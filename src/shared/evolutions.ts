/** User-owned configuration. Credentials are resolved only in the extension host. */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args: string[];
  url?: string;
  envKeys: string[];
  /** HTTP header name -> SecretStorage/environment key, never the header value. */
  headers: Record<string, string>;
  tools: string[];
  autoApproveReadOnly: boolean;
  enabled: boolean;
}
export interface McpCatalog {
  state: 'checking' | 'ready' | 'error';
  tools: { name: string; description: string }[];
  error?: string;
  checkedAt?: string;
}
export interface RunLaunchOptions {
  contextSummary?: ContextSummary;
  navigation?: import('./navigation').NavigationSelection;
  /** Explicitly omit the session navigation for this launch. */
  omitNavigation?: boolean;
  permissionMode?: import('./native').NativePermissionMode;
  pair?: import('./pair').PairPreferences;
  devopsTest?: import('./devopsKit').DevOpsTestTarget;
  initialContext: string;
  mcpServerIds: string[];
  memoryIds: string[];
  useProjectMemory: boolean;
  /** Omitted: follow the agent's default. Only optional context blocks are affected. */
  contextMode?: 'all' | 'empty';
  contextBlocks?: Record<string, { enabled?: boolean; content?: string }>;
  editableExistingFiles?: string[];
}
export interface PromptSection {
  compacted?: boolean;
  id: string;
  label: string;
  source: 'human' | 'agent' | 'skill' | 'artifact' | 'memory' | 'system';
  content: string;
  enabled?: boolean;
  editable?: boolean;
  originalContent?: string;
  unavailable?: boolean;
}
export interface RunPreview {
  compaction?: { characters: number; calls: number };
  featureId: string;
  stepId: string;
  fingerprint: string;
  prompt: string;
  sections: PromptSection[];
  characters: number;
  estimatedTokens: number;
  maxCharacters: number;
  errors: string[];
  resumesSession?: boolean;
  existingChanges?: { files: { path: string; reason?: string }[]; omittedCount: number };
}
export interface ContextSummary {
  content: string;
  sources: { id: string; digest: string }[];
  discussionId: string;
}
export interface HumanRequest {
  id: string;
  featureId: string;
  stepId: string;
  kind: 'question' | 'mcp-permission' | 'native-permission';
  permissionKind?: string;
  question: string;
  choices?: string[];
  allowFreeform: boolean;
  details?: string;
}
export type ModelProfile = 'current' | 'economy' | 'balanced' | 'quality';
export interface FeatureBudget {
  /** 0 means no call limit. Autopilot has its own finite limit. */
  maxRuns: number;
  maxTokens?: number;
  maxNanoAiu?: number;
  maxPromptChars: number;
  modelProfile: ModelProfile;
}
export interface UsageTotals {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  nanoAiu: number;
  unknownTokenRuns: number;
  unknownCostRuns: number;
}
export interface AutopilotConfig {
  /** Existing configurations retain automatic recommendations unless explicitly disabled. */
  autoAnswerRecommended?: boolean;
  correctionLoop?: { maxStagnantCycles: number };
  checkpoints: string[];
  maxRuns: number;
  maxCorrectionCycles: number;
  reviewStepId?: string;
  correctionStepId?: string;
  stepInputs: Record<string, RunLaunchOptions>;
}
export interface AutopilotDecision {
  at: string;
  kind: 'run' | 'approve' | 'correct' | 'pause' | 'complete' | 'configure' | 'resume' | 'answer';
  stepId?: string;
  message: string;
  runs: number;
  correctionCycles: number;
}
export interface AutopilotAnswer {
  at: string;
  stepId: string;
  attemptId: string;
  questionId: string;
  question: string;
  answer: string;
}
export interface AutopilotPreview {
  featureId: string;
  next: string;
  remainingRuns: number;
  remainingCorrections: number;
  errors: string[];
  steps: { id: string; name: string; notes: string[] }[];
}
export interface AutopilotState extends AutopilotConfig {
  correctionLoopHistory?: import('./correctionLoop').CorrectionLoopState[];
  correctionLoopState?: import('./correctionLoop').CorrectionLoopState;
  decisions?: AutopilotDecision[];
  automaticAnswers?: AutopilotAnswer[];
  /** Only an interaction pause may resume after a reply; cleared on manual pause/reload. */
  resumeAfterInteraction?: boolean;
  status: 'idle' | 'running' | 'paused' | 'completed';
  runs: number;
  correctionCycles: number;
  reason?: string;
  updatedAt: string;
}
export interface TestEvidence {
  /** Host-verified native shell receipt matched to a configured test command. */
  native?: {
    activityId: string;
    sessionId: string;
    snapshot: string;
    verification: 'runtime' | 'host-recheck';
  };
  projectId?: string;
  devops?: import('./devopsKit').DevOpsEvidence;
  quality?: import('./quality').QualityEvidence;
  id: string;
  source: 'host';
  commandId: string;
  name: string;
  command: string;
  args: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  error?: string;
  fileHashes: Record<string, string>;
}
export interface ReviewReport {
  verdict: 'pass' | 'changes_requested';
  summary: string;
  findings: {
    id: string;
    severity: 'info' | 'warning' | 'blocking';
    message: string;
    file?: string;
    line?: number;
  }[];
}
export interface AcceptanceCriterion {
  id: string;
  text: string;
  status: 'pending' | 'passed' | 'failed';
  evidence: string;
}
export interface ReviewComment {
  /** Incremented when resolving/reopening so an old acceptance cannot cover a reopened remark. */
  revision?: number;
  id: string;
  stepId: string;
  attemptId: string;
  file?: string;
  line?: number;
  text: string;
  blocking: boolean;
  resolved: boolean;
  createdAt: string;
}
export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  category: 'convention' | 'architecture' | 'decision' | 'context';
  enabled: boolean;
  agentIds: string[];
  updatedAt: string;
  source?: { featureId: string; stepId: string; attemptId: string; revision?: number };
}
