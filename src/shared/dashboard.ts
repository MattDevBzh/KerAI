import type { DevOpsPullRequest, DevOpsTicket } from './devops';
import { defaultTicketFilters, type TicketFilters } from './devopsTickets';
import type { Feature, FeatureStep } from './types';

export const dashboardKinds = [
  'sessions',
  'attention',
  'prs',
  'tickets',
  'usage',
  'activity',
] as const;
export type DashboardKind = (typeof dashboardKinds)[number];
export const dashboardLabels: Record<DashboardKind, string> = {
  sessions: 'Sessions en cours',
  attention: 'À traiter',
  prs: 'Pull requests',
  tickets: 'Tickets',
  usage: 'Consommation',
  activity: 'Activité récente',
};
export interface DashboardFilters {
  projectIds: string[];
  query: string;
  status: string;
  agentId: string;
  author: string;
  reviewer: string;
  draft: 'all' | 'yes' | 'no';
  tickets: TicketFilters;
}
export interface DashboardModule {
  id: string;
  kind: DashboardKind;
  title: string;
  span: 4 | 6 | 12;
  controlSpan: 4 | 6 | 12;
  height: number;
  filters: DashboardFilters;
}
export interface DashboardConfig {
  version: 1;
  refreshSeconds: number;
  projectIds: string[];
  modules: DashboardModule[];
}
export const newDashboardModule = (kind: DashboardKind, id: string): DashboardModule => ({
  id,
  kind,
  title: dashboardLabels[kind],
  span: kind === 'sessions' ? 12 : 6,
  controlSpan: kind === 'sessions' ? 12 : 4,
  height: 0,
  filters: {
    projectIds: [],
    query: '',
    status: kind === 'sessions' ? 'active' : kind === 'prs' ? 'active' : 'all',
    agentId: '',
    author: '',
    reviewer: '',
    draft: 'all',
    tickets: { ...structuredClone(defaultTicketFilters), assignment: 'all' },
  },
});
export const defaultDashboardConfig = (): DashboardConfig => ({
  version: 1,
  refreshSeconds: 60,
  projectIds: [],
  modules: dashboardKinds.map((kind) => ({
    ...newDashboardModule(kind, `default-${kind}`),
    span: 6 as const,
  })),
});
export interface DashboardItem<T> {
  projectId: string;
  projectName: string;
  item: T;
}
export interface DashboardData {
  tickets: DashboardItem<DevOpsTicket>[];
  prs: DashboardItem<DevOpsPullRequest>[];
  updatedAt?: string;
  errors: string[];
  partial: boolean;
  loading: boolean;
}
export interface DashboardState {
  revision: number;
  config: DashboardConfig;
  data: Record<string, DashboardData>;
  error?: string;
}
export type DashboardClientMessage =
  | { type: 'dashboardVisible'; visible: boolean }
  | { type: 'dashboardRefresh' | 'dashboardDetach' | 'dashboardFullscreen' }
  | { type: 'dashboardSave'; config: DashboardConfig; revision: number; requestId: string }
  | {
      type: 'dashboardOpen';
      featureId?: string;
      stepId?: string;
      projectId?: string;
      page?: 'devops-prs' | 'devops-tickets' | 'devops';
      ticketId?: number;
    };
export type DashboardHostMessage =
  | { type: 'dashboardState'; state: DashboardState }
  | { type: 'dashboardSaved'; requestId: string; error?: string };

export function currentDashboardStep(feature: Feature): FeatureStep | undefined {
  return (
    feature.steps.find((s) => s.status === 'running' || s.status === 'waiting_input') ??
    feature.steps.find((s) => s.id === feature.activeStepId) ??
    feature.steps.find((s) => s.status !== 'approved') ??
    feature.steps.at(-1)
  );
}
export function dashboardAgentId(feature: Feature): string | undefined {
  const step = currentDashboardStep(feature);
  return step?.attempts.at(-1)?.profileSnapshot?.agentId ?? step?.agentId;
}
export function dashboardFeatures(
  features: Feature[],
  config: DashboardConfig,
  module: DashboardModule,
): Feature[] {
  const f = module.filters;
  return features
    .filter((feature) => {
      const projects = feature.projects?.map((p) => p.id) ?? [];
      const matchesProjects = (ids: string[]) =>
        !ids.length || ids.some((id) => projects.includes(id));
      if (!matchesProjects(config.projectIds) || !matchesProjects(f.projectIds)) return false;
      if (
        !`${feature.title} ${feature.description}`
          .toLocaleLowerCase()
          .includes(f.query.toLocaleLowerCase())
      )
        return false;
      if (f.agentId && dashboardAgentId(feature) !== f.agentId) return false;
      if (f.status === 'active') return !feature.archived && feature.status !== 'completed';
      if (f.status !== 'all' && f.status !== feature.status) return false;
      return !feature.archived;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export const dashboardAttention = (feature: Feature) =>
  feature.status === 'attention' ||
  feature.status === 'awaiting_final_validation' ||
  feature.steps.some((step) =>
    ['waiting_input', 'awaiting_review', 'failed', 'interrupted', 'stale'].includes(step.status),
  );
