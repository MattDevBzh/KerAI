export type PrThreadStatus = 'byDesign' | 'wontFix' | 'active' | 'closed';
export interface PrAdministrationSettings {
  agentId: string;
  instructions: string;
  context: string;
  threadStatus: PrThreadStatus;
  comments: boolean;
  title: boolean;
  description: boolean;
}
export const defaultPrAdministrationSettings: PrAdministrationSettings = {
  agentId: 'fs-devops-pr-admin',
  instructions: '',
  context: '',
  threadStatus: 'byDesign',
  comments: true,
  title: false,
  description: false,
};
export interface PrAdminSnapshot {
  id: number;
  url: string;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  sourceHead: string;
  targetHead: string;
  baseHead: string;
  iteration: number;
  status: string;
}
export interface PrDiffBlock {
  id: string;
  stableKey: string;
  path: string;
  side: 'left' | 'right';
  startLine: number;
  endLine: number;
  changeTrackingId: number;
  code: string;
}
export interface PrAdminModelProposal {
  summary: string;
  title?: string;
  description?: string;
  comments: { blockId: string; rule: string; explanation: string; reference: string }[];
}
export interface PrAdminAction {
  id: string;
  kind: 'title' | 'description' | 'comment';
  content: string;
  before?: string;
  block?: PrDiffBlock;
  rule?: string;
  key?: string;
  operation: 'create' | 'update' | 'unchanged' | 'protected';
  reason?: string;
  threadId?: number;
  commentId?: number;
}
export interface PrAdminPreview {
  id: string;
  snapshot: PrAdminSnapshot;
  featureId: string;
  summary: string;
  model?: string;
  actions: PrAdminAction[];
  warnings: string[];
  blockCount: number;
  annotatedBlocks: number;
  threadStatus: PrThreadStatus;
  completed: string[];
}
export interface PrAdministrationState {
  settings: PrAdministrationSettings;
  generating?: boolean;
  preview?: PrAdminPreview;
  result?: string;
  error?: string;
}
export interface PrAnnotationReceipt {
  key: string;
  nonce: string;
  actorId: string;
  threadId?: number;
  commentId?: number;
  body: string;
  status: string;
  uncertain: boolean;
}
export interface PrAdministrationRecord {
  settings: PrAdministrationSettings;
  annotations: Record<string, PrAnnotationReceipt[]>;
}
export type PrAdministrationMessage =
  | { type: 'deliveryPrAdminSettings'; settings: PrAdministrationSettings }
  | { type: 'deliveryPrAdminPreview'; pullRequestId: number }
  | { type: 'deliveryPrAdminCancel' }
  | { type: 'deliveryPrAdminApply'; previewId: string; changes: { id: string; content: string }[] };
