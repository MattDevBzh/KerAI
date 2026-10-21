import type { AgentProfile, PolicyProfile, WorkflowStep } from './types';

export function agentPolicy(agent: AgentProfile): PolicyProfile {
  if (agent.policy) return agent.policy;
  if (agent.tools.some((tool) => ['execute', 'studio_run_test'].includes(tool))) return 'tests';
  if (
    agent.tools.some((tool) =>
      ['edit', 'write', 'studio_write_file', 'studio_replace_text'].includes(tool),
    )
  )
    return 'workspace-write';
  return 'read-only';
}

/** Persist a reference, not a copy of the profile. Keep workflow topology and evidence gates. */
export function inheritAgentProfile<T extends WorkflowStep>(step: T, agent: AgentProfile): T {
  return {
    ...step,
    inheritAgent: true,
    name: step.subplan ? step.name : agent.name,
    description: step.subplan ? step.description : agent.description,
    policy: step.subplan ? 'read-only' : agentPolicy(agent),
    skills: [],
    model: (step.model ?? agent.model ?? '').trim(),
    reasoning: (step.reasoning ?? agent.reasoning ?? '').trim(),
  };
}

export function inheritTeamProfiles<T extends WorkflowStep>(
  steps: T[],
  agents: AgentProfile[],
): T[] {
  return steps.map((step) => {
    const agent = agents.find((entry) => entry.id === step.agentId);
    const nested = step.subplan
      ? {
          ...step,
          subplan: { ...step.subplan, steps: inheritTeamProfiles(step.subplan.steps, agents) },
        }
      : step;
    if (!agent) return { ...nested };
    return inheritAgentProfile(nested, agent);
  });
}

/** Historical feature definitions stay compatible until their team is explicitly edited. */
export function resolveAgentProfile<T extends WorkflowStep>(step: T, agent: AgentProfile): T {
  const resolved = step.inheritAgent ? inheritAgentProfile(step, agent) : { ...step };
  return {
    ...resolved,
    model: (resolved.model ?? agent.model)?.trim(),
    reasoning: (resolved.reasoning ?? agent.reasoning)?.trim(),
    skills: step.inheritAgent ? [...agent.skills] : [...new Set([...agent.skills, ...step.skills])],
  };
}
