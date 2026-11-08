import { allFeatures, configurationSteps } from './subplans';
import type { Feature } from './types';

export type CatalogueDeleteTarget =
  | { kind: 'agent'; id: string }
  | { kind: 'kit'; id: string; source: 'bundled' | 'saved' };
export interface CatalogueDeletePreview {
  token: string;
  label: string;
  agents: string[];
  skills: string[];
  workflows: string[];
  shared: string[];
  blockers: string[];
  files: number;
  canDelete: boolean;
}
export type CatalogueDeleteMessage =
  | { type: 'catalogueDeletePreview'; requestId: string; target: CatalogueDeleteTarget }
  | { type: 'catalogueDeleteApply'; requestId: string; token: string };
export interface CatalogueDeleteResult {
  type: 'catalogueDeleteResult';
  requestId: string;
  preview?: CatalogueDeletePreview;
  message?: string;
  error?: string;
}

/** Completed roots are historical. Archived drafts and pending compositions still protect profiles. */
export function agentDeletionBlockers(features: Feature[], agentIds: string[]): string[] {
  const ids = new Set(agentIds),
    blockers = new Set<string>();
  for (const root of features) {
    if (root.status === 'completed') continue;
    for (const feature of allFeatures([root])) {
      const steps = [
        ...configurationSteps(feature.steps),
        ...configurationSteps(feature.pendingTeam?.steps ?? []),
        ...(feature.teamHistory ?? []).flatMap((history) => configurationSteps(history.steps)),
      ];
      if (
        steps.some((step) => ids.has(step.agentId)) ||
        feature.steps.some((step) =>
          step.attempts.some(
            (attempt) => attempt.profileSnapshot && ids.has(attempt.profileSnapshot.agentId),
          ),
        )
      )
        blockers.add(root.title);
    }
  }
  return [...blockers];
}
