import type { Attempt, Feature, FeatureStep, TestEvidence } from '../shared/types';

export function currentTestEvidence(attempt: Attempt): TestEvidence[] {
  return [...new Map((attempt.evidence ?? []).map((proof) => [proof.commandId, proof])).values()];
}
export function evidenceIsCurrent(attempt: Attempt, proof: TestEvidence): boolean {
  return Object.entries(attempt.fileHashes ?? {}).every(
    ([path, hash]) => proof.fileHashes[path] === hash,
  );
}
export function featureCompletionBlockers(feature: Feature): string[] {
  const blockers: string[] = [];
  if (
    feature.criteria?.some(
      (criterion) => criterion.status !== 'passed' || !criterion.evidence.trim(),
    )
  )
    blockers.push('Des critères d’acceptation restent sans validation ou preuve.');
  if (feature.reviewComments?.some((comment) => comment.blocking && !comment.resolved))
    blockers.push('Des commentaires bloquants restent ouverts dans la feature.');
  return blockers;
}

export function approvalBlockers(
  feature: Feature,
  step: FeatureStep,
  actor: 'human' | 'autopilot',
): string[] {
  const blockers: string[] = [],
    attempt = step.attempts.at(-1);
  if (!attempt) return ['Aucune tentative à valider.'];
  if (step.status !== 'awaiting_review') blockers.push('Cette étape attend un résultat à relire.');
  if (!attempt.artifact?.content.trim()) blockers.push('Un livrable non vide est nécessaire.');
  if (attempt.questions.some((q) => !attempt.answers[q.id]?.trim()))
    blockers.push('Des questions restent ouvertes.');
  if (
    !step.dependsOn.every((dep) => feature.steps.find((s) => s.id === dep)?.status === 'approved')
  )
    blockers.push('Une dépendance a été invalidée.');
  if (
    attempt.review?.verdict === 'changes_requested' ||
    attempt.review?.findings.some((f) => f.severity === 'blocking')
  )
    blockers.push('La relecture demande des corrections.');
  const requiresReview =
    feature.autopilot?.reviewStepId === step.id ||
    (feature.workflowId === 'feature' && step.id === 'review') ||
    feature.workflowId === 'code-review';
  if (actor === 'autopilot' && requiresReview && !attempt.review)
    blockers.push('La relecture structurée attendue est absente.');
  if (
    feature.reviewComments?.some(
      (comment) => comment.blocking && !comment.resolved && comment.stepId === step.id,
    )
  )
    blockers.push('Des commentaires bloquants restent ouverts pour cette étape.');
  const evidence = currentTestEvidence(attempt);
  if (evidence.some((proof) => proof.error || proof.exitCode !== 0))
    blockers.push('Une preuve de tests hôte est en échec ou incomplète.');
  if (evidence.some((proof) => !evidenceIsCurrent(attempt, proof)))
    blockers.push('Une preuve de tests est obsolète après modification des fichiers.');
  if (
    actor === 'autopilot' &&
    step.policy === 'tests' &&
    !evidence.some((proof) => proof.source === 'host' && proof.exitCode === 0 && !proof.error)
  )
    blockers.push('Aucune preuve de tests réellement exécutés par le host.');
  const final = feature.steps.every((other) => other.id === step.id || other.status === 'approved');
  if (final) {
    blockers.push(...featureCompletionBlockers(feature));
  }
  return blockers;
}
