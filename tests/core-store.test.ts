import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, defaultSettings } from '../src/core/store';
import { WorkflowEngine } from '../src/core/workflow';
import type { MemoryEntry, FeatureCheckpoint } from '../src/shared/types';

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-store-'));
  roots.push(root);
  return { root, store: new Store(root) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function feature() {
  const engine = new WorkflowEngine();
  const item = engine.createFeature(
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
          policy: 'read-only',
          artifact: 'run.md',
          maxAttempts: 3,
          dependsOn: [],
        },
      ],
    },
    { title: 'Title', description: '' },
  );
  return { engine, item };
}
describe('durable versioned store', () => {
  it('round trips an empty draft without treating it as a completed workflow', async () => {
    const { store } = await setup();
    const item = new WorkflowEngine().createFeature(undefined, { title: 'Draft', description: '' });
    await store.save([item], defaultSettings);
    expect((await store.load()).features[0]).toEqual(item);
    expect(() => store.save([{ ...item, status: 'completed' }], defaultSettings)).toThrow();
    expect(() => store.save([{ ...item, activeStepId: 'ghost' }], defaultSettings)).toThrow();
  });
  it('migrates 1.5 multi-project teams without losing roots, team revision or settings', async () => {
    const { store } = await setup(),
      { item } = feature();
    item.projects = [
      { id: 'primary', name: 'API', path: '/projects/api', branch: 'main' },
      { id: 'secondary', name: 'Web', path: '/projects/web', branch: 'feature/ui' },
    ];
    item.teamRevision = 3;
    item.teamLockedAt = '2026-10-15T12:00:00Z';
    const settings = { ...defaultSettings, defaultModel: 'project-model' };
    await writeFile(
      store.path,
      JSON.stringify({ schemaVersion: 4, features: [item], settings, memory: [] }),
    );
    expect((await store.load()).features[0]).toEqual(item);
    const reopened = await new Store(store.rootPath).load();
    expect(reopened.features[0]).toEqual(item);
    expect(reopened.settings.defaultModel).toBe('project-model');
    expect(reopened.schemaVersion).toBe(6);
  });
  it('persists exact question provenance across a replay and reload', async () => {
    const { store } = await setup();
    const { engine, item } = feature();
    const first = engine.beginRun(item.id, 'run');
    const question = { id: 'audience', text: 'Qui utilise ceci ?', choices: ['Matt', 'Équipe'] };
    engine.finishRun(item.id, 'run', {
      content: 'Partial',
      questions: [question],
      changedFiles: [],
    });
    engine.answerQuestions(item.id, 'run', { audience: 'Matt' });
    const next = engine.beginRun(item.id, 'run');
    await store.save(engine.features, defaultSettings);
    const restored = (await store.load()).features[0].steps[0].attempts.at(-1)!;
    expect(restored.answerBindings?.audience).toEqual({
      question,
      answer: 'Matt',
      origin: { stepId: 'run', attemptId: first.id },
    });
    expect(restored.id).toBe(next.id);
    expect(restored.questions).toEqual([]);
  });
  it('migrates v2 without inventing an execution root, retaining contexts and budgets', async () => {
    const { store } = await setup(),
      { engine, item } = feature();
    item.steps[0].initialContext = 'US-208: keep the existing behavior';
    item.budget = { maxRuns: 4, maxPromptChars: 25000, modelProfile: 'current' };
    await writeFile(
      store.path,
      JSON.stringify({
        schemaVersion: 2,
        features: engine.features,
        settings: defaultSettings,
        memory: [],
      }),
    );
    const migrated = await store.load();
    expect(migrated.features).toEqual(engine.features);
    expect(migrated.features[0].worktree).toBeUndefined();
    expect(JSON.parse(await readFile(store.path, 'utf8')).schemaVersion).toBe(6);
  });
  it('retains worktree identity, per-attempt checkpoints and restored ownership across reload', async () => {
    const { store } = await setup(),
      { engine, item } = feature();
    item.branch = 'codex/feature-studio-fixture';
    item.worktree = {
      path: '/private/tmp/worktree',
      branch: item.branch,
      baseBranch: 'main',
      baseCommit: 'a'.repeat(40),
      createdAt: 'now',
    };
    const point: FeatureCheckpoint = {
      id: '66090868-36d2-4c18-bf11-25baef0fbe13',
      label: 'Before run',
      kind: 'before-run',
      createdAt: 'now',
      branch: item.branch,
      head: 'a'.repeat(40),
      fileCount: 1,
      totalBytes: 5,
      excludedCount: 1,
      excludedPaths: ['.env: protected'],
    };
    const attempt = engine.beginRun(item.id, 'run');
    engine.finishRun(item.id, 'run', { content: 'Artifact', questions: [], changedFiles: [] });
    attempt.checkpointBeforeId = point.id;
    attempt.checkpointAfterId = '783bc489-7531-477e-aa4f-0e09529eacbc';
    item.checkpoints = [point, { ...point, id: attempt.checkpointAfterId, kind: 'after-run' }];
    item.workspaceFileHashes = { 'restored.txt': 'a'.repeat(64), 'deleted.txt': '<missing>' };
    await store.save(engine.features, defaultSettings);
    const restored = await store.load();
    expect(restored.schemaVersion).toBe(6);
    expect(restored.features).toEqual(engine.features);
    const invalid = { ...item, worktree: { ...item.worktree, branch: 'wrong-branch' } };
    const original = await readFile(store.path, 'utf8');
    expect(() => store.save([invalid], defaultSettings)).toThrow();
    expect(await readFile(store.path, 'utf8')).toBe(original);
  });
  it('uses independent empty defaults and recovers running attempts as interrupted on load', async () => {
    const { store } = await setup();
    const blank = await store.load();
    expect(blank.features).toEqual([]);
    blank.settings.testPaths.push('tests');
    expect((await store.load()).settings.testPaths).toEqual(['tests', 'test', '__tests__']);
    const { engine, item } = feature();
    engine.beginRun(item.id, 'run');
    engine.setSession(item.id, 'run', 'cli-session');
    await store.save(engine.features, defaultSettings);
    const restored = await store.load();
    expect(restored.features[0].status).toBe('attention');
    expect(restored.features[0].steps[0].status).toBe('interrupted');
    expect(restored.features[0].steps[0].attempts[0].sessionId).toBe('cli-session');
    expect((await store.load()).features[0].steps[0].status).toBe('interrupted');
  });
  it('serializes competing writes across Store instances and captures snapshots before async IO', async () => {
    const { store, root } = await setup();
    const second = new Store(root),
      { engine, item } = feature();
    item.title = 'first';
    const firstSave = store.save(engine.features, defaultSettings);
    item.title = 'last';
    const lastSave = second.save(engine.features, defaultSettings);
    item.title = 'mutated after save';
    await Promise.all([firstSave, lastSave]);
    expect((await store.load()).features[0].title).toBe('last');
    expect((await readdir(root)).sort()).toEqual(['sessions', 'state.json']);
  });
  it('migrates v0 settings omissions, persisting v5', async () => {
    const { store } = await setup();
    await writeFile(
      store.path,
      JSON.stringify({ schemaVersion: 0, features: [], settings: { defaultModel: '' } }),
    );
    const state = await store.load();
    expect(state.schemaVersion).toBe(6);
    expect(state.settings.timeoutMinutes).toBe(20);
    expect(JSON.parse(await readFile(store.path, 'utf8')).schemaVersion).toBe(6);
  });
  it('rejects unknown versions and corruption without changing the original file', async () => {
    const { store } = await setup();
    const unknown = '{"schemaVersion":99,"valuable":"keep me"}';
    await writeFile(store.path, unknown);
    await expect(store.load()).rejects.toThrow(/inconnue/);
    expect(await readFile(store.path, 'utf8')).toBe(unknown);
    const corrupt = '{';
    await writeFile(store.path, corrupt);
    await expect(store.load()).rejects.toThrow(/conservé/);
    expect(await readFile(store.path, 'utf8')).toBe(corrupt);
  });
  it('retains measured usage, changed file hashes and the full artifact after reload', async () => {
    const { store } = await setup();
    const { engine, item } = feature();
    engine.beginRun(item.id, 'run');
    engine.finishRun(item.id, 'run', {
      content: '# Artifact',
      questions: [],
      changedFiles: ['src/a.ts'],
      fileHashes: { 'src/a.ts': 'sha256' },
      usage: { source: 'measured', inputTokens: 12, outputTokens: 8 },
    });
    await store.save(engine.features, defaultSettings);
    const restored = (await store.load()).features[0].steps[0].attempts[0];
    expect(restored.fileHashes).toEqual({ 'src/a.ts': 'sha256' });
    expect(restored.artifact?.content).toBe('# Artifact');
    expect(restored.usage).toEqual({ source: 'measured', inputTokens: 12, outputTokens: 8 });
  });
  it('migrates v1 preserving historical artifacts, answers, logs and outcomes', async () => {
    const { store } = await setup(),
      { engine, item } = feature();
    const attempt = engine.beginRun(item.id, 'run');
    engine.appendEvent(item.id, 'run', {
      id: 'event',
      at: 'then',
      kind: 'message',
      message: 'History',
    });
    engine.finishRun(item.id, 'run', {
      content: 'Historical artifact',
      questions: [{ id: 'q', text: 'Question' }],
      changedFiles: ['src/a.ts'],
      fileHashes: { 'src/a.ts': 'hash' },
      usage: { source: 'measured', inputTokens: 11, outputTokens: 22 },
    });
    engine.answerQuestions(item.id, 'run', { q: 'Historical answer' });
    const historical = structuredClone(engine.features);
    await writeFile(
      store.path,
      JSON.stringify({
        schemaVersion: 1,
        features: historical,
        settings: {
          defaultModel: '',
          timeoutMinutes: 20,
          testCommands: [],
          testPaths: ['tests'],
          hooks: [],
        },
      }),
    );
    const migrated = await store.load();
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.features).toEqual(historical);
    expect(migrated.memory).toEqual([]);
    expect(migrated.features[0].autopilot).toBeUndefined();
    expect(migrated.features[0].steps[0].attempts[0].id).toBe(attempt.id);
  });
  it('persists local memory, launch/evidence/review and pauses a running pilot after reboot', async () => {
    const { store } = await setup(),
      { engine, item } = feature();
    item.autopilot = {
      checkpoints: ['run'],
      maxRuns: 10,
      maxCorrectionCycles: 1,
      stepInputs: {
        run: {
          initialContext: 'Human context',
          mcpServerIds: [],
          memoryIds: ['memory'],
          useProjectMemory: true,
        },
      },
      status: 'running',
      runs: 1,
      correctionCycles: 0,
      updatedAt: 'now',
    };
    const memory: MemoryEntry = {
      id: 'memory',
      title: 'Convention',
      content: '  Preserve whitespace\n',
      category: 'convention',
      enabled: true,
      agentIds: [],
      updatedAt: 'now',
    };
    const attempt = engine.beginRun(item.id, 'run');
    attempt.launch = item.autopilot.stepInputs.run;
    attempt.memorySnapshot = [memory];
    attempt.promptFingerprint = 'fingerprint';
    attempt.promptCharacters = 120;
    attempt.evidence = [
      {
        id: 'proof',
        source: 'host',
        commandId: 'unit',
        name: 'Unit',
        command: 'node',
        args: [],
        startedAt: 'now',
        finishedAt: 'then',
        exitCode: 0,
        stdout: 'Passed',
        stderr: '',
        truncated: false,
        fileHashes: {},
      },
    ];
    attempt.review = { verdict: 'pass', summary: 'Observed', findings: [] };
    attempt.usage = {
      source: 'measured',
      inputTokens: 10,
      outputTokens: 5,
      cost: 12,
      unit: 'nano-AIU',
      incompleteTokens: true,
      incompleteCost: true,
    };
    await store.save(engine.features, defaultSettings, [memory]);
    const restored = await store.load();
    expect(restored.memory).toEqual([memory]);
    expect(restored.features[0].autopilot).toMatchObject({
      status: 'paused',
      runs: 1,
      correctionCycles: 0,
      reason: expect.stringMatching(/reprise humaine/),
    });
    const saved = restored.features[0].steps[0].attempts[0];
    expect(saved.status).toBe('interrupted');
    expect(saved.memorySnapshot).toEqual([memory]);
    expect(saved.evidence).toEqual(attempt.evidence);
    expect(saved.review).toEqual(attempt.review);
    expect(saved.launch).toEqual(attempt.launch);
    expect(saved.usage).toEqual(attempt.usage);
    expect(JSON.parse(await readFile(store.path, 'utf8')).memory).toEqual([memory]);
  });
});
