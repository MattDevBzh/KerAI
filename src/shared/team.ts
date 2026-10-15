import type { AgentProfile, Feature, StudioState, WorkflowStep } from './types';

export function teamLocked(feature: Feature): boolean {
  return Boolean(feature.teamLockedAt || feature.steps.some((step) => step.attempts.length));
}

export function orderedAgents(agents: AgentProfile[], favorites: string[] = []): AgentProfile[] {
  const ids = new Set(favorites);
  return [...agents].sort(
    (a, b) =>
      Number(ids.has(b.id)) - Number(ids.has(a.id)) ||
      (a.nickname || a.name).localeCompare(b.nickname || b.name, 'fr') ||
      a.id.localeCompare(b.id),
  );
}

export function teamSteps(feature: Feature): WorkflowStep[] {
  return feature.steps.map(({ status: _status, attempts: _attempts, ...step }) =>
    structuredClone(step),
  );
}

export function isLinearTeam(steps: WorkflowStep[]): boolean {
  return steps.every((step, index) =>
    index === 0
      ? !step.dependsOn.length
      : step.dependsOn.length === 1 && step.dependsOn[0] === steps[index - 1].id,
  );
}

function sequence(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, index) => ({ ...step, dependsOn: index ? [steps[index - 1].id] : [] }));
}

/** Copies only configuration, never execution history. Every insertion owns its IDs and report. */
export function instantiateTeam(
  steps: WorkflowStep[],
  newId = () => `step-${crypto.randomUUID()}`,
): WorkflowStep[] {
  const ids = new Map(steps.map((step) => [step.id, newId()]));
  return steps.map((step) => {
    const id = ids.get(step.id)!;
    return {
      ...structuredClone(step),
      id,
      artifact: `${step.artifact.replace(/\.md$/i, '').slice(0, 100)}-${id}.md`,
      dependsOn: step.dependsOn.map((dep) => {
        const mapped = ids.get(dep);
        if (!mapped) throw new Error(`Dépendance absente : ${dep}.`);
        return mapped;
      }),
    };
  });
}

export function agentStep(agent: AgentProfile): WorkflowStep {
  // A solo profile has no workflow permission policy. Start with read access; the user chooses
  // writing or tests explicitly in the intervention settings before validating the team.
  return instantiateTeam([
    {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      agentId: agent.id,
      policy: 'read-only',
      model: agent.model,
      skills: [],
      maxAttempts: 3,
      artifact: 'COMPTE_RENDU.md',
      dependsOn: [],
    },
  ])[0];
}

export function insertTeam(
  current: WorkflowStep[],
  added: WorkflowStep[],
  at: number,
): WorkflowStep[] {
  if (!added.length) return structuredClone(current);
  const position = Math.max(0, Math.min(at, current.length));
  const before = structuredClone(current.slice(0, position));
  const after = structuredClone(current.slice(position));
  const incoming = structuredClone(added);
  if (isLinearTeam(current) && isLinearTeam(incoming))
    return sequence([...before, ...incoming, ...after]);
  // Join graph boundaries at the insertion point. Internal edges of an imported team survive.
  const usedBefore = new Set(before.flatMap((step) => step.dependsOn));
  const terminalsBefore = before.filter((step) => !usedBefore.has(step.id)).map((step) => step.id);
  const incomingUsed = new Set(incoming.flatMap((step) => step.dependsOn));
  const incomingEnds = incoming.filter((step) => !incomingUsed.has(step.id)).map((step) => step.id);
  for (const step of incoming) if (!step.dependsOn.length) step.dependsOn = [...terminalsBefore];
  const afterIds = new Set(after.map((step) => step.id));
  for (const step of after)
    if (!step.dependsOn.some((dep) => afterIds.has(dep)))
      step.dependsOn = [...new Set([...step.dependsOn, ...incomingEnds])];
  const result = [...before, ...incoming, ...after];
  assertTeamOrder(result);
  return result;
}

export function moveTeamStep(steps: WorkflowStep[], from: number, to: number): WorkflowStep[] {
  const next = structuredClone(steps);
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [step] = next.splice(from, 1);
  next.splice(to, 0, step);
  if (isLinearTeam(steps)) return sequence(next);
  assertTeamOrder(next);
  return next;
}

export function removeTeamStep(steps: WorkflowStep[], id: string): WorkflowStep[] {
  const removed = steps.find((step) => step.id === id);
  return steps
    .filter((step) => step.id !== id)
    .map((step) => ({
      ...structuredClone(step),
      dependsOn: [
        ...new Set(
          step.dependsOn.flatMap((dep) => (dep === id ? (removed?.dependsOn ?? []) : [dep])),
        ),
      ],
    }));
}

export function assertTeamOrder(steps: WorkflowStep[]): void {
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) throw new Error('Deux interventions ont le même identifiant.');
    if (step.dependsOn.some((dep) => !seen.has(dep)))
      throw new Error(`« ${step.name} » doit rester après ses étapes préalables.`);
    seen.add(step.id);
  }
}

/** Existing templates may be saved in a valid but non-topological display order. */
export function orderTeam(steps: WorkflowStep[]): WorkflowStep[] {
  const remaining = [...steps],
    result: WorkflowStep[] = [],
    seen = new Set<string>();
  while (remaining.length) {
    const index = remaining.findIndex((step) => step.dependsOn.every((dep) => seen.has(dep)));
    if (index < 0) throw new Error('Les dépendances de cette équipe sont incohérentes.');
    const [step] = remaining.splice(index, 1);
    result.push(structuredClone(step));
    seen.add(step.id);
  }
  return result;
}

export function effectiveTeamModel(step: WorkflowStep, feature: Feature, state: StudioState) {
  const budget = feature.budget ?? state.settings.budgetDefaults;
  const profile =
    budget && budget.modelProfile !== 'current'
      ? state.settings.modelProfiles?.[budget.modelProfile]
      : undefined;
  const agent = state.agents.find((item) => item.id === step.agentId);
  const model = profile?.model || step.model || agent?.model || state.settings.defaultModel;
  const info = state.runtime.models.find((item) => item.id === model);
  const reasoning = profile ? profile.reasoning : step.reasoning;
  return {
    model: info?.name || model || 'Automatique',
    reasoning:
      reasoning || (info && !info.reasoningEfforts?.length ? 'Non applicable' : 'Automatique'),
    profile: profile ? budget!.modelProfile : undefined,
    modelId: model,
  };
}
