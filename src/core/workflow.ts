import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Attempt, Feature, FeatureStep, RunEvent, RunResult, Workflow } from '../shared/types';

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
            model: z.string().optional(),
            reasoning: z.string().optional(),
            skills: z.array(id),
            maxAttempts: z.number().int().min(1).max(100),
            artifact: z.string().regex(/^[^/\\]+\.md$/),
            dependsOn: z.array(id),
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
    workflow: Workflow,
    input: {
      title: string;
      description: string;
      branch?: string;
      agentId?: string;
      model?: string;
    },
  ): Feature {
    const validated = validateWorkflow(workflow);
    if (!input.title.trim()) throw new Error('Le titre est obligatoire.');
    const now = new Date().toISOString();
    const feature: Feature = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description,
      workflowId: validated.id,
      workflowName: validated.name,
      createdAt: now,
      updatedAt: now,
      branch: input.branch ?? '',
      status: 'draft',
      activeStepId: validated.steps.find((s) => !s.dependsOn.length)!.id,
      steps: validated.steps.map((step) => ({
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
    feature.updatedAt = new Date().toISOString();
    feature.status = feature.steps.every((s) => s.status === 'approved')
      ? 'completed'
      : feature.steps.some((s) => s.status === 'running')
        ? 'running'
        : feature.steps.some((s) => !['pending'].includes(s.status))
          ? 'attention'
          : 'draft';
    const next = feature.steps.find(
      (s) =>
        s.status !== 'approved' &&
        s.dependsOn.every((dep) => feature.steps.find((d) => d.id === dep)?.status === 'approved'),
    );
    if (next) feature.activeStepId = next.id;
  }
  private invalidate(feature: Feature, stepId: string) {
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
    const attempt: Attempt = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      status: 'running',
      model: step.model,
      feedback,
      logs: [],
      questions: [],
      answers: previous ? { ...previous.answers } : {},
      changedFiles: [],
      ...(previous?.artifact ? { artifact: structuredClone(previous.artifact) } : {}),
      ...(resume ? { sessionId: previous!.sessionId } : {}),
    };
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
    Object.assign(attempt, {
      sessionId: result.sessionId ?? attempt.sessionId,
      model: result.model ?? attempt.model,
      usage: result.usage,
      questions: structuredClone(result.questions),
      changedFiles: [...result.changedFiles],
      fileHashes: result.fileHashes ? { ...result.fileHashes } : undefined,
      finishedAt: new Date().toISOString(),
      artifact: {
        name: step.artifact,
        content: result.content,
        updatedAt: new Date().toISOString(),
      },
    });
    step.status = attempt.status = result.questions.some((q) => !attempt.answers[q.id]?.trim())
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
  approveStep(featureId: string, stepId: string) {
    const [feature, step] = this.pair(featureId, stepId),
      attempt = this.latest(step);
    if (step.status !== 'awaiting_review')
      throw new Error('Cette étape attend un résultat à relire.');
    if (!attempt.artifact?.content.trim()) throw new Error('Un livrable non vide est nécessaire.');
    if (attempt.questions.some((q) => !attempt.answers[q.id]?.trim()))
      throw new Error('Des questions restent ouvertes.');
    if (
      !step.dependsOn.every((dep) => feature.steps.find((s) => s.id === dep)?.status === 'approved')
    )
      throw new Error('Une dépendance a été invalidée.');
    step.status = attempt.status = 'approved';
    attempt.approvedAt = new Date().toISOString();
    this.touch(feature);
  }
  saveArtifact(featureId: string, stepId: string, content: string) {
    const [feature, step] = this.pair(featureId, stepId),
      attempt = this.latest(step);
    if (feature.steps.some((s) => s.status === 'running'))
      throw new Error('Arrêter la tentative avant de modifier un livrable.');
    if (!['awaiting_review', 'waiting_input', 'approved'].includes(step.status))
      throw new Error('Ce livrable ne peut pas être modifié dans cet état.');
    attempt.artifact = { name: step.artifact, content, updatedAt: new Date().toISOString() };
    if (step.status === 'approved') {
      this.invalidate(feature, step.id);
      step.status = attempt.status = 'awaiting_review';
      delete attempt.approvedAt;
    }
    this.touch(feature);
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
    },
  ) {
    const [feature, step] = this.pair(featureId, stepId);
    if (feature.steps.some((s) => s.status === 'running'))
      throw new Error('Configuration indisponible pendant une tentative.');
    if (!config.agentId.trim()) throw new Error('Agent obligatoire.');
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
      JSON.stringify([...step.skills].sort()) !== JSON.stringify([...config.skills].sort());
    const { maxAttempts, ...selection } = config;
    Object.assign(step, selection);
    if (maxAttempts !== undefined) step.maxAttempts = maxAttempts;
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
