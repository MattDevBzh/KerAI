import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentAdapter, RunCallbacks, RunInput, RunResult } from '../src/shared/types';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { runProcess } from '../src/host/process';
import { randomUUID } from 'node:crypto';
import { emptyLaunch } from '../src/core/context';
import { defaultPairPreferences } from '../src/shared/pair';
import { digest, sessionDirectory, writePrivate } from '../src/host/SessionFiles';
import { pairSourceKey } from '../src/core/pairSource';

// End-to-end scenarios perform real Git checkpoints and spawn local test processes.
// Keep the Windows allowance consistent across this integration suite.
if (process.platform === 'win32') vi.setConfig({ testTimeout: 60_000 });

const roots: string[] = [],
  services: StudioService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function git(root: string, ...args: string[]) {
  const result = await runProcess('git', args, root);
  if (result.code !== 0) throw new Error(result.stderr);
}
const finished = (content = '# Livrable'): RunResult => ({
  content,
  questions: [],
  changedFiles: [],
  model: 'fixture-real-model',
  usage: { source: 'measured', inputTokens: 10, outputTokens: 20 },
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-service-')));
  roots.push(root);
  const workspace = join(root, 'repo');
  await mkdir(workspace);
  await git(workspace, 'init', '-b', 'fixture');
  const storage = join(root, 'storage');
  let trusted = true;
  const service = new StudioService(
    workspace,
    resolve('defaults'),
    new Store(storage),
    () => trusted,
  );
  services.push(service);
  await service.initialize();
  const inputs: RunInput[] = [];
  let behavior = async (
    _input: RunInput,
    _callbacks: RunCallbacks,
    _signal: AbortSignal,
  ): Promise<RunResult> => finished();
  const adapter: AgentAdapter = {
    check: vi.fn(async () => ({
      state: 'ready' as const,
      authenticated: true,
      version: 'fixture',
      models: [{ id: 'fixture-real-model', name: 'Fixture model' }],
    })),
    run: vi.fn(async (input, callbacks, signal) => {
      inputs.push(input);
      callbacks.onSession(`session-${inputs.length}`);
      return await behavior(input, callbacks, signal);
    }),
    dispose: vi.fn(async () => {}),
  };
  service.adapter = adapter;
  return {
    root,
    workspace,
    storage,
    service,
    adapter,
    inputs,
    trust(value: boolean) {
      trusted = value;
    },
    run(fn: typeof behavior) {
      behavior = fn;
    },
  };
}

const launch = {
  ...emptyLaunch(),
  initialContext: 'CONTEXTE CONFIRMÉ',
  pair: defaultPairPreferences,
};
async function legacyFixture(phase: 'planning' | 'paused' | 'working' | 'review' = 'paused') {
  const f = await fixture();
  await f.service.checkRuntime();
  const feature = await f.service.createFeature({
    title: 'Pair',
    description: 'Une mission',
    workflowId: 'single',
  });
  const step = feature.steps[0];
  const preview = await f.service.previewRun(feature.id, step.id, '', false, launch);
  await f.service.runStep(feature.id, step.id, '', false, launch, preview.fingerprint);
  const attempt = step.attempts[0];
  const input = structuredClone(f.inputs[0]);
  input.launch = { ...emptyLaunch(), pairPace: 'batches' } as unknown as RunInput['launch'];
  input.attempt.id = attempt.id;
  const encoded = JSON.stringify(input);
  const legacy = {
    pace: 'batches',
    phase,
    revision: 4,
    turns: 3,
    organizationApproved: true,
    inputHash: digest(encoded),
    sourceKey: pairSourceKey(feature, step),
    sessionIds: ['old-1', 'old-2'],
    messages: [
      {
        id: 'old-message',
        at: attempt.startedAt,
        role: 'assistant',
        content: 'Décision et travail déjà réalisés.',
      },
    ],
  };
  const raw = JSON.parse(JSON.stringify(feature));
  const saved = raw.steps[0].attempts[0];
  saved.pair = legacy;
  saved.launch = input.launch;
  saved.status = raw.steps[0].status =
    phase === 'review' ? 'awaiting_review' : phase === 'working' ? 'running' : 'waiting_input';
  saved.usage = { source: 'measured', inputTokens: 42, outputTokens: 15 };
  if (phase === 'review')
    saved.artifact = {
      name: step.artifact,
      content: '# Livrable conservé',
      updatedAt: attempt.startedAt,
    };
  const featureText = JSON.stringify(raw),
    hash = digest(featureText);
  await writePrivate(
    f.storage,
    `${sessionDirectory(feature.id)}/pair-${digest(attempt.id)}.json`,
    encoded,
  );
  await writePrivate(f.storage, `${sessionDirectory(feature.id)}/state-${hash}.json`, featureText);
  const index = {
    schemaVersion: 6,
    entries: [{ id: feature.id, hash }],
    settings: f.service.state.settings,
    memory: [],
  };
  await writeFile(join(f.storage, 'state.json'), JSON.stringify(index));
  return { ...f, feature, step, attempt, encoded, index };
}
it.each(['planning', 'paused', 'working', 'review'] as const)(
  'migrates v1.19 %s history, frozen context, usage and sessions without starting work',
  async (phase) => {
    const f = await legacyFixture(phase);
    const loaded = await new Store(f.storage).load();
    const attempt = loaded.features[0].steps[0].attempts[0];
    expect(loaded.schemaVersion).toBe(7);
    expect(attempt.pair).toMatchObject({
      calls: 3,
      busy: false,
      mode: 'pair',
      plans: [],
      phase: phase === 'review' ? 'review' : 'interrupted',
      sessionIds: ['old-1', 'old-2'],
    });
    expect(attempt.pair?.messages[0].content).toBe('Décision et travail déjà réalisés.');
    expect(attempt.pair?.snapshot.prompt).toContain('CONTEXTE CONFIRMÉ');
    expect(attempt.usage?.inputTokens).toBe(42);
    expect(attempt.launch?.pair?.pace).toBe('blocks');
    expect(attempt.pair?.approvedRevision).toBeUndefined();
    if (phase === 'review') expect(attempt.artifact?.content).toBe('# Livrable conservé');
    expect((await new Store(f.storage).load()).features).toEqual(loaded.features);
    expect(f.inputs).toHaveLength(1);
  },
);
it('preserves the v6 index when the frozen pair context is corrupted', async () => {
  const f = await legacyFixture();
  await writePrivate(
    f.storage,
    `${sessionDirectory(f.feature.id)}/pair-${digest(f.attempt.id)}.json`,
    f.encoded + ' ',
  );
  await expect(new Store(f.storage).load()).rejects.toThrow('Contexte pair altéré');
  expect(JSON.parse(await readFile(join(f.storage, 'state.json'), 'utf8'))).toEqual(f.index);
});
it('resumes a migrated conversation by requesting a new plan without executing legacy prose', async () => {
  const f = await legacyFixture();
  const service = new StudioService(
    f.workspace,
    resolve('defaults'),
    new Store(f.storage),
    () => true,
  );
  services.push(service);
  await service.initialize();
  service.adapter = f.adapter;
  await service.checkRuntime();
  const attempt = service.engine.getStep(f.feature.id, f.step.id).attempts[0];
  await service.pairAction({
    type: 'pairAction',
    action: 'resume',
    featureId: f.feature.id,
    stepId: f.step.id,
    attemptId: attempt.id,
    expectedVersion: attempt.pair!.version,
    requestId: randomUUID(),
  });
  await vi.waitFor(() => expect(f.inputs).toHaveLength(2), { timeout: 30000 });
  await vi.waitFor(() => expect(service.state.workspaceOperation).toBeUndefined(), {
    timeout: 30000,
  });
  expect(f.inputs[1].mode).toBe('discussion');
  expect(f.inputs[1].preparedPrompt).toContain('Décision et travail déjà réalisés.');
  expect(attempt.pair?.approvedRevision).toBeUndefined();
});
