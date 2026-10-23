/** Portable declarations only. Host identity and browser authority never come from imported JSON. */
export type NavigationActor =
  | { kind: 'human' }
  | { kind: 'navigator'; agentId: string; attemptId: string; applicationId: string };
export type NavigationLocator = {
  strategy: 'testId' | 'role' | 'label' | 'text' | 'css';
  value: string;
  name?: string;
  frame?: string;
  tab?: number;
};
export type NavigationCondition = {
  kind: 'visible' | 'hidden' | 'text' | 'url';
  target?: NavigationLocator;
  value?: string;
};
export type NavigationValue = { literal: string } | { parameter: string };
export type NavigationStep = {
  id: string;
  action:
    | 'navigate'
    | 'click'
    | 'fill'
    | 'select'
    | 'check'
    | 'press'
    | 'scroll'
    | 'viewport'
    | 'wait'
    | 'manual';
  target?: NavigationLocator;
  url?: string;
  value?: NavigationValue;
  key?: string;
  checked?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  note?: string;
  timeoutMs?: number;
  postconditions?: NavigationCondition[];
  effect?: 'read' | 'write' | 'unknown';
};
export interface ApplicationProfile {
  id: string;
  name: string;
  projectIds: string[];
  origin: string;
  allowedOrigins: string[];
  authenticationOrigins?: string[];
  ownerNavigatorId?: string;
  role?: string;
  authInstructions?: string;
  interactionPolicy: 'inspect' | 'confirm' | 'authorized';
  browserExecutable?: string;
  createdAt: string;
  updatedAt: string;
}
export interface NavigationParameter {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  sensitive?: boolean;
  defaultValue?: string;
}
export interface NavigationJourney {
  id: string;
  applicationId: string;
  revision: number;
  hash?: string;
  parentHash?: string;
  title: string;
  intent: string;
  tags: string[];
  prerequisites: string[];
  parameters: NavigationParameter[];
  steps: NavigationStep[];
  arrival: NavigationCondition[];
  status: 'draft' | 'available' | 'archived';
  provenance: {
    mode: 'description' | 'import' | 'demonstration' | 'human';
    source?: string;
    notes?: string;
    author?: NavigationActor;
    verifiedRunId?: string;
  };
  variantOf?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ExecutionBinding {
  applicationId: string;
  origin: string;
  projectIds: string[];
  roots: string[];
  worktree?: string;
  commit?: string;
  dirty?: boolean;
  verification: 'declared' | 'verified' | 'unknown';
  reason: string;
  build?: string;
}
export interface NavigationRun {
  id: string;
  journeyId: string;
  revision: number;
  definitionHash: string;
  applicationId: string;
  mode: 'reach' | 'reproduce' | 'verify';
  status: 'running' | 'succeeded' | 'failed' | 'interrupted';
  startedAt: string;
  finishedAt?: string;
  arrivalVerified: boolean;
  prerequisitesConfirmed: boolean;
  binding: ExecutionBinding;
  events: {
    stepId: string;
    status: 'succeeded' | 'failed' | 'interrupted';
    message?: string;
    at: string;
  }[];
  evidencePaths: string[];
  error?: string;
  metrics: { actions: number; durationMs: number; outputChars: number; providerCalls: number };
}
export interface NavigationContribution {
  id: string;
  journeyId: string;
  revision: number;
  observation: string;
  proposal?: string;
  attemptId?: string;
  author: string;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
}
export interface BrowserInspection {
  sourceMaps?: NavigationSourceMap[];
  url: string;
  title: string;
  observedAt: string;
  text: string;
  elements: {
    tag: string;
    role?: string;
    name: string;
    selector?: string;
    rect?: { x: number; y: number; width: number; height: number };
    styles?: Record<string, string>;
  }[];
  resources: string[];
  truncated: boolean;
  screenshotPath?: string;
}
export interface BrowserSessionState {
  id: string;
  applicationId: string;
  state: 'idle' | 'agent' | 'recording' | 'human' | 'stopping' | 'interrupted' | 'closed';
  generation: number;
  url?: string;
  actor?: string;
  recordedSteps: NavigationStep[];
  recordingPaused: boolean;
  recordingActive?: boolean;
  warnings: string[];
}
export interface NavigationSnapshot {
  evaluation?: import('./navigationEvaluation').NavigationEvaluationSnapshot;
  metrics?: import('./navigationMetrics').NavigationMetrics;
  navigationVersion: 1;
  applications: ApplicationProfile[];
  journeys: NavigationJourney[];
  contributions: NavigationContribution[];
  runs: NavigationRun[];
  browser?: BrowserSessionState;
  inspection?: BrowserInspection;
  captures?: NavigationCapture[];
  codeAnchors?: CodeAnchor[];
  revisions?: NavigationJourney[];
  error?: string;
  notice?: string;
}
export interface NavigationSearchResult {
  id: string;
  revision: number;
  title: string;
  intent: string;
  status: NavigationJourney['status'];
  score: number;
  reasons: string[];
  prerequisites: string[];
}
export interface NavigationContextPacket {
  refs: { id: string; revision: number; hash: string }[];
  text: string;
  chars: number;
  omitted: number;
  hash: string;
}
export type NavigationCommand =
  | import('./navigationEvaluation').NavigationEvaluationCommand
  | { action: 'load' | 'authenticate' | 'resumeControl' | 'exportMetrics' }
  | { action: 'history'; journeyId: string }
  | { action: 'sourceSearch'; query: string; projectId?: string; directory?: string }
  | { action: 'resolveContribution'; id: string; status: 'accepted' | 'dismissed' }
  | { action: 'saveApplication'; application: ApplicationProfile }
  | { action: 'saveDraft'; journey: NavigationJourney; expectedRevision: number }
  | { action: 'commit' | 'archive'; journeyId: string; expectedRevision: number; runId?: string }
  | { action: 'import'; applicationId: string; json: string }
  | { action: 'describe'; applicationId: string; description: string; title?: string }
  | { action: 'prepare'; applicationId: string }
  | {
      action: 'replay';
      journeyId: string;
      parameters: Record<string, string>;
      mode: 'reach' | 'reproduce' | 'verify';
      confirmInteractions: boolean;
      prerequisitesConfirmed: boolean;
    }
  | { action: 'recordStart'; applicationId: string }
  | {
      action:
        | 'recordPause'
        | 'recordResume'
        | 'recordCancel'
        | 'takeControl'
        | 'stop'
        | 'closeBrowser';
    }
  | { action: 'recordFinish'; title: string; intent: string; arrival: NavigationCondition[] }
  | { action: 'inspect'; target?: NavigationLocator }
  | { action: 'capture' }
  | { action: 'contribute'; contribution: NavigationContribution }
  | { action: 'export'; journeyId: string }
  | { action: 'openSource'; relativePath: string; projectId: string };
export const NAVIGATION_LIMITS = {
  importBytes: 2 * 1024 * 1024,
  steps: 80,
  stringChars: 4000,
  depth: 20,
  searchChars: 6000,
  contextChars: 12000,
  observationChars: 6000,
  stepTimeoutMs: 15000,
  replayTimeoutMs: 180000,
} as const;
export interface NavigationSelection {
  applicationId: string;
  journeyId?: string;
  revision?: number;
  parameters: Record<string, string>;
  intent: 'reach-state' | 'reproduce';
  allowInteractions: boolean;
  prerequisitesConfirmed?: boolean;
}
export interface NavigationContextSnapshot {
  selection: NavigationSelection;
  journey?: NavigationJourney;
  application: ApplicationProfile;
  binding?: ExecutionBinding;
  contextText: string;
  digest: string;
}

export interface NavigationCapture {
  role?: string;
  binding?: ExecutionBinding;
  browser?: string;
  previewUrl?: string;
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  url: string;
  createdAt: string;
  applicationId: string;
  journeyId?: string;
  revision?: number;
  attemptId?: string;
  viewport?: { width: number; height: number };
}
export interface CodeAnchor {
  id: string;
  applicationId: string;
  projectId: string;
  relativePath: string;
  line: number;
  hash: string;
  query: string;
  reason: string;
  state: 'candidate' | 'corroborated' | 'stale';
  observedAt: string;
}

export interface NavigationSourceMap {
  bundleUrl: string;
  bundleHash?: string;
  sourceMapUrl: string;
  sources: string[];
  file?: string;
  state: 'candidate';
  reason: string;
}
