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
    name: agent.name,
    description: agent.description,
    policy: agentPolicy(agent),
    skills: [],
    model: step.model?.trim() || undefined,
    reasoning: step.reasoning?.trim() || undefined,
  };
}

export function inheritTeamProfiles<T extends WorkflowStep>(
  steps: T[],
  agents: AgentProfile[],
): T[] {
  return steps.map((step) => {
    const agent = agents.find((entry) => entry.id === step.agentId);
    if (!agent) return { ...step };
    return inheritAgentProfile(step, agent);
  });
}

/** Historical feature definitions stay compatible until their team is explicitly edited. */
export function resolveAgentProfile<T extends WorkflowStep>(step: T, agent: AgentProfile): T {
  const resolved = step.inheritAgent ? inheritAgentProfile(step, agent) : { ...step };
  return {
    ...resolved,
    model: step.model?.trim() || agent.model?.trim() || undefined,
    reasoning: step.reasoning?.trim() || agent.reasoning?.trim() || undefined,
    skills: step.inheritAgent ? [...agent.skills] : [...new Set([...agent.skills, ...step.skills])],
  };
}
