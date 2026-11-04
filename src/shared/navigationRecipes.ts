import type {
  NavigationCondition,
  NavigationJourney,
  NavigationLocator,
  NavigationPlan,
  NavigationSnapshot,
  NavigationStep,
} from './navigation';
import { NAVIGATION_LIMITS } from './navigation';

export function publishedJourneys(state: NavigationSnapshot): NavigationJourney[] {
  const current = new Map((state.publishedJourneys ?? []).map((j) => [j.id, j]));
  for (const journey of state.journeys) {
    if (journey.status === 'available') current.set(journey.id, journey);
    if (journey.status === 'archived') current.delete(journey.id);
  }
  return [...current.values()];
}

/** Compile pinned, same-application blocks. No fallback to a newer revision. */
export function navigationPlan(
  journey: NavigationJourney,
  state: NavigationSnapshot,
): NavigationPlan {
  const library = [...state.journeys, ...publishedJourneys(state), ...(state.blockRevisions ?? [])];
  const result: NavigationPlan = { steps: [], parameters: [], prerequisites: [], dependencies: [] };
  const visit = (item: NavigationJourney, prefix: string, ancestry: string[]) => {
    if (ancestry.includes(item.id) || ancestry.length >= 8)
      throw new Error('Composition cyclique ou trop profonde.');
    for (const parameter of item.parameters) {
      const previous = result.parameters.find((p) => p.name === parameter.name);
      if (
        previous &&
        (['label', 'type', 'required', 'sensitive', 'defaultValue'] as const).some(
          (key) => previous[key] !== parameter[key],
        )
      )
        throw new Error(`Paramètre incompatible entre blocs : ${parameter.name}.`);
      if (!previous) result.parameters.push(parameter);
    }
    result.prerequisites.push(
      ...item.prerequisites.filter((p) => !result.prerequisites.includes(p)),
    );
    for (const [index, ref] of (item.blocks ?? []).entries()) {
      const block = library.find(
        (j) => j.id === ref.journeyId && j.revision === ref.revision && j.status === 'available',
      );
      if (!block || block.applicationId !== journey.applicationId)
        throw new Error('Bloc publié introuvable dans cette application.');
      if (state.journeys.some((j) => j.id === block.id && j.status === 'archived'))
        throw new Error('Un bloc a été archivé. Choisis un autre accès.');
      result.dependencies.push({ journeyId: block.id, revision: block.revision, hash: block.hash });
      const blockPrefix = `${prefix}b${index}-`;
      visit(block, blockPrefix, [...ancestry, item.id]);
      result.steps.push({
        id: `${blockPrefix}arrival`,
        action: 'wait',
        postconditions: block.arrival,
        note: `Arrivée : ${block.title}`,
        effect: 'read',
      });
    }
    result.steps.push(...item.steps.map((step) => ({ ...step, id: `${prefix}${step.id}` })));
    if (
      result.steps.length > NAVIGATION_LIMITS.steps ||
      result.parameters.length > NAVIGATION_LIMITS.parameters
    )
      throw new Error('Composition trop grande : 80 étapes et 40 paramètres maximum.');
  };
  visit(journey, '', []);
  if (
    result.steps.some((s) => s.id.length > 128) ||
    new Set(result.steps.map((s) => s.id)).size !== result.steps.length
  )
    throw new Error('Identifiants d’étapes composées trop longs ou ambigus.');
  return result;
}

export function substituteNavigation(
  value: string,
  parameters: Record<string, string>,
  format: 'text' | 'css' | 'url' = 'text',
): string {
  return value.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_all, name: string) => {
    if (!Object.hasOwn(parameters, name)) throw new Error(`Paramètre manquant : ${name}.`);
    const replacement = parameters[name];
    if (format === 'url') return encodeURIComponent(replacement);
    if (format === 'css')
      return [...replacement]
        .map((c) => (/[a-zA-Z0-9_-]/.test(c) ? c : `\\${c.codePointAt(0)!.toString(16)} `))
        .join('');
    return replacement;
  });
}
export function resolveNavigationLocator(
  target: NavigationLocator | undefined,
  parameters: Record<string, string>,
): NavigationLocator | undefined {
  return (
    target && {
      ...target,
      value: substituteNavigation(
        target.value,
        parameters,
        target.strategy === 'css' ? 'css' : 'text',
      ),
      ...(target.name !== undefined ? { name: substituteNavigation(target.name, parameters) } : {}),
      ...(target.frame !== undefined
        ? { frame: substituteNavigation(target.frame, parameters, 'css') }
        : {}),
    }
  );
}
export function resolveNavigationConditions(
  conditions: NavigationCondition[],
  parameters: Record<string, string>,
): NavigationCondition[] {
  return conditions.map((condition) => ({
    ...condition,
    target: resolveNavigationLocator(condition.target, parameters),
    ...(condition.value !== undefined
      ? {
          value: substituteNavigation(
            condition.value,
            parameters,
            condition.kind === 'url' ? 'url' : 'text',
          ),
        }
      : {}),
  }));
}
export function resolveNavigationStep(
  step: NavigationStep,
  parameters: Record<string, string>,
): NavigationStep {
  return {
    ...step,
    target: resolveNavigationLocator(step.target, parameters),
    ...(step.url ? { url: substituteNavigation(step.url, parameters, 'url') } : {}),
    ...(step.postconditions
      ? { postconditions: resolveNavigationConditions(step.postconditions, parameters) }
      : {}),
    ...(step.resolver
      ? {
          resolver: {
            ...step.resolver,
            filters: step.resolver.filters.map((f) => ({
              ...f,
              ...(f.text !== undefined ? { text: substituteNavigation(f.text, parameters) } : {}),
            })),
          },
        }
      : {}),
  };
}

export function navigationOutputs(steps: NavigationStep[]) {
  return new Set(steps.flatMap((step) => (step.resolver ? [step.resolver.output] : [])));
}

export function navigationMaintenance(state: NavigationSnapshot) {
  const journeys = publishedJourneys(state);
  const reasons = new Map(journeys.map((journey) => [journey.id, new Set<string>()]));
  for (const journey of journeys) {
    const items = reasons.get(journey.id)!;
    for (const anchor of state.codeAnchors ?? [])
      if (anchor.state === 'stale' && anchor.journeyIds?.includes(journey.id))
        items.add(`Source modifiée : ${anchor.relativePath}`);
    for (const block of journey.blocks ?? []) {
      const current = journeys.find((j) => j.id === block.journeyId);
      if (!current) items.add(`Bloc indisponible : ${block.journeyId}`);
      else if (current.revision !== block.revision)
        items.add(
          `Nouvelle révision de ${current.title} : r${current.revision} (r${block.revision} conservée)`,
        );
    }
  }
  // Bounded fixed point propagates impacted source files through composed accesses.
  for (let pass = 0; pass < 8; pass++)
    for (const journey of journeys)
      for (const block of journey.blocks ?? [])
        if (reasons.get(block.journeyId)?.size)
          reasons
            .get(journey.id)!
            .add(
              `Bloc à revérifier : ${journeys.find((j) => j.id === block.journeyId)?.title ?? block.journeyId}`,
            );
  return [...reasons]
    .filter(([, items]) => items.size)
    .map(([journeyId, items]) => ({ journeyId, reasons: [...items].slice(0, 20) }));
}
