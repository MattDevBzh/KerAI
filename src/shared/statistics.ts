export type StatsPeriod =
  | 'today'
  | '7d'
  | '30d'
  | '90d'
  | 'month'
  | 'previousMonth'
  | 'year'
  | 'all'
  | 'custom';
export type StatsGrain = 'day' | 'week' | 'month';
export interface StatsFilters {
  project: string;
  workflow: string;
  period: StatsPeriod;
  from: string;
  to: string;
  grain: StatsGrain;
  includeArchived: boolean;
}
export const defaultStatsFilters: StatsFilters = {
  project: '',
  workflow: '',
  period: '30d',
  from: '',
  to: '',
  grain: 'day',
  includeArchived: true,
};
export interface StatsStorageItem {
  featureId: string;
  bytes?: number;
  error?: string;
}
export type StatsClientMessage = { type: 'statsStorage'; requestId: string; featureIds: string[] };
export type StatsHostMessage = {
  type: 'statsStorageResult';
  requestId: string;
  items: StatsStorageItem[];
  error?: string;
};
