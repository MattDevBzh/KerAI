/** Structured runner output is evidence from an approved local process, never human acceptance. */
export type QualityKind = 'visual' | 'counterexample';
export interface QualityCommandConfig {
  kind: QualityKind;
  reportPath: string;
}
export interface QualityCase {
  id: string;
  title: string;
  criterionIds: string[];
  status: 'passed' | 'failed' | 'skipped';
  steps: string[];
  errors: string[];
  expected?: string;
  actual?: string;
  reproduction?: string[];
  attachmentIds: string[];
}
export interface QualityAttachment {
  id: string;
  name: string;
  kind: 'screenshot' | 'trace';
  mime: 'image/png' | 'image/jpeg' | 'application/zip';
  sizeBytes: number;
  sha256: string;
}
export interface QualityEvidence {
  version: 1;
  kind: QualityKind;
  featureId: string;
  attemptId: string;
  commandId: string;
  evidenceId: string;
  collectedAt: string;
  status: 'passed' | 'failed' | 'incomplete' | 'unavailable' | 'invalid';
  runner?: string;
  reportPath: string;
  reportSha256?: string;
  error?: string;
  cases: QualityCase[];
  attachments: QualityAttachment[];
}
