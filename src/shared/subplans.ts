import type { Feature, FeatureStep, WorkflowStep, StepStatus } from './types';

export interface SubplanConfig {
  mode: 'automatic' | 'pair';
  teamName: string;
  steps: WorkflowStep[];
}
export interface SubplanIteration {
  id: string;
  number: number;
  taskId: string;
  title: string;
  description: string;
  planRevision: number;
  corrects?: string;
  orchestrationAttemptId: string;
  cancelled?: boolean;
  requiresRecheck?: boolean;
  recheckAfter?: number;
  templateKey?: string;
  feature: Feature;
}
export interface SubplanState {
  iterations: SubplanIteration[];
  acceptedRevisions: number[];
  paused?: boolean;
  queue?: string[];
}

/** Iterative traversal: configuration nesting and execution history have no UI depth limit. */
export function allFeatures(roots: Feature[]): Feature[] {
  const result: Feature[] = [],
    pending = [...roots].reverse();
  const seen = new Set<string>();
  while (pending.length) {
    const feature = pending.pop()!;
    if (seen.has(feature.id))
      throw new Error(
        'Une sous-équipe contient une référence circulaire ou une identité dupliquée.',
      );
    seen.add(feature.id);
    result.push(feature);
    pending.push(
      ...feature.steps
        .flatMap((step) => step.subplanState?.iterations.map((i) => i.feature) ?? [])
        .reverse(),
    );
  }
  return result;
}
export function featurePath(roots: Feature[], id: string): Feature[] {
  const features = new Map(allFeatures(roots).map((f) => [f.id, f]));
  const result: Feature[] = [];
  let current = features.get(id);
  while (current) {
    result.unshift(current);
    current = current.parent ? features.get(current.parent.featureId) : undefined;
    if (current && result.some((f) => f.id === current!.id))
      throw new Error('Navigation circulaire.');
  }
  return result;
}
export function configurationSteps(steps: WorkflowStep[]): WorkflowStep[] {
  const result: WorkflowStep[] = [],
    pending = [...steps];
  const seen = new Set<WorkflowStep>();
  while (pending.length) {
    const step = pending.pop()!;
    if (seen.has(step)) throw new Error('Composition circulaire.');
    seen.add(step);
    result.push(step);
    if (step.subplan) pending.push(...step.subplan.steps);
  }
  return result;
}
export function subplanIssues(steps: WorkflowStep[]): string[] {
  const errors: string[] = [],
    pending = steps.map((step) => ({ step, path: step.name }));
  const seen = new Set<WorkflowStep>();
  while (pending.length) {
    const { step, path } = pending.pop()!;
    if (seen.has(step)) {
      errors.push(`${path} : composition circulaire.`);
      continue;
    }
    seen.add(step);
    if (!step.subplan) continue;
    if (!step.agentId) errors.push(`${path} : choisis un orchestrateur.`);
    if (!step.subplan.steps.length) errors.push(`${path} : choisis une sous-équipe.`);
    pending.push(
      ...step.subplan.steps.map((child) => ({ step: child, path: `${path} › ${child.name}` })),
    );
  }
  return errors;
}
export function subplanComplete(step: FeatureStep): boolean {
  const pair = step.attempts.at(-1)?.pair;
  return Boolean(
    step.subplanState?.iterations.length &&
      step.subplanState.iterations.every(
        (i) => i.cancelled || (i.feature.status === 'completed' && !i.requiresRecheck),
      ) &&
      pair &&
      pair.plans.at(-1)?.revision === pair.approvedRevision &&
      !pair.busy &&
      !pair.error,
  );
}
export function currentIteration(step: FeatureStep): SubplanIteration | undefined {
  const state = step.subplanState;
  const ordered =
    state?.queue?.map((id) => state.iterations.find((i) => i.id === id)!).filter(Boolean) ??
    state?.iterations;
  return ordered?.find((i) => !i.cancelled && i.feature.status !== 'completed');
}
export function subplanDisplayStatus(step: FeatureStep): StepStatus {
  if (!step.subplan || step.status !== 'waiting_input') return step.status;
  if (step.subplanState?.paused || step.attempts.at(-1)?.pair?.pauseRequested) return 'interrupted';
  const iteration = currentIteration(step);
  if (
    iteration &&
    allFeatures([iteration.feature]).some((f) => f.steps.some((s) => s.status === 'running'))
  )
    return 'running';
  return step.status;
}
export function subplanProgressLabel(step: FeatureStep): string | undefined {
  if (!step.subplan) return;
  if (subplanIssues([step]).length) return 'Sous-équipe à configurer';
  if (subplanDisplayStatus(step) === 'running' && step.status !== 'running')
    return 'Sous-équipe au travail';
  if (step.subplanState?.paused) return 'Sous-plan en pause';
  if (currentIteration(step)) return `Itération ${currentIteration(step)!.number} · à poursuivre`;
  if (step.subplanState?.iterations.some((i) => i.requiresRecheck)) return 'Résultats à revérifier';
}
export function subplanContract(step: FeatureStep): string {
  return `CARTE SOUS-PLAN : tu es uniquement l'orchestrateur. Découpe la mission « ${step.name} » en tâches ordonnées, chacune confiée à une exécution complète de l'équipe ${step.subplan?.teamName || 'configurée'} : ${JSON.stringify(step.subplan?.steps.map((s) => ({ name: s.name, mission: s.description, sousPlan: Boolean(s.subplan) })))}. Ne réalise jamais leur développement toi-même. Chaque tâche correspond à une itération ; les corrections de développement et tests restent dans cette itération. Fournis un unique bloc JSON feature-studio-pair-plan : {"summary":"Découpage et critères de fin","blocks":[{"id":"tache_1","title":"Titre","description":"Mission autonome, contexte et critères vérifiables","corrects":"identifiant optionnel d'une ancienne itération"}]}. Omettre corrects pour une tâche nouvelle. Garde les identifiants et le contenu des tâches déjà démarrées. La tâche en cours doit rester la première tâche non terminée ; réorganise seulement les suivantes. Tu peux omettre les tâches terminées, ajouter des tâches et ajuster celles jamais démarrées. Pour corriger une tâche validée, propose une nouvelle tâche avec corrects ; les tâches suivantes seront signalées à revérifier. Ne réécris jamais l'historique. Les accords et les exécutions sont contrôlés par l'application. Pour faire valider le découpage, rends ce bloc structuré directement dans ta réponse, sans demander un accord préalable avec ask_user ; le bouton de validation du cockpit est prévu pour cela. L'équipe s'arrête pour la validation humaine de chaque étape, notamment le code avant les tests. État actuel des itérations : ${JSON.stringify(step.subplanState?.iterations.map((i) => ({ id: i.id, number: i.number, taskId: i.taskId, title: i.title, description: i.description, status: i.cancelled ? 'annulée' : i.feature.status, requiresRecheck: i.requiresRecheck, corrects: i.corrects, results: i.feature.steps.map((s) => ({ name: s.name, status: s.status, report: s.attempts.at(-1)?.artifact?.content })) })) ?? [])}. Réponds aux questions dans le chat ; une explication n'impose pas de nouveau plan. Tous les outils de cet orchestrateur restent en lecture seule.`;
}
export function newSubplanStep(): WorkflowStep {
  const id = `subplan-${crypto.randomUUID()}`;
  return {
    id,
    name: 'Sous-plan',
    description: 'Découper cette mission et confier chaque tâche à la sous-équipe.',
    agentId: 'fs-orchestrator',
    inheritAgent: true,
    policy: 'read-only',
    skills: [],
    maxAttempts: 20,
    artifact: `${id}.md`,
    dependsOn: [],
    subplan: { mode: 'pair', teamName: '', steps: [] },
  };
}
