import { randomUUID } from 'node:crypto';
import type { AgentProfile, Feature, FeatureStep } from '../shared/types';
import { inheritTeamProfiles } from '../shared/agentInheritance';
import { instantiateTeam } from '../shared/team';
import { reconcileTeam } from './teamComposition';
import {
  allFeatures,
  currentIteration,
  featurePath,
  subplanComplete,
  subplanIssues,
} from '../shared/subplans';
import { featureStateKey } from '../shared/collaboration';
import { pairPlan } from '../shared/pair';
import { pairMessage } from './pair';
import { WorkflowEngine } from './workflow';

/** Validate the whole proposal before any child instance is added or changed. */
export function validateSubplanProposal(step: FeatureStep): void {
  const pair = step.attempts.at(-1)?.pair,
    plan = pair && pairPlan(pair);
  if (!step.subplan || !plan) throw new Error('Un découpage est nécessaire.');
  const issues = subplanIssues([step]);
  if (issues.length) throw new Error(issues.join(' '));
  const iterations = step.subplanState?.iterations ?? [];
  const running = currentIteration(step);
  if (running?.feature.steps.some((s) => s.attempts.length)) {
    const next = plan.blocks.find(
      (task) =>
        !iterations.some(
          (i) =>
            !i.cancelled &&
            i.taskId === task.id &&
            i.orchestrationAttemptId === step.attempts.at(-1)!.id &&
            i.feature.status === 'completed',
        ),
    );
    if (next?.id !== running.taskId)
      throw new Error(
        `Termine la tâche en cours « ${running.title} » avant les nouvelles tâches. Tu peux réorganiser les tâches suivantes.`,
      );
  }
  for (const task of plan.blocks) {
    const existing = iterations.find(
      (i) =>
        !i.cancelled &&
        i.taskId === task.id &&
        i.orchestrationAttemptId === step.attempts.at(-1)!.id,
    );
    if (existing && existing.corrects !== task.corrects)
      throw new Error(
        'Conserve le lien de correction ; utilise une nouvelle tâche pour changer sa cible.',
      );
    if (
      existing &&
      existing.feature.steps.some((s) => s.attempts.length) &&
      (existing.title !== task.title ||
        existing.description !== task.description ||
        existing.corrects !== task.corrects)
    )
      throw new Error(
        `« ${existing.title} » a déjà démarré. Propose une nouvelle tâche corrective pour préserver son historique.`,
      );
    if (
      task.corrects &&
      !iterations.some(
        (i) => i.id === task.corrects && !i.cancelled && i.feature.status === 'completed',
      )
    )
      throw new Error('La tâche à corriger doit désigner une itération terminée.');
  }
  for (const i of iterations)
    if (
      !i.cancelled &&
      i.feature.status !== 'completed' &&
      i.feature.steps.some((s) => s.attempts.length) &&
      !plan.blocks.some((t) => t.id === i.taskId)
    )
      throw new Error(`Conserve la tâche en cours « ${i.title} » dans le découpage proposé.`);
}

export function acceptSubplan(feature: Feature, step: FeatureStep, agents: AgentProfile[]): void {
  validateSubplanProposal(step);
  const attempt = step.attempts.at(-1)!,
    pair = attempt.pair!,
    plan = pairPlan(pair)!;
  const state = (step.subplanState ??= { iterations: [], acceptedRevisions: [] });
  if (state.acceptedRevisions.includes(plan.revision) && pair.approvedRevision === plan.revision)
    return;
  const oldTasks = state.iterations.filter(
    (i) => !i.cancelled && i.orchestrationAttemptId === attempt.id,
  );
  for (const i of oldTasks) {
    if (
      !i.feature.steps.some((s) => s.attempts.length) &&
      !plan.blocks.some((t) => t.id === i.taskId)
    )
      i.cancelled = true;
  }
  for (const task of plan.blocks) {
    const existing = oldTasks.find((i) => !i.cancelled && i.taskId === task.id);
    if (existing) {
      if (!existing.feature.steps.some((s) => s.attempts.length)) {
        existing.title = task.title;
        existing.description = task.description;
        existing.feature.title = task.title;
        existing.feature.description = taskDescription(
          feature,
          step,
          task.description,
          task.corrects,
        );
        if (existing.feature.descriptionVersions?.length)
          existing.feature.descriptionVersions[0].content = existing.feature.description;
      }
      continue;
    }
    const id = randomUUID();
    const child = new WorkflowEngine().createFeature(
      {
        id: 'custom',
        name: step.subplan!.teamName || 'Sous-équipe',
        description: '',
        icon: 'layers',
        steps: instantiateTeam(inheritTeamProfiles(step.subplan!.steps, agents)),
      },
      {
        title: task.title,
        description: taskDescription(feature, step, task.description, task.corrects),
        branch: feature.branch,
      },
    );
    child.parent = { featureId: feature.id, stepId: step.id, iterationId: id };
    child.execution = structuredClone(feature.execution);
    child.projects = structuredClone(feature.projects);
    child.worktree = structuredClone(feature.worktree);
    if (child.worktree) child.worktree.ownerFeatureId ??= feature.id;
    child.budget = structuredClone(feature.budget);
    // Every child step is a human checkpoint, including development before the test agent.
    child.autopilot = {
      checkpoints: child.steps.map((s) => s.id),
      maxRuns: child.budget?.maxRuns || 10,
      maxCorrectionCycles: 3,
      stepInputs: {},
      status: 'idle',
      runs: 0,
      correctionCycles: 0,
      updatedAt: new Date().toISOString(),
    };
    state.iterations.push({
      id,
      number: state.iterations.length + 1,
      taskId: task.id,
      title: task.title,
      description: task.description,
      corrects: task.corrects,
      planRevision: plan.revision,
      orchestrationAttemptId: attempt.id,
      templateKey: JSON.stringify(step.subplan!.steps),
      feature: child,
    });
    if (task.corrects) {
      const target = state.iterations.find((i) => i.id === task.corrects)!;
      for (const previous of state.iterations)
        if (
          previous.number >= target.number &&
          previous.feature.status === 'completed' &&
          !previous.cancelled
        ) {
          previous.requiresRecheck = true;
          previous.recheckAfter = state.iterations.length;
        }
    }
  }
  state.acceptedRevisions.push(plan.revision);
  state.queue = plan.blocks.map(
    (task) =>
      state.iterations.find(
        (i) => !i.cancelled && i.taskId === task.id && i.orchestrationAttemptId === attempt.id,
      )!.id,
  );
  state.paused = false;
  pair.approvedRevision = plan.revision;
  plan.acceptedAt ??= new Date().toISOString();
  pair.phase = 'checkpoint';
  pair.pauseRequested = false;
  pair.error = undefined;
  pair.version++;
  pairMessage(
    pair,
    'system',
    `Découpage ${plan.revision} accepté. Chaque tâche exécutera la sous-équipe avec validation humaine de ses étapes. Les anciennes tâches signalées « À revérifier » nécessitent une nouvelle tâche corrective liée avant la clôture.`,
  );
}
function taskDescription(
  feature: Feature,
  step: FeatureStep,
  description: string,
  corrects?: string,
): string {
  const previous = step.subplanState?.iterations.find((i) => i.id === corrects);
  return [
    `Contexte de la feature : ${feature.title}\n${feature.description}`,
    `Mission du sous-plan : ${step.description}`,
    `Tâche à réaliser :\n${description}`,
    previous
      ? `Révision de l'itération ${previous.number} (${previous.id}) :\n${iterationReport(previous.feature)}`
      : '',
    'Chaque étape est validée par l’humain. N’anticipe pas la mission d’une étape suivante. Le développement remet le code pour relecture avant le lancement des tests par leur étape dédiée. Un test en échec entraîne une correction, une nouvelle validation du code et de nouveaux tests.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function refreshFutureIteration(step: FeatureStep, agents: AgentProfile[]): void {
  const i = currentIteration(step);
  if (
    !i ||
    !step.subplan ||
    i.feature.steps.some((s) => s.attempts.length || s.optionalDecision) ||
    (i.feature.teamRevision ?? 0) > 0
  )
    return;
  const key = JSON.stringify(step.subplan.steps);
  if (key === i.templateKey) return;
  reconcileTeam(i.feature, instantiateTeam(inheritTeamProfiles(step.subplan.steps, agents)));
  i.feature.teamRevision = 0;
  i.feature.activeStepId = i.feature.steps[0]?.id ?? '';
  i.feature.status = 'draft';
  i.templateKey = key;
}
export function iterationReport(feature: Feature): string {
  return feature.steps
    .map((s) => `### ${s.name} · ${s.status}\n${s.attempts.at(-1)?.artifact?.content ?? ''}`)
    .join('\n\n');
}
/** Reconcile from leaves upward. Historical reports are immutable; only the parent synthesis changes. */
export function syncSubplans(engine: WorkflowEngine): void {
  for (const feature of allFeatures(engine.features).reverse()) {
    for (const step of feature.steps) {
      const state = step.subplanState,
        attempt = step.attempts.at(-1),
        pair = attempt?.pair;
      if (
        !state ||
        !attempt ||
        !pair ||
        pair.busy ||
        step.status === 'approved' ||
        step.status === 'stale'
      )
        continue;
      for (const i of state.iterations)
        if (i.feature.status === 'completed' && i.corrects) {
          const old = state.iterations.find((previous) => previous.id === i.corrects);
          if (old?.requiresRecheck && i.number >= (old.recheckAfter ?? 0))
            old.requiresRecheck = false;
        }
      const plan = pairPlan(pair);
      if (
        !plan ||
        pair.approvedRevision !== plan.revision ||
        pair.error ||
        pair.pendingMessages.length
      )
        continue;
      for (const task of plan.blocks) {
        const i = state.iterations.find(
          (i) => !i.cancelled && i.taskId === task.id && i.orchestrationAttemptId === attempt.id,
        );
        if (
          i?.feature.status === 'completed' &&
          !pair.results.some((r) => r.planRevision === plan.revision && r.blockId === task.id)
        )
          pair.results.push({
            planRevision: plan.revision,
            blockId: task.id,
            title: i.title,
            content: iterationReport(i.feature),
            at: new Date().toISOString(),
          });
      }
      if (state.paused || pair.pauseRequested) continue;
      if (subplanComplete(step)) {
        const content =
          `# ${step.name}\n\n${plan.summary}\n\n` +
          state.iterations
            .filter((i) => !i.cancelled)
            .map(
              (i) =>
                `## Itération ${i.number} · ${i.title}${i.corrects ? ' · révision' : ''}\n\n${iterationReport(i.feature)}`,
            )
            .join('\n\n');
        if (attempt.artifact?.content !== content || pair.phase !== 'review') {
          step.status = attempt.status = 'running';
          pair.phase = 'review';
          pair.version++;
          const attempts = state.iterations
            .flatMap((i) =>
              allFeatures([i.feature]).flatMap((f) => f.steps.flatMap((s) => s.attempts)),
            )
            .sort((a, b) =>
              (a.finishedAt ?? a.startedAt).localeCompare(b.finishedAt ?? b.startedAt),
            );
          feature.workspaceFileHashes = {
            ...feature.workspaceFileHashes,
            ...Object.assign({}, ...attempts.map((a) => a.fileHashes ?? {})),
          };
          engine.finishRun(feature.id, step.id, {
            content,
            questions: [],
            changedFiles: [...new Set(attempts.flatMap((a) => a.changedFiles))],
            fileHashes: Object.assign({}, ...attempts.map((a) => a.fileHashes ?? {})),
          });
        }
      } else {
        pair.phase = 'checkpoint';
        step.status = attempt.status = 'waiting_input';
      }
    }
    if (
      feature.steps.some((s) => s.subplanState) &&
      (feature.status !== 'completed' ||
        !feature.finalValidation ||
        feature.finalValidation.stateKey !== featureStateKey(feature))
    )
      engine.refreshFeatureStatus(feature.id);
  }
}
export function assertSubplanExecution(roots: Feature[], feature: Feature): void {
  const path = featurePath(roots, feature.id);
  for (let index = 1; index < path.length; index++) {
    const child = path[index],
      parent = path[index - 1],
      step = parent.steps.find((s) => s.id === child.parent!.stepId)!;
    const pair = step.attempts.at(-1)?.pair;
    if (
      parent.archived ||
      step.status === 'approved' ||
      step.status === 'stale' ||
      step.subplanState?.paused ||
      !pair ||
      pair.pauseRequested ||
      pair.error ||
      pair.approvedRevision !== pairPlan(pair)?.revision ||
      currentIteration(step)?.feature.id !== child.id
    )
      throw new Error(
        'Cette itération est historique ou en attente. Reprends le sous-plan actif ; pour corriger une tâche validée, ajoute une nouvelle tâche depuis son orchestrateur.',
      );
  }
}
