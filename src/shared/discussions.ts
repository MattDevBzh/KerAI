import type { AgentProfile, Usage, PolicyProfile } from './types';

export interface DiscussionFeatureMember {
  model?: string;
  reasoning?: string;
  optional?: boolean;
  agentId: string;
  name: string;
  description: string;
  policy: PolicyProfile;
}
export interface DiscussionFeaturePlan {
  title: string;
  description: string;
  criteria: string[];
  team: DiscussionFeatureMember[];
}
export interface DiscussionFeatureDraft extends DiscussionFeaturePlan {
  requestId: string;
  createdAt: string;
}

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
/** Host-owned copy of one report and the context of its execution. */
export interface DiscussionSource {
  featureId: string;
  featureTitle: string;
  stepId: string;
  stepName: string;
  attemptId: string;
  revision: number;
  capturedAt: string;
  agent: AgentProfile;
  model?: string;
  reasoning?: string;
  context: string;
  output: string;
  originalOutput?: string;
  warnings: string[];
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
  source?: DiscussionSource;
  featureDraft?: DiscussionFeatureDraft;
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
      type: 'prepareDiscussionFeature';
      requestId: string;
      discussionId: string;
      agentKey: string;
      model?: string;
      reasoning?: string;
    }
  | {
      type: 'openReportDiscussion';
      requestId: string;
      featureId: string;
      stepId: string;
      attemptId: string;
      revision: number;
    }
  | { type: 'returnToDiscussionReport'; discussionId: string; edit: boolean }
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
  | { type: 'featureCreateResult'; requestId: string; featureId?: string; error?: string }
  | { type: 'reportDiscussionOpened'; requestId: string; discussionId?: string; error?: string }
  | {
      type: 'discussionReportOpened';
      featureId: string;
      stepId: string;
      attemptId: string;
      edit: boolean;
      notice?: string;
    }
  | {
      type: 'discussionResult';
      requestId: string;
      discussionId: string;
      error?: string;
      cancelled?: boolean;
    };
