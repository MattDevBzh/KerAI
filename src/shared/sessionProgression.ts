import type { Feature, RunLaunchOptions, AutopilotConfig } from './types';
import { defaultPairPreferences } from './pair';
export type SessionProgression = 'guided' | 'balanced';
/** Custom teams stop before the first writing stage and at the final stage. */
export function progressionCheckpoints(feature: Feature, mode: SessionProgression): string[] {
  if (mode === 'guided') return feature.steps.map((step) => step.id);
  const firstWrite = feature.steps.findIndex((step) => step.policy !== 'read-only');
  const explicit = feature.steps
    .filter(
      (step) =>
        step.id === 'plan' ||
        step.agentId.includes('plan') ||
        step.id === 'review' ||
        step.agentId.includes('review'),
    )
    .map((step) => step.id);
  if (firstWrite > 0) explicit.push(feature.steps[firstWrite - 1].id);
  if (feature.steps.length) explicit.push(feature.steps.at(-1)!.id);
  return [...new Set(explicit)];
}
export function sessionLaunch(feature: Feature, stepId: string, pair = false): RunLaunchOptions {
  const step = feature.steps.find((s) => s.id === stepId)!;
  return {
    initialContext: step.initialContext ?? '',
    mcpServerIds: step.mcpServerIds ?? [],
    memoryIds: [],
    useProjectMemory: false,
    permissionMode: feature.execution?.permissionMode ?? 'manual',
    ...(pair ? { pair: { ...defaultPairPreferences } } : {}),
    ...(feature.navigation ? { navigation: feature.navigation } : {}),
  };
}
export function progressionConfig(feature: Feature, mode: SessionProgression): AutopilotConfig {
  return {
    checkpoints: progressionCheckpoints(feature, mode),
    maxRuns: Math.max(1, feature.steps.length),
    maxCorrectionCycles: 0,
    autoAnswerRecommended: false,
    stepInputs: Object.fromEntries(feature.steps.map((s) => [s.id, sessionLaunch(feature, s.id)])),
  };
}
