import type { Attempt, Feature, FeatureStep } from '../shared/types';
import { usageTotals } from './budgets';

export const unknownModel = 'Non communiqué';
export interface UsageFilters {
  /** Inclusive UTC calendar dates, matched against attempt.startedAt. */
  from?: string;
  to?: string;
  workflowId?: string;
  model?: string;
  includeArchived?: boolean;
}
export interface UsageMetric {
  /** Observed sum; null means there is no measurement, including no measured zero. */
  value: number | null;
  completeRuns: number;
  partialRuns: number;
  unknownRuns: number;
  zeroRuns: number;
}
export interface UsageSummary {
  runs: number;
  inputTokens: UsageMetric;
  outputTokens: UsageMetric;
  nanoAiu: UsageMetric;
  completeTokenRuns: number;
  humanApprovals: number;
  autopilotApprovals: number;
  unattributedApprovals: number;
  invalidatedApprovalRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  interruptedRuns: number;
  ongoingRuns: number;
  ignoredCostUnitRuns: number;
  invalidDateRuns: number;
}
export interface UsageEntry {
  feature: Feature;
  step: FeatureStep;
  attempt: Attempt;
  model: string;
}
export interface UsageGroup {
  id: string;
  label: string;
  summary: UsageSummary;
}
export interface UsageAnalytics {
  summary: UsageSummary;
  models: UsageGroup[];
  workflows: UsageGroup[];
  sessions: UsageGroup[];
  entries: UsageEntry[];
  validationEffort: {
    validatedSteps: number;
    attempts: number;
    outsideSelection: number;
    average: number | null;
  };
}
const measured = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const metric = (): UsageMetric => ({
  value: null,
  completeRuns: 0,
  partialRuns: 0,
  unknownRuns: 0,
  zeroRuns: 0,
});
export function effectiveModel(attempt: Attempt): string {
  return attempt.usage?.model?.trim() || attempt.model?.trim() || unknownModel;
}
export function usageEntries(features: Feature[]): UsageEntry[] {
  return features.flatMap((feature) =>
    feature.steps.flatMap((step) =>
      step.attempts.map((attempt) => ({ feature, step, attempt, model: effectiveModel(attempt) })),
    ),
  );
}
function coverMetric(target: UsageMetric, value: unknown, partial: boolean) {
  if (!measured(value)) {
    target.unknownRuns++;
    return;
  }
  if (partial) target.partialRuns++;
  else target.completeRuns++;
  if (value === 0) target.zeroRuns++;
}
function summarize(entries: UsageEntry[]): UsageSummary {
  const result: UsageSummary = {
    runs: entries.length,
    inputTokens: metric(),
    outputTokens: metric(),
    nanoAiu: metric(),
    completeTokenRuns: 0,
    humanApprovals: 0,
    autopilotApprovals: 0,
    unattributedApprovals: 0,
    invalidatedApprovalRuns: 0,
    failedRuns: 0,
    cancelledRuns: 0,
    interruptedRuns: 0,
    ongoingRuns: 0,
    ignoredCostUnitRuns: 0,
    invalidDateRuns: 0,
  };
  if (entries.length) {
    // Budget and dashboard share the same cumulative-snapshot rules. Event logs are never summed.
    const first = entries[0];
    const totals = usageTotals({
      ...first.feature,
      steps: [
        {
          ...first.step,
          attempts: entries.map(({ attempt }) => ({
            ...attempt,
            usage: attempt.usage?.source === 'measured' ? attempt.usage : undefined,
          })),
        },
      ],
    });
    result.completeTokenRuns = totals.runs - totals.unknownTokenRuns;
    // Only coverage determines whether a canonical total of zero represents a known zero.
    result.inputTokens.value = totals.inputTokens;
    result.outputTokens.value = totals.outputTokens;
    result.nanoAiu.value = totals.nanoAiu;
  }
  for (const { attempt, step } of entries) {
    const usage = attempt.usage?.source === 'measured' ? attempt.usage : undefined;
    coverMetric(result.inputTokens, usage?.inputTokens, Boolean(usage?.incompleteTokens));
    coverMetric(result.outputTokens, usage?.outputTokens, Boolean(usage?.incompleteTokens));
    coverMetric(
      result.nanoAiu,
      usage?.unit === 'nano-AIU' ? usage.cost : undefined,
      Boolean(usage?.incompleteCost),
    );
    if (usage?.unit && usage.unit !== 'nano-AIU' && measured(usage.cost))
      result.ignoredCostUnitRuns++;
    if (!Number.isFinite(Date.parse(attempt.startedAt))) result.invalidDateRuns++;
    if (
      attempt.status === 'approved' &&
      (step.status !== 'approved' || step.attempts.at(-1) !== attempt)
    )
      result.invalidatedApprovalRuns++;
    else if (attempt.status === 'approved') {
      if (attempt.approvedBy === 'human') result.humanApprovals++;
      else if (attempt.approvedBy === 'autopilot') result.autopilotApprovals++;
      else result.unattributedApprovals++;
    } else if (attempt.status === 'failed') result.failedRuns++;
    else if (attempt.status === 'cancelled') result.cancelledRuns++;
    else if (attempt.status === 'interrupted') result.interruptedRuns++;
    else if (['running', 'waiting_input'].includes(attempt.status)) result.ongoingRuns++;
  }
  for (const value of [result.inputTokens, result.outputTokens, result.nanoAiu]) {
    if (!value.completeRuns && !value.partialRuns) value.value = null;
  }
  return result;
}
function groups(entries: UsageEntry[], key: (entry: UsageEntry) => [string, string]): UsageGroup[] {
  const grouped = new Map<string, { label: string; entries: UsageEntry[] }>();
  for (const entry of entries) {
    const [id, label] = key(entry);
    const group = grouped.get(id) ?? { label, entries: [] };
    group.entries.push(entry);
    grouped.set(id, group);
  }
  return [...grouped]
    .map(([id, group]) => ({ id, label: group.label, summary: summarize(group.entries) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}
export function analyzeUsage(features: Feature[], filters: UsageFilters = {}): UsageAnalytics {
  const start = filters.from ? Date.parse(`${filters.from}T00:00:00Z`) : undefined;
  const end = filters.to ? Date.parse(`${filters.to}T00:00:00Z`) + 86400000 : undefined;
  const entries = usageEntries(features).filter(({ feature, attempt, model }) => {
    const at = Date.parse(attempt.startedAt);
    return (
      (!feature.archived || filters.includeArchived === true) &&
      (!filters.workflowId || filters.workflowId === feature.workflowId) &&
      (!filters.model || filters.model === model) &&
      (start === undefined || at >= start) &&
      (end === undefined || at < end)
    );
  });
  const selected = new Set(entries.map((entry) => entry.attempt));
  const validated = new Map<FeatureStep, UsageEntry>();
  for (const entry of entries) {
    if (
      entry.attempt.status === 'approved' &&
      entry.step.status === 'approved' &&
      entry.step.attempts.at(-1) === entry.attempt
    )
      validated.set(entry.step, entry);
  }
  let attempts = 0,
    outsideSelection = 0;
  for (const { step, attempt } of validated.values()) {
    const preceding = step.attempts.slice(0, step.attempts.indexOf(attempt) + 1);
    attempts += preceding.length;
    outsideSelection += preceding.filter((item) => !selected.has(item)).length;
  }
  return {
    summary: summarize(entries),
    entries,
    models: groups(entries, (entry) => [entry.model, entry.model]),
    workflows: groups(entries, (entry) => [entry.feature.workflowId, entry.feature.workflowName]),
    sessions: groups(entries, (entry) => [entry.feature.id, entry.feature.title]),
    validationEffort: {
      validatedSteps: validated.size,
      attempts,
      outsideSelection,
      average: validated.size ? attempts / validated.size : null,
    },
  };
}
