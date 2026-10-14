import type { Feature, FeatureBudget, UsageTotals } from '../shared/types';

export const defaultBudget: FeatureBudget = {
  maxRuns: 10,
  maxPromptChars: 60000,
  modelProfile: 'current',
};
const measured = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function usageTotals(feature: Feature): UsageTotals {
  const totals: UsageTotals = {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    nanoAiu: 0,
    unknownTokenRuns: 0,
    unknownCostRuns: 0,
  };
  for (const step of feature.steps)
    for (const attempt of step.attempts) {
      totals.runs++;
      if (measured(attempt.usage?.inputTokens)) totals.inputTokens += attempt.usage.inputTokens;
      if (measured(attempt.usage?.outputTokens)) totals.outputTokens += attempt.usage.outputTokens;
      if (
        attempt.usage?.incompleteTokens ||
        !measured(attempt.usage?.inputTokens) ||
        !measured(attempt.usage?.outputTokens)
      )
        totals.unknownTokenRuns++;
      if (attempt.usage?.unit === 'nano-AIU' && measured(attempt.usage.cost))
        totals.nanoAiu += attempt.usage.cost;
      if (
        attempt.usage?.incompleteCost ||
        attempt.usage?.unit !== 'nano-AIU' ||
        !measured(attempt.usage?.cost)
      )
        totals.unknownCostRuns++;
    }
  return totals;
}
/** Guard for a new call, never a conversion to a monetary cost guarantee. */
export function budgetBlockReason(feature: Feature): string | undefined {
  const budget = feature.budget ?? defaultBudget,
    totals = usageTotals(feature);
  if (totals.runs >= budget.maxRuns) return 'Budget : nombre maximal de runs atteint.';
  if (budget.maxTokens !== undefined) {
    if (totals.unknownTokenRuns)
      return 'Budget : consommation de tokens inconnue pour une tentative. Reprise humaine requise.';
    if (totals.inputTokens + totals.outputTokens >= budget.maxTokens)
      return 'Budget : plafond de tokens mesurés atteint.';
  }
  if (budget.maxNanoAiu !== undefined) {
    if (totals.unknownCostRuns)
      return 'Budget : consommation en crédits inconnue pour une tentative. Reprise humaine requise.';
    if (totals.nanoAiu >= budget.maxNanoAiu) return 'Budget : plafond de crédits mesuré atteint.';
  }
  return undefined;
}
