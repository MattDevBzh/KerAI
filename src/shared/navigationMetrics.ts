import type { Feature, Usage } from './types';
import { allFeatures } from './subplans';
export interface NavigationPhaseMetrics {
  phase: 'learning-maintenance' | 'analysis' | 'development' | 'verification' | 'unclassified';
  attempts: number;
  failed: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
  unit?: string;
  apiDurationMs?: number;
  measuredAttempts: number;
  completeTokens: boolean;
  completeCost: boolean;
}
export interface NavigationMetrics {
  phases: NavigationPhaseMetrics[];
  gain: null;
  note: string;
}
/** Projection of the existing ledger. Never adds a second usage event or excludes failed attempts. */
export function navigationMetrics(features: Feature[]): NavigationMetrics {
  const phases = new Map<NavigationPhaseMetrics['phase'], NavigationPhaseMetrics>();
  for (const feature of allFeatures(features))
    for (const step of feature.steps)
      for (const attempt of step.attempts) {
        if (!attempt.navigation) continue;
        const agent = attempt.profileSnapshot?.agentId ?? step.agentId;
        const phase: NavigationPhaseMetrics['phase'] =
          agent === attempt.navigation.application.ownerNavigatorId
            ? 'learning-maintenance'
            : agent === 'fs-plan'
              ? 'analysis'
              : agent === 'fs-dev'
                ? 'development'
                : ['fs-tests', 'fs-visual-tests'].includes(agent)
                  ? 'verification'
                  : 'unclassified';
        let row = phases.get(phase);
        if (!row) {
          row = {
            phase,
            attempts: 0,
            failed: 0,
            measuredAttempts: 0,
            completeTokens: true,
            completeCost: true,
          };
          phases.set(phase, row);
        }
        row.attempts++;
        if (['failed', 'cancelled', 'interrupted'].includes(attempt.status)) row.failed++;
        const usage = attempt.usage;
        if (usage) row.measuredAttempts++;
        for (const key of [
          'inputTokens',
          'outputTokens',
          'cacheReadTokens',
          'cacheWriteTokens',
        ] as const)
          if (usage?.[key] !== undefined) row[key] = (row[key] ?? 0) + usage[key]!;
        if (usage?.durationMs !== undefined)
          row.apiDurationMs = (row.apiDurationMs ?? 0) + usage.durationMs;
        if (usage?.cost !== undefined && usage.unit) {
          if (!row.unit) row.unit = usage.unit;
          if (row.unit === usage.unit) row.cost = (row.cost ?? 0) + usage.cost;
          else {
            row.completeCost = false;
            row.unit = 'mixed';
            row.cost = undefined;
          }
        }
        if (
          !usage ||
          usage.inputTokens === undefined ||
          usage.outputTokens === undefined ||
          usage.incompleteTokens
        )
          row.completeTokens = false;
        if (!usage || usage.cost === undefined || !usage.unit || usage.incompleteCost)
          row.completeCost = false;
      }
  return {
    phases: [...phases.values()],
    gain: null,
    note: 'Usages fournisseur reçus dans les sessions, échecs inclus. Apprentissage et entretien non séparables automatiquement. Durée API distincte du temps humain. Aucun gain calculé sans campagne comparative.',
  };
}
