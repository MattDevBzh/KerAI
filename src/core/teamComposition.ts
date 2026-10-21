import type { Feature, WorkflowStep } from '../shared/types';
import { teamSteps } from '../shared/team';

/** Keep executed objects and their evidence. Only not-yet-started members are replaceable. */
export function reconcileTeam(feature: Feature, steps: WorkflowStep[]): void {
  for (const old of feature.steps) {
    const next = steps.find((s) => s.id === old.id);
    if (old.attempts.length || old.optionalDecision || old.subplanState?.iterations.length) {
      if (!next)
        throw new Error(
          `« ${old.name} » a déjà été utilisée. Son historique doit rester dans l’équipe.`,
        );
      if (Boolean(next.subplan) !== Boolean(old.subplan) || next.agentId !== old.agentId)
        throw new Error(
          `Conserve l’intervenant de « ${old.name} » et ajoute une nouvelle carte pour le remplacer.`,
        );
    }
  }
  const oldById = new Map(feature.steps.map((s) => [s.id, s]));
  const lastUsed = Math.max(
    -1,
    ...steps.map((s, index) =>
      oldById.get(s.id)?.attempts.length || oldById.get(s.id)?.optionalDecision ? index : -1,
    ),
  );
  (feature.teamHistory ??= []).push({
    revision: feature.teamRevision ?? 0,
    at: new Date().toISOString(),
    steps: teamSteps(feature),
  });
  feature.steps = steps.map((config, index) => {
    const old = oldById.get(config.id);
    if (old) return Object.assign(old, structuredClone(config));
    return {
      ...structuredClone(config),
      status: 'pending',
      attempts: [],
      ...(index < lastUsed ? { awaitsCorrection: true } : {}),
    };
  });
  feature.teamRevision = (feature.teamRevision ?? 0) + 1;
  feature.workflowId = 'custom';
  feature.workflowName = 'Équipe personnalisée';
  feature.updatedAt = new Date().toISOString();
  delete feature.pendingTeam;
  delete feature.optionalRequest;
  delete feature.finalValidation;
  if (feature.autopilot) {
    const ids = new Set(steps.map((s) => s.id));
    feature.autopilot.checkpoints = feature.parent
      ? [...ids]
      : feature.autopilot.checkpoints.filter((id) => ids.has(id));
    feature.autopilot.stepInputs = Object.fromEntries(
      Object.entries(feature.autopilot.stepInputs).filter(([id]) => ids.has(id)),
    );
    if (
      !ids.has(feature.autopilot.reviewStepId ?? '') ||
      !ids.has(feature.autopilot.correctionStepId ?? '')
    ) {
      delete feature.autopilot.reviewStepId;
      delete feature.autopilot.correctionStepId;
    }
  }
  if (!steps.length) {
    feature.activeStepId = '';
    delete feature.teamLockedAt;
    delete feature.autopilot;
  }
}
