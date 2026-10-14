import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentAdapter, Feature, RunCallbacks, RunInput, RunResult } from '../src/shared/types';
import { StudioService } from '../src/host/StudioService';
import { Store, defaultSettings } from '../src/core/store';
import { SessionArchive } from '../src/host/SessionArchive';
import { sessionDirectory, readPrivate } from '../src/host/SessionFiles';
import { markDeletion, pendingDeletions } from '../src/host/SessionCleanup';
import {
  sumUsage,
  observerUsage,
  observationHtml,
  observationMarkdown,
} from '../src/shared/observationReport';
import { runProcess } from '../src/host/process';

const roots: string[] = [],
  services: StudioService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()));
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
const usage = {
  source: 'measured' as const,
  inputTokens: 100,
  outputTokens: 20,
  cost: 100000000,
  unit: 'nano-AIU',
  model: 'observed-model',
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'studio-observer-'));
  roots.push(root);
  const workspace = join(root, 'repo'),
    storage = join(root, 'storage');
  await mkdir(workspace);
  await writeFile(join(workspace, 'app.txt'), 'protected project content');
  for (const args of [
    ['init', '-b', 'fixture'],
    ['add', '.'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Fixture',
    ],
  ]) {
    const result = await runProcess('git', args, workspace);
    if (result.code) throw new Error(result.stderr);
  }
  const service = new StudioService(workspace, resolve('defaults'), new Store(storage), () => true);
  services.push(service);
  await service.initialize();
  let behavior: (
    input: RunInput,
    callbacks: RunCallbacks,
    signal: AbortSignal,
  ) => Promise<RunResult> = async (input, callbacks) => {
    const reference = input.preparedPrompt?.match(/s-[a-f0-9]{40}/)?.[0];
    callbacks.onUsage!(usage);
    callbacks.onSession(`sdk-${input.attempt.id}`);
    return {
      content: JSON.stringify({
        summary: 'Les phases sont cohérentes.',
        strengths: ['La demande est explicite.'],
        findings: [
          {
            kind: 'recommendation',
            title: 'Préciser le résultat attendu',
            detail: 'Ajouter un critère observable avant cette phase.',
            impact: 'medium',
            references: [reference],
          },
        ],
      }),
      questions: [],
      changedFiles: [],
      usage,
      model: 'observed-model',
    };
  };
  const adapter: AgentAdapter = {
    check: vi.fn(async () => ({
      state: 'ready' as const,
      authenticated: true,
      models: [{ id: 'requested-model', name: 'Requested' }],
    })),
    run: vi.fn((input: RunInput, callbacks: RunCallbacks, signal: AbortSignal) =>
      behavior(input, callbacks, signal),
    ),
    dispose: vi.fn(async () => {}),
    deleteSessions: vi.fn(async () => {}),
  };
  service.adapter = adapter;
  await service.checkRuntime();
  const workflow = {
    id: 'fixture',
    name: 'Feature complète',
    description: '',
    icon: '',
    steps: ['plan', 'dev'].map((id) => ({
      id,
      name: id === 'plan' ? 'Plan' : 'Développement',
      description: '',
      agentId: service.state.agents[0].id,
      policy: 'read-only' as const,
      skills: [],
      maxAttempts: 3,
      artifact: `${id}.md`,
      dependsOn: id === 'dev' ? ['plan'] : [],
    })),
  };
  const feature = service.engine.createFeature(workflow, {
    title: 'Feature test',
    description: 'Un besoin concret',
    branch: 'fixture',
  });
  await service.persist();
  return {
    root,
    workspace,
    storage,
    service,
    feature,
    adapter,
    behavior: (fn: typeof behavior) => {
      behavior = fn;
    },
  };
}
const options = { model: 'requested-model', maxCalls: 20 };
async function run(f: Awaited<ReturnType<typeof fixture>>) {
  const preview = await f.service.previewObservation(f.feature.id, options);
  await f.service.observeSession(f.feature.id, options, preview.fingerprint);
  return f.feature.observations!.at(-1)!;
}

describe('complete, sourced single-session observations', () => {
  it('reviews every phase, preserves the workflow, measures its own calls and freezes source content', async () => {
    const f = await fixture();
    const state = JSON.stringify({ ...f.feature, observations: undefined });
    const report = await run(f);
    expect(report.status).toBe('completed');
    expect(report.coverage.complete).toBe(true);
    expect(report.phases.map((p) => p.name)).toEqual(['Plan', 'Développement']);
    expect(report.coverage.analyzedParts).toBe(report.coverage.totalParts);
    expect(JSON.stringify({ ...f.feature, observations: undefined })).toBe(state);
    expect(observerUsage(report)?.cost).toBe(report.calls.length * usage.cost);
    expect(report.calls.every((c) => c.model === 'observed-model')).toBe(true);
    const ref = report.phases[0].analyses[0].findings[0].references[0];
    const source = await f.service.observationSource(f.feature.id, report.id, ref);
    expect(source.content).toContain('Un besoin concret');
    f.feature.description = 'Besoin changé';
    expect((await f.service.observationSource(f.feature.id, report.id, ref)).content).toBe(
      source.content,
    );
    const reloaded = (await f.service.store.load()).features[0].observations![0];
    expect(reloaded.status).toBe('completed');
    expect(reloaded.calls.length).toBe(report.calls.length);
  });
  it('refuses stale previews and a call budget too small before charging a model', async () => {
    const f = await fixture();
    const preview = await f.service.previewObservation(f.feature.id, options);
    f.feature.description = 'Changed';
    await expect(
      f.service.observeSession(f.feature.id, options, preview.fingerprint),
    ).rejects.toThrow('changé');
    const tooSmall = { ...options, maxCalls: 2 };
    const next = await f.service.previewObservation(f.feature.id, tooSmall);
    await expect(
      f.service.observeSession(f.feature.id, tooSmall, next.fingerprint),
    ).rejects.toThrow('au moins');
    expect(f.adapter.run).not.toHaveBeenCalled();
  });
  it('rejects fabricated citations and keeps the usage already paid', async () => {
    const f = await fixture();
    f.behavior(async (_input, callbacks) => {
      callbacks.onUsage!(usage);
      return {
        content: JSON.stringify({
          summary: 'Avis',
          strengths: [],
          findings: [
            {
              kind: 'fact',
              title: 'Fausse preuve',
              detail: 'Invention',
              impact: 'high',
              references: ['missing-source'],
            },
          ],
        }),
        questions: [],
        changedFiles: [],
        usage,
      };
    });
    const review = await run(f);
    expect(review.status).toBe('failed');
    expect(review.error).toContain('source absente');
    expect(observerUsage(review)?.cost).toBe(usage.cost);
    expect(review.phases[0].analyses).toEqual([]);
  });
  it('stops between calls when the credit budget is reached or accounting is missing', async () => {
    const f = await fixture();
    const capped = { ...options, maxNanoAiu: 1 };
    let preview = await f.service.previewObservation(f.feature.id, capped);
    await f.service.observeSession(f.feature.id, capped, preview.fingerprint);
    expect(f.feature.observations![0].calls).toHaveLength(1);
    expect(f.feature.observations![0].error).toContain('Budget de crédits');
    f.behavior(async (input) => ({
      content: JSON.stringify({ summary: 'Avis', strengths: [], findings: [] }),
      questions: [],
      changedFiles: [],
      model: 'observed-model',
    }));
    preview = await f.service.previewObservation(f.feature.id, capped);
    await f.service.observeSession(f.feature.id, capped, preview.fingerprint);
    expect(f.feature.observations![1].calls).toHaveLength(1);
    expect(f.feature.observations![1].error).toContain('inconnue');
  });
  it('cancels an active review, rejects concurrent deletion and keeps measured consumption', async () => {
    const f = await fixture();
    let started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    f.behavior(async (_input, callbacks, signal) => {
      callbacks.onUsage!(usage);
      started();
      await new Promise<void>((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }),
      );
      throw new Error('Cancelled');
    });
    const preview = await f.service.previewObservation(f.feature.id, options),
      pending = f.service.observeSession(f.feature.id, options, preview.fingerprint);
    await ready;
    await expect(f.service.deleteFeature(f.feature.id)).rejects.toThrow('opération');
    f.service.cancelObservation(f.feature.id);
    await pending;
    expect(f.feature.observations![0].status).toBe('cancelled');
    expect(observerUsage(f.feature.observations![0])?.cost).toBe(usage.cost);
  });
  it('marks missing archive records and legacy attempts as partial instead of claiming completeness', async () => {
    const f = await fixture();
    const attempt = f.service.engine.beginRun(f.feature.id, 'plan');
    f.service.engine.finishRun(f.feature.id, 'plan', {
      content: 'Livrable',
      questions: [],
      changedFiles: [],
    });
    let preview = await f.service.previewObservation(f.feature.id, options);
    expect(preview.warnings.join(' ')).toContain('historique ancien');
    attempt.traceArchive = { bytes: 20, records: 2, complete: true };
    preview = await f.service.previewObservation(f.feature.id, options);
    expect(preview.warnings.join(' ')).toContain('absents');
  });
  it('exports safe, styled HTML and a complete Markdown report with observer accounting', async () => {
    const f = await fixture();
    const review = await run(f);
    review.featureTitle = '<script>alert(1)</script>';
    const html = observationHtml(review);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('Bilan de l’Observateur');
    expect(observationMarkdown(review)).toContain('observed-model');
    expect(observationMarkdown(review)).toContain('Commentaires globaux');
  });
});

describe('durable archives and deletion', () => {
  it('allows deletion of a truncated journal and retains the project', async () => {
    const f = await fixture();
    const directory = join(f.storage, sessionDirectory(f.feature.id));
    await writeFile(join(directory, 'traces.jsonl'), '{"id":"partial');
    const storage = await f.service.sessionStorage(f.feature.id);
    expect(storage.traces.complete).toBe(false);
    expect(storage.traces.reason).toContain('suppression reste disponible');
    expect(await f.service.deleteFeature(f.feature.id)).toBeGreaterThan(0);
    expect(await readFile(join(f.workspace, 'app.txt'), 'utf8')).toBe('protected project content');
  });
  it('anchors source manifests in the persisted report and rejects tampering', async () => {
    const f = await fixture();
    const report = await run(f);
    const reloaded = (await f.service.store.load()).features[0].observations![0];
    expect(reloaded.dossierHash).toBe(report.dossierHash);
    const manifest = join(
      f.storage,
      sessionDirectory(f.feature.id),
      'observations',
      report.id,
      'dossier',
      'manifest.json',
    );
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    data.parts[0].hash = 'a'.repeat(64);
    await writeFile(manifest, JSON.stringify(data));
    await expect(
      f.service.observationSource(f.feature.id, report.id, report.sourceIndex[0].id),
    ).rejects.toThrow('Manifeste de revue altéré');
  });
  it('logs human intent without granting observer tools or recording a secret setting', async () => {
    const f = await fixture();
    await f.service.recordHumanAction({
      type: 'approveStep',
      featureId: f.feature.id,
      stepId: 'plan',
    });
    const archive = await SessionArchive.create(f.storage, f.feature.id, 100000);
    const events = [];
    for await (const event of archive.read()) events.push(event);
    expect(events[0].type).toBe('host.human_request');
    expect(events[0].data).toContain('approveStep');
    const tools = await f.service.getTools(
      { observation: true } as RunInput,
      {} as RunCallbacks,
      new AbortController().signal,
    );
    expect(tools.map((tool) => tool.name)).toEqual(['studio_observation_context']);
    await f.service.recordHumanAction({
      type: 'setMcpSecret',
      serverId: 'server',
      key: 'token',
      value: 'private-value',
    });
    const unchanged = [];
    for await (const event of archive.read()) unchanged.push(event);
    expect(unchanged).toEqual(events);
  });
  it('retains more than 3000 events and long UTF-8 messages with pagination and masking', async () => {
    const f = await fixture();
    const archive = await SessionArchive.create(f.storage, f.feature.id, 4 * 1024 ** 2);
    for (let i = 0; i < 3100; i++)
      archive.append({
        id: `event-${i}`,
        at: 'now',
        type: 'tool',
        attemptId: 'attempt',
        data: `Événement ${i}`,
      });
    const long = 'é'.repeat(45000);
    archive.append({ id: 'long', at: 'now', type: 'message', attemptId: 'attempt', data: long });
    archive.append({
      id: 'secret',
      at: 'now',
      type: 'message',
      data: 'sk-abcdefghijklmnopqrstuvwx',
    });
    await archive.flush();
    const records = [];
    for await (const row of archive.read()) records.push(row);
    expect(records.filter((r) => r.id.startsWith('event-'))).toHaveLength(3100);
    expect(
      records
        .filter((r) => r.id.startsWith('long'))
        .map((r) => r.data)
        .join(''),
    ).toBe(long);
    expect(JSON.stringify(records)).not.toContain('sk-abcdefghijkl');
    const first = await archive.page('attempt');
    expect(first.traces).toHaveLength(100);
    expect(first.nextOffset).toBe(100);
    expect((await archive.page('attempt', 3100)).traces.map((r) => r.data).join('')).toBe(long);
  });
  it('fails visibly at the storage limit and refuses a symlinked journal', async () => {
    const f = await fixture();
    const archive = await SessionArchive.create(f.storage, f.feature.id, 100);
    expect(() =>
      archive.append({ id: 'large', at: 'now', type: 'message', data: 'x'.repeat(300) }),
    ).toThrow('Limite');
    expect(archive.info.complete).toBe(false);
    const dir = join(f.storage, sessionDirectory(f.feature.id));
    await mkdir(dir, { recursive: true });
    await symlink(join(f.workspace, 'app.txt'), join(dir, 'traces.jsonl'));
    await expect(SessionArchive.create(f.storage, f.feature.id, 1000)).rejects.toThrow('Lien');
    expect(await readFile(join(f.workspace, 'app.txt'), 'utf8')).toBe('protected project content');
  });
  it('migrates v4 into a lightweight index and separate session files without losing logs', async () => {
    const f = await fixture();
    f.feature.steps[0].attempts.push({
      id: 'legacy',
      startedAt: 'now',
      status: 'failed',
      feedback: '',
      logs: [{ id: 'log', at: 'now', kind: 'message', message: 'valuable transcript' }],
      questions: [],
      answers: {},
      changedFiles: [],
    });
    await writeFile(
      f.service.store.path,
      JSON.stringify({
        schemaVersion: 4,
        features: [f.feature],
        settings: defaultSettings,
        memory: [],
      }),
    );
    const restored = await f.service.store.load();
    expect(restored.schemaVersion).toBe(5);
    expect(restored.features[0].steps[0].attempts[0].logs[0].message).toBe('valuable transcript');
    const index = JSON.parse(await readFile(f.service.store.path, 'utf8'));
    expect(index.features).toBeUndefined();
    expect(index.entries).toHaveLength(1);
    expect(JSON.stringify(index)).not.toContain('valuable transcript');
    expect(
      (await readdir(join(f.storage, sessionDirectory(f.feature.id)))).filter((n) =>
        n.startsWith('state-'),
      ),
    ).toHaveLength(1);
  });
  it('deletes reports, traces, backups and native session IDs without deleting project files', async () => {
    const f = await fixture();
    await run(f);
    const archive = await SessionArchive.create(f.storage, f.feature.id, 100000);
    archive.append({ id: 'trace', at: 'now', type: 'message', data: 'private transcript' });
    await archive.flush();
    const attempt = f.service.engine.beginRun(f.feature.id, 'plan');
    f.service.engine.finishRun(f.feature.id, 'plan', {
      content: 'Artifact',
      questions: [],
      changedFiles: [],
      sessionId: 'native-work-session',
    });
    await mkdir(join(f.storage, 'existing-changes', attempt.id), { recursive: true });
    await writeFile(
      join(f.storage, 'existing-changes', attempt.id, 'backup.bin'),
      'private backup',
    );
    await f.service.persist();
    const freed = await f.service.deleteFeature(f.feature.id);
    expect(freed).toBeGreaterThan(0);
    expect((await f.service.store.load()).features).toEqual([]);
    expect(await readdir(join(f.storage, 'sessions'))).toEqual([]);
    expect(await readdir(join(f.storage, 'existing-changes'))).toEqual([]);
    expect(f.adapter.deleteSessions).toHaveBeenCalledWith(
      expect.arrayContaining(['native-work-session']),
    );
    expect(await readFile(join(f.workspace, 'app.txt'), 'utf8')).toBe('protected project content');
    expect(await pendingDeletions(f.storage)).toEqual([]);
  });
  it('preserves shared checkpoint blobs until the last owning session is deleted', async () => {
    const f = await fixture();
    const second = structuredClone(f.feature);
    second.id = 'surviving-feature';
    f.service.engine.features.push(second);
    f.feature.checkpoints = [
      await f.service.workspaces.capture(f.feature, { kind: 'manual', label: 'First' }),
    ];
    second.checkpoints = [
      await f.service.workspaces.capture(second, { kind: 'manual', label: 'Second' }),
    ];
    await f.service.persist();
    await f.service.deleteFeature(f.feature.id);
    expect(
      (
        await f.service.workspaces.readFile(second, second.checkpoints[0].id, 'app.txt')
      )?.toString(),
    ).toBe('protected project content');
    expect((await readdir(join(f.storage, 'workspaces', 'objects'))).length).toBeGreaterThan(0);
    await f.service.deleteFeature(second.id);
    expect(await readdir(join(f.storage, 'workspaces', 'objects'))).toEqual([]);
  });
  it('collects owned checkpoint manifests whose references were not persisted before a crash', async () => {
    const f = await fixture();
    const survivor = structuredClone(f.feature);
    survivor.id = 'surviving-feature';
    f.service.engine.features.push(survivor);
    survivor.checkpoints = [
      await f.service.workspaces.capture(survivor, { kind: 'manual', label: 'Survivor' }),
    ];
    await writeFile(join(f.workspace, 'app.txt'), 'only the deleted session captured this');
    const orphan = await f.service.workspaces.capture(f.feature, {
      kind: 'manual',
      label: 'Captured before index persistence',
    });
    expect(f.feature.checkpoints ?? []).toEqual([]);
    await f.service.persist();
    await expect(
      f.service.workspaces.purgeSession(f.feature.id, [survivor.checkpoints[0].id]),
    ).rejects.toThrow('autre session');
    const manifests = join(f.storage, 'workspaces', 'manifests');
    expect(await readdir(manifests)).toContain(`${orphan.id}.json`);
    await f.service.deleteFeature(f.feature.id);
    expect(await readdir(manifests)).toEqual([`${survivor.checkpoints[0].id}.json`]);
    expect(await readdir(join(f.storage, 'workspaces', 'objects'))).toHaveLength(1);
    expect(
      (
        await f.service.workspaces.readFile(survivor, survivor.checkpoints[0].id, 'app.txt')
      )?.toString(),
    ).toBe('protected project content');
    await f.service.deleteFeature(survivor.id);
    expect(await readdir(manifests)).toEqual([]);
    expect(await readdir(join(f.storage, 'workspaces', 'objects'))).toEqual([]);
  });
  it('collects orphan quality media while preserving attachments referenced by surviving sessions', async () => {
    const f = await fixture();
    const survivor = structuredClone(f.feature);
    survivor.id = 'surviving-feature';
    f.service.engine.features.push(survivor);
    for (const [feature, hash] of [
      [f.feature, 'a'],
      [survivor, 'b'],
    ] as const) {
      const attempt = f.service.engine.beginRun(feature.id, 'plan');
      f.service.engine.finishRun(feature.id, 'plan', {
        content: 'Quality report',
        questions: [],
        changedFiles: [],
      });
      attempt.evidence = [
        {
          id: 'quality-proof',
          source: 'host',
          commandId: 'quality-command',
          name: 'Visual check',
          command: 'node',
          args: [],
          startedAt: attempt.startedAt,
          finishedAt: 'now',
          exitCode: 0,
          stdout: '',
          stderr: '',
          truncated: false,
          fileHashes: {},
          quality: {
            version: 1,
            kind: 'visual',
            featureId: feature.id,
            attemptId: attempt.id,
            commandId: 'quality-command',
            evidenceId: 'quality-proof',
            collectedAt: 'now',
            status: 'passed',
            reportPath: '.feature-studio/quality/report.json',
            cases: [],
            attachments: [
              {
                id: 'image',
                name: 'Screen',
                kind: 'screenshot',
                mime: 'image/png',
                sizeBytes: 5,
                sha256: hash.repeat(64),
              },
            ],
          },
        },
      ];
    }
    const quality = join(f.storage, 'quality');
    await mkdir(quality);
    for (const hash of ['a', 'b', 'c'])
      await writeFile(join(quality, `${hash.repeat(64)}.png`), 'image');
    await writeFile(join(quality, 'unrelated.txt'), 'preserved');
    await f.service.persist();
    await f.service.deleteFeature(f.feature.id);
    expect((await readdir(quality)).sort()).toEqual([`${'b'.repeat(64)}.png`, 'unrelated.txt']);
    await f.service.deleteFeature(survivor.id);
    expect(await readdir(quality)).toEqual(['unrelated.txt']);
  });
  it('honors a durable deletion marker after a crash, even before cleaning the old index', async () => {
    const f = await fixture();
    await markDeletion(f.storage, f.feature);
    expect((await new Store(f.storage).load()).features).toEqual([]);
    await f.service.recoverSessionDeletions();
    expect(await pendingDeletions(f.storage)).toEqual([]);
    expect((await f.service.store.load()).features).toEqual([]);
  });
  it('keeps unknown cost distinct from measured zero and sums only cumulative receipts once', () => {
    expect(sumUsage([undefined])?.cost).toBeUndefined();
    expect(
      sumUsage([{ source: 'measured', inputTokens: 0, outputTokens: 0, cost: 0, unit: 'nano-AIU' }])
        ?.cost,
    ).toBe(0);
    expect(sumUsage([usage, { ...usage, unit: 'USD' }])?.cost).toBe(usage.cost);
    expect(sumUsage([usage, undefined])?.incompleteCost).toBe(true);
  });
});
