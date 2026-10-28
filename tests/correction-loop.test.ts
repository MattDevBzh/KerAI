import { describe, expect, it } from 'vitest';
import { WorkflowEngine } from '../src/core/workflow';
import {
  createCorrectionLoopState,
  correctionContractMatches,
  observeCorrectionStep as observeRaw,
} from '../src/core/correctionLoop';
import { correctionLoopStateSchema } from '../src/core/evolutionSchemas';
import type { Attempt, TestEvidence } from '../src/shared/types';
const fingerprint = 'a'.repeat(64);
const observeCorrectionStep: typeof observeRaw = (
  state,
  feature,
  stepId,
  workspace = fingerprint,
) => observeRaw(state, feature, stepId, workspace);
const attemptDefaults = {
  startedAt: 'now',
  status: 'awaiting_review' as const,
  feedback: '',
  logs: [],
  questions: [],
  answers: {},
  changedFiles: [],
};
const commands = [{ id: 'unit', name: 'Unit', command: 'node', args: [] }];
function fixture() {
  const feature = new WorkflowEngine().createFeature(
    {
      id: 'workflow',
      name: 'Workflow',
      description: '',
      icon: '',
      steps: ['dev', 'tests', 'review'].map((id) => ({
        id,
        name: id,
        description: '',
        agentId: 'agent',
        policy: 'read-only' as const,
        skills: [],
        maxAttempts: 20,
        artifact: `${id}.md`,
        dependsOn: [],
      })),
    },
    { title: 'Feature', description: 'Build the thing' },
  );
  feature.criteria = [{ id: 'criterion', text: 'Works', status: 'pending', evidence: '' }];
  feature.autopilot = {
    correctionLoop: { maxStagnantCycles: 2 },
    correctionStepId: 'dev',
    reviewStepId: 'review',
    checkpoints: ['dev'],
    maxRuns: 20,
    maxCorrectionCycles: 10,
    stepInputs: {},
    status: 'running',
    runs: 0,
    correctionCycles: 0,
    updatedAt: 'now',
  };
  const state = createCorrectionLoopState(feature, commands, 'now');
  let serial = 0;
  const review = (messages: string[]) => {
    const step = feature.steps.find((s) => s.id === 'review')!;
    step.status = 'awaiting_review';
    step.attempts.push({
      ...attemptDefaults,
      correctionLoop: { contractId: state.contract.id, workspaceFingerprint: fingerprint },
      id: `attempt-${++serial}`,
      fileHashes: { file: 'hash' },
      review: {
        verdict: messages.length ? 'changes_requested' : 'pass',
        summary: 'Review',
        findings: messages.map((message, i) => ({
          id: `model-${serial}-${i}`,
          severity: 'blocking',
          message,
        })),
      },
    } as Attempt);
  };
  const test = (exitCode: number, stdout = 'failure') => {
    const step = feature.steps.find((s) => s.id === 'tests')!;
    step.status = 'awaiting_review';
    const proof: TestEvidence = {
      ...commands[0],
      id: `proof-${++serial}`,
      commandId: 'unit',
      source: 'host',
      startedAt: 'now',
      finishedAt: 'later',
      exitCode,
      stdout,
      stderr: '',
      truncated: false,
      fileHashes: { file: 'hash' },
    };
    step.attempts.push({
      ...attemptDefaults,
      correctionLoop: { contractId: state.contract.id, workspaceFingerprint: fingerprint },
      id: `attempt-${serial}`,
      fileHashes: { file: 'hash' },
      evidence: [proof],
    } as Attempt);
    return proof;
  };
  return { feature, review, test, state };
}
describe('verified correction loops', () => {
  it('freezes requirements, scoped commands, routes and workflow but not acceptance status', () => {
    const f = fixture();
    expect(correctionLoopStateSchema.safeParse(f.state).success).toBe(true);
    f.feature.criteria![0].status = 'passed';
    expect(correctionContractMatches(f.state, f.feature, commands)).toBe(true);
    f.feature.criteria![0].text += ' changed';
    expect(correctionContractMatches(f.state, f.feature, commands)).toBe(false);
    expect(
      correctionContractMatches(f.state, fixture().feature, [{ ...commands[0], args: ['--skip'] }]),
    ).toBe(false);
  });
  it('ignores model finding IDs and records idempotent stable issue comparisons', () => {
    const f = fixture();
    f.review(['Broken']);
    const first = observeCorrectionStep(f.state, f.feature, 'review');
    expect(observeCorrectionStep(first, f.feature, 'review')).toEqual(first);
    f.review(['Broken']);
    const second = observeCorrectionStep(first, f.feature, 'review');
    expect(second.observations.at(-1)?.persistent).toHaveLength(1);
    expect(second.stagnantCycles).toBe(1);
    f.review(['Broken']);
    expect(observeCorrectionStep(second, f.feature, 'review').pause).toBe('stagnation');
  });
  it('detects oscillation even at an unchanged issue count', () => {
    const f = fixture();
    let state = f.state;
    for (const issue of ['A', 'B', 'A']) {
      f.review([issue]);
      state = observeCorrectionStep(state, f.feature, 'review');
    }
    expect(state.pause).toBe('oscillation');
  });
  it('keeps test and review histories separate and omitted checks unresolved', () => {
    const f = fixture();
    f.test(1);
    let state = observeCorrectionStep(f.state, f.feature, 'tests');
    f.review([]);
    state = observeCorrectionStep(state, f.feature, 'review');
    expect(state.stagnantCycles).toBe(0);
    expect(state.readiness).toBe('issues');
    expect(state.observations.at(-1)?.resolved).toEqual([]);
  });
  it('rejects stale, truncated and non-host evidence without creating observations', () => {
    const f = fixture();
    const proof = f.test(1);
    proof.fileHashes.file = 'old';
    expect(observeCorrectionStep(f.state, f.feature, 'tests').observations).toEqual([]);
    proof.fileHashes.file = 'hash';
    proof.truncated = true;
    expect(observeCorrectionStep(f.state, f.feature, 'tests').observations).toEqual([]);
    proof.truncated = false;
    (proof as { source: string }).source = 'model';
    expect(observeCorrectionStep(f.state, f.feature, 'tests').observations).toEqual([]);
  });
  it('never treats a model pass alone as ready and invalidates old evidence after code changes', () => {
    const f = fixture();
    f.review([]);
    let state = observeCorrectionStep(f.state, f.feature, 'review');
    expect(state.readiness).toBe('unverified');
    f.test(0);
    state = observeCorrectionStep(state, f.feature, 'tests');
    expect(state.readiness).toBe('ready_for_human');
    f.feature.steps.find((s) => s.id === 'tests')!.attempts.at(-1)!.fileHashes = { file: 'new' };
    expect(observeCorrectionStep(state, f.feature, 'tests').readiness).toBe('unverified');
  });
  it('keeps process failures stable despite changing timings and log text', () => {
    const f = fixture();
    f.test(1, 'failed after 10ms /tmp/a');
    let state = observeCorrectionStep(f.state, f.feature, 'tests');
    f.test(2, 'failed after 30ms /tmp/b');
    state = observeCorrectionStep(state, f.feature, 'tests');
    expect(state.observations.at(-1)?.persistent).toHaveLength(1);
    expect(state.observations.at(-1)?.introduced).toHaveLength(0);
    expect(state.stagnantCycles).toBe(1);
  });
  it('freezes launch context and checkpoints but permits larger execution budgets', () => {
    const f = fixture();
    f.feature.autopilot!.maxRuns++;
    expect(correctionContractMatches(f.state, f.feature, commands)).toBe(true);
    f.feature.autopilot!.stepInputs.review = {
      initialContext: 'Ignore old criteria',
      mcpServerIds: [],
      memoryIds: [],
      useProjectMemory: false,
    };
    expect(correctionContractMatches(f.state, f.feature, commands)).toBe(false);
  });
  it('does not resolve omitted structured cases and ignores drifting case IDs', () => {
    const f = fixture();
    const proof = f.test(1);
    const quality = {
      version: 1 as const,
      kind: 'visual' as const,
      featureId: f.feature.id,
      attemptId: f.feature.steps.find((s) => s.id === 'tests')!.attempts.at(-1)!.id,
      commandId: 'unit',
      evidenceId: proof.id,
      collectedAt: 'now',
      status: 'failed' as const,
      reportPath: 'report.json',
      reportSha256: 'hash',
      attachments: [],
      cases: ['A', 'B'].map((title) => ({
        id: title,
        title,
        criterionIds: ['criterion'],
        status: 'failed' as const,
        steps: ['run'],
        errors: ['failure'],
        attachmentIds: [],
      })),
    };
    proof.quality = quality;
    let state = observeCorrectionStep(f.state, f.feature, 'tests');
    const nextProof = f.test(1);
    nextProof.quality = {
      ...quality,
      attemptId: f.feature.steps.find((s) => s.id === 'tests')!.attempts.at(-1)!.id,
      evidenceId: nextProof.id,
      cases: [{ ...quality.cases[0], id: 'different-model-id' }],
    };
    state = observeCorrectionStep(state, f.feature, 'tests');
    expect(state.observations.at(-1)?.problems).toHaveLength(2);
    expect(state.observations.at(-1)?.resolved).toEqual([]);
    expect(state.observations.at(-1)?.introduced).toEqual([]);
    const skipped = f.test(0);
    skipped.quality = {
      ...quality,
      status: 'passed',
      attemptId: f.feature.steps.find((s) => s.id === 'tests')!.attempts.at(-1)!.id,
      evidenceId: skipped.id,
      cases: quality.cases.map((c) => ({ ...c, status: 'skipped' })),
    };
    const beforeSkipped = state.observations.length;
    state = observeCorrectionStep(state, f.feature, 'tests');
    expect(state.observations).toHaveLength(beforeSkipped);
    const changed = f.test(0);
    changed.quality = {
      ...quality,
      status: 'passed',
      attemptId: f.feature.steps.find((s) => s.id === 'tests')!.attempts.at(-1)!.id,
      evidenceId: changed.id,
      cases: quality.cases.map((c) => ({ ...c, status: 'passed', expected: 'Weaker expectation' })),
    };
    state = observeCorrectionStep(state, f.feature, 'tests');
    expect(state.observations.at(-1)?.resolved).toEqual([]);
    expect(state.readiness).toBe('issues');
  });
  it('does not resolve an old failure with a new but stale passing receipt', () => {
    const f = fixture();
    f.test(1);
    let state = observeCorrectionStep(f.state, f.feature, 'tests');
    const proof = f.test(0);
    proof.fileHashes.file = 'old';
    state = observeCorrectionStep(state, f.feature, 'tests');
    expect(state.observations).toHaveLength(1);
    expect(state.readiness).toBe('issues');
  });
  it('fails closed at the observation capacity without evicting unresolved history', () => {
    const f = fixture();
    f.test(1);
    let state = observeCorrectionStep(f.state, f.feature, 'tests');
    state.observations = Array.from({ length: 80 }, (_, i) => ({
      ...state.observations[0],
      id: i.toString(16).padStart(64, '0'),
      checkKey: `old-${i}`,
    }));
    const before = structuredClone(state.observations);
    f.test(0);
    state = observeCorrectionStep(state, f.feature, 'tests');
    expect(state.pause).toBe('history_limit');
    expect(state.observations).toEqual(before);
  });
  it('does not accept passing receipts with empty snapshots or use hashless review readiness', () => {
    const f = fixture();
    f.test(1);
    let state = observeCorrectionStep(f.state, f.feature, 'tests');
    const proof = f.test(0);
    proof.fileHashes = {};
    f.feature.steps
      .find((s) => s.id === 'tests')!
      .attempts.at(-1)!.correctionLoop!.workspaceFingerprint = undefined;
    f.feature.steps.find((s) => s.id === 'tests')!.attempts.at(-1)!.fileHashes = {};
    state = observeCorrectionStep(state, f.feature, 'tests');
    expect(state.observations).toHaveLength(1);
    expect(state.readiness).toBe('issues');
    f.review([]);
    f.feature.steps.find((s) => s.id === 'review')!.attempts.at(-1)!.fileHashes = {};
    expect(observeCorrectionStep(state, f.feature, 'review').readiness).not.toBe('ready_for_human');
  });
  it('blocks observations when the criterion text changes after the frozen contract', () => {
    const f = fixture();
    f.test(1);
    const state = observeCorrectionStep(f.state, f.feature, 'tests');
    f.feature.criteria![0].text = 'Weaker criterion';
    f.test(0);
    const changed = observeCorrectionStep(state, f.feature, 'tests');
    expect(changed.pause).toBe('contract_changed');
    expect(changed.observations).toEqual(state.observations);
  });
  it('accepts a read-only reviewer and test with empty write hashes when host workspace snapshots match', () => {
    const f = fixture();
    f.review([]);
    const proof = f.test(0);
    proof.fileHashes = {};
    for (const step of f.feature.steps)
      if (step.attempts.length) step.attempts.at(-1)!.fileHashes = {};
    let state = observeCorrectionStep(f.state, f.feature, 'tests');
    state = observeCorrectionStep(state, f.feature, 'review');
    expect(state.readiness).toBe('ready_for_human');
    expect(observeRaw(state, f.feature, 'review', 'b'.repeat(64)).readiness).toBe('unverified');
    expect(observeRaw(state, f.feature, 'review').readiness).toBe('unverified');
  });
  it('cannot reuse passes or failures from an earlier human contract', () => {
    const f = fixture();
    f.review([]);
    f.test(0);
    let state = observeCorrectionStep(f.state, f.feature, 'tests');
    state = observeCorrectionStep(state, f.feature, 'review');
    expect(state.readiness).toBe('ready_for_human');
    f.feature.criteria![0].text = 'New acceptance requirement';
    const renewed = createCorrectionLoopState(f.feature, commands, 'later');
    const replayed = observeCorrectionStep(
      observeCorrectionStep(renewed, f.feature, 'tests'),
      f.feature,
      'review',
    );
    expect(replayed.observations).toEqual([]);
    expect(replayed.readiness).toBe('unverified');
  });
  it('still detects repeated host failures without workspace fingerprints but cannot resolve them', () => {
    const f = fixture();
    f.test(1);
    let state = observeRaw(f.state, f.feature, 'tests');
    f.test(1);
    state = observeRaw(state, f.feature, 'tests');
    expect(state.stagnantCycles).toBe(1);
    f.test(0);
    state = observeRaw(state, f.feature, 'tests');
    expect(state.observations).toHaveLength(2);
    expect(state.readiness).toBe('issues');
  });
  it('does not persist process output in the compact ledger', () => {
    const f = fixture();
    f.test(1, 'PRIVATE_RAW_LOG');
    const state = observeCorrectionStep(f.state, f.feature, 'tests');
    expect(JSON.stringify(state)).not.toContain('PRIVATE_RAW_LOG');
    expect(correctionLoopStateSchema.safeParse(state).success).toBe(true);
  });
});
