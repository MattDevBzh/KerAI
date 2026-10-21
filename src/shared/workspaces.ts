export interface FeatureWorktree {
  ownerFeatureId?: string;
  path: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  createdAt: string;
}

export interface FeatureCheckpoint {
  projectId?: string;
  id: string;
  label: string;
  kind: 'before-run' | 'after-run' | 'manual' | 'recovery';
  createdAt: string;
  branch: string;
  head: string;
  stepId?: string;
  attemptId?: string;
  fileCount: number;
  totalBytes: number;
  excludedCount: number;
  excludedPaths: string[];
}

export interface CheckpointFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  beforeHash?: string;
  afterHash?: string;
  binary: boolean;
  restorable: boolean;
  reason?: string;
}

export interface CheckpointComparison {
  featureId: string;
  checkpointId: string;
  /** Undefined means the live feature workspace. */
  targetCheckpointId?: string;
  fingerprint: string;
  files: CheckpointFileChange[];
}
