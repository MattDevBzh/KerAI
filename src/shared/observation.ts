import type { Usage } from './types';

export const DEFAULT_TRACE_BYTES = 256 * 1024 * 1024;
export interface SessionTrace {
  id: string;
  at: string;
  type: string;
  stepId?: string;
  attemptId?: string;
  agentId?: string;
  data: string;
}
export interface TraceArchiveInfo {
  bytes: number;
  records: number;
  complete: boolean;
  reason?: string;
}
export interface ObservationFinding {
  kind: 'fact' | 'interpretation' | 'recommendation';
  title: string;
  detail: string;
  impact: 'high' | 'medium' | 'low';
  references: string[];
}
export interface ObservationAnalysis {
  summary: string;
  strengths: string[];
  findings: ObservationFinding[];
}
export interface ObservationPhase {
  stepId: string;
  name: string;
  agent: string;
  status: string;
  attempts: number;
  durationMs: number;
  usage?: Usage;
  models: string[];
  analyzedParts: number;
  totalParts: number;
  analyses: ObservationAnalysis[];
}
export interface ObservationCall {
  sessionId?: string;
  id: string;
  phaseId?: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  model?: string;
  usage?: Usage;
  error?: string;
}
export interface SessionObservation {
  id: string;
  createdAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  featureTitle: string;
  snapshotKey: string;
  dossierHash?: string;
  snapshotStateKey?: string;
  requestedModel: string;
  maxCalls: number;
  maxNanoAiu?: number;
  coverage: { complete: boolean; warnings: string[]; analyzedParts: number; totalParts: number };
  phases: ObservationPhase[];
  calls: ObservationCall[];
  global?: ObservationAnalysis;
  error?: string;
  /** Host-owned sources frozen when the review starts. */
  sourceIndex: { id: string; label: string; stepId?: string; attemptId?: string }[];
}
export interface ObservationOptions {
  model: string;
  maxCalls: number;
  maxNanoAiu?: number;
}
export interface ObservationPreview {
  featureId: string;
  fingerprint: string;
  phases: number;
  parts: number;
  characters: number;
  warnings: string[];
  options: ObservationOptions;
}
export interface SessionStorageInfo {
  bytes: number;
  traces: TraceArchiveInfo;
  traceLimitBytes: number;
  sharedBytes: number;
}
export type ObservationClientMessage =
  | {
      type: 'previewObservation';
      featureId: string;
      requestId: string;
      options: ObservationOptions;
    }
  | { type: 'runObservation'; featureId: string; fingerprint: string; options: ObservationOptions }
  | { type: 'cancelObservation'; featureId: string }
  | {
      type: 'exportObservation';
      featureId: string;
      observationId: string;
      format: 'html' | 'markdown';
    }
  | {
      type: 'observationSource';
      featureId: string;
      observationId: string;
      sourceId: string;
      requestId: string;
      offset?: number;
    }
  | { type: 'sessionStorage'; featureId: string; requestId: string }
  | { type: 'deleteFeature'; featureId: string }
  | {
      type: 'sessionJournal';
      featureId: string;
      attemptId: string;
      requestId: string;
      offset?: number;
    };
export type ObservationHostMessage =
  | { type: 'observationPreview'; requestId: string; preview?: ObservationPreview; error?: string }
  | {
      type: 'observationSource';
      requestId: string;
      label?: string;
      content?: string;
      nextOffset?: number;
      error?: string;
    }
  | { type: 'sessionStorage'; requestId: string; storage?: SessionStorageInfo; error?: string }
  | {
      type: 'sessionJournal';
      requestId: string;
      traces?: SessionTrace[];
      nextOffset?: number;
      error?: string;
    }
  | { type: 'deleteFeatureResult'; featureId: string; freedBytes?: number; error?: string };
