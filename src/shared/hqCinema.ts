import type { Feature, FeatureStep, StudioState } from './types';
import type { TaskBoardItem } from './taskBoard';
import { allFeatures, currentIteration, featurePath } from './subplans';

export function hqScene(root: Feature, state: Pick<StudioState, 'humanRequests'>) {
  const excluded = new Set<string>();
  const family = allFeatures([root]).filter((f) => {
    if (f.archived || (f.parent && excluded.has(f.parent.featureId))) excluded.add(f.id);
    for (const step of f.steps)
      for (const iteration of step.subplanState?.iterations ?? [])
        if (iteration.cancelled) excluded.add(iteration.feature.id);
    return !excluded.has(f.id);
  });
  const request = state.humanRequests?.find((r) => family.some((f) => f.id === r.featureId));
  let feature = request ? family.find((f) => f.id === request.featureId)! : root;
  if (
    !request &&
    !root.archived &&
    root.status !== 'completed' &&
    root.status !== 'awaiting_final_validation'
  ) {
    const running = family.find(
      (f) => f.status !== 'completed' && f.steps.some((s) => s.status === 'running'),
    );
    if (running) feature = running;
    else {
      const seen = new Set<string>();
      while (!seen.has(feature.id)) {
        seen.add(feature.id);
        const parentStep = feature.steps.find((s) => s.id === feature.activeStepId);
        const next = parentStep && currentIteration(parentStep);
        if (
          !next ||
          next.cancelled ||
          next.feature.archived ||
          parentStep?.subplanState?.paused ||
          feature.status === 'awaiting_final_validation' ||
          feature.optionalRequest
        )
          break;
        feature = next.feature;
      }
    }
  }
  const step =
    feature.steps.find((s) => s.id === request?.stepId) ??
    feature.steps.find((s) => s.status === 'running') ??
    feature.steps.find((s) => s.id === feature.activeStepId) ??
    feature.steps[0];
  const path = featurePath([root], feature.id);
  const parent = path.at(-2);
  const parentStep = parent?.steps.find((s) =>
    s.subplanState?.iterations.some((i) => i.feature.id === feature.id),
  );
  const siblings = parentStep?.subplanState?.iterations.filter((i) => !i.cancelled) ?? [];
  const iteration = siblings.find((i) => i.feature.id === feature.id);
  return {
    feature,
    step,
    request,
    path,
    iteration,
    number: iteration ? siblings.indexOf(iteration) + 1 : 0,
    total: siblings.length,
  };
}

export function hqBoard(step?: FeatureStep): {
  title: string;
  items: TaskBoardItem[];
  initialPlan: { id: string; text: string }[];
  source: 'agent' | 'plan' | 'mission';
  updatedAt?: string;
} {
  const attempt =
    step && !['pending', 'stale'].includes(step.status) ? step.attempts.at(-1) : undefined;
  if (attempt?.taskBoard) return { ...attempt.taskBoard, source: 'agent' };
  const pair = attempt?.pair;
  const plan = pair?.plans.find((p) => p.revision === pair.approvedRevision) ?? pair?.plans.at(-1);
  if (pair && plan)
    return {
      title: plan.acceptedAt ? 'Mon plan de travail' : 'Organisation proposée',
      source: 'plan',
      initialPlan: plan.blocks.map((b) => ({ id: b.id, text: b.title })),
      items: plan.blocks.map((b) => ({
        id: b.id,
        text: b.title,
        status: pair.results.some((r) => r.planRevision === plan.revision && r.blockId === b.id)
          ? 'done'
          : pair.busy && pair.turn?.blockId === b.id
            ? 'in_progress'
            : 'pending',
      })),
    };
  return {
    title: 'Ma tâche courante',
    source: 'mission',
    initialPlan: [],
    items: step
      ? [
          {
            id: step.id,
            text: step.name,
            status:
              step.status === 'running'
                ? 'in_progress'
                : ['approved', 'awaiting_review'].includes(step.status)
                  ? 'done'
                  : ['failed', 'interrupted', 'waiting_input'].includes(step.status)
                    ? 'blocked'
                    : 'pending',
          },
        ]
      : [],
  };
}

export function hqSpeech(scene: ReturnType<typeof hqScene>) {
  const { feature, step, request } = scene;
  if (request) return { id: request.id, text: request.question, kind: 'attention' as const };
  if (feature.archived)
    return {
      id: 'archived',
      text: 'Session archivée · dernier état enregistré.',
      kind: 'status' as const,
    };
  if (feature.status === 'completed')
    return { id: 'completed', text: 'Session terminée et validée.', kind: 'status' as const };
  if (feature.optionalRequest)
    return {
      id: feature.optionalRequest.id,
      text: 'Une intervention facultative attend ton choix. Réduis le QG pour décider.',
      kind: 'attention' as const,
    };
  if (feature.status === 'awaiting_final_validation')
    return {
      id: 'final',
      text: 'Le bilan est prêt. Réduis le QG pour le relire et donner ta validation finale.',
      kind: 'attention' as const,
    };
  const attempt =
    step && !['pending', 'stale'].includes(step.status) ? step.attempts.at(-1) : undefined;
  const question = attempt?.questions.find((q) => !attempt.answers[q.id]);
  if (question) return { id: question.id, text: question.text, kind: 'attention' as const };
  if (step?.status === 'failed')
    return {
      id: `failed:${attempt?.id}`,
      text: attempt?.error || 'Cette intervention a échoué. Réduis le QG pour consulter le détail.',
      kind: 'attention' as const,
    };
  const message = attempt?.pair?.messages
    .filter((m) => m.role === 'assistant' && m.kind !== 'reasoning' && m.content.trim())
    .at(-1);
  const text = (message?.content ?? attempt?.artifact?.content ?? '')
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[#>*-]+\s/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`/g, '')
    .trim();
  const awaitingHuman =
    step?.status === 'awaiting_review' ||
    step?.status === 'waiting_input' ||
    step?.status === 'interrupted';
  if (text)
    return {
      id: message?.id ?? `artifact:${attempt?.id}`,
      text,
      kind: awaitingHuman ? ('attention' as const) : ('message' as const),
    };
  if (awaitingHuman)
    return {
      id: `waiting:${step?.id}`,
      text:
        step?.status === 'awaiting_review'
          ? 'Mon intervention est terminée. Le résultat attend ta relecture et ta validation dans le cockpit.'
          : 'La session est en attente. Retrouve le contexte et les choix disponibles dans le cockpit.',
      kind: 'attention' as const,
    };
  const board = hqBoard(step);
  const current = board.items.find((i) => i.status === 'in_progress' || i.status === 'blocked');
  return {
    id: `status:${step?.id}:${step?.status}`,
    text:
      current?.note ||
      current?.text ||
      step?.description ||
      'L’équipe attend la prochaine intervention.',
    kind: 'status' as const,
  };
}

/** Plain, bounded excerpts of public conversation; no invented summary or reasoning. */
export function speechPages(text: string, length = 260): string[] {
  const words = text.slice(0, 6000).split(/\s+/);
  const pages: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > length) {
      if (current) {
        pages.push(current);
        current = '';
      }
      for (let offset = 0; offset < word.length; offset += length)
        pages.push(word.slice(offset, offset + length));
      continue;
    }
    if (current && current.length + word.length + 1 > length) {
      pages.push(current);
      current = '';
    }
    current += (current ? ' ' : '') + word;
  }
  if (current) pages.push(current);
  return pages.length ? pages : [''];
}
