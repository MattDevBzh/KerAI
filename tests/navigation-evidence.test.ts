import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, defaultSettings } from '../src/core/store';
import { WorkflowEngine } from '../src/core/workflow';
import { navigationMetrics } from '../src/shared/navigationMetrics';
import { proofDossier, proofDossierMarkdown } from '../src/shared/proofs';
import type { NavigationContextSnapshot } from '../src/shared/navigation';
import type { Usage } from '../src/shared/types';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const frozen: NavigationContextSnapshot = {
  application: {
    id: 'app',
    name: 'App',
    projectIds: [],
    origin: 'http://localhost:3000',
    allowedOrigins: ['http://localhost:3000'],
    ownerNavigatorId: 'fs-navigator',
    interactionPolicy: 'confirm',
    createdAt: '2026-10-23T10:00:00.000Z',
    updatedAt: '2026-10-23T10:00:00.000Z',
  },
  selection: {
    applicationId: 'app',
    parameters: {},
    intent: 'reproduce',
    allowInteractions: false,
  },
  contextText: 'Contexte figé initial',
  digest: 'a'.repeat(64),
};
function fixture(agentId = 'fs-navigator') {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'workflow',
      name: 'Workflow',
      description: '',
      icon: '',
      steps: [
        {
          id: 'run',
          name: 'Run',
          description: '',
          agentId,
          policy: 'read-only',
          skills: [],
          dependsOn: [],
          artifact: 'result.md',
          maxAttempts: 3,
        },
      ],
    },
    { title: 'Navigation', description: 'Synthetic' },
  );
  const attempt = engine.beginRun(feature.id, 'run');
  attempt.navigation = structuredClone(frozen);
  return { engine, feature, attempt };
}
describe('navigation evidence and migration', () => {
  it('migrates v10 additively without silently granting historical sessions navigation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'navigation-migration-'));
    roots.push(root);
    const store = new Store(root);
    const { engine, feature, attempt } = fixture();
    delete attempt.navigation;
    engine.finishRun(feature.id, 'run', {
      content: 'Historique préservé',
      questions: [],
      changedFiles: [],
    });
    await store.save(engine.features, defaultSettings);
    const index = JSON.parse(await readFile(store.path, 'utf8'));
    index.schemaVersion = 10;
    await writeFile(store.path, JSON.stringify(index));
    const migrated = await store.load();
    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.features[0]).toEqual(feature);
    expect(migrated.features[0].steps[0].attempts[0].navigation).toBeUndefined();
    expect(JSON.parse(await readFile(store.path, 'utf8')).schemaVersion).toBe(14);
  });
  it('preserves frozen context and capture metadata while interrupting unfinished attempts after restart', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'navigation-persist-'));
    roots.push(root);
    const store = new Store(root);
    const { engine, attempt } = fixture();
    attempt.navigationCaptures = [
      {
        id: 'capture',
        applicationId: 'app',
        path: '/private/image.png',
        bytes: 100,
        sha256: 'b'.repeat(64),
        browser: 'Chromium',
        url: 'http://localhost:3000',
        createdAt: '2026-10-23T10:00:00.000Z',
      },
    ];
    await store.save(engine.features, defaultSettings);
    const restored = (await new Store(root).load()).features[0].steps[0].attempts[0];
    expect(restored.status).toBe('interrupted');
    expect(restored.navigation).toEqual(frozen);
    expect(restored.navigationCaptures).toEqual(attempt.navigationCaptures);
  });
  it('presents browser receipts as runtime observations, and marks changed captures for recheck', () => {
    const { feature, attempt } = fixture();
    attempt.navigationCaptures = [
      {
        id: 'capture',
        applicationId: 'app',
        path: '/private/image.png',
        bytes: 100,
        sha256: 'b'.repeat(64),
        url: 'http://localhost:3000',
        createdAt: '2026-10-23T10:00:00.000Z',
      },
    ];
    const receipt = proofDossier(feature).sources.find(
      (source) => source.navigationCaptureId === 'capture',
    )!;
    expect(receipt).toMatchObject({ origin: 'runtime', state: 'observed', digest: 'b'.repeat(64) });
    expect(receipt.content).toContain('critères métier à vérifier');
    feature.proofChecks = {
      [receipt.id]: { at: '2026-10-23T11:00:00.000Z', state: 'changed', reason: 'Hash changé' },
    };
    expect(proofDossier(feature).sources.find((source) => source.id === receipt.id)?.state).toBe(
      'recheck',
    );
    expect(proofDossierMarkdown(feature)).not.toContain('/private/image.png');
  });
});
describe('navigation consumption projection', () => {
  it('includes failure and missing measures without fabricating zero or economic gain', () => {
    const { feature, attempt } = fixture();
    attempt.usage = {
      source: 'measured',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      durationMs: 100,
      cost: 2,
      unit: 'credits',
    };
    feature.steps[0].attempts.push({
      ...structuredClone(attempt),
      id: 'failed-attempt',
      status: 'failed',
      usage: undefined,
    });
    const result = navigationMetrics([feature]);
    expect(result.phases[0]).toMatchObject({
      phase: 'learning-maintenance',
      attempts: 2,
      failed: 1,
      measuredAttempts: 1,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      apiDurationMs: 100,
      cost: 2,
      unit: 'credits',
      completeTokens: false,
      completeCost: false,
    });
    expect(result.gain).toBeNull();
    expect(attempt.usage.inputTokens).toBe(10);
  });
  it('separates role phases and does not add incompatible cost units', () => {
    const features = ['fs-plan', 'fs-dev', 'fs-tests'].map((role) => {
      const { feature, attempt } = fixture(role);
      attempt.usage = {
        source: 'measured',
        inputTokens: 1,
        outputTokens: 2,
        cost: 1,
        unit: 'credits',
      };
      return feature;
    });
    const owner = fixture();
    owner.attempt.usage = {
      source: 'measured',
      inputTokens: 5,
      outputTokens: 1,
      cost: 1,
      unit: 'credits',
    };
    owner.feature.steps[0].attempts.push({
      ...structuredClone(owner.attempt),
      id: 'other-unit',
      usage: { source: 'measured', cost: 1, unit: 'USD' } as Usage,
    });
    const phases = navigationMetrics([...features, owner.feature]).phases;
    expect(phases.map((row) => row.phase)).toEqual([
      'analysis',
      'development',
      'verification',
      'learning-maintenance',
    ]);
    expect(phases.at(-1)).toMatchObject({ unit: 'mixed', completeCost: false });
    expect(phases.at(-1)?.cost).toBeUndefined();
  });
});
