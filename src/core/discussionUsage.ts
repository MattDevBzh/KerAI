import type { Discussion } from '../shared/discussions';
import type { Feature, StepStatus } from '../shared/types';

/** Read-only projection into the shared usage ledger; never added to the workflow store. */
export function discussionUsage(discussions: Discussion[]): Feature[] {
  return discussions.map((discussion) => ({
    id: `discussion:${discussion.id}`,
    title: discussion.title,
    description: '',
    workflowId: '__discussion__',
    workflowName: 'Discussions',
    createdAt: discussion.createdAt,
    updatedAt: discussion.updatedAt,
    branch: '',
    status: 'completed',
    activeStepId: '',
    steps: discussion.messages
      .filter((message) => message.role === 'assistant')
      .map((message) => {
        const status: StepStatus = (
          {
            complete: 'awaiting_review',
            streaming: 'running',
            error: 'failed',
            interrupted: 'interrupted',
          } as const
        )[message.status];
        return {
          id: message.id,
          name: message.agent?.nickname || message.agent?.name || 'Réponse',
          description: '',
          agentId: message.agent?.id ?? '',
          policy: 'read-only',
          skills: [],
          maxAttempts: 1,
          artifact: 'response.md',
          dependsOn: [],
          status,
          attempts: [
            {
              id: message.id,
              startedAt: message.createdAt,
              status,
              model: message.model,
              usage: message.usage,
              error: message.error,
              feedback: '',
              logs: [],
              questions: [],
              answers: {},
              changedFiles: [],
            },
          ],
        };
      }),
  }));
}
