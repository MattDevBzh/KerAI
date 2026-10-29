import { sessionMarkdown } from '../src/shared/sessionExport';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, defaultSettings } from '../src/core/store';
import { WorkflowEngine } from '../src/core/workflow';
import { createCorrectionLoopState, observeCorrectionStep } from '../src/core/correctionLoop';
import { buildPrompt, emptyLaunch, previewContext } from '../src/core/context';
import { StateEncoder, StateReceiver } from '../src/shared/stateTransfer';
import type { RunInput } from '../src/shared/types';
import { demoState } from '../webview/demo';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixture() {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'loop-fixture',
      name: 'Correction',
      description: '',
      icon: '',
      steps: ['dev', 'review'].map((id, index) => ({
        id,
        name: id,
        description: 'Check behavior',
        agentId: id,
        skills: [],
        policy: 'read-only' as const,
        artifact: `${id}.md`,
        maxAttempts: 5,
        dependsOn: index ? ['dev'] : [],
      })),
    },
    { title: 'Durable loop', description: 'Frozen objective: preserve CSV accents' },
  );
  feature.criteria = [
    { id: 'accents', text: 'Export preserves accented names', status: 'pending', evidence: '' },
  ];
  feature.autopilot = {
    checkpoints: [],
    maxRuns: 10,
    maxCorrectionCycles: 4,
    reviewStepId: 'review',
    correctionStepId: 'dev',
    stepInputs: {},
    correctionLoop: { maxStagnantCycles: 2 },
    status: 'paused',
    runs: 2,
    correctionCycles: 1,
    updatedAt: new Date().toISOString(),
  };
  const commands = [{ id: 'unit', name: 'Unit', command: 'npm', args: ['test'] }];
  let previous = createCorrectionLoopState(
    feature,
    commands,
    new Date().toISOString(),
    'previous-contract',
  );
  const dev = engine.beginRun(feature.id, 'dev');
  engine.finishRun(feature.id, 'dev', { content: 'Code', questions: [], changedFiles: [] });
  engine.approveStep(feature.id, 'dev', 'human', dev.id, dev.revision ?? 0);
  const reviewAttempt = engine.beginRun(feature.id, 'review');
  reviewAttempt.correctionLoop = { contractId: previous.contract.id };
  engine.finishRun(feature.id, 'review', {
    content: 'Review',
    questions: [],
    changedFiles: [],
    review: {
      verdict: 'changes_requested',
      summary: 'Accent defect',
      findings: [{ id: 'accent-defect', severity: 'blocking', message: 'Accents are lost' }],
    },
  });
  previous = observeCorrectionStep(previous, feature, 'review');
  feature.autopilot.correctionLoopHistory = [previous];
  feature.autopilot.correctionLoopState = createCorrectionLoopState(
    feature,
    commands,
    new Date().toISOString(),
    'current-contract',
  );
  return { engine, feature };
}

describe('correction contract durability and mandatory context', () => {
  it('migrates a version 12 index to 14 without losing criteria, budgets or previous observations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'correction-contract-'));
    roots.push(root);
    const store = new Store(root),
      { engine, feature } = fixture();
    await store.save(engine.features, defaultSettings);
    const index = JSON.parse(await readFile(store.path, 'utf8'));
    expect(index.schemaVersion).toBe(14);
    expect(index.entries).toHaveLength(1);
    index.schemaVersion = 12;
    await writeFile(store.path, JSON.stringify(index));
    const migrated = await new Store(root).load();
    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.features[0].criteria).toEqual(feature.criteria);
    expect(migrated.features[0].autopilot).toEqual(feature.autopilot);
    expect(migrated.features[0].autopilot?.correctionLoopHistory?.[0].observations).toHaveLength(1);
    const durableIndex = JSON.parse(await readFile(store.path, 'utf8'));
    expect(durableIndex.schemaVersion).toBe(14);
    expect(durableIndex.entries).toEqual(index.entries);
    expect((await new Store(root).load()).features).toEqual(migrated.features);
  });

  it.each(['all', 'empty'] as const)(
    'keeps the frozen contract enabled and immutable with contextMode %s',
    (mode) => {
      const { feature } = fixture();
      const data: RunInput = {
        feature,
        step: feature.steps[1],
        attempt: feature.steps[1].attempts.at(-1)!,
        workspacePath: '/fixture',
        agent: {
          id: 'review',
          name: 'Review',
          description: '',
          instructions: 'Review code',
          tools: ['read'],
          skills: [],
          source: 'bundled',
          path: '',
        },
        skills: [],
        settings: structuredClone(defaultSettings),
        launch: {
          ...emptyLaunch(),
          contextMode: mode,
          contextBlocks: {
            'correction-loop': { enabled: false, content: 'MALICIOUS_CONTRACT_REPLACEMENT' },
          },
        },
      };
      const preview = previewContext(data);
      const section = preview.sections.find((section) => section.id === 'correction-loop');
      expect(section).toMatchObject({ source: 'system', enabled: true, editable: false });
      const prompt = buildPrompt(data);
      expect(prompt).toContain('Frozen objective: preserve CSV accents');
      expect(prompt).toContain('Export preserves accented names');
      expect(prompt).toContain('npm test');
      expect(prompt).not.toContain('MALICIOUS_CONTRACT_REPLACEMENT');
      expect(preview.prompt).toBe(prompt);
    },
  );

  it('transports contract renewal and ledger changes through JSON state deltas without losing fields', () => {
    const { feature } = fixture();
    const state = structuredClone(demoState);
    state.features = [feature];
    const encoder = new StateEncoder(),
      receiver = new StateReceiver();
    receiver.receive(JSON.parse(JSON.stringify(encoder.encode(state))));
    feature.autopilot!.correctionLoopState!.pause = 'contract_changed';
    const delta = encoder.encode(state);
    expect(delta.type).toBe('stateDelta');
    const received = receiver.receive(JSON.parse(JSON.stringify(delta)))!;
    expect(received.features[0].autopilot).toEqual(JSON.parse(JSON.stringify(feature.autopilot)));
    expect(received.features[0].autopilot?.correctionLoopHistory?.[0].observations).toHaveLength(1);
    expect(received.features[0].autopilot?.correctionLoopState?.pause).toBe('contract_changed');
  });
});

it('exports the frozen contract and archival summaries with proof references without duplicating raw logs', () => {
  const { feature } = fixture();
  const pilot = feature.autopilot!;
  pilot.correctionLoopState!.observations = structuredClone(
    pilot.correctionLoopHistory![0].observations,
  );
  const loop = pilot.correctionLoopState!,
    observation = loop.observations[0];
  loop.readiness = 'issues';
  loop.pause = 'stagnation';
  loop.stagnantCycles = 2;
  observation.kind = 'test';
  observation.evidenceIds = ['proofReference'];
  observation.resolved = ['a'.repeat(64)];
  observation.persistent = ['b'.repeat(64)];
  observation.introduced = ['c'.repeat(64)];
  observation.problems[0].message = '[injected](https://example.invalid) <script>hidden</script>';
  feature.steps[1].attempts[0].evidence = [
    {
      id: 'proofReference',
      source: 'host',
      commandId: 'unit',
      name: 'Unit',
      command: 'npm',
      args: ['test'],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 1,
      truncated: false,
      stdout: 'RAW_OUTPUT_MARKER',
      stderr: 'RAW_ERROR_MARKER',
      fileHashes: {},
    },
  ];
  const text = sessionMarkdown(feature, '/fixture');
  const summary = text.split('## Suivi de la boucle de correction')[1].split('## dev —')[0];
  expect(summary).toContain('Contrat courant · current\\-contract');
  expect(summary).toContain('Objectif figé : Frozen objective: preserve CSV accents');
  expect(summary).toContain('accents : Export preserves accented names');
  expect(summary).toContain('Appels consommés : 2/10');
  expect(summary).toContain('Cycles de correction consommés : 1/4');
  expect(summary).toContain('Absence de progrès vérifié');
  expect(summary).toContain('Résolus : 1 ; persistants : 1 ; nouveaux : 1');
  expect(summary).toContain('Références de preuves : proofReference');
  expect(summary).toContain('previous\\-contract');
  expect(summary).toContain('pas les preuves actuelles');
  expect(summary).toContain('ne constitue pas une preuve de tests exécutés');
  expect(summary).toContain('validation définitive humaine');
  expect(summary).not.toContain('RAW_OUTPUT_MARKER');
  expect(summary).not.toContain('RAW_ERROR_MARKER');
  expect(summary).not.toContain('[injected](https://example.invalid)');
  expect(summary).not.toContain('<script>');
  // The existing detailed proof export remains available, independently of the compact ledger.
  expect(text.match(/RAW_OUTPUT_MARKER/g)).toHaveLength(1);
  expect(text.match(/RAW_ERROR_MARKER/g)).toHaveLength(1);
});

it('exports every retained observation and proof reference at the persisted bounds without silent truncation', () => {
  const { feature } = fixture();
  const pilot = feature.autopilot!,
    sample = pilot.correctionLoopHistory![0];
  pilot.correctionLoopState!.observations = Array.from({ length: 80 }, (_, index) => ({
    ...structuredClone(sample.observations[0]),
    evidenceIds: Array.from({ length: 100 }, (_, proof) => `proof${index}ref${proof}`),
  }));
  pilot.correctionLoopHistory = Array.from({ length: 20 }, (_, index) => ({
    ...structuredClone(sample),
    contract: { ...sample.contract, id: `archivedContract${index}` },
  }));
  delete pilot.correctionLoop;
  const text = sessionMarkdown(feature, '/fixture');
  expect(text).toContain('désactivé ; historique conservé');
  expect(text.match(/#### Observation /g)).toHaveLength(80);
  expect(text.match(/proof\d+ref\d+/g)).toHaveLength(8000);
  expect(text).toContain('proof79ref99');
  expect(text.match(/archivedContract\d+/g)).toHaveLength(20);
  expect(text).toContain('archivedContract19');
});
