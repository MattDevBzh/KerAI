export interface DevOpsConfig {
  organization: string;
  project: string;
  repository: string;
  remote: string;
}
export interface DevOpsTicket {
  id: number;
  title: string;
  state: string;
  workItemType?: string;
  assignedTo?: string;
  iterationPath?: string;
  areaPath?: string;
  tags?: string[];
  createdDate?: string;
  changedDate?: string;
  url: string;
  description: string;
  acceptanceCriteria: string;
  comments: { id: number; author: string; text: string }[];
  commentsLoaded?: boolean;
  commentsTruncated?: boolean;
}
export interface DevOpsPullRequest {
  id: number;
  title: string;
  status: string;
  isDraft?: boolean;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  description?: string;
  creationDate?: string;
  closedDate?: string;
  createdBy?: string;
  reviewers?: { id: string; displayName: string; vote: number; isRequired?: boolean }[];
  mergeStatus?: string;
}
export interface DevOpsLink {
  featureId: string;
  ticketId?: number;
  ticketUrl?: string;
  projectKey: string;
  pullRequestIds: number[];
  pullRequestUrls?: Record<string, string>;
}
export interface DeliveryFile {
  path: string;
  staged: string;
  unstaged: string;
  untracked: boolean;
  blocked?: string;
}
export interface DeliverySnapshot {
  branch: string;
  head: string;
  fingerprint: string;
  files: DeliveryFile[];
  remote?: string;
  remoteUrl?: string;
  diff: string;
  stagedDiff?: string;
  unstagedDiff?: string;
  untrackedDiff?: string;
  diffTruncated: boolean;
}
export interface DeliveryPreview {
  kind: 'commit' | 'push' | 'pr';
  fingerprint: string;
  branch: string;
  head: string;
  paths: string[];
  title: string;
  description?: string;
  target?: string;
  remote?: string;
  ticketId?: number;
  featureId?: string;
}
export interface DeliveryChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
}
export interface DevOpsState {
  config?: DevOpsConfig;
  authenticated: boolean;
  account?: string;
  busy: boolean;
  error?: string;
  notices: string[];
  tickets: DevOpsTicket[];
  pullRequests: DevOpsPullRequest[];
  links: DevOpsLink[];
  history: DeliveryChatEntry[];
  snapshot?: DeliverySnapshot;
  preview?: DeliveryPreview;
  refreshedAt?: string;
  truncated?: boolean;
}
export type DevOpsClientMessage =
  | { type: 'devopsRefresh' | 'devopsAuthenticate' | 'devopsDisconnect' | 'deliveryInspect' }
  | { type: 'devopsConfigure'; config: DevOpsConfig }
  | { type: 'devopsLoadTicket'; ticketId: number }
  | { type: 'devopsLinkFeature'; featureId: string; ticketId: number }
  | {
      type: 'devopsLinkPullRequest';
      pullRequestId: number;
      featureId: string;
      ticketId?: number;
      replaces?: { featureId: string; ticketId?: number };
    }
  | { type: 'devopsUnlinkPullRequest'; pullRequestId: number; featureId: string; ticketId?: number }
  | { type: 'devopsCreateFeature'; ticketId: number }
  | { type: 'deliveryChat'; text: string }
  | { type: 'deliveryPreviewCommit'; paths: string[]; title?: string; intent?: string }
  | { type: 'deliveryCommit'; paths: string[]; title: string; fingerprint: string }
  | { type: 'deliveryPreviewPush'; remote: string }
  | {
      type: 'deliveryPreviewPr';
      title: string;
      description: string;
      target: string;
      ticketId?: number;
      featureId?: string;
    }
  | { type: 'deliveryExecute'; kind: 'commit' | 'push' | 'pr'; fingerprint: string };
