import type { Feature, FeatureStep } from './types';

/** A passed intervention satisfies ordering, never a test or approval requirement. */
export function stepResolved(step: FeatureStep | undefined): boolean {
  return Boolean(
    step &&
      (step.status === 'approved' ||
        (step.optional && step.status === 'skipped' && step.optionalDecision?.action === 'skip')),
  );
}

export function optionalChoiceAvailable(feature: Feature, step: FeatureStep): boolean {
  return Boolean(
    step.optional &&
      !feature.archived &&
      !step.awaitsCorrection &&
      !step.attempts.at(-1)?.pair?.busy &&
      [
        'pending',
        'stale',
        'cancelled',
        'interrupted',
        'failed',
        'waiting_input',
        'awaiting_review',
      ].includes(step.status) &&
      !feature.steps.some((item) => item.status === 'running') &&
      step.dependsOn.every((id) => stepResolved(feature.steps.find((item) => item.id === id))),
  );
}

export function skippedStepLabel(step: FeatureStep): string {
  return step.attempts.length
    ? 'Passée après tentative — non validée'
    : 'Passée par l’humain — non exécutée';
}

export function skippedSteps(feature: Feature): FeatureStep[] {
  return feature.steps.filter((step) => step.status === 'skipped');
}

export function progressLabel(feature: Feature): string {
  const approved = feature.steps.filter((step) => step.status === 'approved').length;
  const skipped = skippedSteps(feature).length;
  return skipped
    ? `${approved} validée${approved > 1 ? 's' : ''} · ${skipped} passée${skipped > 1 ? 's' : ''} / ${feature.steps.length} intervention${feature.steps.length > 1 ? 's' : ''}`
    : `${approved} / ${feature.steps.length} étapes validées`;
}
