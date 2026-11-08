import type { Usage } from './types';
export interface PrReviewer {
  id: string;
  name: string;
  required: boolean;
}
export interface PullRequestSettings {
  agentId: string;
  target: string;
  instructions: string;
  isDraft: boolean;
  reviewers: PrReviewer[];
}
export const defaultPullRequestSettings: PullRequestSettings = {
  agentId: 'fs-devops-pr',
  target: 'main',
  instructions: '',
  isDraft: true,
  reviewers: [],
};
export interface PrGeneration {
  id: string;
  featureId: string;
  title: string;
  description: string;
  head: string;
  target: string;
  targetHead: string;
  agentId: string;
  model?: string;
  usage?: Usage;
}
export interface DeliverySession {
  featureId: string;
  title: string;
  path: string;
  branch: string;
}
