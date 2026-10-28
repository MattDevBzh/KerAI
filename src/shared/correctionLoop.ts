/** Frozen by a human configuration gesture; observations never approve work. */
export interface ScopedCorrectionCommand {
  projectId?: string;
  id: string;
  name: string;
  command: string;
  args: string[];
  quality?: { kind: 'visual' | 'counterexample'; reportPath: string };
}
export interface CorrectionContract {
  id: string;
  createdAt: string;
  fingerprint: string;
  workflowFingerprint: string;
  description: string;
  criteria: { id: string; text: string }[];
  correctionStepId?: string;
  reviewStepId?: string;
  commands: ScopedCorrectionCommand[];
}
export interface CorrectionProblem {
  key: string;
  message: string;
}
export interface CorrectionObservation {
  id: string;
  stepId: string;
  attemptId: string;
  evidenceIds: string[];
  workspaceFingerprint?: string;
  checkKey: string;
  kind: 'review' | 'test';
  problems: CorrectionProblem[];
  resolved: string[];
  persistent: string[];
  introduced: string[];
  stagnantCycles: number;
}
export interface CorrectionLoopState {
  contract: CorrectionContract;
  observations: CorrectionObservation[];
  stagnantCycles: number;
  pause?: 'contract_changed' | 'stagnation' | 'oscillation' | 'history_limit';
  readiness: 'unverified' | 'issues' | 'ready_for_human';
}
