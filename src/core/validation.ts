import type { QualityKind } from '../shared/quality';
import type { Attempt, Feature, FeatureStep, TestEvidence } from '../shared/types';
import { needsDevOpsEvidence } from '../shared/devopsKit';

export function currentTestEvidence(attempt: Attempt): TestEvidence[] {
  return [...new Map((attempt.evidence ?? []).map((proof) => [proof.commandId, proof])).values()];
}
export function evidenceIsCurrent(attempt: Attempt, proof: TestEvidence): boolean {
  return Object.entries(attempt.fileHashes ?? {}).every(
    ([path, hash]) => proof.fileHashes[path] === hash,
  );
}
/** Standard quality agents retain their contract even in a customized step. */
export function requiredQualityKinds(step: FeatureStep): QualityKind[] {
  const agentKind =
    step.agentId === 'fs-visual-tests'
      ? 'visual'
      : step.agentId === 'fs-counterexamples'
        ? 'counterexample'
        : undefined;
  return [
    ...new Set(
      [step.requiredQuality, agentKind].filter((kind): kind is QualityKind => kind !== undefined),
    ),
  ];
}
function qualityIsCurrent(
  feature: Feature,
  attempt: Attempt,
  proof: TestEvidence,
  kind: QualityKind,
): boolean {
  const quality = proof.quality;
  const criteria = new Set((feature.criteria ?? []).map((criterion) => criterion.id));
  return (
    proof.source === 'host' &&
    proof.exitCode === 0 &&
    !proof.error &&
    Boolean(proof.finishedAt) &&
    evidenceIsCurrent(attempt, proof) &&
    quality?.status === 'passed' &&
    quality.kind === kind &&
    quality.featureId === feature.id &&
    quality.attemptId === attempt.id &&
    quality.evidenceId === proof.id &&
    quality.commandId === proof.commandId &&
    Boolean(quality.reportSha256) &&
    quality.cases.length > 0 &&
    quality.cases.every(
      (testCase) =>
        testCase.status === 'passed' &&
        !testCase.errors.length &&
        testCase.steps.length > 0 &&
        testCase.criterionIds.length > 0 &&
        testCase.criterionIds.every((id) => criteria.has(id)),
    )
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
    (['feature', 'quality-feature', 'devops'].includes(feature.workflowId) &&
      step.id === 'review') ||
    ['fs-devops-review', 'fs-devops-validate'].includes(step.agentId) ||
    needsDevOpsEvidence(step) ||
    feature.workflowId === 'code-review';
  if (
    (actor === 'autopilot' || needsDevOpsEvidence(step) || step.agentId === 'fs-devops-review') &&
    requiresReview &&
    !attempt.review
  )
    blockers.push('La relecture structurée attendue est absente.');
  if (
    feature.reviewComments?.some(
      (comment) => comment.blocking && !comment.resolved && comment.stepId === step.id,
    )
  )
    blockers.push('Des commentaires bloquants restent ouverts pour cette étape.');
  const evidence = currentTestEvidence(attempt);
  if (needsDevOpsEvidence(step)) {
    const target = attempt.launch?.devopsTest;
    if (
      !target?.isolationConfirmed ||
      !evidence.some(
        (proof) =>
          proof.source === 'host' &&
          proof.devops?.status === 'passed' &&
          proof.devops.featureId === feature.id &&
          proof.devops.attemptId === attempt.id &&
          JSON.stringify(proof.devops.target) === JSON.stringify(target) &&
          proof.exitCode === 0 &&
          !proof.error &&
          !proof.truncated &&
          proof.devops.checks.length > 0 &&
          proof.devops.checks.every((item) => item.passed) &&
          evidenceIsCurrent(attempt, proof),
      )
    )
      blockers.push(
        'Une vérification hôte réussie du test Azure DevOps déclaré par l’humain est requise.',
      );
  }
  for (const kind of requiredQualityKinds(step)) {
    if (!evidence.some((proof) => qualityIsCurrent(feature, attempt, proof, kind)))
      blockers.push(
        `Rapport qualité ${kind === 'visual' ? 'visuel' : 'contre-exemples'} réussi, courant et lié à cette tentative requis. Une commande ordinaire ne suffit pas.`,
      );
  }
  if (
    evidence.some(
      (proof) =>
        proof.error || proof.exitCode !== 0 || (proof.quality && proof.quality.status !== 'passed'),
    )
  )
    blockers.push('Une preuve de tests hôte est en échec ou incomplète.');
  if (evidence.some((proof) => !evidenceIsCurrent(attempt, proof)))
    blockers.push('Une preuve de tests est obsolète après modification des fichiers.');
  if (
    actor === 'autopilot' &&
    step.policy === 'tests' &&
    !evidence.some(
      (proof) =>
        proof.source === 'host' &&
        proof.exitCode === 0 &&
        !proof.error &&
        (!proof.quality || proof.quality.status === 'passed'),
    )
  )
    blockers.push('Aucune preuve de tests réellement exécutés par le host.');
  const final = feature.steps.every((other) => other.id === step.id || other.status === 'approved');
  if (final) {
    blockers.push(...featureCompletionBlockers(feature));
  }
  return blockers;
}
