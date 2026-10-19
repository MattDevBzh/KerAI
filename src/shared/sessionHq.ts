import type { AgentProfile, FeatureStep, StepStatus } from './types';

export const hqStatusLabels: Record<StepStatus, string> = {
  pending: 'À venir',
  running: 'Au travail',
  waiting_input: 'Attend ta réponse',
  awaiting_review: 'À valider',
  approved: 'Validée',
  failed: 'En échec',
  cancelled: 'Annulée',
  stale: 'À actualiser',
  interrupted: 'Interrompue',
};

/** One station per intervention, including repeated agents. Questions take precedence over animation. */
export function sessionHqStation(
  step: FeatureStep,
  agents: AgentProfile[],
  waitingForHuman = false,
) {
  // An invalidated or unstarted station represents its next assigned agent, not the old run.
  const attempt = ['pending', 'stale'].includes(step.status) ? undefined : step.attempts.at(-1);
  const agentId = attempt?.profileSnapshot?.agentId ?? step.agentId;
  const profile = agents.find((agent) => agent.id === agentId);
  const status = waitingForHuman ? 'waiting_input' : step.status;
  return {
    agent: { id: agentId, avatar: profile?.avatar },
    name: attempt?.agentName || profile?.nickname || profile?.name || agentId,
    status,
    label: hqStatusLabels[status],
  };
}
