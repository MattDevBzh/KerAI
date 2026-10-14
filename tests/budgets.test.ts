import { describe, expect, it } from 'vitest';
import { WorkflowEngine } from '../src/core/workflow';
import { budgetBlockReason, defaultBudget, usageTotals } from '../src/core/budgets';
import type { Usage } from '../src/shared/types';
function fixture(usages: (Usage | undefined)[]) {
  const engine = new WorkflowEngine(),
    feature = engine.createFeature(
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
            policy: 'read-only',
            skills: [],
            maxAttempts: 10,
            artifact: 'run.md',
            dependsOn: [],
          },
        ],
      },
      { title: 'Budget', description: '' },
    );
  for (const [index, usage] of usages.entries()) {
    const attempt = engine.beginRun(feature.id, 'run');
    attempt.usage = usage;
    if (index % 2) engine.cancelRun(feature.id);
    else engine.failRun(feature.id, 'run', 'Failure');
  }
  return feature;
}
describe('measured feature consumption', () => {
  it('counts failed and cancelled attempts, preserves unknowns, and sums only nano-AIU units', () => {
    const feature = fixture([
      { source: 'measured', inputTokens: 10, outputTokens: 5, cost: 100, unit: 'nano-AIU' },
      { source: 'measured', inputTokens: 2, outputTokens: 3, cost: 2, unit: 'USD' },
      undefined,
      { source: 'measured', inputTokens: 0, outputTokens: 0, cost: 0, unit: 'nano-AIU' },
    ]);
    expect(usageTotals(feature)).toEqual({
      runs: 4,
      inputTokens: 12,
      outputTokens: 8,
      nanoAiu: 100,
      unknownTokenRuns: 1,
      unknownCostRuns: 2,
    });
    expect(defaultBudget).toEqual({ maxRuns: 10, maxPromptChars: 60000, modelProfile: 'current' });
  });
  it('stops on measured thresholds and unknown usage only when that limit is configured', () => {
    const unknown = fixture([undefined]);
    expect(budgetBlockReason(unknown)).toBeUndefined();
    unknown.budget = { ...defaultBudget, maxTokens: 100 };
    expect(budgetBlockReason(unknown)).toMatch(/inconnue/);
    unknown.budget = { ...defaultBudget, maxNanoAiu: 100 };
    expect(budgetBlockReason(unknown)).toMatch(/inconnue/);
    const known = fixture([
      { source: 'measured', inputTokens: 10, outputTokens: 5, cost: 12, unit: 'nano-AIU' },
    ]);
    known.budget = { ...defaultBudget, maxTokens: 15 };
    expect(budgetBlockReason(known)).toMatch(/tokens mesurés/);
    known.budget = { ...defaultBudget, maxNanoAiu: 12 };
    expect(budgetBlockReason(known)).toMatch(/crédits mesuré/);
    known.budget = { ...defaultBudget, maxRuns: 1 };
    expect(budgetBlockReason(known)).toMatch(/runs atteint/);
  });
  it('treats partial token data as unknown and zero limits as a stop before the first call', () => {
    const feature = fixture([{ source: 'measured', inputTokens: 8 }]);
    expect(usageTotals(feature).unknownTokenRuns).toBe(1);
    const untouched = fixture([]);
    untouched.budget = { ...defaultBudget, maxTokens: 0 };
    expect(budgetBlockReason(untouched)).toMatch(/plafond/);
  });
  it('keeps known sums but blocks limits when a cumulative usage stream is incomplete', () => {
    const feature = fixture([
      {
        source: 'measured',
        inputTokens: 12,
        outputTokens: 8,
        cost: 25,
        unit: 'nano-AIU',
        incompleteTokens: true,
        incompleteCost: true,
      },
    ]);
    expect(usageTotals(feature)).toEqual({
      runs: 1,
      inputTokens: 12,
      outputTokens: 8,
      nanoAiu: 25,
      unknownTokenRuns: 1,
      unknownCostRuns: 1,
    });
    feature.budget = { ...defaultBudget, maxTokens: 100 };
    expect(budgetBlockReason(feature)).toMatch(/tokens inconnue/);
    feature.budget = { ...defaultBudget, maxNanoAiu: 100 };
    expect(budgetBlockReason(feature)).toMatch(/crédits inconnue/);
  });
});
