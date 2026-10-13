import type {
  McpServerConfig,
  McpCatalog,
  RunLaunchOptions,
  RunPreview,
  HumanRequest,
  FeatureBudget,
  AutopilotState,
  AutopilotConfig,
  TestEvidence,
  ReviewReport,
  AcceptanceCriterion,
  ReviewComment,
  MemoryEntry,
  ModelProfile,
} from './evolutions';
export * from './evolutions';
import type { FeatureWorktree, FeatureCheckpoint, CheckpointComparison } from './workspaces';
export * from './workspaces';
export type PolicyProfile = 'read-only' | 'workspace-write' | 'tests';
export type StepStatus =
  | 'pending'
  | 'running'
  | 'waiting_input'
  | 'awaiting_review'
  | 'approved'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'interrupted';
export type FeatureStatus = 'draft' | 'running' | 'attention' | 'completed';
export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  agentId: string;
  policy: PolicyProfile;
  model?: string;
  reasoning?: string;
  skills: string[];
  maxAttempts: number;
  artifact: string;
  dependsOn: string[];
  initialContext?: string;
  mcpServerIds?: string[];
  askBeforeRun?: boolean;
}
export interface Workflow {
  id: string;
  name: string;
  description: string;
  icon: string;
  steps: WorkflowStep[];
  source?: string;
}
export interface Question {
  id: string;
  text: string;
  choices?: string[];
}
export interface RunEvent {
  id: string;
  at: string;
  kind: 'info' | 'tool' | 'message' | 'warning' | 'error' | 'usage';
  message: string;
}
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  cost?: number;
  unit?: string;
  source: 'measured';
  incompleteTokens?: boolean;
  incompleteCost?: boolean;
}
export interface Artifact {
  name: string;
  content: string;
  updatedAt: string;
}
export interface Attempt {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: StepStatus;
  sessionId?: string;
  model?: string;
  feedback: string;
  logs: RunEvent[];
  artifact?: Artifact;
  questions: Question[];
  answers: Record<string, string>;
  changedFiles: string[];
  usage?: Usage;
  error?: string;
  approvedAt?: string;
  fileHashes?: Record<string, string>;
  launch?: RunLaunchOptions;
  promptFingerprint?: string;
  promptCharacters?: number;
  memorySnapshot?: MemoryEntry[];
  evidence?: TestEvidence[];
  review?: ReviewReport;
  revision?: number;
  approvedBy?: 'human' | 'autopilot';
  checkpointBeforeId?: string;
  checkpointAfterId?: string;
}
export interface FeatureStep extends WorkflowStep {
  status: StepStatus;
  attempts: Attempt[];
}
export interface Feature {
  id: string;
  title: string;
  description: string;
  workflowId: string;
  workflowName: string;
  createdAt: string;
  updatedAt: string;
  branch: string;
  status: FeatureStatus;
  activeStepId: string;
  steps: FeatureStep[];
  archived?: boolean;
  autopilot?: AutopilotState;
  budget?: FeatureBudget;
  criteria?: AcceptanceCriterion[];
  reviewComments?: ReviewComment[];
  worktree?: FeatureWorktree;
  checkpoints?: FeatureCheckpoint[];
  /** Latest file contents explicitly written by this feature or restored by its owner. */
  workspaceFileHashes?: Record<string, string>;
}
export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  model?: string;
  source: 'bundled' | 'user' | 'workspace';
  path: string;
  skills: string[];
  nickname?: string;
  avatar?: string;
}
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  content: string;
  path: string;
  source: 'bundled' | 'user' | 'workspace';
}
export interface TestCommand {
  id: string;
  name: string;
  command: string;
  args: string[];
}
export interface HookDefinition {
  id: string;
  name: string;
  event: 'beforeRun' | 'afterRun';
  command: string;
  args: string[];
  enabled: boolean;
}
export interface StudioSettings {
  defaultModel: string;
  timeoutMinutes: number;
  testCommands: TestCommand[];
  testPaths: string[];
  hooks: HookDefinition[];
  mcpServers?: McpServerConfig[];
  budgetDefaults?: FeatureBudget;
  modelProfiles?: Partial<
    Record<Exclude<ModelProfile, 'current'>, { model: string; reasoning?: string }>
  >;
}
export interface ModelInfo {
  id: string;
  name: string;
  multiplier?: number;
  reasoningEfforts?: string[];
}
export interface RuntimeStatus {
  state: 'unchecked' | 'checking' | 'ready' | 'unavailable';
  version?: string;
  authenticated?: boolean;
  account?: string;
  models: ModelInfo[];
  error?: string;
}
export interface StudioState {
  schemaVersion: 1 | 2 | 3;
  workspace: {
    name: string;
    path: string;
    trusted: boolean;
    branch: string;
    canIsolate?: boolean;
    isolationReason?: string;
  };
  features: Feature[];
  workflows: Workflow[];
  agents: AgentProfile[];
  skills: SkillInfo[];
  runtime: RuntimeStatus;
  settings: StudioSettings;
  notices: string[];
  mcpCatalogs?: Record<string, McpCatalog>;
  humanRequests?: HumanRequest[];
  memory?: MemoryEntry[];
  workspaceOperation?: { featureId?: string; label: string; readOnly?: boolean };
}
export type ClientMessage =
  | { type: 'ready' | 'refresh' | 'checkRuntime' | 'installKit' | 'openSettings' }
  | {
      type: 'createFeature';
      title: string;
      description: string;
      workflowId: string;
      agentId?: string;
      model?: string;
      isolated?: boolean;
    }
  | {
      type: 'runStep';
      featureId: string;
      stepId: string;
      feedback?: string;
      resume?: boolean;
      launch?: RunLaunchOptions;
      previewFingerprint?: string;
    }
  | {
      type: 'previewRun';
      requestId: string;
      featureId: string;
      stepId: string;
      feedback?: string;
      resume?: boolean;
      launch: RunLaunchOptions;
    }
  | { type: 'answerHumanRequest'; requestId: string; answer: string }
  | { type: 'testMcp'; serverId: string }
  | { type: 'setMcpSecret'; serverId: string; key: string; value: string }
  | { type: 'cancelRun'; featureId: string }
  | {
      type: 'approveStep';
      featureId: string;
      stepId: string;
      expectedAttemptId?: string;
      expectedRevision?: number;
    }
  | { type: 'answerQuestions'; featureId: string; stepId: string; answers: Record<string, string> }
  | { type: 'saveArtifact'; featureId: string; stepId: string; content: string }
  | {
      type: 'configureStep';
      featureId: string;
      stepId: string;
      agentId: string;
      model?: string;
      reasoning?: string;
      skills: string[];
      maxAttempts?: number;
      initialContext?: string;
      mcpServerIds?: string[];
      askBeforeRun?: boolean;
    }
  | { type: 'archiveFeature'; featureId: string; archived: boolean }
  | { type: 'openDiff'; path: string; featureId?: string }
  | { type: 'openFile'; path: string; featureId?: string }
  | { type: 'openFeatureWorkspace'; featureId: string }
  | { type: 'createCheckpoint'; featureId: string; label: string }
  | {
      type: 'compareCheckpoint';
      requestId: string;
      featureId: string;
      checkpointId: string;
      targetCheckpointId?: string;
    }
  | {
      type: 'openCheckpointDiff';
      featureId: string;
      checkpointId: string;
      targetCheckpointId?: string;
      path: string;
    }
  | {
      type: 'restoreCheckpoint';
      featureId: string;
      checkpointId: string;
      paths: string[];
      expectedFingerprint: string;
    }
  | { type: 'exportFeature'; featureId: string }
  | {
      type: 'saveAgent';
      agent: {
        id: string;
        name: string;
        description: string;
        instructions: string;
        tools: string[];
        model?: string;
        skills: string[];
        nickname?: string;
        avatar?: string;
      };
    }
  | { type: 'saveSkill'; id: string; content: string }
  | { type: 'saveSettings'; settings: StudioSettings }
  | { type: 'createWorkflow' }
  | { type: 'saveWorkflow'; workflow: Workflow }
  | { type: 'saveAutopilot'; featureId: string; config: AutopilotConfig }
  | { type: 'startAutopilot' | 'pauseAutopilot'; featureId: string }
  | { type: 'saveBudget'; featureId: string; budget: FeatureBudget }
  | { type: 'saveCriteria'; featureId: string; criteria: AcceptanceCriterion[] }
  | {
      type: 'addReviewComment';
      featureId: string;
      comment: Omit<ReviewComment, 'id' | 'createdAt' | 'resolved'>;
    }
  | { type: 'resolveReviewComment'; featureId: string; commentId: string; resolved: boolean }
  | { type: 'saveMemory'; entry: MemoryEntry }
  | { type: 'deleteMemory'; id: string };
export type HostMessage =
  | { type: 'state'; state: StudioState }
  | { type: 'error'; message: string }
  | { type: 'notice'; message: string }
  | { type: 'runPreview'; requestId: string; preview: RunPreview }
  | { type: 'checkpointComparison'; requestId: string; comparison: CheckpointComparison }
  | { type: 'navigate'; view: 'create' | 'dashboard'; featureId?: string };
export interface RunInput {
  feature: Feature;
  step: FeatureStep;
  attempt: Attempt;
  agent: AgentProfile;
  skills: SkillInfo[];
  workspacePath: string;
  settings: StudioSettings;
  resumeSessionId?: string;
  launch?: RunLaunchOptions;
  memory?: MemoryEntry[];
  preparedPrompt?: string;
  mcpServers?: McpServerConfig[];
  automation?: { reviewStepId?: string; correctionStepId?: string };
}
export interface RunResult {
  content: string;
  sessionId?: string;
  model?: string;
  usage?: Usage;
  questions: Question[];
  changedFiles: string[];
  fileHashes?: Record<string, string>;
  review?: ReviewReport;
}
export interface RunCallbacks {
  onEvent(event: RunEvent): void;
  onSession(id: string): void;
  /** Cumulative, deduplicated usage for this attempt, including runs that later fail. */
  onUsage?(usage: Usage): void;
  onEvidence?(evidence: TestEvidence): void;
  onQuestion?(question: {
    question: string;
    choices?: string[];
    allowFreeform: boolean;
  }): Promise<string>;
  onMcpPermission?(request: {
    serverId: string;
    toolName: string;
    args: string;
    readOnly: boolean;
  }): Promise<boolean>;
}
export interface AgentAdapter {
  check(): Promise<RuntimeStatus>;
  run(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal): Promise<RunResult>;
  dispose(): Promise<void>;
  discoverMcp?(server: McpServerConfig): Promise<McpCatalog>;
}
