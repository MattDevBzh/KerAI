import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Tool } from '@github/copilot-sdk';
import { ProjectCatalog } from '../src/host/ProjectCatalog';
import { DedicatedWindow, windowsShortcutScript } from '../src/host/DedicatedWindow';
import { StudioHub } from '../src/host/StudioHub';
import type { DevOpsController } from '../src/host/DevOpsController';
import { StudioService } from '../src/host/StudioService';
import {
  MultiProjectTools,
  inspectProjectChanges,
  backupProjectChanges,
} from '../src/host/MultiProjectTools';
import { Store } from '../src/core/store';
import { WorkflowEngine } from '../src/core/workflow';
import { emptyLaunch } from '../src/core/context';
import { runProcess } from '../src/host/process';
import { sha256 } from '../src/host/PolicyEngine';
import { currentTestEvidence, evidenceIsCurrent } from '../src/core/validation';
import type { RunInput, TestEvidence, AgentAdapter } from '../src/shared/types';
import { demoState } from '../webview/demo';

const roots: string[] = [],
  cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-projects-')));
  roots.push(root);
  return root;
}
async function git(root: string, ...args: string[]) {
  const result = await runProcess(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ],
    root,
  );
  if (result.code) throw new Error(result.stderr);
  return result.stdout.trim();
}
async function repositories() {
  const root = await directory();
  const projects = await Promise.all(
    ['api', 'web'].map(async (name) => {
      const path = join(root, name);
      await mkdir(path);
      await writeFile(join(path, 'same.txt'), name + '\n');
      await git(path, 'init', '-b', 'main');
      await git(path, 'add', '.');
      await git(path, 'commit', '-m', 'initial');
      return { id: randomUUID(), name, path, branch: 'main' };
    }),
  );
  return { root, projects };
}
async function invoke(tools: Tool[], name: string, args: unknown) {
  const result = await tools.find((tool) => tool.name === name)!.handler!(args, {
    sessionId: 'fixture',
    toolCallId: 'call',
    toolName: name,
    arguments: args,
  });
  return result as { resultType: string; textResultForLlm: string };
}
async function inputFixture(policy: 'workspace-write' | 'tests' = 'workspace-write') {
  const f = await repositories(),
    engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'single',
      name: 'Single',
      description: '',
      icon: '',
      steps: [
        {
          id: 'run',
          name: 'Run',
          description: '',
          agentId: 'agent',
          skills: [],
          policy,
          maxAttempts: 3,
          artifact: 'report.md',
          dependsOn: [],
        },
      ],
    },
    { title: 'Two projects', description: '', branch: 'main' },
  );
  feature.projects = f.projects;
  const attempt = engine.beginRun(feature.id, 'run');
  const settings = structuredClone(demoState.settings);
  settings.hooks = [];
  settings.testPaths = ['**'];
  settings.testCommands = [
    {
      id: 'unit',
      name: 'Unit',
      command: process.execPath,
      args: ['-e', 'console.log(process.cwd())'],
    },
  ];
  const input: RunInput = {
    workspacePath: f.projects[0].path,
    feature,
    step: feature.steps[0],
    agent: {
      ...demoState.agents[0],
      id: 'agent',
      skills: [],
      tools: ['read', 'search', 'edit', 'execute'],
    },
    skills: [],
    attempt,
    settings,
    launch: emptyLaunch(),
    projects: f.projects.map((project) => ({ ...project, settings: structuredClone(settings) })),
  };
  return { ...f, input };
}

describe('user project catalog and dedicated window', () => {
  it('deduplicates canonical folders, remembers multi selection and keeps legacy session locations', async () => {
    const root = await directory();
    await mkdir(join(root, 'a'));
    await mkdir(join(root, 'b'));
    await symlink(join(root, 'a'), join(root, 'alias'), 'dir');
    const catalog = new ProjectCatalog(join(root, 'user'));
    const [a, b, alias] = await catalog.add(
      [join(root, 'a'), join(root, 'b'), join(root, 'alias')],
      { root: join(root, 'a'), storagePath: join(root, 'old-store') },
    );
    expect(alias.id).toBe(a.id);
    expect(catalog.state.projects).toHaveLength(2);
    await catalog.select([b.id, a.id]);
    await catalog.update(a.id, { name: 'API' });
    const reopened = new ProjectCatalog(catalog.directory);
    await reopened.load();
    expect(reopened.state.selectedProjectIds).toEqual([b.id, a.id]);
    expect(reopened.storage(reopened.resolve([a.id])[0])).toBe(join(root, 'old-store'));
    await reopened.update(b.id, { hidden: true });
    expect(reopened.state.selectedProjectIds).toEqual([a.id]);
    expect(() => reopened.resolve([b.id])).toThrow(/masqué/);
    expect(reopened.state.projects).toHaveLength(2);
  });
  it('rejects overlapping roots, duplicates and unknown selections without saving them', async () => {
    const root = await directory();
    await mkdir(join(root, 'repo', 'nested'), { recursive: true });
    const catalog = new ProjectCatalog(join(root, 'user'));
    const [parent, child] = await catalog.add([join(root, 'repo'), join(root, 'repo/nested')]);
    expect(() => catalog.resolve([parent.id, child.id])).toThrow(/contenir/);
    await expect(catalog.select([parent.id, parent.id])).rejects.toThrow();
    await expect(catalog.select([randomUUID()])).rejects.toThrow();
    expect(catalog.state.selectedProjectIds).toEqual([parent.id]);
  });
  it('creates a private workspace, preserves customization and consumes only fresh allowed commands once', async () => {
    const root = await directory(),
      window = new DedicatedWindow(root);
    await window.prepare();
    const config = JSON.parse(await readFile(window.workspace, 'utf8'));
    expect(config.folders).toEqual([{ name: 'Feature Studio', path: window.home }]);
    expect(config.settings['workbench.editor.showTabs']).toBe('none');
    await writeFile(window.workspace, 'custom settings');
    await window.prepare();
    expect(await readFile(window.workspace, 'utf8')).toBe('custom settings');
    await window.enqueue('newFeature');
    await writeFile(
      join(window.requests, `${randomUUID()}.json`),
      JSON.stringify({ action: 'arbitrary-shell', createdAt: Date.now() }),
    );
    await writeFile(
      join(window.requests, `${randomUUID()}.json`),
      JSON.stringify({ action: 'installKit', createdAt: 1 }),
    );
    expect((await window.takeRequests()).map((request) => request.action)).toEqual(['newFeature']);
    expect(await window.takeRequests()).toEqual([]);
    const script = windowsShortcutScript(
      "C:\\O'Brien\\Code - Insiders.exe",
      'C:\\$value\\Feature Studio.code-workspace',
    );
    expect(script).toContain("'C:\\O''Brien\\Code - Insiders.exe'");
    expect(script).toContain('--new-window "C:\\$value\\Feature Studio.code-workspace"');
    expect(() => windowsShortcutScript('code.exe', 'unsafe\ncommand')).toThrow();
  });
});

describe('explicit multi-project execution', () => {
  it('routes same-named files and writes to the selected project, denies escapes and ambiguous calls', async () => {
    const f = await inputFixture(),
      [a, b] = f.projects;
    const host = new MultiProjectTools(
      f.input,
      { onEvent() {}, onSession() {} },
      new AbortController().signal,
    );
    const tools = await host.createTools();
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    expect((tools[0].parameters as { required: string[] }).required).toContain('projectId');
    for (const project of f.projects) {
      const read = await invoke(tools, 'studio_read_file', {
        projectId: project.id,
        path: 'same.txt',
      });
      expect(read.resultType).toBe('success');
      expect(read.textResultForLlm).toContain(project.name);
    }
    expect((await invoke(tools, 'studio_read_file', { path: 'same.txt' })).resultType).toBe(
      'failure',
    );
    expect(
      (await invoke(tools, 'studio_read_file', { projectId: 'unknown', path: 'same.txt' }))
        .resultType,
    ).toBe('failure');
    expect(
      (await invoke(tools, 'studio_read_file', { projectId: a.id, path: '../web/same.txt' }))
        .resultType,
    ).toBe('failure');
    expect(
      (
        await invoke(tools, 'studio_write_file', {
          projectId: b.id,
          path: 'same.txt',
          content: 'changed\n',
        })
      ).resultType,
    ).toBe('success');
    expect(await readFile(join(a.path, 'same.txt'), 'utf8')).toBe('api\n');
    expect(await readFile(join(b.path, 'same.txt'), 'utf8')).toBe('changed\n');
    expect([...host.changedFiles]).toEqual([`@${b.id}/same.txt`]);
    expect(host.fileHashes).toEqual({ [`@${b.id}/same.txt`]: sha256('changed\n') });
  });
  it('grants and backs up human changes only in the explicitly selected project', async () => {
    const f = await inputFixture(),
      [a, b] = f.projects;
    for (const project of f.projects)
      await writeFile(join(project.path, 'same.txt'), `human ${project.name}\n`);
    f.input.launch!.editableExistingFiles = [`@${b.id}/same.txt`];
    const preview = await inspectProjectChanges(f.input);
    expect(preview.files.map((file) => file.path)).toEqual([
      `@${a.id}/same.txt`,
      `@${b.id}/same.txt`,
    ]);
    expect(f.input.existingChangeGrants).toEqual({ [`@${b.id}/same.txt`]: sha256('human web\n') });
    const backup = await backupProjectChanges(
      f.input,
      join(f.root, 'backup'),
      new AbortController().signal,
    );
    expect(backup).toContain(b.id);
    const host = new MultiProjectTools(
        f.input,
        { onEvent() {}, onSession() {} },
        new AbortController().signal,
      ),
      tools = await host.createTools();
    for (const project of f.projects)
      await invoke(tools, 'studio_read_file', { projectId: project.id, path: 'same.txt' });
    expect(
      (
        await invoke(tools, 'studio_write_file', {
          projectId: a.id,
          path: 'same.txt',
          content: 'bad',
        })
      ).resultType,
    ).toBe('failure');
    expect(
      (
        await invoke(tools, 'studio_write_file', {
          projectId: b.id,
          path: 'same.txt',
          content: 'good',
        })
      ).resultType,
    ).toBe('success');
  });
  it('keeps independent test evidence for an identical command id in two repositories', async () => {
    const f = await inputFixture('tests'),
      proofs: TestEvidence[] = [];
    const host = new MultiProjectTools(
        f.input,
        {
          onEvent() {},
          onSession() {},

          onEvidence(proof) {
            proofs.push(proof);
          },
        },
        new AbortController().signal,
      ),
      tools = await host.createTools();
    for (const project of f.projects) {
      await invoke(tools, 'studio_read_file', { projectId: project.id, path: 'same.txt' });
      expect(
        (await invoke(tools, 'studio_run_test', { projectId: project.id, id: 'unit' })).resultType,
      ).toBe('success');
    }
    expect(proofs).toHaveLength(2);
    expect(proofs.map((proof) => proof.stdout.trim())).toEqual(
      f.projects.map((project) => project.path),
    );
    f.input.attempt.evidence = proofs;
    f.input.attempt.fileHashes = Object.assign({}, ...proofs.map((proof) => proof.fileHashes));
    expect(currentTestEvidence(f.input.attempt)).toHaveLength(2);
    expect(proofs.every((proof) => evidenceIsCurrent(f.input.attempt, proof))).toBe(true);
    f.input.attempt.fileHashes![`@${f.projects[0].id}/same.txt`] = 'changed';
    expect(evidenceIsCurrent(f.input.attempt, proofs[0])).toBe(false);
    expect(evidenceIsCurrent(f.input.attempt, proofs[1])).toBe(true);
  });
  it('restores a checkpoint in the secondary project without touching the primary and rejects cross-project comparison', async () => {
    const f = await repositories(),
      service = new StudioService(
        f.projects[0].path,
        resolve('defaults'),
        new Store(join(f.root, 'storage')),
        () => true,
      );
    cleanup.push(() => service.dispose());
    await service.initialize();
    const feature = await service.createFeature({
      title: 'Two',
      description: '',
      projects: f.projects,
    });
    await service.createCheckpoint(feature.id, 'API', f.projects[0].id);
    await service.createCheckpoint(feature.id, 'Web', f.projects[1].id);
    const [a, b] = feature.checkpoints!;
    await expect(service.compareCheckpoint(feature.id, a.id, b.id)).rejects.toThrow();
    await writeFile(join(f.projects[1].path, 'same.txt'), 'changed web');
    const comparison = await service.compareCheckpoint(feature.id, b.id);
    expect(comparison.files.map((file) => file.path)).toEqual(['same.txt']);
    expect((await service.checkpointDiff(feature.id, b.id, 'same.txt')).before?.toString()).toBe(
      'web\n',
    );
    await service.restoreCheckpoint(feature.id, b.id, ['same.txt'], comparison.fingerprint);
    expect(await readFile(join(f.projects[1].path, 'same.txt'), 'utf8')).toBe('web\n');
    expect(await readFile(join(f.projects[0].path, 'same.txt'), 'utf8')).toBe('api\n');
    expect(feature.checkpoints!.at(-1)?.projectId).toBe(f.projects[1].id);
    expect(feature.workspaceFileHashes).toEqual({
      [`@${f.projects[1].id}/same.txt`]: sha256('web\n'),
    });
    expect((await service.store.load()).features[0].projects).toEqual(f.projects);
    await expect(
      service.createFeature({
        title: 'Invalid',
        description: '',
        projects: f.projects,
        isolated: true,
      }),
    ).rejects.toThrow(/seul projet/);
  });
  it('checks every branch before inference and executes one session across both projects', async () => {
    const f = await repositories(),
      service = new StudioService(
        f.projects[0].path,
        resolve('defaults'),
        new Store(join(f.root, 'storage')),
        () => true,
      );
    cleanup.push(() => service.dispose());
    await service.initialize();
    const run = vi.fn(
      async (
        input: RunInput,
        callbacks: import('../src/shared/types').RunCallbacks,
        signal: AbortSignal,
      ) => {
        const tools = await service.getTools(input, callbacks, signal);
        for (const project of f.projects) {
          expect(
            (await invoke(tools, 'studio_read_file', { projectId: project.id, path: 'same.txt' }))
              .resultType,
          ).toBe('success');
          expect(
            (
              await invoke(tools, 'studio_write_file', {
                projectId: project.id,
                path: 'same.txt',
                content: `updated ${project.name}\n`,
              })
            ).resultType,
          ).toBe('success');
        }
        return { content: 'Both projects updated', questions: [], changedFiles: [] };
      },
    );
    service.adapter = {
      run,
      check: async () => ({ state: 'ready', authenticated: true, models: [] }),
      dispose: async () => {},
    };
    await service.checkRuntime();
    const feature = await service.createFeature({
      title: 'Two projects',
      description: '',
      workflowId: 'single',
      projects: f.projects,
    });
    const preview = await service.previewRun(feature.id, 'session');
    expect(preview.errors).toEqual([]);
    expect(preview.sections.find((section) => section.id === 'projects')?.content).toContain(
      f.projects[1].path,
    );
    await git(f.projects[1].path, 'checkout', '-b', 'other');
    await expect(
      service.runStep(feature.id, 'session', '', false, emptyLaunch(), preview.fingerprint),
    ).rejects.toThrow(/branche/);
    expect(run).not.toHaveBeenCalled();
    expect(feature.steps[0].attempts).toHaveLength(0);
    await git(f.projects[1].path, 'checkout', 'main');
    await service.runStep(feature.id, 'session', '', false, emptyLaunch(), preview.fingerprint);
    expect(run).toHaveBeenCalledTimes(1);
    expect(feature.steps[0].status).toBe('awaiting_review');
    expect(feature.steps[0].attempts[0].changedFiles).toEqual(
      f.projects.map((project) => `@${project.id}/same.txt`),
    );
    expect((await service.store.load()).features[0].steps[0].attempts[0].fileHashes).toEqual(
      Object.fromEntries(
        f.projects.map((project) => [
          `@${project.id}/same.txt`,
          sha256(`updated ${project.name}\n`),
        ]),
      ),
    );
  });
  it('aggregates session histories and routes to the owning service with a shared execution guard', async () => {
    const f = await repositories(),
      catalog = new ProjectCatalog(join(f.root, 'user'));
    const projects = await catalog.add(f.projects.map((project) => project.path));
    const hub = new StudioHub(
      catalog,
      async (project) => {
        const service = new StudioService(
          project!.path,
          resolve('defaults'),
          new Store(catalog.storage(project!)),
          () => true,
        );
        await service.initialize();
        return {
          project,
          service,
          devops: { dispose: vi.fn(async () => {}) } as unknown as DevOpsController,
        };
      },
      true,
      false,
    );
    cleanup.push(() => hub.dispose());
    await hub.initialize();
    const a = await hub.entry(projects[0].id),
      b = await hub.entry(projects[1].id);
    const first = await a.service.createFeature({ title: 'API', description: '' }),
      second = await b.service.createFeature({ title: 'Web', description: '' });
    await hub.activateFeature(second.id);
    expect((await hub.current()).service).toBe(b.service);
    expect(hub.snapshot()!.features.map((feature) => feature.id)).toEqual([first.id, second.id]);
    a.service.state.workspaceOperation = { label: 'running' };
    await expect(b.service.createFeature({ title: 'Blocked', description: '' })).rejects.toThrow(
      /opération/,
    );
    a.service.state.workspaceOperation = undefined;
    await hub.select(projects.map((project) => project.id));
    expect(hub.snapshot()!.projectCatalog?.selectedProjectIds).toEqual(
      projects.map((project) => project.id),
    );
  });
});
