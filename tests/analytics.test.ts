import { describe, expect, it } from 'vitest';
import { analyzeUsage, effectiveModel, unknownModel } from '../src/core/analytics';
import type { Attempt, Feature, Usage } from '../src/shared/types';
import { usageTotals } from '../src/core/budgets';
const at = '2026-10-13T10:00:00Z';
function attempt(id: string, extra: Partial<Attempt> = {}): Attempt {
  return {
    id,
    startedAt: at,
    status: 'awaiting_review',
    feedback: '',
    questions: [],
    answers: {},
    logs: [],
    changedFiles: [],
    ...extra,
  };
}
function feature(id: string, attempts: Attempt[], extra: Partial<Feature> = {}): Feature {
  return {
    id,
    title: `Session ${id}`,
    description: '',
    workflowId: 'feature',
    workflowName: 'Feature',
    createdAt: at,
    updatedAt: at,
    branch: '',
    status: 'attention',
    activeStepId: 'dev',
    steps: [
      {
        id: 'dev',
        name: 'Development',
        description: '',
        agentId: 'agent',
        policy: 'read-only',
        skills: [],
        maxAttempts: 10,
        artifact: 'work',
        dependsOn: [],
        model: 'configured-model-must-not-appear',
        status: attempts.at(-1)?.status ?? 'pending',
        attempts,
      },
    ],
    ...extra,
  };
}
const usage = (extra: Partial<Usage> = {}): Usage => ({ source: 'measured', ...extra });
describe('multi-session observed usage analytics', () => {
  it('keeps measured zero, absent and partial values distinct and uses exact nano-AIU units', () => {
    const data = feature('mixed', [
      attempt('zero', {
        usage: usage({ inputTokens: 0, outputTokens: 0, cost: 0, unit: 'nano-AIU' }),
      }),
      attempt('unknown'),
      attempt('partial', {
        usage: usage({
          inputTokens: 12,
          cost: 30,
          unit: 'nano-AIU',
          incompleteTokens: true,
          incompleteCost: true,
        }),
      }),
      attempt('usd', { usage: usage({ inputTokens: 8, outputTokens: 4, cost: 99, unit: 'USD' }) }),
    ]);
    const result = analyzeUsage([data]);
    expect(result.summary.inputTokens).toEqual({
      value: 20,
      completeRuns: 2,
      partialRuns: 1,
      unknownRuns: 1,
      zeroRuns: 1,
    });
    expect(result.summary.outputTokens).toEqual({
      value: 4,
      completeRuns: 2,
      partialRuns: 0,
      unknownRuns: 2,
      zeroRuns: 1,
    });
    expect(result.summary.nanoAiu).toEqual({
      value: 30,
      completeRuns: 1,
      partialRuns: 1,
      unknownRuns: 2,
      zeroRuns: 1,
    });
    expect(result.summary.completeTokenRuns).toBe(2);
    expect(result.summary.ignoredCostUnitRuns).toBe(1);
    expect(result.summary.runs).toBe(4);
    expect(result.summary.inputTokens.value).toBe(usageTotals(data).inputTokens);
    expect(analyzeUsage([feature('unknown', [attempt('one')])]).summary.nanoAiu.value).toBeNull();
    expect(analyzeUsage([]).summary.inputTokens.value).toBeNull();
  });
  it('sums the final cumulative usage snapshot once, ignoring event snapshots and revisions', () => {
    const data = feature('snapshot', [
      attempt('one', {
        revision: 19,
        usage: usage({ inputTokens: 100, outputTokens: 50, cost: 70, unit: 'nano-AIU' }),
        logs: [
          { id: 'initial', at, kind: 'usage', message: '{"inputTokens":10,"outputTokens":5}' },
          { id: 'updated', at, kind: 'usage', message: '{"inputTokens":100,"outputTokens":50}' },
        ],
      }),
    ]);
    const result = analyzeUsage([data]);
    expect(result.summary.runs).toBe(1);
    expect(result.summary.inputTokens.value).toBe(100);
    expect(result.summary.outputTokens.value).toBe(50);
    expect(result.summary.nanoAiu.value).toBe(70);
  });
  it('groups by observed model first, recorded attempt second, never configured step model', () => {
    const data = feature('models', [
      attempt('first', {
        model: 'requested',
        usage: usage({ model: ' observed ', inputTokens: 1 }),
      }),
      attempt('second', { model: 'recorded', usage: usage({ model: ' ' }) }),
      attempt('third'),
    ]);
    const result = analyzeUsage([data]);
    expect(result.models.map((group) => group.id)).toEqual([unknownModel, 'observed', 'recorded']);
    expect(effectiveModel(attempt('no-model'))).toBe(unknownModel);
    expect(result.models.some((group) => group.id.includes('configured'))).toBe(false);
    expect(analyzeUsage([data], { model: 'observed' }).summary.runs).toBe(1);
  });
  it('filters inclusive UTC start dates, workflow, model and archives, including empty selections', () => {
    const a = feature('a', [
      attempt('before', { startedAt: '2026-10-12T23:59:59Z', model: 'm' }),
      attempt('start', { startedAt: '2026-10-13T00:00:00Z', model: 'm' }),
      attempt('end', { startedAt: '2026-10-13T23:59:59.999Z', model: 'm' }),
      attempt('after', { startedAt: '2026-10-14T00:00:00Z' }),
    ]);
    const b = feature('b', [attempt('other', { model: 'm' })], {
      workflowId: 'review',
      workflowName: 'Review',
    });
    const archived = feature('archived', [attempt('archived')], { archived: true });
    expect(analyzeUsage([a, b, archived]).summary.runs).toBe(5);
    expect(analyzeUsage([a, b, archived], { includeArchived: true }).summary.runs).toBe(6);
    const filtered = analyzeUsage([a, b, archived], {
      from: '2026-10-13',
      to: '2026-10-13',
      workflowId: 'feature',
      model: 'm',
    });
    expect(filtered.entries.map((entry) => entry.attempt.id)).toEqual(['start', 'end']);
    expect(filtered.sessions.map((group) => group.id)).toEqual(['a']);
    expect(filtered.workflows.map((group) => group.id)).toEqual(['feature']);
    expect(analyzeUsage([a], { from: '2030-01-01' }).summary.runs).toBe(0);
    expect(analyzeUsage([a], { from: '2026-10-14', to: '2026-10-13' }).summary.runs).toBe(0);
  });
  it('reports current human and autopilot validations with explicit lifetime effort denominator', () => {
    const a = feature('human', [
      attempt('failed', { status: 'failed', startedAt: '2026-10-12T10:00:00Z', model: 'old' }),
      attempt('cancel', { status: 'cancelled', startedAt: '2026-10-12T11:00:00Z', model: 'old' }),
      attempt('approved', {
        status: 'approved',
        approvedBy: 'human',
        approvedAt: at,
        model: 'new',
        revision: 8,
      }),
    ]);
    const b = feature('auto', [
      attempt('approved-auto', { status: 'approved', approvedBy: 'autopilot', approvedAt: at }),
    ]);
    const unknown = feature('legacy', [attempt('legacy-approved', { status: 'approved' })]);
    const unvalidated = feature('unvalidated', [attempt('wait')]);
    const stale = feature('invalidated', [
      attempt('old-approval', { status: 'approved', approvedBy: 'human' }),
    ]);
    stale.steps[0].status = 'stale';
    const result = analyzeUsage([a, b, unknown, unvalidated, stale]);
    expect(result.summary).toMatchObject({
      humanApprovals: 1,
      autopilotApprovals: 1,
      unattributedApprovals: 1,
      invalidatedApprovalRuns: 1,
      failedRuns: 1,
      cancelledRuns: 1,
    });
    expect(result.validationEffort).toEqual({
      validatedSteps: 3,
      attempts: 5,
      outsideSelection: 0,
      average: 5 / 3,
    });
    const selected = analyzeUsage([a, b], { model: 'new', from: '2026-10-13' });
    expect(selected.summary.runs).toBe(1);
    expect(selected.validationEffort).toEqual({
      validatedSteps: 1,
      attempts: 3,
      outsideSelection: 2,
      average: 3,
    });
    expect(analyzeUsage([unvalidated]).validationEffort.average).toBeNull();
  });
  it('ignores non-measured, negative and nonfinite telemetry and documents unusable dates', () => {
    const data = feature('bad', [
      attempt('bad', {
        startedAt: 'invalid',
        usage: {
          source: 'estimated',
          inputTokens: 100,
          cost: 999,
          unit: 'nano-AIU',
        } as unknown as Usage,
      }),
      attempt('negative', {
        usage: usage({
          inputTokens: -1,
          outputTokens: Number.NaN,
          cost: Number.POSITIVE_INFINITY,
          unit: 'nano-AIU',
        }),
      }),
      attempt('interrupted', { status: 'interrupted' }),
      attempt('running', { status: 'running' }),
    ]);
    const result = analyzeUsage([data]);
    expect(result.summary.inputTokens.value).toBeNull();
    expect(result.summary.outputTokens.value).toBeNull();
    expect(result.summary.nanoAiu.value).toBeNull();
    expect(result.summary.invalidDateRuns).toBe(1);
    expect(result.summary.interruptedRuns).toBe(1);
    expect(result.summary.ongoingRuns).toBe(1);
    expect(analyzeUsage([data], { from: '2026-10-13' }).summary.invalidDateRuns).toBe(0);
  });
});
