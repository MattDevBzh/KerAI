import { describe, expect, it } from 'vitest';
import { WorkflowEngine } from '../src/core/workflow';
import { nextAutopilotAction } from '../src/core/autopilot';
import type { TestEvidence } from '../src/shared/types';
const proof = (exitCode = 0): TestEvidence => ({
  id: 'proof',
  source: 'host',
  commandId: 'unit',
  name: 'Unit',
  command: 'node',
  args: [],
  startedAt: 'now',
  finishedAt: 'later',
  exitCode,
  stdout: 'Observed result',
  stderr: '',
  truncated: false,
  fileHashes: {},
});
function fixture() {
  const engine = new WorkflowEngine(),
    feature = engine.createFeature(
      {
        id: 'feature',
        name: 'Feature',
        description: '',
        icon: '',
        steps: ['specs', 'dev', 'tests', 'review'].map((id, index, ids) => ({
          id,
          name: id,
          description: '',
          agentId: 'agent',
          policy: id === 'tests' ? 'tests' : id === 'dev' ? 'workspace-write' : 'read-only',
          skills: [],
          maxAttempts: 5,
          artifact: `${id}.md`,
          dependsOn: index ? [ids[index - 1]] : [],
        })),
      },
      { title: 'Pilot', description: '' },
    );
  feature.autopilot = {
    checkpoints: ['specs', 'review'],
    maxRuns: 10,
    maxCorrectionCycles: 1,
    correctionStepId: 'dev',
    reviewStepId: 'review',
    stepInputs: {},
    status: 'running',
    runs: 0,
    correctionCycles: 0,
    updatedAt: 'now',
  };
  function finish(id: string, approve = true) {
    const attempt = engine.beginRun(feature.id, id);
    engine.finishRun(feature.id, id, { content: id, questions: [], changedFiles: [] });
    if (id === 'tests') attempt.evidence = [proof()];
    if (approve) engine.approveStep(feature.id, id);
    return attempt;
  }
  return { engine, feature, finish };
}
describe('pure bounded autopilot decisions', () => {
  it('runs ready steps, stops at human checkpoints and never mutates state', () => {
    const f = fixture(),
      before = structuredClone(f.feature);
    expect(nextAutopilotAction(f.feature)).toEqual({ kind: 'run', stepId: 'specs' });
    expect(f.feature).toEqual(before);
    f.finish('specs', false);
    expect(nextAutopilotAction(f.feature)).toEqual({
      kind: 'pause',
      reason: 'Validation humaine requise : specs.',
    });
    f.engine.approveStep(f.feature.id, 'specs');
    expect(nextAutopilotAction(f.feature)).toEqual({ kind: 'run', stepId: 'dev' });
    f.finish('dev', false);
    expect(nextAutopilotAction(f.feature)).toEqual({ kind: 'approve', stepId: 'dev' });
  });
  it('pauses questions and errors, and resumes only answered questions after explicit activation', () => {
    const f = fixture(),
      attempt = f.engine.beginRun(f.feature.id, 'specs');
    f.engine.setSession(f.feature.id, 'specs', 'session');
    f.engine.finishRun(f.feature.id, 'specs', {
      content: 'Partial',
      questions: [{ id: 'q', text: 'Who?' }],
      changedFiles: [],
    });
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/questions/),
    });
    f.engine.answerQuestions(f.feature.id, 'specs', { q: 'Matt' });
    f.feature.autopilot!.status = 'paused';
    expect(nextAutopilotAction(f.feature).kind).toBe('pause');
    f.feature.autopilot!.status = 'running';
    expect(nextAutopilotAction(f.feature)).toEqual({ kind: 'run', stepId: 'specs', resume: true });
    f.engine.beginRun(f.feature.id, 'specs', '', true);
    f.engine.failRun(f.feature.id, 'specs', 'Transport');
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/failed/),
    });
    expect(attempt.answers.q).toBe('Matt');
  });
  it('requires observed tests to auto-approve and permits a declared bounded correction route', () => {
    const f = fixture();
    f.finish('specs');
    f.finish('dev');
    const attempt = f.finish('tests', false);
    attempt.evidence = [];
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/réellement exécutés/),
    });
    attempt.evidence = [proof(1)];
    const decision = nextAutopilotAction(f.feature);
    expect(decision).toMatchObject({
      kind: 'correct',
      stepId: 'dev',
      feedback: expect.stringContaining('code 1'),
    });
    f.feature.autopilot!.correctionCycles = 1;
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/cycles de correction/),
    });
  });
  it('prioritizes checkpoints over correction and rejects unrelated correction targets', () => {
    const f = fixture();
    f.finish('specs');
    f.finish('dev');
    const attempt = f.finish('tests', false);
    attempt.evidence = [proof(1)];
    f.feature.autopilot!.checkpoints.push('tests');
    expect(nextAutopilotAction(f.feature)).toEqual({
      kind: 'pause',
      reason: 'Validation humaine requise : tests.',
    });
    f.feature.autopilot!.checkpoints = [];
    f.feature.autopilot!.correctionStepId = 'review';
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/Route/),
    });
  });
  it('uses structured review verdicts and never prose-only claims to request corrections', () => {
    const f = fixture();
    f.finish('specs');
    f.finish('dev');
    f.finish('tests');
    const review = f.finish('review', false);
    f.feature.autopilot!.checkpoints = [];
    review.artifact!.content = 'Changes requested (ordinary prose)';
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/structurée/),
    });
    review.review = { verdict: 'pass', summary: 'Observed pass', findings: [] };
    expect(nextAutopilotAction(f.feature)).toEqual({ kind: 'approve', stepId: 'review' });
    review.review = {
      verdict: 'changes_requested',
      summary: 'Fix bug',
      findings: [{ id: 'bug', severity: 'blocking', message: 'Observed defect' }],
    };
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'correct',
      stepId: 'dev',
      feedback: expect.stringContaining('Observed defect'),
    });
  });
  it('requires builtin review verdicts even with no automatic correction route configured', () => {
    const f = fixture();
    f.finish('specs');
    f.finish('dev');
    f.finish('tests');
    f.finish('review', false);
    f.feature.autopilot!.checkpoints = [];
    f.feature.autopilot!.reviewStepId = undefined;
    f.feature.autopilot!.correctionStepId = undefined;
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/structurée/),
    });
    f.feature.workflowId = 'code-review';
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/structurée/),
    });
    f.feature.workflowId = 'custom';
    expect(nextAutopilotAction(f.feature)).toEqual({ kind: 'approve', stepId: 'review' });
  });
  it('checks run limits and confirmation before new calls, while allowing approvals without spending', () => {
    const f = fixture();
    f.feature.steps[0].askBeforeRun = true;
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/Confirmation/),
    });
    f.feature.steps[0].askBeforeRun = false;
    f.feature.autopilot!.runs = 10;
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/runs du pilote/),
    });
    f.feature.autopilot!.runs = 0;
    f.finish('specs');
    f.finish('dev', false);
    f.feature.budget!.maxRuns = 1;
    expect(nextAutopilotAction(f.feature)).toEqual({ kind: 'approve', stepId: 'dev' });
    f.engine.approveStep(f.feature.id, 'dev');
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/Budget/),
    });
  });
  it('completes only after approvals and final criteria or comment blockers are resolved', () => {
    const f = fixture();
    for (const id of ['specs', 'dev', 'tests', 'review']) f.finish(id);
    expect(nextAutopilotAction(f.feature)).toEqual({ kind: 'complete' });
    f.feature.criteria = [
      { id: 'criterion', text: 'Visible path', status: 'pending', evidence: '' },
    ];
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringMatching(/critères/),
    });
    f.feature.autopilot = undefined;
    expect(nextAutopilotAction(f.feature).kind).toBe('pause');
  });
});
