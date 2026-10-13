import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Tool } from '@github/copilot-sdk';
import type { AgentAdapter, Feature, RunCallbacks, RunInput, RunResult } from '../src/shared/types';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { sha256 } from '../src/host/PolicyEngine';
import { WorkspaceLease } from '../src/host/WorkspaceLease';

const execute = promisify(execFile);
const roots: string[] = [],
  services: StudioService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  const { stdout } = await execute(
    'git',
    [
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    { cwd: root, env, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}
const finished = (): RunResult => ({
  content: '# Local fixture deliverable',
  questions: [],
  changedFiles: [],
  model: 'fixture',
  usage: { source: 'measured', inputTokens: 1, outputTokens: 1 },
});
type Behavior = (
  input: RunInput,
  callbacks: RunCallbacks,
  signal: AbortSignal,
) => Promise<RunResult>;
function fakeAdapter(record: RunInput[], behavior: () => Behavior): AgentAdapter {
  return {
    check: vi.fn(async () => ({
      state: 'ready' as const,
      authenticated: true,
      models: [{ id: 'fixture', name: 'Fixture' }],
    })),
    run: vi.fn(async (input, callbacks, signal) => {
      record.push(input);
      callbacks.onSession(`fixture-${record.length}`);
      return behavior()(input, callbacks, signal);
    }),
    dispose: vi.fn(async () => {}),
  };
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-workspace-service-')));
  roots.push(root);
  const workspace = join(root, 'repo'),
    storage = join(root, 'storage');
  await mkdir(join(workspace, 'src'), { recursive: true });
  await mkdir(join(workspace, 'tests'));
  await writeFile(join(workspace, 'src/app.ts'), 'export const answer = 1;\n');
  await writeFile(join(workspace, 'tests/proof.txt'), 'initial proof\n');
  await writeFile(join(workspace, 'stable.txt'), 'stable\n');
  await git(workspace, 'init', '-b', 'fixture');
  await git(workspace, 'add', '.');
  await git(workspace, 'commit', '-m', 'Fixture baseline');
  const service = new StudioService(workspace, resolve('defaults'), new Store(storage), () => true);
  services.push(service);
  await service.initialize();
  const inputs: RunInput[] = [];
  let behavior: Behavior = async () => finished();
  const adapter = fakeAdapter(inputs, () => behavior);
  service.adapter = adapter;
  await service.checkRuntime();
  return {
    root,
    workspace,
    storage,
    service,
    adapter,
    inputs,
    run(fn: Behavior) {
      behavior = fn;
    },
  };
}
async function isolated(
  f: Awaited<ReturnType<typeof fixture>>,
  title = 'Isolated fixture',
): Promise<Feature> {
  return f.service.createFeature({
    title,
    description: 'Local Git integration, no inference',
    workflowId: 'single',
    isolated: true,
  });
}
async function invoke(tools: Tool[], name: string, args: unknown) {
  const tool = tools.find((item) => item.name === name);
  if (!tool?.handler) throw new Error(`Missing ${name}`);
  return (await tool.handler(args, {
    sessionId: 'fixture',
    toolCallId: 'local',
    toolName: name,
    arguments: args,
  })) as { resultType: string; textResultForLlm: string };
}
async function replace(tools: Tool[], file: string, content: string) {
  expect((await invoke(tools, 'studio_read_file', { path: file })).resultType).toBe('success');
  expect((await invoke(tools, 'studio_write_file', { path: file, content })).resultType).toBe(
    'success',
  );
}
async function testSettings(service: StudioService) {
  await service.saveSettings({
    ...service.state.settings,
    testCommands: [
      {
        id: 'local',
        name: 'Local proof',
        command: process.execPath,
        args: [
          '-e',
          'console.log(process.cwd()); console.log(require("fs").readFileSync("tests/proof.txt", "utf8"))',
        ],
      },
    ],
  });
}
function testsProfile(feature: Feature) {
  feature.steps[0].agentId = 'fs-tests';
  feature.steps[0].policy = 'tests';
}
async function approve(service: StudioService, feature: Feature) {
  const step = feature.steps[0],
    attempt = step.attempts.at(-1)!;
  await service.approveStep(feature.id, step.id, attempt.id, attempt.revision ?? 0);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function untilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('Cancelled fixture'));
    else
      signal.addEventListener('abort', () => reject(new Error('Cancelled fixture')), {
        once: true,
      });
  });
}

describe('StudioService isolated workspaces with real local Git and a fake agent', () => {
  it('creates from committed HEAD while dirty source bytes, staged index and source hooks remain intact', async () => {
    const f = await fixture();
    await writeFile(join(f.workspace, 'src/app.ts'), 'staged human content\n');
    await git(f.workspace, 'add', 'src/app.ts');
    await writeFile(join(f.workspace, 'src/app.ts'), 'unstaged human content\n');
    await writeFile(join(f.workspace, 'human-untracked.txt'), 'human untracked\n');
    const hookDirectory = join(f.root, 'source-hooks'),
      hookMarker = join(f.root, 'post-checkout-ran');
    await mkdir(hookDirectory);
    await writeFile(join(hookDirectory, 'post-checkout'), `#!/bin/sh\ntouch "${hookMarker}"\n`);
    await chmod(join(hookDirectory, 'post-checkout'), 0o700);
    await git(f.workspace, 'config', 'core.hooksPath', hookDirectory);
    // A same-content timestamp change makes an accidental source status refresh visible in the index bytes.
    const future = new Date(Date.now() + 5000);
    await utimes(join(f.workspace, 'stable.txt'), future, future);
    const sourceIndex = await readFile(join(f.workspace, '.git/index')),
      beforeStatus = await git(f.workspace, 'status', '--porcelain=v1', '-z');
    const head = (await git(f.workspace, 'rev-parse', 'HEAD')).trim();
    const feature = await isolated(f),
      worktree = await f.service.featurePath(feature.id);
    expect(worktree).not.toBe(f.workspace);
    expect(feature.worktree?.baseCommit).toBe(head);
    expect(feature.worktree?.baseBranch).toBe('fixture');
    expect(await readFile(join(worktree, 'src/app.ts'), 'utf8')).toBe('export const answer = 1;\n');
    await expect(readFile(join(worktree, 'human-untracked.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(f.workspace, 'src/app.ts'), 'utf8')).toBe(
      'unstaged human content\n',
    );
    expect(await readFile(join(f.workspace, 'human-untracked.txt'), 'utf8')).toBe(
      'human untracked\n',
    );
    expect(await readFile(join(f.workspace, '.git/index'))).toEqual(sourceIndex);
    expect(await git(f.workspace, 'status', '--porcelain=v1', '-z')).toBe(beforeStatus);
    expect((await git(f.workspace, 'symbolic-ref', '--short', 'HEAD')).trim()).toBe('fixture');
    expect((await git(f.workspace, 'config', '--local', '--get', 'core.hooksPath')).trim()).toBe(
      hookDirectory,
    );
    await expect(readFile(hookMarker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.service.store.load()).features[0].worktree?.path).toBe(worktree);
  });

  it('routes host tools, hooks, test commands, checkpoints and approval evidence to the worktree', async () => {
    const f = await fixture();
    await writeFile(join(f.workspace, 'src/app.ts'), 'source human content\n');
    const feature = await isolated(f);
    testsProfile(feature);
    const worktree = await f.service.featurePath(feature.id);
    await testSettings(f.service);
    await f.service.saveSettings({
      ...f.service.state.settings,
      hooks: ['beforeRun', 'afterRun'].map((event) => ({
        id: event,
        name: event,
        event: event as 'beforeRun' | 'afterRun',
        enabled: true,
        command: process.execPath,
        args: [
          '-e',
          `require("fs").writeFileSync(${JSON.stringify(event + '.txt')}, process.cwd())`,
        ],
      })),
    });
    f.run(async (input, callbacks, signal) => {
      expect(input.workspacePath).toBe(worktree);
      const tools = await f.service.getTools(input, callbacks, signal);
      const source = await invoke(tools, 'studio_read_file', { path: 'src/app.ts' });
      expect(source.textResultForLlm).toContain('answer = 1');
      expect(source.textResultForLlm).not.toContain('source human');
      await replace(tools, 'tests/proof.txt', 'worktree test proof\n');
      const proof = await invoke(tools, 'studio_run_test', { id: 'local' });
      expect(proof.resultType).toBe('success');
      expect(proof.textResultForLlm).toContain(worktree);
      return finished();
    });
    await f.service.runStep(feature.id, 'session');
    const attempt = feature.steps[0].attempts.at(-1)!;
    expect(attempt.evidence?.[0].stdout).toContain(worktree);
    const before = feature.checkpoints!.find((point) => point.id === attempt.checkpointBeforeId)!,
      after = feature.checkpoints!.find((point) => point.id === attempt.checkpointAfterId)!;
    expect(before).toMatchObject({ kind: 'before-run', attemptId: attempt.id, stepId: 'session' });
    expect(after).toMatchObject({ kind: 'after-run', attemptId: attempt.id, stepId: 'session' });
    expect(
      await f.service.workspaces.readFile(feature, before.id, 'beforeRun.txt'),
    ).toBeUndefined();
    expect(
      (await f.service.workspaces.readFile(feature, after.id, 'afterRun.txt'))?.toString(),
    ).toBe(worktree);
    for (const event of ['beforeRun', 'afterRun']) {
      expect(await readFile(join(worktree, event + '.txt'), 'utf8')).toBe(worktree);
      await expect(readFile(join(f.workspace, event + '.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
    await approve(f.service, feature);
    expect(feature.steps[0].status).toBe('approved');
    await f.service.runStep(feature.id, 'session');
    await writeFile(join(worktree, 'src/app.ts'), 'human worktree change\n');
    await expect(approve(f.service, feature)).rejects.toThrow('preuve de test est obsolète');
    expect(feature.steps[0].status).toBe('awaiting_review');
    expect(await readFile(join(f.workspace, 'src/app.ts'), 'utf8')).toBe('source human content\n');
  });

  it.each(['failed', 'cancelled'] as const)(
    'persists before/after attempt checkpoints after a %s partial write',
    async (status) => {
      const f = await fixture(),
        feature = await isolated(f),
        entered = deferred<void>();
      f.run(async (input, callbacks, signal) => {
        await replace(
          await f.service.getTools(input, callbacks, signal),
          'src/app.ts',
          'partial fixture write\n',
        );
        entered.resolve();
        if (status === 'failed') throw new Error('Expected fixture failure');
        return untilAbort(signal);
      });
      const run = f.service.runStep(feature.id, 'session');
      await entered.promise;
      if (status === 'cancelled') f.service.cancel(feature.id);
      await run;
      const saved = (await f.service.store.load()).features[0],
        attempt = saved.steps[0].attempts.at(-1)!;
      expect(attempt.status).toBe(status);
      expect(attempt.changedFiles).toEqual(['src/app.ts']);
      expect(attempt.checkpointBeforeId).toBeTruthy();
      expect(attempt.checkpointAfterId).toBeTruthy();
      expect(
        saved.checkpoints?.find((point) => point.id === attempt.checkpointAfterId),
      ).toMatchObject({ kind: 'after-run', attemptId: attempt.id });
      expect(
        (
          await f.service.workspaces.readFile(saved, attempt.checkpointBeforeId!, 'src/app.ts')
        )?.toString(),
      ).toBe('export const answer = 1;\n');
      expect(
        (
          await f.service.workspaces.readFile(saved, attempt.checkpointAfterId!, 'src/app.ts')
        )?.toString(),
      ).toBe('partial fixture write\n');
      expect(await readFile(join(f.workspace, 'src/app.ts'), 'utf8')).toBe(
        'export const answer = 1;\n',
      );
    },
  );

  it('compares immutable historical checkpoints independently of subsequent live changes', async () => {
    const f = await fixture(),
      feature = await isolated(f),
      worktree = await f.service.featurePath(feature.id);
    await f.service.createCheckpoint(feature.id, 'Version 1');
    const first = feature.checkpoints!.at(-1)!;
    await writeFile(join(worktree, 'src/app.ts'), 'version 2\n');
    await f.service.createCheckpoint(feature.id, 'Version 2');
    const second = feature.checkpoints!.at(-1)!;
    await writeFile(join(worktree, 'src/app.ts'), 'version 3 live\n');
    const historical = await f.service.compareCheckpoint(feature.id, first.id, second.id),
      live = await f.service.compareCheckpoint(feature.id, first.id);
    expect(historical.files[0].afterHash).toBe(sha256('version 2\n'));
    expect(live.files[0].afterHash).toBe(sha256('version 3 live\n'));
    expect(
      (
        await f.service.checkpointDiff(feature.id, first.id, 'src/app.ts', second.id)
      ).after?.toString(),
    ).toBe('version 2\n');
    expect(
      (await f.service.checkpointDiff(feature.id, first.id, 'src/app.ts')).after?.toString(),
    ).toBe('version 3 live\n');
    await writeFile(join(worktree, 'src/app.ts'), 'version 4 live\n');
    expect((await f.service.compareCheckpoint(feature.id, first.id, second.id)).fingerprint).toBe(
      historical.fingerprint,
    );
    expect((await f.service.compareCheckpoint(feature.id, first.id)).fingerprint).not.toBe(
      live.fingerprint,
    );
  });

  it('durably saves recovery before selected restore, invalidates review, and allows a new attempt to rewrite restored owned bytes', async () => {
    const f = await fixture(),
      feature = await isolated(f),
      worktree = await f.service.featurePath(feature.id);
    testsProfile(feature);
    await testSettings(f.service);
    let version = 'version 2\n';
    f.run(async (input, callbacks, signal) => {
      const tools = await f.service.getTools(input, callbacks, signal);
      await replace(tools, 'tests/proof.txt', version);
      expect((await invoke(tools, 'studio_run_test', { id: 'local' })).resultType).toBe('success');
      return finished();
    });
    await f.service.runStep(feature.id, 'session');
    await approve(f.service, feature);
    const earlier = feature.steps[0].attempts.at(-1)!.checkpointAfterId!;
    version = 'version 3\n';
    await f.service.runStep(feature.id, 'session');
    await approve(f.service, feature);
    const previous = feature.steps[0].attempts.at(-1)!,
      revision = previous.revision ?? 0;
    await writeFile(join(worktree, 'src/app.ts'), 'unselected human change\n');
    const comparison = await f.service.compareCheckpoint(feature.id, earlier);
    let recoveryId = '';
    await f.service.restoreCheckpoint(
      feature.id,
      earlier,
      ['tests/proof.txt'],
      comparison.fingerprint,
      async () => {
        const disk = (await new Store(f.storage).load()).features[0],
          recovery = disk.checkpoints!.at(-1)!;
        recoveryId = recovery.id;
        expect(recovery.kind).toBe('recovery');
        expect(disk.steps[0].status).toBe('stale');
        expect(await readFile(join(worktree, 'tests/proof.txt'), 'utf8')).toBe('version 3\n');
        expect(
          (await f.service.workspaces.readFile(disk, recovery.id, 'tests/proof.txt'))?.toString(),
        ).toBe('version 3\n');
      },
    );
    expect(await readFile(join(worktree, 'tests/proof.txt'), 'utf8')).toBe('version 2\n');
    expect(await readFile(join(worktree, 'src/app.ts'), 'utf8')).toBe('unselected human change\n');
    expect(feature.steps[0].status).toBe('stale');
    expect(previous.revision).toBeGreaterThan(revision);
    expect(feature.workspaceFileHashes?.['tests/proof.txt']).toBe(sha256('version 2\n'));
    await expect(
      f.service.approveStep(feature.id, 'session', previous.id, revision),
    ).rejects.toThrow('livrable a changé');
    expect((await f.service.store.load()).features[0].checkpoints!.at(-1)!.id).toBe(recoveryId);
    version = 'version 4\n';
    await f.service.runStep(feature.id, 'session');
    expect(feature.steps[0].status).toBe('awaiting_review');
    expect(await readFile(join(worktree, 'tests/proof.txt'), 'utf8')).toBe('version 4\n');
    expect(await readFile(join(f.workspace, 'tests/proof.txt'), 'utf8')).toBe('initial proof\n');
  });

  it('refuses a stale restore comparison and preserves a recovery point when the target changes after backup', async () => {
    const f = await fixture(),
      feature = await isolated(f),
      worktree = await f.service.featurePath(feature.id);
    await f.service.createCheckpoint(feature.id, 'Baseline');
    const checkpoint = feature.checkpoints!.at(-1)!;
    await writeFile(join(worktree, 'src/app.ts'), 'version 2\n');
    const stale = await f.service.compareCheckpoint(feature.id, checkpoint.id);
    await writeFile(join(worktree, 'src/app.ts'), 'human version 3\n');
    await expect(
      f.service.restoreCheckpoint(feature.id, checkpoint.id, ['src/app.ts'], stale.fingerprint),
    ).rejects.toThrow('Actualise la comparaison');
    expect(feature.checkpoints).toHaveLength(1);
    const current = await f.service.compareCheckpoint(feature.id, checkpoint.id);
    await expect(
      f.service.restoreCheckpoint(
        feature.id,
        checkpoint.id,
        ['src/app.ts'],
        current.fingerprint,
        async () => {
          await writeFile(join(worktree, 'src/app.ts'), 'human version 4\n');
        },
      ),
    ).rejects.toThrow('workspace a changé après la sauvegarde');
    expect(await readFile(join(worktree, 'src/app.ts'), 'utf8')).toBe('human version 4\n');
    const recovery = (await f.service.store.load()).features[0].checkpoints!.at(-1)!;
    expect(recovery.kind).toBe('recovery');
    expect(
      (await f.service.workspaces.readFile(feature, recovery.id, 'src/app.ts'))?.toString(),
    ).toBe('human version 3\n');
  });

  it('never mutates checkout files when recovery state persistence fails', async () => {
    const f = await fixture(),
      feature = await isolated(f),
      worktree = await f.service.featurePath(feature.id);
    await f.service.createCheckpoint(feature.id, 'Baseline');
    const checkpoint = feature.checkpoints!.at(-1)!;
    await writeFile(join(worktree, 'src/app.ts'), 'current protected content\n');
    const comparison = await f.service.compareCheckpoint(feature.id, checkpoint.id);
    const persist = vi
      .spyOn(f.service, 'persist')
      .mockRejectedValueOnce(new Error('Fixture storage failure'));
    await expect(
      f.service.restoreCheckpoint(
        feature.id,
        checkpoint.id,
        ['src/app.ts'],
        comparison.fingerprint,
      ),
    ).rejects.toThrow('Fixture storage failure');
    expect(await readFile(join(worktree, 'src/app.ts'), 'utf8')).toBe(
      'current protected content\n',
    );
    persist.mockRestore();
    expect((await f.service.store.load()).features[0].checkpoints).toHaveLength(1);
  });

  it.each(['changed branch', 'missing worktree'] as const)(
    'refuses %s before reaching the adapter or creating an attempt',
    async (failure) => {
      const f = await fixture(),
        feature = await isolated(f),
        worktree = await f.service.featurePath(feature.id);
      if (failure === 'changed branch') await git(worktree, 'checkout', '-b', 'human-other-branch');
      else await rm(worktree, { recursive: true });
      await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow(
        failure === 'changed branch' ? /branche du worktree a changé/ : /ENOENT/,
      );
      expect(f.adapter.run).not.toHaveBeenCalled();
      expect(feature.steps[0].attempts).toHaveLength(0);
    },
  );

  it('reserves the cockpit across features and holds a target lease against a second service instance', async () => {
    const f = await fixture(),
      feature = await isolated(f),
      other = await isolated(f, 'Other feature'),
      entered = deferred<void>();
    // extension.ensure owns the source lease for the entire cockpit lifetime, before initialize.
    const sourceLease = new WorkspaceLease(f.workspace);
    const sameSourceWindow = new WorkspaceLease(f.workspace);
    const targetWindow = new WorkspaceLease(feature.worktree!.path);
    await sourceLease.acquire();
    try {
      await expect(sameSourceWindow.acquire()).rejects.toThrow('autre fenêtre');
      f.run(async (_input, _callbacks, signal) => {
        entered.resolve();
        return untilAbort(signal);
      });
      const running = f.service.runStep(feature.id, 'session');
      await entered.promise;
      await expect(f.service.runStep(other.id, 'session')).rejects.toThrow('opération en cours');
      await expect(
        f.service.createCheckpoint(other.id, 'Forbidden concurrent operation'),
      ).rejects.toThrow('opération en cours');
      // A second VS Code window opened in the target cannot initialize its cockpit during a run.
      await expect(targetWindow.acquire()).rejects.toThrow('autre fenêtre');
      f.service.cancel(feature.id);
      await running;
      const attemptId = feature.steps[0].attempts.at(-1)!.id;
      await targetWindow.acquire();
      const secondary = new StudioService(
        feature.worktree!.path,
        resolve('defaults'),
        new Store(join(f.root, 'second-window-storage')),
        () => true,
      );
      services.push(secondary);
      await secondary.initialize();
      const secondFeature = await secondary.createFeature({
        title: 'Other window session',
        description: '',
        workflowId: 'single',
      });
      await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow('autre fenêtre');
      await secondary.createCheckpoint(secondFeature.id, 'Lease released after cancellation');
      expect(secondFeature.checkpoints!.at(-1)!.label).toBe('Lease released after cancellation');
      const persisted = (await new Store(f.storage).load()).features.find(
        (item) => item.id === feature.id,
      )!;
      expect(persisted.steps[0].attempts.map((attempt) => attempt.id)).toContain(attemptId);
    } finally {
      await targetWindow.release();
      await sourceLease.release();
    }
  });
});
