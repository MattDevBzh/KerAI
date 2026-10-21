import type { Feature, FeatureStep } from '../shared/types';

/** Changes to the mission, configuration or approved sources require a new context preview. */
export function pairSourceKey(feature: Feature, step: FeatureStep): string {
  const {
    attempts: _attempts,
    subplanState: _subplanState,
    awaitsCorrection: _awaitsCorrection,
    status: _status,
    optionalDecision: _decision,
    optionalDecisionHistory: _history,
    ...configuration
  } = step;
  const scope = {
    description: feature.description,
    revision: feature.descriptionRevision ?? 0,
    correction: feature.activeCorrectionId,
    branch: feature.branch,
    projects: feature.projects,
    worktree: feature.worktree?.path,
    configuration: step.subplan
      ? { ...configuration, subplan: { mode: step.subplan.mode } }
      : configuration,
    sources: feature.steps
      .filter((s) => s.id !== step.id && (s.status === 'approved' || step.dependsOn.includes(s.id)))
      .map((s) => [s.id, s.status, s.attempts.at(-1)?.id, s.attempts.at(-1)?.revision]),
  };
  return JSON.stringify(scope, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}
