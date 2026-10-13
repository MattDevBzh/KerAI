/** The human selects the tested revision and scope; model tools cannot change them. */
export interface DevOpsTestTarget {
  buildId: number;
  pipelineId: number;
  commit: string;
  branch: string;
  environment: string;
  isolationConfirmed: boolean;
  expectedStages: string[];
  expectedArtifacts: string[];
  requireTestResults: boolean;
}
export type DevOpsQuery =
  | { kind: 'pipelines'; continuationToken?: string }
  | { kind: 'pipeline'; pipelineId: number; revision?: number }
  | { kind: 'builds'; pipelineId: number; continuationToken?: string }
  | { kind: 'build' | 'timeline' | 'artifacts' | 'test-runs'; buildId: number };
export interface DevOpsObservation {
  kind: DevOpsQuery['kind'];
  projectKey: string;
  collectedAt: string;
  sourceUrl: string;
  data: Record<string, unknown>;
  truncated: boolean;
  continuationToken?: string;
}
export interface DevOpsVerification {
  target: DevOpsTestTarget;
  projectKey: string;
  buildUrl: string;
  collectedAt: string;
  status: 'passed' | 'failed' | 'incomplete';
  checks: { name: string; passed: boolean; detail: string }[];
  observations: DevOpsObservation[];
}
export interface DevOpsEvidence extends DevOpsVerification {
  featureId: string;
  attemptId: string;
}
export const needsDevOpsEvidence = (step: { agentId: string; requiredDevOpsEvidence?: boolean }) =>
  step.requiredDevOpsEvidence === true || step.agentId === 'fs-devops-validate';
