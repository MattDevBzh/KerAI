import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Attempt, Feature, FeatureStep, RunEvent, RunResult, Workflow } from '../shared/types';
import { qualityKindSchema } from './qualitySchemas';
import { launchSchema, reviewSchema } from './evolutionSchemas';
import { approvalBlockers, featureCompletionBlockers } from './validation';
import { defaultBudget } from './budgets';
import { boundAnswers, sameQuestion } from './questions';
import {
  featureStateKey,
  finalValidationReady,
  previewCorrection,
  correctionSnapshot,
} from '../shared/collaboration';
import type {
  CorrectionRequest,
  EditorialSaveOptions,
  CorrectionCycle,
} from '../shared/collaboration';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const workflowSchema = z
  .object({
    id,
    name: z.string().trim().min(1),
    description: z.string(),
    icon: z.string(),
    source: z.string().optional(),
    steps: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1),
            description: z.string(),
            agentId: id,
            policy: z.enum(['read-only', 'workspace-write', 'tests']),
            requiredQuality: qualityKindSchema.optional(),
            requiredDevOpsEvidence: z.boolean().optional(),
            model: z.string().optional(),
            reasoning: z.string().optional(),
            skills: z.array(id),
            maxAttempts: z.number().int().min(1).max(100),
            artifact: z.string().regex(/^[^/\\]+\.md$/),
            dependsOn: z.array(id),
            initialContext: z.string().max(60000).optional(),
            mcpServerIds: z.array(id).max(256).optional(),
            askBeforeRun: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((workflow, context) => {
    const seen = new Set<string>();
    for (const step of workflow.steps) {
      if (seen.has(step.id))
        context.addIssue({ code: 'custom', message: `Étape dupliquée : ${step.id}` });
      seen.add(step.id);
    }
    const visiting = new Set<string>(),
      done = new Set<string>();
    function visit(stepId: string) {
      if (visiting.has(stepId)) {
        context.addIssue({ code: 'custom', message: `Cycle de dépendances : ${stepId}` });
        return;
      }
      if (done.has(stepId)) return;
      const step = workflow.steps.find((s) => s.id === stepId);
      if (!step) {
        context.addIssue({ code: 'custom', message: `Dépendance inconnue : ${stepId}` });
        return;
      }
      visiting.add(stepId);
      for (const dep of step.dependsOn) visit(dep);
      visiting.delete(stepId);
      done.add(stepId);
    }
    for (const step of workflow.steps) visit(step.id);
  });
export function validateWorkflow(input: unknown): Workflow {
  return workflowSchema.parse(input);
}

export class WorkflowEngine {
  constructor(public readonly features: Feature[] = []) {}

  createFeature(
    workflow: Workflow | undefined,
    input: {
      title: string;
      description: string;
      branch?: string;
      agentId?: string;
      model?: string;
    },
  ): Feature {
    const validated = workflow ? validateWorkflow(workflow) : undefined;
    if (!input.title.trim()) throw new Error('Le titre est obligatoire.');
    const now = new Date().toISOString();
    const feature: Feature = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description,
      descriptionRevision: 0,
      descriptionVersions: [{ revision: 0, content: input.description, at: now, author: 'human' }],
      corrections: [],
      workflowId: validated?.id ?? 'custom',
      workflowName: validated?.name ?? 'Équipe personnalisée',
      teamRevision: 0,
      createdAt: now,
      updatedAt: now,
      branch: input.branch ?? '',
      status: 'draft',
      budget: structuredClone(defaultBudget),
      criteria: [],
      reviewComments: [],
      activeStepId: validated?.steps.find((s) => !s.dependsOn.length)?.id ?? '',
      steps: (validated?.steps ?? []).map((step) => ({
        ...structuredClone(step),
        agentId: input.agentId ?? step.agentId,
        model: input.model ?? step.model,
        status: 'pending',
        attempts: [],
      })),
    };
    this.features.push(feature);
    return feature;
  }

  getFeature(featureId: string): Feature {
    const feature = this.features.find((f) => f.id === featureId);
    if (!feature) throw new Error('Session inconnue.');
    return feature;
  }
  getStep(featureId: string, stepId: string): FeatureStep {
    return this.pair(featureId, stepId)[1];
  }
  private pair(featureId: string, stepId: string): [Feature, FeatureStep] {
    const feature = this.getFeature(featureId),
      step = feature.steps.find((s) => s.id === stepId);
    if (!step) throw new Error('Étape inconnue.');
    return [feature, step];
  }
  private latest(step: FeatureStep): Attempt {
    const attempt = step.attempts.at(-1);
    if (!attempt) throw new Error('Aucune tentative.');
    return attempt;
  }
  private touch(feature: Feature) {
    if (feature.finalValidation && feature.finalValidation.stateKey !== featureStateKey(feature))
      delete feature.finalValidation;
    feature.updatedAt = new Date().toISOString();
    feature.status = !feature.steps.length
      ? 'draft'
      : feature.steps.every((s) => s.status === 'approved')
        ? featureCompletionBlockers(feature).length
          ? 'attention'
          : feature.finalValidation
            ? 'completed'
            : 'awaiting_final_validation'
        : feature.steps.some((s) => s.status === 'running')
          ? 'running'
          : feature.steps.some((s) => !['pending'].includes(s.status))
            ? 'attention'
            : 'draft';
    const correction = feature.corrections?.find((item) => item.id === feature.activeCorrectionId);
    if (correction) {
      if (
        correction.impactedStepIds.every(
          (id) => feature.steps.find((step) => step.id === id)?.status === 'approved',
        )
      ) {
        correction.status = 'completed';
        delete feature.activeCorrectionId;
      } else if (
        feature.steps.find((step) => step.id === correction.sourceStepId)?.status ===
        'awaiting_review'
      )
        correction.status = 'awaiting_review';
    }
    const next = feature.steps.find(
      (s) =>
        s.status !== 'approved' &&
        s.dependsOn.every((dep) => feature.steps.find((d) => d.id === dep)?.status === 'approved'),
    );
    if (next) feature.activeStepId = next.id;
  }
  refreshFeatureStatus(featureId: string): void {
    this.touch(this.getFeature(featureId));
  }
  invalidateAfterRestore(featureId: string): void {
    const feature = this.getFeature(featureId);
    delete feature.finalValidation;
    if (feature.steps.some((step) => step.status === 'running'))
      throw new Error('Arrête la tentative avant de restaurer les fichiers.');
    for (const step of feature.steps) {
      if (!step.attempts.length) continue;
      step.status = 'stale';
      const attempt = step.attempts.at(-1)!;
      attempt.revision = (attempt.revision ?? 0) + 1;
    }
    for (const criterion of feature.criteria ?? []) {
      criterion.status = 'pending';
      criterion.evidence = '';
    }
    if (feature.autopilot) {
      feature.autopilot.status = 'paused';
      feature.autopilot.reason = 'Fichiers restaurés : revalide les étapes avant de reprendre.';
      feature.autopilot.updatedAt = new Date().toISOString();
    }
    this.touch(feature);
  }
  private invalidate(feature: Feature, stepId: string) {
    delete feature.finalValidation;
    // Acceptance proofs apply to the feature state as a whole, not an old run.
    for (const criterion of feature.criteria ?? []) {
      criterion.status = 'pending';
      criterion.evidence = '';
    }
    const invalid = new Set([stepId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of feature.steps)
        if (!invalid.has(step.id) && step.dependsOn.some((dep) => invalid.has(dep))) {
          invalid.add(step.id);
          changed = true;
        }
    }
    for (const step of feature.steps)
      if (step.id !== stepId && invalid.has(step.id) && step.status !== 'pending')
        step.status = 'stale';
  }
  beginRun(featureId: string, stepId: string, feedback = '', resume = false): Attempt {
    const [feature, step] = this.pair(featureId, stepId);
    if (feature.archived) throw new Error('La session est archivée.');
    if (feature.steps.some((s) => s.status === 'running'))
      throw new Error('Une tentative est déjà en cours.');
    if (
      !step.dependsOn.every((dep) => feature.steps.find((s) => s.id === dep)?.status === 'approved')
    )
      throw new Error('Les étapes préalables doivent être validées.');
    if (step.attempts.length >= step.maxAttempts)
      throw new Error('Nombre maximal de tentatives atteint.');
    const previous = step.attempts.at(-1);
    if (resume && (previous?.descriptionRevision ?? 0) !== (feature.descriptionRevision ?? 0))
      throw new Error('Le besoin initial a changé : lance une nouvelle session Copilot.');
    if (
      resume &&
      (!previous?.sessionId ||
        !['waiting_input', 'interrupted', 'failed', 'cancelled', 'awaiting_review'].includes(
          step.status,
        ))
    )
      throw new Error('Cette tentative ne peut pas être reprise.');
    if (resume && previous!.questions.some((q) => !previous!.answers[q.id]?.trim()))
      throw new Error('Répondre aux questions avant de reprendre.');
    this.invalidate(feature, step.id);
    const answerBindings = boundAnswers(
      (previous?.descriptionRevision ?? 0) === (feature.descriptionRevision ?? 0)
        ? previous
        : undefined,
      step.id,
    );
    const attempt: Attempt = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      status: 'running',
      model: step.model,
      feedback,
      logs: [],
      questions: [],
      answers: Object.fromEntries(
        Object.entries(answerBindings).map(([id, binding]) => [id, binding.answer]),
      ),
      answerBindings,
      changedFiles: [],
      revision: 0,
      descriptionRevision: feature.descriptionRevision ?? 0,
      ...(feature.activeCorrectionId ? { correctionId: feature.activeCorrectionId } : {}),
      ...(!feature.activeCorrectionId &&
      previous?.artifact &&
      (previous.descriptionRevision ?? 0) === (feature.descriptionRevision ?? 0)
        ? { artifact: structuredClone(previous.artifact) }
        : {}),
      ...(resume ? { sessionId: previous!.sessionId } : {}),
    };
    const correction = feature.corrections?.find((item) => item.id === feature.activeCorrectionId);
    if (correction) correction.status = 'running';
    feature.teamLockedAt ??= attempt.startedAt;
    step.attempts.push(attempt);
    step.status = 'running';
    feature.activeStepId = step.id;
    this.touch(feature);
    return attempt;
  }
  finishRun(featureId: string, stepId: string, result: RunResult): Attempt {
    const [feature, step] = this.pair(featureId, stepId),
      attempt = this.latest(step);
    if (step.status !== 'running' || attempt.status !== 'running')
      throw new Error('La tentative ne tourne plus.');
    if (
      new Set(result.questions.map((q) => q.id)).size !== result.questions.length ||
      result.questions.some(
        (q) =>
          !/^[a-zA-Z][\w-]{0,63}$/.test(q.id) ||
          ['__proto__', 'prototype', 'constructor'].includes(q.id) ||
          !q.text.trim(),
      )
    )
      throw new Error('Questions invalides.');
    const answerBindings = boundAnswers(attempt, step.id);
    for (const question of result.questions) {
      if (
        !answerBindings[question.id] ||
        !sameQuestion(answerBindings[question.id].question, question)
      ) {
        delete attempt.answers[question.id];
        delete answerBindings[question.id];
      }
    }
    attempt.answerBindings = answerBindings;
    attempt.answers = Object.fromEntries(
      Object.entries(answerBindings).map(([id, binding]) => [id, binding.answer]),
    );
    const questions = [
      ...new Map(
        [...attempt.questions, ...result.questions].map((question) => [
          question.id,
          structuredClone(question),
        ]),
      ).values(),
    ];
    Object.assign(attempt, {
      sessionId: result.sessionId ?? attempt.sessionId,
      model: result.model ?? attempt.model,
      usage: result.usage ?? attempt.usage,
      review: result.review ? reviewSchema.parse(result.review) : attempt.review,
      questions,
      changedFiles: [...result.changedFiles],
      fileHashes: result.fileHashes ? { ...result.fileHashes } : attempt.fileHashes,
      finishedAt: new Date().toISOString(),
      artifact: {
        name: step.artifact,
        content: result.content,
        updatedAt: new Date().toISOString(),
      },
      revision: (attempt.revision ?? 0) + 1,
    });
    attempt.artifactVersions = [
      {
        revision: attempt.revision ?? 0,
        content: result.content,
        at: attempt.finishedAt!,
        author: 'agent',
      },
    ];
    step.status = attempt.status = questions.some((q) => !attempt.answers[q.id]?.trim())
      ? 'waiting_input'
      : 'awaiting_review';
    this.touch(feature);
    return attempt;
  }
  private terminate(
    featureId: string,
    stepId: string,
    status: 'failed' | 'cancelled' | 'interrupted',
    error?: string,
  ) {
    const [feature, step] = this.pair(featureId, stepId),
      attempt = this.latest(step);
    if (step.status !== 'running') throw new Error('La tentative ne tourne plus.');
    step.status = attempt.status = status;
    attempt.error = error;
    attempt.finishedAt = new Date().toISOString();
    const correction = feature.corrections?.find((item) => item.id === attempt.correctionId);
    if (correction) correction.status = 'interrupted';
    this.touch(feature);
  }
  failRun(featureId: string, stepId: string, error: string) {
    this.terminate(featureId, stepId, 'failed', error);
  }
  cancelRun(featureId: string, stepId?: string) {
    const target =
      stepId ?? this.getFeature(featureId).steps.find((s) => s.status === 'running')?.id;
    if (!target) throw new Error('Aucune tentative en cours.');
    this.terminate(featureId, target, 'cancelled');
  }
  interruptRun(featureId: string, stepId: string) {
    this.terminate(featureId, stepId, 'interrupted', 'Session interrompue.');
  }
  approveStep(
    featureId: string,
    stepId: string,
    actor: 'human' | 'autopilot' = 'human',
    expectedAttemptId?: string,
    expectedRevision?: number,
  ) {
    const [feature, step] = this.pair(featureId, stepId),
      attempt = this.latest(step);
    if (
      (expectedAttemptId !== undefined && expectedAttemptId !== attempt.id) ||
      (expectedRevision !== undefined && expectedRevision !== (attempt.revision ?? 0))
    )
      throw new Error('Validation obsolète : la tentative ou le livrable a changé.');
    const blockers = approvalBlockers(feature, step, actor);
    if (blockers.length) throw new Error(blockers.join(' '));
    step.status = attempt.status = 'approved';
    attempt.approvedAt = new Date().toISOString();
    attempt.approvedBy = actor;
    this.touch(feature);
  }
  saveArtifact(featureId: string, stepId: string, content: string, options?: EditorialSaveOptions) {
    const [feature, step] = this.pair(featureId, stepId),
      attempt = this.latest(step);
    if (feature.archived) throw new Error('La session est archivée.');
    if (feature.steps.some((s) => s.status === 'running'))
      throw new Error('Arrêter la tentative avant de modifier un livrable.');
    if (!['awaiting_review', 'waiting_input', 'approved', 'stale'].includes(step.status))
      throw new Error('Ce livrable ne peut pas être modifié dans cet état.');
    if (
      options &&
      (options.expectedAttemptId !== attempt.id ||
        options.expectedRevision !== (attempt.revision ?? 0) ||
        options.expectedStateKey !== featureStateKey(feature))
    )
      throw new Error(
        'Enregistrement obsolète : la session ou le compte rendu a changé. Recharge sa version actuelle.',
      );
    const now = new Date().toISOString();
    const descriptionChanged =
      options?.description !== undefined && options.description !== feature.description;
    const contentChanged = content !== attempt.artifact?.content;
    if (!descriptionChanged && !contentChanged) return;
    if (!attempt.artifactVersions?.length && attempt.artifact)
      attempt.artifactVersions = [
        {
          revision: attempt.revision ?? 0,
          content: attempt.artifact.content,
          at: attempt.artifact.updatedAt,
          author: 'agent',
        },
      ];
    if (contentChanged) {
      attempt.revision = (attempt.revision ?? 0) + 1;
      attempt.artifact = { name: step.artifact, content, updatedAt: now };
      attempt.artifactVersions ??= [];
      attempt.artifactVersions.push({
        revision: attempt.revision,
        content,
        at: now,
        author: 'human',
        reason: options?.reason,
      });
      this.invalidate(feature, step.id);
      if (step.status === 'approved') {
        step.status = attempt.status = 'awaiting_review';
        delete attempt.approvedAt;
        delete attempt.approvedBy;
      }
    }
    if (descriptionChanged) {
      feature.descriptionVersions ??= [
        {
          revision: feature.descriptionRevision ?? 0,
          content: feature.description,
          at: feature.createdAt,
          author: 'human',
        },
      ];
      feature.descriptionRevision = (feature.descriptionRevision ?? 0) + 1;
      feature.description = options!.description!;
      feature.descriptionVersions.push({
        revision: feature.descriptionRevision,
        content: feature.description,
        at: now,
        author: 'human',
        reason: options?.reason,
      });
      for (const candidate of feature.steps) {
        this.invalidate(feature, candidate.id);
        if (candidate.attempts.length) candidate.status = 'stale';
      }
      if (feature.activeCorrectionId) {
        const cycle = feature.corrections?.find((item) => item.id === feature.activeCorrectionId);
        if (cycle) cycle.status = 'interrupted';
        delete feature.activeCorrectionId;
      }
      if (feature.autopilot) {
        feature.autopilot.status = 'paused';
        feature.autopilot.reason =
          'Besoin initial révisé : nouvelles sessions Copilot et revalidation du parcours requises.';
        feature.autopilot.updatedAt = now;
      }
    }
    this.touch(feature);
  }
  requestCorrection(featureId: string, request: CorrectionRequest): CorrectionCycle {
    const feature = this.getFeature(featureId);
    const preview = previewCorrection(feature, request);
    if (preview.errors.length) throw new Error(preview.errors.join(' '));
    const cycle: CorrectionCycle = {
      ...structuredClone(request),
      rootStepIds: preview.rootStepIds,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'requested',
      impactedStepIds: preview.impactedStepIds,
      snapshot: correctionSnapshot(feature, request.sourceStepId)!,
    };
    for (const root of cycle.rootStepIds) this.invalidate(feature, root);
    for (const step of feature.steps)
      if (cycle.impactedStepIds.includes(step.id) && step.attempts.length) step.status = 'stale';
    feature.corrections ??= [];
    feature.corrections.push(cycle);
    feature.activeCorrectionId = cycle.id;
    this.touch(feature);
    return cycle;
  }
  finalizeFeature(featureId: string, expectedStateKey: string): string {
    const feature = this.getFeature(featureId);
    if (expectedStateKey !== featureStateKey(feature))
      throw new Error(
        'La session a changé. Relis sa version actuelle avant validation définitive.',
      );
    if (feature.finalValidation) throw new Error('Cette session est déjà validée définitivement.');
    if (!finalValidationReady(feature))
      throw new Error(
        'Valide toutes les étapes, les critères et les remarques bloquantes avant de terminer.',
      );
    const id = randomUUID();
    feature.finalValidation = {
      id,
      at: new Date().toISOString(),
      stateKey: expectedStateKey,
      author: 'human',
    };
    const correction = feature.corrections?.find((item) => item.id === feature.activeCorrectionId);
    if (correction) correction.status = 'completed';
    delete feature.activeCorrectionId;
    if (feature.autopilot) {
      feature.autopilot.status = 'completed';
      feature.autopilot.reason = 'Validation définitive humaine enregistrée.';
      feature.autopilot.updatedAt = new Date().toISOString();
    }
    feature.finalValidation.stateKey = featureStateKey(feature);
    this.touch(feature);
    return id;
  }
  answerQuestions(featureId: string, stepId: string, answers: Record<string, string>) {
    const [feature, step] = this.pair(featureId, stepId),
      attempt = this.latest(step);
    if (step.status !== 'waiting_input') throw new Error('Cette étape ne demande pas de réponse.');
    for (const [key, answer] of Object.entries(answers)) {
      if (!attempt.questions.some((q) => q.id === key) || typeof answer !== 'string')
        throw new Error('Réponse à une question inconnue.');
    }
    Object.assign(attempt.answers, answers);
    attempt.answerBindings = boundAnswers(attempt, step.id);
    attempt.revision = (attempt.revision ?? 0) + 1;
    this.touch(feature);
    // Les réponses sont fournies au prochain run : elles ne valident pas un livrable que l'agent n'a pas encore complété.
  }
  configureStep(
    featureId: string,
    stepId: string,
    config: {
      agentId: string;
      model?: string;
      reasoning?: string;
      skills: string[];
      maxAttempts?: number;
      initialContext?: string;
      mcpServerIds?: string[];
      askBeforeRun?: boolean;
    },
  ) {
    const [feature, step] = this.pair(featureId, stepId);
    if (feature.steps.some((s) => s.status === 'running'))
      throw new Error('Configuration indisponible pendant une tentative.');
    if (!config.agentId.trim()) throw new Error('Agent obligatoire.');
    launchSchema.parse({
      initialContext: config.initialContext ?? step.initialContext ?? '',
      mcpServerIds: config.mcpServerIds ?? step.mcpServerIds ?? [],
      memoryIds: [],
      useProjectMemory: false,
    });
    if (
      config.maxAttempts !== undefined &&
      (!Number.isInteger(config.maxAttempts) ||
        config.maxAttempts < 1 ||
        config.maxAttempts > 100 ||
        config.maxAttempts < step.attempts.length)
    )
      throw new Error(
        'Le maximum doit être un entier entre 1 et 100, au moins égal aux tentatives déjà enregistrées.',
      );
    const changed =
      step.agentId !== config.agentId ||
      (step.model ?? '') !== (config.model ?? '') ||
      (step.reasoning ?? '') !== (config.reasoning ?? '') ||
      (config.initialContext !== undefined &&
        (step.initialContext ?? '') !== config.initialContext) ||
      (config.mcpServerIds !== undefined &&
        JSON.stringify([...(step.mcpServerIds ?? [])].sort()) !==
          JSON.stringify([...config.mcpServerIds].sort())) ||
      JSON.stringify([...step.skills].sort()) !== JSON.stringify([...config.skills].sort());
    const { maxAttempts, initialContext, mcpServerIds, askBeforeRun, ...selection } = config;
    Object.assign(step, selection);
    if (maxAttempts !== undefined) step.maxAttempts = maxAttempts;
    if (initialContext !== undefined) step.initialContext = initialContext;
    if (mcpServerIds !== undefined) step.mcpServerIds = [...mcpServerIds];
    if (askBeforeRun !== undefined) step.askBeforeRun = askBeforeRun;
    if (changed && step.attempts.length) {
      this.invalidate(feature, step.id);
      step.status = 'stale';
    }
    this.touch(feature);
  }
  appendEvent(featureId: string, stepId: string, event: RunEvent) {
    const [feature, step] = this.pair(featureId, stepId);
    if (step.status !== 'running') return;
    this.latest(step).logs.push(event);
    this.touch(feature);
  }
  setSession(featureId: string, stepId: string, sessionId: string) {
    const [feature, step] = this.pair(featureId, stepId);
    if (step.status !== 'running') return;
    this.latest(step).sessionId = sessionId;
    this.touch(feature);
  }
  archiveFeature(featureId: string, archived: boolean) {
    const feature = this.getFeature(featureId);
    if (feature.steps.some((s) => s.status === 'running'))
      throw new Error('Arrêter la tentative avant de masquer la session.');
    feature.archived = archived;
    this.touch(feature);
  }
}
