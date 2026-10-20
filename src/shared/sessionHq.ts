import type { AgentProfile, Feature, FeatureStep, StepStatus } from './types';

export const hqTransferDuration = 5_000;
export interface HqContextTransfer {
  attemptId: string;
  fromStepId: string;
  toStepId: string;
}

/** A launch is a new attempt, never a streamed update or a resumed pair block. */
export function sessionHqTransfer(
  previous: Feature,
  current: Feature,
): HqContextTransfer | undefined {
  if (previous.id !== current.id || current.archived) return;
  for (const [index, step] of current.steps.entries()) {
    const attempt = step.attempts.at(-1);
    const before = previous.steps.find((item) => item.id === step.id);
    if (
      index > 0 &&
      before &&
      step.status === 'running' &&
      attempt?.status === 'running' &&
      !before.attempts.some((item) => item.id === attempt.id)
    )
      return {
        attemptId: attempt.id,
        fromStepId: current.steps[index - 1].id,
        toStepId: step.id,
      };
  }
}

export const hqStatusLabels: Record<StepStatus, string> = {
  pending: 'À venir',
  running: 'Au travail',
  waiting_input: 'Attend ta réponse',
  awaiting_review: 'À valider',
  approved: 'Validée',
  skipped: 'Passée · non exécutée',
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
  waitingForOptionalChoice = false,
) {
  // An invalidated or unstarted station represents its next assigned agent, not the old run.
  const attempt = ['pending', 'stale'].includes(step.status) ? undefined : step.attempts.at(-1);
  const agentId = attempt?.profileSnapshot?.agentId ?? step.agentId;
  const profile = agents.find((agent) => agent.id === agentId);
  const status = waitingForHuman || waitingForOptionalChoice ? 'waiting_input' : step.status;
  return {
    agent: { id: agentId, avatar: profile?.avatar },
    name: attempt?.agentName || profile?.nickname || profile?.name || agentId,
    status,
    label: waitingForOptionalChoice
      ? 'Choix facultatif attendu'
      : `${hqStatusLabels[status]}${step.optional && status !== 'skipped' ? ' · Facultative' : ''}`,
  };
}
