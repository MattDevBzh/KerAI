import type { StudioState } from './types';
import { allFeatures } from './subplans';
export function attentionCount(state: StudioState) {
  return new Set([
    ...state.features
      .filter((f) => !f.archived && f.optionalRequest)
      .map((f) => `${f.id}:${f.optionalRequest!.stepId}`),
    ...state.features
      .filter((f) => !f.archived && f.status === 'awaiting_final_validation')
      .map((f) => `${f.id}:final`),
    ...(state.humanRequests ?? []).map((r) => `${r.featureId}:${r.stepId}`),
    ...state.features
      .filter((f) => !f.archived)
      .flatMap((f) =>
        f.steps
          .filter((s) =>
            ['waiting_input', 'awaiting_review', 'failed', 'stale', 'interrupted'].includes(
              s.status,
            ),
          )
          .map((s) => `${f.id}:${s.id}`),
      ),
  ]).size;
}

export const hasActiveRun = (state: StudioState) =>
  allFeatures(state.features).some((feature) =>
    feature.steps.some((step) => step.status === 'running'),
  );
