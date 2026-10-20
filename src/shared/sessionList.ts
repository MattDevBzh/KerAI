import type { Feature } from './types';
import type { StudioProject } from './projects';

export type SessionBatchAction = 'archive' | 'restore' | 'delete';
export interface SessionBatchResult {
  requestId: string;
  action: SessionBatchAction;
  succeeded: string[];
  failed: { featureId: string; title: string; error: string }[];
  freedBytes: number;
  cancelled?: boolean;
  error?: string;
}
export interface SessionListFilters {
  search: string;
  project: string;
  status: string;
  archived: boolean;
  sort: 'recent' | 'oldest' | 'title';
}
export const defaultSessionFilters: SessionListFilters = {
  search: '',
  project: '',
  status: 'all',
  archived: false,
  sort: 'recent',
};

/** Use current project names, retaining the attribution of disconnected/older projects. */
export function sessionProjects(feature: Feature, catalog: StudioProject[] = []): StudioProject[] {
  return (feature.projects ?? []).map(
    (project) => catalog.find((item) => item.id === project.id) ?? project,
  );
}

/** A range follows the visible, sorted list and never includes hidden sessions. */
export function selectSessionRange(
  visible: string[],
  selected: string[],
  anchor: string | undefined,
  id: string,
  extend: boolean,
): string[] {
  const index = visible.indexOf(id);
  if (index < 0) return selected;
  const next = new Set(selected.filter((item) => visible.includes(item)));
  const start = anchor ? visible.indexOf(anchor) : -1;
  if (extend && start >= 0) {
    for (const item of visible.slice(Math.min(start, index), Math.max(start, index) + 1))
      next.add(item);
  } else if (next.has(id)) next.delete(id);
  else next.add(id);
  return [...next];
}
