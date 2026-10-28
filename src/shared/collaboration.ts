import { unacceptedBlockingComments } from './reviewApproval';
import { stepResolved } from './optionalSteps';
import type { Artifact, Feature, ReviewComment, ReviewReport } from './types';

export interface EditorialVersion {
  revision: number;
  content: string;
  at: string;
  author: 'agent' | 'human';
  reason?: string;
}
export interface EditorialSaveOptions {
  expectedAttemptId: string;
  expectedRevision: number;
  expectedStateKey: string;
  description?: string;
  reason?: string;
}
export interface CorrectionRequest {
  expectedStateKey: string;
  sourceStepId: string;
  rootStepIds: string[];
  feedback: string;
  findingIds: string[];
  commentIds: string[];
  initialContext?: string;
  artifactContext?: Record<string, { enabled?: boolean; content?: string }>;
}
export interface CorrectionSnapshot {
  description: string;
  descriptionRevision: number;
  sourceStepId: string;
  sourceAttemptId: string;
  sourceRevision: number;
  review?: ReviewReport;
  comments: ReviewComment[];
  artifacts: {
    stepId: string;
    stepName: string;
    attemptId: string;
    revision: number;
    status: string;
    artifact: Artifact;
  }[];
}
export interface CorrectionCycle extends CorrectionRequest {
  id: string;
  createdAt: string;
  status: 'requested' | 'running' | 'interrupted' | 'awaiting_review' | 'completed';
  impactedStepIds: string[];
  snapshot: CorrectionSnapshot;
}
export interface CorrectionPreview {
  rootStepIds: string[];
  impactedStepIds: string[];
  preservedStepIds: string[];
  routeStepIds: string[];
  errors: string[];
  context: string;
}
export type CollaborationClientMessage =
  | ({ type: 'requestCorrection'; featureId: string } & CorrectionRequest)
  | { type: 'finalizeFeature'; featureId: string; expectedStateKey: string };

/** Browser-safe optimistic concurrency token. It is compared for equality, never trusted as proof. */
export function featureStateKey(feature: Feature): string {
  return JSON.stringify({
    id: feature.id,
    description: feature.description,
    descriptionRevision: feature.descriptionRevision ?? 0,
    archived: Boolean(feature.archived),
    finalized: feature.finalValidation?.id,
    steps: feature.steps.map((step) => ({
      id: step.id,
      status: step.status,
      agentId: step.agentId,
      model: step.model,
      reasoning: step.reasoning,
      skills: step.skills,
      dependsOn: step.dependsOn,
      maxAttempts: step.maxAttempts,
      initialContext: step.initialContext,
      mcpServerIds: step.mcpServerIds,
      askBeforeRun: step.askBeforeRun,
      optional: step.optional,
      optionalDecision: step.optionalDecision,
      awaitsCorrection: step.awaitsCorrection,
      subplan: step.subplan,
      iterations: step.subplanState?.iterations.map((i) => ({
        id: i.id,
        cancelled: i.cancelled,
        requiresRecheck: i.requiresRecheck,
        state: featureStateKey(i.feature),
      })),
      attempts: step.attempts.map((attempt) => ({
        id: attempt.id,
        revision: attempt.revision ?? 0,
        status: attempt.status,
      })),
    })),
    criteria: feature.criteria ?? [],
    comments: feature.reviewComments ?? [],
    correction: feature.activeCorrectionId,
    pendingTeam: feature.pendingTeam,
    budget: feature.budget,
    pilot: feature.autopilot && {
      checkpoints: feature.autopilot.checkpoints,
      maxRuns: feature.autopilot.maxRuns,
      maxCorrectionCycles: feature.autopilot.maxCorrectionCycles,
      reviewStepId: feature.autopilot.reviewStepId,
      correctionStepId: feature.autopilot.correctionStepId,
      correctionLoop: feature.autopilot.correctionLoop,
      correctionContractId: feature.autopilot.correctionLoopState?.contract.id,
      stepInputs: feature.autopilot.stepInputs,
    },
  });
}
export function correctionClosure(feature: Feature, roots: string[]): string[] {
  const impacted = new Set(roots);
  for (let changed = true; changed; ) {
    changed = false;
    for (const step of feature.steps)
      if (!impacted.has(step.id) && step.dependsOn.some((id) => impacted.has(id))) {
        impacted.add(step.id);
        changed = true;
      }
  }
  return feature.steps.filter((step) => impacted.has(step.id)).map((step) => step.id);
}
export function correctionContext(
  cycle: Pick<
    CorrectionCycle,
    'feedback' | 'findingIds' | 'commentIds' | 'initialContext' | 'artifactContext' | 'snapshot'
  >,
): string {
  const snapshot = cycle.snapshot;
  return [
    `Correction demandée depuis ${snapshot.sourceStepId}, tentative ${snapshot.sourceAttemptId}, révision ${snapshot.sourceRevision}.`,
    `Besoin actuel (révision ${snapshot.descriptionRevision}) :\n${snapshot.description}`,
    `Retour humain :\n${cycle.feedback}`,
    cycle.initialContext ? `Contexte complémentaire humain :\n${cycle.initialContext}` : '',
    snapshot.review
      ? `Relecture structurée (${snapshot.review.verdict}) :\n${snapshot.review.summary}\n${snapshot.review.findings
          .filter((finding) => cycle.findingIds.includes(finding.id))
          .map(
            (finding) =>
              `[${finding.id} · ${finding.severity}] ${finding.message}${finding.file ? ` (${finding.file}${finding.line ? ':' + finding.line : ''})` : ''}`,
          )
          .join('\n')}`
      : '',
    snapshot.comments
      .filter((comment) => cycle.commentIds.includes(comment.id))
      .map(
        (comment) =>
          `Remarque humaine ${comment.id} (tentative ${comment.attemptId}) : ${comment.text}`,
      )
      .join('\n'),
    ...snapshot.artifacts
      .filter((source) => cycle.artifactContext?.[source.stepId]?.enabled !== false)
      .map(
        (source) =>
          `Rapport historique avant correction · ${source.stepName} (${source.stepId}, tentative ${source.attemptId}, révision ${source.revision}, état avant correction ${source.status})${cycle.artifactContext?.[source.stepId]?.content !== undefined ? ' · extrait ajusté par l’humain' : ''} :\n${cycle.artifactContext?.[source.stepId]?.content ?? source.artifact.content}`,
      ),
    'Ces versions et constats décrivent l’état avant correction. Ils ne valent pas validation des étapes invalidées ni preuve de tests actuels. Les remarques restent ouvertes jusqu’à une décision humaine explicite.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function correctionSnapshot(
  feature: Feature,
  sourceStepId: string,
): CorrectionSnapshot | undefined {
  const source = feature.steps.find((step) => step.id === sourceStepId)?.attempts.at(-1);
  if (!source) return undefined;
  return {
    description: feature.description,
    descriptionRevision: feature.descriptionRevision ?? 0,
    sourceStepId,
    sourceAttemptId: source.id,
    sourceRevision: source.revision ?? 0,
    review: source.review ? structuredClone(source.review) : undefined,
    comments: structuredClone(feature.reviewComments ?? []),
    artifacts: feature.steps.flatMap((step) => {
      const attempt = step.attempts.at(-1);
      return attempt?.artifact
        ? [
            {
              stepId: step.id,
              stepName: step.name,
              attemptId: attempt.id,
              revision: attempt.revision ?? 0,
              status: step.status,
              artifact: structuredClone(attempt.artifact),
            },
          ]
        : [];
    }),
  };
}
export function previewCorrection(feature: Feature, request: CorrectionRequest): CorrectionPreview {
  const roots = [...new Set(request.rootStepIds)];
  const impactedStepIds = correctionClosure(feature, roots);
  const errors: string[] = [];
  const source = feature.steps.find((step) => step.id === request.sourceStepId);
  if (
    !source?.attempts.at(-1)?.artifact ||
    !['awaiting_review', 'approved', 'stale'].includes(source.status)
  )
    errors.push('La correction doit partir d’un compte rendu disponible pour relecture.');
  if (!roots.length || roots.some((id) => !feature.steps.some((step) => step.id === id)))
    errors.push('Sélectionne au moins une étape existante à corriger.');
  for (const root of feature.steps.filter((step) => roots.includes(step.id))) {
    const missing = root.dependsOn.filter(
      (id) =>
        !impactedStepIds.includes(id) &&
        !stepResolved(feature.steps.find((step) => step.id === id)),
    );
    if (missing.length)
      errors.push(
        `Ajoute les préalables invalidés de ${root.name} à la route : ${missing.join(', ')}.`,
      );
  }
  if (!impactedStepIds.includes(request.sourceStepId))
    errors.push('La route doit repasser par la relecture d’origine.');
  if (!request.feedback.trim()) errors.push('Précise le retour humain pour cette correction.');
  if (feature.archived || feature.steps.some((step) => step.status === 'running'))
    errors.push('Arrête la tentative et utilise une session ouverte avant de corriger.');
  if (request.expectedStateKey !== featureStateKey(feature))
    errors.push('La session a changé. Actualise la route avant de la lancer.');
  const snapshot = correctionSnapshot(feature, request.sourceStepId);
  if (
    request.findingIds.some(
      (id) => !snapshot?.review?.findings.some((finding) => finding.id === id),
    )
  )
    errors.push('Un constat sélectionné n’appartient plus à cette relecture.');
  if (
    request.commentIds.some(
      (id) => !snapshot?.comments.some((comment) => comment.id === id && !comment.resolved),
    )
  )
    errors.push('Une remarque sélectionnée n’est plus ouverte.');
  if (
    Object.keys(request.artifactContext ?? {}).some(
      (id) => !snapshot?.artifacts.some((source) => source.stepId === id),
    )
  )
    errors.push('Un rapport de contexte sélectionné est inconnu.');
  const routeStepIds: string[] = [];
  const remaining = new Set(impactedStepIds);
  while (remaining.size) {
    const next = feature.steps.find(
      (step) => remaining.has(step.id) && step.dependsOn.every((id) => !remaining.has(id)),
    );
    if (!next) {
      errors.push('Dépendances invalides dans la route de correction.');
      break;
    }
    routeStepIds.push(next.id);
    remaining.delete(next.id);
  }
  return {
    rootStepIds: roots,
    impactedStepIds,
    preservedStepIds: feature.steps
      .filter((step) => !impactedStepIds.includes(step.id))
      .map((step) => step.id),
    routeStepIds,
    errors,
    context: snapshot ? correctionContext({ ...request, snapshot }) : '',
  };
}
export function finalValidationReady(feature: Feature): boolean {
  return (
    !feature.archived &&
    !feature.pendingTeam &&
    !feature.steps.some((s) => s.awaitsCorrection) &&
    feature.steps.length > 0 &&
    feature.steps.every(stepResolved) &&
    !(feature.criteria ?? []).some(
      (criterion) => criterion.status !== 'passed' || !criterion.evidence.trim(),
    ) &&
    !unacceptedBlockingComments(feature).length
  );
}
