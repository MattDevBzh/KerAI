import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, defaultSettings } from '../src/core/store';
import { WorkflowEngine } from '../src/core/workflow';

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
    expect(JSON.parse(await readFile(store.path, 'utf8')).features[0].steps[0].status).toBe(
      'interrupted',
    );
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
    expect(await readdir(root)).toEqual(['state.json']);
  });
  it('migrates v0 settings omissions, persisting v1', async () => {
    const { store } = await setup();
    await writeFile(
      store.path,
      JSON.stringify({ schemaVersion: 0, features: [], settings: { defaultModel: '' } }),
    );
    const state = await store.load();
    expect(state.schemaVersion).toBe(1);
    expect(state.settings.timeoutMinutes).toBe(20);
    expect(JSON.parse(await readFile(store.path, 'utf8')).schemaVersion).toBe(1);
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
});
