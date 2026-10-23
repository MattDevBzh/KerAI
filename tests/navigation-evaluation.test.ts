import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  navigationEvaluationReport,
  evaluationAttempts,
  type NavigationCampaign,
  type NavigationEvaluationEntry,
  type NavigationEvaluationInput,
} from '../src/shared/navigationEvaluation';
import { NavigationEvaluationStore } from '../src/host/NavigationEvaluationStore';
import { navigationCommandSchema } from '../src/core/navigationSchemas';
import { demoState } from '../webview/demo';
const now = '2026-10-23T10:00:00Z';
const configuration = {
  model: 'model',
  runtime: 'runtime-1',
  permissions: 'read-only',
  build: 'commit-initial',
  dataSnapshot: 'data-1',
  criteria: 'criteria-1',
  role: 'manager',
  catalogueSnapshot: 'catalogue-1',
  indexSnapshot: 'index-1',
};
function row(
  condition: 'A' | 'B',
  patch: Partial<NavigationEvaluationEntry> = {},
): NavigationEvaluationEntry {
  return {
    id: condition,
    condition,
    ticketId: 'ticket',
    repetition: 1,
    order: 1,
    phase: 'analysis',
    outcome: 'succeeded',
    qualityAccepted: true,
    attemptRefs: [{ featureId: 'f', stepId: 's', attemptId: condition }],
    providerMode: 'linked-attempts',
    times: {
      preparation: 0,
      connection: 0,
      demonstration: 0,
      work: condition === 'A' ? 100 : 50,
      waiting: 0,
    },
    configuration: { ...configuration },
    receipts: [
      {
        ref: { featureId: 'f', stepId: 's', attemptId: condition },
        status: 'approved',
        model: 'model',
        usage: {
          source: 'measured',
          model: 'model',
          inputTokens: condition === 'A' ? 100 : 50,
          outputTokens: 0,
          cost: condition === 'A' ? 10 : 5,
          unit: 'nano-AIU',
        },
      },
    ],
    savedAt: now,
    ...patch,
  };
}
function overheads(): NavigationEvaluationEntry[] {
  return (['A', 'B'] as const).flatMap((condition) =>
    (['learning', 'maintenance'] as const).map((phase) =>
      row(condition, {
        id: `${condition}-${phase}`,
        phase,
        ticketId: undefined,
        order: phase === 'learning' ? 0 : 2,
        providerMode: 'none-declared',
        attemptRefs: [],
        receipts: [],
        times: { preparation: 0, connection: 0, demonstration: 0, work: 0, waiting: 0 },
      }),
    ),
  );
}
function campaign(
  entries: NavigationEvaluationEntry[] = [row('A'), row('B'), ...overheads()],
): NavigationCampaign {
  return {
    id: 'campaign',
    name: 'Private campaign',
    profile: '/private/project',
    tickets: [{ id: 'ticket', label: 'Private ticket' }],
    repetitions: 1,
    phases: ['analysis'],
    entries,
    createdAt: now,
    updatedAt: now,
  };
}
function input(entry: NavigationEvaluationEntry): NavigationEvaluationInput {
  const { receipts, savedAt, ...value } = entry;
  return value;
}
describe('navigation campaign admissibility and honest cumulative measures', () => {
  it('computes paired median and cumulative gain only for complete comparable rows including explicit overhead zeros', () => {
    const report = navigationEvaluationReport(campaign());
    expect(report.metrics.tokens.medianPairedGain).toBe(0.5);
    expect(report.metrics.tokens.cumulativeGain).toBe(0.5);
    expect(report.metrics.activeSeconds.breakEven[0]).toMatchObject({
      firstUse: 1,
      finalGain: 0.5,
      reversed: false,
    });
  });
  it('missing learning/maintenance never becomes free overhead', () => {
    const report = navigationEvaluationReport(campaign([row('A'), row('B')]));
    expect(report.metrics.tokens.medianPairedGain).toBe(0.5);
    expect(report.metrics.tokens.cumulativeGain).toBeNull();
    expect(report.metrics.tokens.cumulativeReasons.join(' ')).toContain(
      'apprentissage non renseigné',
    );
    expect(report.metrics.tokens.breakEven[0].firstUse).toBeNull();
  });
  it('unknown time is distinct from zero and active time does not include human waiting', () => {
    const b = row('B');
    delete b.times.waiting;
    const report = navigationEvaluationReport(campaign([row('A'), b, ...overheads()]));
    expect(report.metrics.activeSeconds.cumulativeGain).toBe(0.5);
    expect(report.metrics.totalSeconds.cumulativeGain).toBeNull();
    expect(report.metrics.totalSeconds.totalB.value).toBeNull();
  });
  it('failed tasks remain in totals and are excluded from quality comparisons', () => {
    const report = navigationEvaluationReport(
      campaign([row('A'), row('B', { outcome: 'failed' }), ...overheads()]),
    );
    expect(report.metrics.tokens.totalB.value).toBe(50);
    expect(report.metrics.tokens.admissiblePairs).toBe(0);
    expect(report.metrics.tokens.cumulativeGain).toBeNull();
    expect(report.failures).toBe(1);
  });
  it('failed intermediate attempts count in a finally accepted task instead of disappearing', () => {
    const b = row('B');
    b.receipts[0].status = 'failed';
    b.receipts.push({
      ref: { featureId: 'f', stepId: 's', attemptId: 'retry' },
      status: 'approved',
      model: 'model',
      usage: { source: 'measured', inputTokens: 20, outputTokens: 0, cost: 2, unit: 'nano-AIU' },
    });
    b.attemptRefs.push(b.receipts[1].ref);
    const report = navigationEvaluationReport(campaign([row('A'), b, ...overheads()]));
    expect(report.metrics.tokens.totalB.value).toBe(70);
    expect(report.failures).toBe(1);
    expect(report.metrics.tokens.cumulativeGain).toBeCloseTo(0.3);
  });
  it('cost units and effective model disagreements forbid an unsupported comparison', () => {
    const b = row('B');
    b.receipts[0].usage!.unit = 'USD';
    const report = navigationEvaluationReport(campaign([row('A'), b, ...overheads()]));
    expect(report.metrics.cost.cumulativeGain).toBeNull();
    expect(report.metrics.cost.admissiblePairs).toBe(0);
    b.receipts[0].usage!.model = 'another-model';
    expect(
      navigationEvaluationReport(campaign([row('A'), b, ...overheads()])).metrics.tokens
        .admissiblePairs,
    ).toBe(0);
  });
  it('model-level receipts expose mixed models even when the top-level model matches', () => {
    const b = row('B');
    b.receipts[0].usage!.byModel = {
      model: { inputTokens: 40, outputTokens: 0 },
      'other-model': { inputTokens: 10, outputTokens: 0 },
    };
    const report = navigationEvaluationReport(campaign([row('A'), b, ...overheads()]));
    expect(report.metrics.tokens.admissiblePairs).toBe(0);
    expect(report.metrics.tokens.cumulativeGain).toBeNull();
  });
  it('never counts the A half of an unfinished future pair as savings', () => {
    const entries = [
      row('A', { ticketId: 'first', order: 1 }),
      row('B', { ticketId: 'first', order: 4 }),
      row('A', { ticketId: 'second', order: 2 }),
      row('B', { ticketId: 'second', order: 3 }),
    ];
    [1000, 990, 100, 150].forEach((value, index) => {
      entries[index].times.work = value;
    });
    const c = campaign([...entries, ...overheads()]);
    c.tickets = [
      { id: 'first', label: 'First' },
      { id: 'second', label: 'Second' },
    ];
    const report = navigationEvaluationReport(c);
    expect(report.metrics.activeSeconds.breakEven[0].firstUse).toBeNull();
    expect(report.metrics.activeSeconds.breakEven[0].reversed).toBe(false);
    expect(report.metrics.activeSeconds.cumulativeGain).toBeLessThan(0);
  });
  it('out-of-scope measured work cannot escape quality exclusions in cumulative gains', () => {
    const c = campaign([
      ...campaign().entries,
      row('A', { phase: 'verification' }),
      row('B', { phase: 'verification', outcome: 'failed' }),
    ]);
    const report = navigationEvaluationReport(c);
    expect(report.metrics.activeSeconds.cumulativeGain).toBeNull();
    expect(report.metrics.activeSeconds.cumulativeReasons.join(' ')).toContain('hors du périmètre');
    expect(report.metrics.activeSeconds.breakEven[0].finalGain).toBeNull();
  });
  it('a later maintenance cost can reverse observed break-even', () => {
    const overhead = overheads();
    overhead.find((entry) => entry.condition === 'B' && entry.phase === 'maintenance')!.times.work =
      80;
    const result = navigationEvaluationReport(campaign([row('A'), row('B'), ...overhead]));
    expect(result.metrics.activeSeconds.breakEven[0]).toMatchObject({
      firstUse: 1,
      reversed: true,
    });
    expect(result.metrics.activeSeconds.cumulativeGain).toBeCloseTo(-0.3);
  });
  it('zero denominator, missing phases and non-comparable snapshots never produce gain', () => {
    const a = row('A');
    a.receipts[0].usage!.inputTokens = 0;
    expect(
      navigationEvaluationReport(campaign([a, row('B'), ...overheads()])).metrics.tokens
        .cumulativeGain,
    ).toBeNull();
    const c = campaign();
    c.phases.push('development');
    expect(navigationEvaluationReport(c).metrics.activeSeconds.admissiblePairs).toBe(0);
    const b = row('B');
    b.configuration.build = 'different';
    expect(
      navigationEvaluationReport(campaign([row('A'), b, ...overheads()])).metrics.tokens
        .admissiblePairs,
    ).toBe(0);
  });
  it('repetitions do not count as new uses and changing initial library snapshots is excluded', () => {
    const c = campaign();
    c.repetitions = 2;
    c.entries.push(
      ...c.entries.map((entry) => ({
        ...structuredClone(entry),
        id: `${entry.id}-2`,
        repetition: 2,
      })),
    );
    let report = navigationEvaluationReport(c);
    expect(report.metrics.activeSeconds.breakEven.map((entry) => entry.firstUse)).toEqual([1, 1]);
    c.entries.find(
      (entry) => entry.repetition === 2 && entry.condition === 'B' && entry.phase === 'analysis',
    )!.configuration.catalogueSnapshot = 'changed';
    report = navigationEvaluationReport(c);
    expect(report.metrics.tokens.admissiblePairs).toBe(1);
    expect(report.metrics.tokens.cumulativeGain).toBeNull();
  });
});
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kerai-evaluation-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe('private campaign journal and exact host usage receipts', () => {
  it('includes baseline A without navigation, deduplicates attempts, freezes receipts and reloads', async () => {
    const features = structuredClone(demoState.features);
    const attempt = evaluationAttempts(features)[0];
    expect(attempt).toBeDefined();
    const source = features
      .find((feature) => feature.id === attempt.ref.featureId)!
      .steps.find((step) => step.id === attempt.ref.stepId)!
      .attempts.find((row) => row.id === attempt.ref.attemptId)!;
    source.navigation = undefined;
    source.status = 'approved';
    source.usage = {
      source: 'measured',
      inputTokens: 123,
      outputTokens: 7,
      cost: 4,
      unit: 'nano-AIU',
      model: 'model',
    };
    const store = new NavigationEvaluationStore({
      storageRoot: directory,
      features: () => features,
    });
    await store.initialize();
    const { entries, createdAt, updatedAt, ...definition } = campaign();
    await store.handle({ action: 'evaluationSaveCampaign', campaign: definition });
    const value = input(row('A', { attemptRefs: [attempt.ref] }));
    await store.handle({ action: 'evaluationSaveEntry', campaignId: 'campaign', entry: value });
    await expect(
      store.handle({
        action: 'evaluationSaveEntry',
        campaignId: 'campaign',
        entry: { ...value, id: 'duplicate', condition: 'B' },
      }),
    ).rejects.toThrow('déjà comptée');
    source.usage.inputTokens = 999;
    expect(store.snapshot().campaigns[0].entries[0].receipts[0].usage?.inputTokens).toBe(123);
    const reloaded = new NavigationEvaluationStore({ storageRoot: directory, features: () => [] });
    await reloaded.initialize();
    expect(reloaded.snapshot().campaigns[0].entries[0].receipts[0].usage?.inputTokens).toBe(123);
    expect(await readFile(path.join(directory, 'evaluation.json'), 'utf8')).toContain('123');
  });
  it('refuses to remove a phase with recorded measurements', async () => {
    const store = new NavigationEvaluationStore({ storageRoot: directory, features: () => [] });
    await store.initialize();
    const { entries, createdAt, updatedAt, ...definition } = campaign();
    await store.handle({ action: 'evaluationSaveCampaign', campaign: definition });
    await store.handle({
      action: 'evaluationSaveEntry',
      campaignId: definition.id,
      entry: input(row('A', { providerMode: 'unknown', attemptRefs: [], receipts: [] })),
    });
    await expect(
      store.handle({
        action: 'evaluationSaveCampaign',
        campaign: { ...definition, phases: ['verification'] },
      }),
    ).rejects.toThrow('phase');
  });
  it('exports exact failures and numbers without local names, URLs, observations or source references', async () => {
    const store = new NavigationEvaluationStore({ storageRoot: directory, features: () => [] });
    await store.initialize();
    const { entries, createdAt, updatedAt, ...definition } = campaign();
    await store.handle({ action: 'evaluationSaveCampaign', campaign: definition });
    await store.handle({
      action: 'evaluationSaveEntry',
      campaignId: 'campaign',
      entry: input(
        row('A', {
          outcome: 'failed',
          attemptRefs: [],
          receipts: [],
          providerMode: 'unknown',
          observations: 'https://private.example SECRET_ACCOUNT',
          configuration: { ...configuration, build: '/private/repo' },
        }),
      ),
    });
    const result = await store.handle({ action: 'evaluationExport', campaignId: 'campaign' });
    expect(result.exportText).not.toMatch(
      /Private campaign|Private ticket|private\/|private.example|SECRET_ACCOUNT/,
    );
    const exported = JSON.parse(result.exportText!);
    expect(exported.entries[0].times.work).toBe(100);
    expect(exported.entries[0].outcome).toBe('failed');
    expect(exported.report.metrics.tokens.totalA.value).toBeNull();
  });
  it('rejects forged receipts and provider mode ambiguity at the host message boundary', () => {
    expect(() =>
      navigationCommandSchema.parse({
        action: 'evaluationSaveEntry',
        campaignId: 'campaign',
        entry: { ...input(row('A')), receipts: [] },
      }),
    ).toThrow();
    expect(() =>
      navigationCommandSchema.parse({
        action: 'evaluationSaveEntry',
        campaignId: 'campaign',
        entry: { ...input(row('A')), providerMode: 'none-declared' },
      }),
    ).toThrow();
  });
});
