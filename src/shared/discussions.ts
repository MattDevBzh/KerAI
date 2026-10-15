import type { AgentProfile, Usage } from './types';

export type DiscussionIdentity = Pick<AgentProfile, 'id' | 'name' | 'nickname' | 'avatar'>;
export interface DiscussionAgent {
  key: string;
  projectName?: string;
  profile: AgentProfile;
}
export interface DiscussionMessage {
  id: string;
  requestId?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: 'complete' | 'streaming' | 'interrupted' | 'error';
  agent?: DiscussionIdentity;
  model?: string;
  reasoning?: string;
  usage?: Usage;
  error?: string;
}
export interface Discussion {
  id: string;
  title: string;
  agentKey: string;
  model?: string;
  reasoning?: string;
  createdAt: string;
  updatedAt: string;
  messages: DiscussionMessage[];
}
export interface DiscussionState {
  discussions: Discussion[];
  agents: DiscussionAgent[];
  defaultModel?: string;
  error?: string;
}
export type DiscussionClientMessage =
  | { type: 'refreshDiscussions' }
  | {
      type: 'sendDiscussion';
      requestId: string;
      discussionId: string;
      agentKey: string;
      content: string;
      model?: string;
      reasoning?: string;
    }
  | { type: 'cancelDiscussion'; discussionId: string }
  | { type: 'deleteDiscussion'; discussionId: string; requestId: string };
export type DiscussionHostMessage =
  | { type: 'discussionState'; state: DiscussionState }
  | {
      type: 'discussionResult';
      requestId: string;
      discussionId: string;
      error?: string;
      cancelled?: boolean;
    };
