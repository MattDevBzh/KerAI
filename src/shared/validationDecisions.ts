import { approvalBlockers, featureCompletionBlockers } from '../core/validation';
import { proofDossier, type ProofEntry } from './proofs';
import type { Feature, FeatureStep, StudioState } from './types';
export interface ValidationDecision {
  id: string;
  feature: Feature;
  step?: FeatureStep;
  stepId: string;
  kind: 'final' | 'review' | 'question' | 'optional' | 'repair';
  label: string;
  action: string;
  blockers: string[];
  tests: ProofEntry[];
  files: string[];
  result: string;
  priority: number;
}
export function validationDecisions(state: Pick<StudioState, 'features'>): ValidationDecision[] {
  return state.features
    .filter((feature) => !feature.archived)
    .flatMap((feature) => {
      if (
        feature.status !== 'awaiting_final_validation' &&
        !feature.optionalRequest &&
        !feature.steps.some((step) =>
          ['awaiting_review', 'waiting_input', 'failed', 'stale', 'interrupted'].includes(
            step.status,
          ),
        )
      )
        return [];
      const dossier = proofDossier(feature);
      const tests = (attemptIds: Set<string | undefined>) =>
        dossier.sources.filter(
          (source) => source.kind === 'test' && attemptIds.has(source.attemptId),
        );
      const items: ValidationDecision[] = feature.steps
        .filter(
          (step) =>
            step.id === feature.optionalRequest?.stepId ||
            ['awaiting_review', 'waiting_input', 'failed', 'stale', 'interrupted'].includes(
              step.status,
            ),
        )
        .map((step) => {
          const attempt = step.attempts.at(-1);
          const kind =
            step.id === feature.optionalRequest?.stepId
              ? 'optional'
              : step.status === 'awaiting_review'
                ? 'review'
                : step.status === 'waiting_input'
                  ? 'question'
                  : 'repair';
          const blockers = kind === 'review' ? approvalBlockers(feature, step, 'human') : [];
          return {
            id: `${feature.id}:${step.id}`,
            feature,
            step,
            stepId: step.id,
            kind,
            label:
              kind === 'optional'
                ? 'Intervention facultative à choisir'
                : kind === 'review'
                  ? 'Livrable à valider'
                  : kind === 'question'
                    ? 'Réponse attendue'
                    : step.status === 'stale'
                      ? 'Contexte à actualiser'
                      : 'Tentative à reprendre',
            action:
              kind === 'question'
                ? 'Répondre aux questions'
                : kind === 'optional'
                  ? 'Choisir cette intervention'
                  : kind === 'repair'
                    ? 'Préparer la reprise'
                    : blockers.length
                      ? 'Examiner les blocages'
                      : 'Relire et décider',
            blockers,
            tests: tests(new Set([attempt?.id])),
            files: attempt?.changedFiles ?? [],
            result: attempt?.artifact?.content ?? attempt?.error ?? '',
            priority:
              kind === 'repair' || blockers.length
                ? 0
                : kind === 'question'
                  ? 1
                  : kind === 'optional'
                    ? 2
                    : 3,
          };
        });
      if (feature.status === 'awaiting_final_validation') {
        const blockers = featureCompletionBlockers(feature);
        items.push({
          id: `${feature.id}:final`,
          feature,
          stepId: feature.activeStepId || feature.steps.at(-1)?.id || '',
          kind: 'final',
          label: 'Dernière validation',
          action: 'Examiner le bilan final',
          blockers,
          tests: tests(new Set(feature.steps.map((step) => step.attempts.at(-1)?.id))),
          files: [
            ...new Set(feature.steps.flatMap((step) => step.attempts.at(-1)?.changedFiles ?? [])),
          ],
          result:
            [...feature.steps]
              .reverse()
              .find((step) => step.attempts.at(-1)?.artifact)
              ?.attempts.at(-1)?.artifact?.content ?? '',
          priority: blockers.length ? 0 : 4,
        });
      }
      return items;
    })
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Date.parse(a.feature.updatedAt) - Date.parse(b.feature.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}
