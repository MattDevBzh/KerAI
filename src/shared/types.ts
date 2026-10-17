import type { ZoomPreference } from './zoom';
import type { DevOpsClientMessage, DevOpsState } from './devops';
import type { ThemeId } from './themes';
export * from './themes';
export * from './devops';
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
export * from './collaboration';
export * from './observation';
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
export type FeatureStatus =
  | 'draft'
  | 'running'
  | 'attention'
  | 'awaiting_final_validation'
  | 'completed';
export interface WorkflowStep {
  requiredDevOpsEvidence?: boolean;
  requiredQuality?: import('./quality').QualityKind;
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
export interface AnsweredQuestion {
  question: Question;
  answer: string;
  origin: { stepId: string; attemptId: string };
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
  byModel?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
      incompleteTokens?: boolean;
      incompleteCost?: boolean;
    }
  >;
}
export interface Artifact {
  name: string;
  content: string;
  updatedAt: string;
}
export interface Attempt {
  /** Execution identity frozen at launch, independent from later step edits. */
  profileSnapshot?: {
    agentId: string;
    policy: PolicyProfile;
    skillIds: string[];
    modelOverride: boolean;
  };
  agentName?: string;
  traceArchive?: import('./observation').TraceArchiveInfo;
  /** Tone captured at launch; older attempts had roast disabled. */
  roastLevel?: import('./roast').RoastLevel;
  artifactVersions?: import('./collaboration').EditorialVersion[];
  descriptionRevision?: number;
  correctionId?: string;
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
  /** Answers remain bound to the exact question and the attempt that asked it. */
  answerBindings?: Record<string, AnsweredQuestion>;
  changedFiles: string[];
  usage?: Usage;
  error?: string;
  approvedAt?: string;
  fileHashes?: Record<string, string>;
  launch?: RunLaunchOptions;
  existingChangesBackup?: string;
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
  discussionId?: string;
  creationRequestId?: string;
  traceWarnings?: string[];
  observations?: import('./observation').SessionObservation[];
  projects?: import('./projects').FeatureProject[];
  teamRevision?: number;
  teamLockedAt?: string;
  descriptionRevision?: number;
  descriptionVersions?: import('./collaboration').EditorialVersion[];
  corrections?: import('./collaboration').CorrectionCycle[];
  activeCorrectionId?: string;
  finalValidation?: { id: string; at: string; stateKey: string; author: 'human' };
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
  revision?: string;
  targets?: Record<import('./profiles').ProfileScope, import('./profiles').ProfileTarget>;
  versions?: Omit<AgentProfile, 'versions' | 'targets'>[];
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
  emptyContextByDefault?: boolean;
  discussionAgent?: boolean;
  roastLevel?: import('./roast').RoastLevel;
}
export interface SkillInfo {
  revision?: string;
  targets?: Record<import('./profiles').ProfileScope, import('./profiles').ProfileTarget>;
  versions?: Omit<SkillInfo, 'versions' | 'targets'>[];
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
  quality?: import('./quality').QualityCommandConfig;
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
  traceLimitBytes?: number;
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
  cliPath?: string;
  cliSource?: 'configured' | 'path' | 'user-install';
  version?: string;
  authenticated?: boolean;
  account?: string;
  models: ModelInfo[];
  error?: string;
}
export interface StudioState {
  projectCatalog?: import('./projects').ProjectCatalogState;
  favoriteAgentIds?: string[];
  profileDirectories?: { user: string; workspace: string };
  schemaVersion: 1 | 2 | 3 | 4 | 5;
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
  | { type: 'refreshQuests' }
  | import('./observation').ObservationClientMessage
  | import('./projects').ProjectClientMessage
  | import('./collaboration').CollaborationClientMessage
  | import('./kits').KitClientMessage
  | DevOpsClientMessage
  | {
      type: 'saveFeatureTeam';
      featureId: string;
      requestId: string;
      expectedRevision: number;
      steps: WorkflowStep[];
    }
  | { type: 'setAgentFavorite'; agentId: string; favorite: boolean; requestId: string }
  | { type: 'setZoom'; zoom: ZoomPreference; requestId: string }
  | { type: 'setTheme'; theme: ThemeId; requestId: string }
  | { type: 'installQualityKit'; featureId?: string }
  | { type: 'openQualityAttachment'; featureId: string; evidenceId: string; attachmentId: string }
  | {
      type:
        | 'ready'
        | 'refresh'
        | 'checkRuntime'
        | 'autoDetectCli'
        | 'installKit'
        | 'migrateUserKit'
        | 'openSettings';
    }
  | {
      type: 'createFeature';
      requestId?: string;
      discussionId?: string;
      criteria?: string[];
      team?: import('./discussions').DiscussionFeatureMember[];
      projectIds?: string[];
      title: string;
      description: string;
      workflowId?: string;
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
  | ({ type: 'saveArtifact'; featureId: string; stepId: string; content: string } & Partial<
      import('./collaboration').EditorialSaveOptions
    >)
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
  | { type: 'openFeatureWorkspace'; featureId: string; projectId?: string }
  | { type: 'createCheckpoint'; featureId: string; label: string; projectId?: string }
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
      requestId: string;
      options: import('./profiles').ProfileSaveOptions;
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
        emptyContextByDefault?: boolean;
        discussionAgent?: boolean;
        roastLevel?: import('./roast').RoastLevel;
      };
    }
  | {
      type: 'saveSkill';
      id: string;
      content: string;
      requestId: string;
      options: import('./profiles').ProfileSaveOptions;
    }
  | { type: 'saveSettings'; settings: StudioSettings; projectId?: string }
  | { type: 'createWorkflow' }
  | { type: 'saveWorkflow'; workflow: Workflow }
  | { type: 'deleteWorkflow'; workflowId: string; requestId: string }
  | import('./discussions').DiscussionClientMessage
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
  | { type: 'accountCredits'; state: import('./credits').AccountCredits }
  | { type: 'questState'; state: import('./quests').QuestState; earned?: string[] }
  | import('./observation').ObservationHostMessage
  | import('./discussions').DiscussionHostMessage
  | { type: 'workflowDeleteResult'; requestId: string; error?: string; cancelled?: boolean }
  | { type: 'projectResult'; requestId: string; error?: string; message?: string }
  | {
      type: 'featureTeamResult';
      requestId: string;
      featureId: string;
      revision?: number;
      error?: string;
    }
  | { type: 'agentFavoriteResult'; requestId: string; error?: string }
  | { type: 'correctionResult'; featureId: string; correctionId?: string; error?: string }
  | {
      type: 'artifactSaveResult';
      featureId: string;
      stepId: string;
      attemptId?: string;
      revision?: number;
      error?: string;
    }
  | {
      type: 'featureFinalizationResult';
      featureId: string;
      finalizationId?: string;
      error?: string;
    }
  | import('./kits').KitHostMessage
  | { type: 'zoomState'; zoom: ZoomPreference; requestId?: string; error?: string }
  | { type: 'themeState'; theme: ThemeId; requestId?: string; error?: string }
  | ({ type: 'profileSaveResult'; requestId: string; error?: string } & Partial<
      import('./profiles').ProfileSaveResult
    >)
  | { type: 'devopsState'; state: DevOpsState }
  | { type: 'state'; state: StudioState }
  | { type: 'error'; message: string }
  | { type: 'notice'; message: string }
  | { type: 'runPreview'; requestId: string; preview: RunPreview }
  | {
      type: 'stepApprovalResult';
      featureId: string;
      stepId: string;
      attemptId?: string;
      error?: string;
    }
  | { type: 'checkpointComparison'; requestId: string; comparison: CheckpointComparison }
  | { type: 'navigate'; view: 'create' | 'dashboard' | 'observation'; featureId?: string };
export interface RunInput {
  observation?: boolean;
  /** Host-owned conversation mode: no repository, MCP, human-question or native tools. */
  mode?: 'discussion';
  projects?: import('./projects').RunProject[];
  devopsProjectKey?: string;
  feature: Feature;
  step: FeatureStep;
  attempt: Attempt;
  agent: AgentProfile;
  skills: SkillInfo[];
  workspacePath: string;
  qualityStoragePath?: string;
  settings: StudioSettings;
  resumeSessionId?: string;
  launch?: RunLaunchOptions;
  memory?: MemoryEntry[];
  preparedPrompt?: string;
  /** Verified by the host against the human-approved preview. Never supplied by model tools. */
  existingChangeGrants?: Record<string, string>;
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
  onTrace?(trace: import('./observation').SessionTrace): void;
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
  deleteSessions?(ids: string[]): Promise<void>;
  check(): Promise<RuntimeStatus>;
  run(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal): Promise<RunResult>;
  dispose(): Promise<void>;
  discoverMcp?(server: McpServerConfig): Promise<McpCatalog>;
}
