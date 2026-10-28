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
  | 'skipped'
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
  subplan?: import('./subplans').SubplanConfig;
  /** Resolve the agent profile at launch; only model/reasoning are member overrides. */
  inheritAgent?: boolean;
  optional?: boolean;
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
  /** 0 means no limit on user-requested attempts. */
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
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
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
  taskBoard?: import('./taskBoard').TaskBoard;
  navigationRequest?: {
    id: string;
    applicationId: string;
    reason: string;
    observations: string;
    createdAt: string;
    navigatorFeatureId?: string;
  };
  navigation?: import('./navigation').NavigationContextSnapshot;
  navigationRuns?: import('./navigation').NavigationRun[];
  navigationCaptures?: import('./navigation').NavigationCapture[];
  proofClaims?: import('./proofs').ProofClaim[];
  nativeActivity?: import('./native').NativeActivity[];
  nativeContextLoads?: import('./native').NativeContextLoad[];
  pair?: import('./pair').PairState;
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
  reviewAcceptance?: import('./reviewApproval').ReviewAcceptance;
  revision?: number;
  approvedBy?: 'human' | 'autopilot';
  checkpointBeforeId?: string;
  checkpointAfterId?: string;
}
export interface FeatureStep extends WorkflowStep {
  subplanState?: import('./subplans').SubplanState;
  awaitsCorrection?: boolean;
  optionalDecision?: { id: string; action: 'run' | 'skip'; at: string; author: 'human' };
  optionalDecisionHistory?: NonNullable<FeatureStep['optionalDecision']>[];
  status: StepStatus;
  attempts: Attempt[];
}
export interface Feature {
  navigation?: import('./navigation').NavigationSelection;
  proofChecks?: Record<string, import('./proofs').ProofCheck>;
  images?: import('./images').ImageAttachment[];
  parent?: { featureId: string; stepId: string; iterationId: string };
  pendingTeam?: { expectedRevision: number; steps: WorkflowStep[] };
  teamHistory?: { revision: number; at: string; steps: WorkflowStep[] }[];
  execution?: import('./native').NativeExecution;
  optionalRequest?: { id: string; stepId: string; stateKey: string };
  ticketSource?: import('./devopsTickets').TicketSourceSnapshot;
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
  reasoning?: string;
  policy?: PolicyProfile;
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
  vision?: boolean;
  id: string;
  name: string;
  multiplier?: number;
  reasoningEfforts?: string[];
}
export interface RuntimeStatus {
  native?: import('./native').NativeCapabilities;
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
  navigation?: import('./navigation').NavigationSnapshot;
  projectCatalog?: import('./projects').ProjectCatalogState;
  favoriteAgentIds?: string[];
  profileDirectories?: { user: string; workspace: string };
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
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
  | { type: 'resyncState' }
  | { type: 'navigationIntervention'; featureId: string; stepId: string; attemptId: string }
  | { type: 'openNavigationCapture'; featureId: string; captureId: string }
  | { type: 'navigation'; requestId: string; command: import('./navigation').NavigationCommand }
  | import('./pair').PairAction
  | import('./statistics').StatsClientMessage
  | { type: 'refreshSecretThemes' }
  | { type: 'unlockDragonBall'; sequence: readonly string[]; requestId: string }
  | import('./dashboard').DashboardClientMessage
  | { type: 'refreshQuests' }
  | { type: 'refreshRewards' }
  | {
      type: 'setReward';
      rewardId: import('./rewards').RewardId;
      enabled: boolean;
      requestId: string;
    }
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
  | { type: 'setLivingHq'; enabled: boolean; requestId: string }
  | { type: 'hqWindow'; action: 'detach' | 'fullscreen'; requestId: string }
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
        | 'manageWorkspaceTrust'
        | 'installKit'
        | 'migrateUserKit'
        | 'openSettings';
    }
  | {
      type: 'createFeature';
      images?: import('./images').ImageAttachment[];
      permissionMode?: import('./native').NativePermissionMode;
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
      type: 'resolveOptionalStep';
      requestId?: string;
      featureId: string;
      stepId: string;
      expectedStateKey: string;
      decisionId?: string;
      choice: 'run' | 'skip';
      continueAutopilot?: boolean;
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
  | { type: 'setPermissionMode'; featureId: string; mode: import('./native').NativePermissionMode }
  | { type: 'testMcp'; serverId: string }
  | { type: 'setMcpSecret'; serverId: string; key: string; value: string }
  | { type: 'cancelRun'; featureId: string }
  | {
      type: 'approveStep';
      featureId: string;
      stepId: string;
      expectedAttemptId?: string;
      expectedRevision?: number;
      expectedReviewWarningsKey?: string;
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
  | {
      type: 'manageSessions';
      requestId: string;
      action: import('./sessionList').SessionBatchAction;
      featureIds: string[];
    }
  | { type: 'openDiff'; path: string; featureId?: string }
  | { type: 'openFile'; path: string; featureId?: string }
  | { type: 'openPersonalReviewReport'; sessionId: string }
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
      type: 'saveProofClaim';
      featureId: string;
      stepId: string;
      attemptId: string;
      requestId: string;
      revision: number;
      claimId?: string;
      claim: Pick<import('./proofs').ProofClaim, 'text' | 'proofIds' | 'verdict'>;
    }
  | { type: 'checkProofDossier' | 'exportProofDossier'; featureId: string; requestId: string }
  | {
      type: 'exportAgentReport';
      format?: import('./documentation').DocumentFormat;
      requestId: string;
      featureId: string;
      stepId: string;
      attemptId: string;
      revision: number;
    }
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
        reasoning?: string;
        policy?: PolicyProfile;
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
  | { type: 'saveAutopilot'; featureId: string; config: AutopilotConfig; requestId?: string }
  | { type: 'previewAutopilot'; featureId: string; requestId: string }
  | { type: 'startAutopilot' | 'pauseAutopilot'; featureId: string }
  | { type: 'saveBudget'; featureId: string; budget: FeatureBudget }
  | { type: 'saveCriteria'; featureId: string; criteria: AcceptanceCriterion[] }
  | {
      type: 'addReviewComment';
      featureId: string;
      comment: Omit<ReviewComment, 'id' | 'createdAt' | 'resolved' | 'revision'>;
    }
  | { type: 'resolveReviewComment'; featureId: string; commentId: string; resolved: boolean }
  | { type: 'saveMemory'; entry: MemoryEntry }
  | { type: 'deleteMemory'; id: string };
export type HostMessage =
  | { type: 'autopilotSaved'; requestId: string; error?: string }
  | {
      type: 'autopilotPreview';
      requestId: string;
      preview?: import('./evolutions').AutopilotPreview;
      error?: string;
    }
  | {
      type: 'navigationState';
      state: import('./navigation').NavigationSnapshot;
      requestId?: string;
      error?: string;
      message?: string;
    }
  | {
      type: 'pairActionResult';
      requestId: string;
      featureId: string;
      stepId: string;
      error?: string;
    }
  | import('./statistics').StatsHostMessage
  | { type: 'secretThemeState'; dragonBallUnlocked: boolean; requestId?: string; error?: string }
  | { type: 'optionalStepResult'; requestId: string; error?: string }
  | import('./dashboard').DashboardHostMessage
  | { type: 'accountCredits'; state: import('./credits').AccountCredits }
  | { type: 'questState'; state: import('./quests').QuestState; earned?: string[] }
  | {
      type: 'rewardState';
      state: import('./rewards').RewardState;
      requestId?: string;
      error?: string;
    }
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
  | { type: 'livingHqState'; enabled: boolean; requestId?: string; error?: string }
  | { type: 'zoomState'; zoom: ZoomPreference; requestId?: string; error?: string }
  | { type: 'themeState'; theme: ThemeId; requestId?: string; error?: string }
  | ({ type: 'profileSaveResult'; requestId: string; error?: string } & Partial<
      import('./profiles').ProfileSaveResult
    >)
  | { type: 'devopsState'; state: DevOpsState }
  | import('./stateTransfer').StateTransfer
  | { type: 'hqWindowResult'; requestId: string; error?: string }
  | { type: 'error'; message: string; requestId?: string }
  | { type: 'notice'; message: string }
  | { type: 'proofDossierResult'; requestId: string; error?: string; notice?: string }
  | { type: 'agentReportExported'; requestId: string; cancelled?: boolean; error?: string }
  | ({ type: 'sessionBatchResult' } & import('./sessionList').SessionBatchResult)
  | { type: 'sessionBatchProgress'; requestId: string; completed: number; total: number }
  | { type: 'runPreview'; requestId: string; preview: RunPreview }
  | {
      type: 'stepApprovalResult';
      featureId: string;
      stepId: string;
      attemptId?: string;
      error?: string;
    }
  | { type: 'checkpointComparison'; requestId: string; comparison: CheckpointComparison }
  | {
      type: 'navigate';
      view:
        | 'create'
        | 'dashboard'
        | 'sessions'
        | 'observation'
        | 'devops-prs'
        | 'devops-tickets'
        | 'devops';
      featureId?: string;
      stepId?: string;
    };
export interface RunInput {
  navigation?: import('./navigation').NavigationContextSnapshot;
  images?: import('./images').ImageAttachment[];
  nativeReadOnly?: boolean;
  previousEventIds?: string[];
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
  /** Runtime validates the selected model before any optional browser image is sent. */
  validateModelImages?(images: import('./images').ImageAttachment[]): void;
  onTaskBoard?(
    update: import('./taskBoard').TaskBoardUpdate,
  ): Promise<import('./taskBoard').TaskBoard>;
  navigationBlocked?(): boolean;
  onNavigationRequest?(request: { reason: string; observations: string }): Promise<void>;
  onNavigationRun?(run: import('./navigation').NavigationRun): Promise<void>;
  onNavigationCapture?(capture: import('./navigation').NavigationCapture): Promise<void>;
  getProofs?(): import('./proofs').ProofEntry[];
  onProofClaim?(
    claim: Pick<import('./proofs').ProofClaim, 'id' | 'text' | 'proofIds' | 'verdict'>,
  ): Promise<import('./proofs').ProofClaim>;
  onPromptSending?(): void;
  onPromptSent?(): void;
  onNativeMessage?(message: {
    id: string;
    kind: 'text' | 'reasoning';
    content: string;
    at: string;
    complete: boolean;
  }): void;
  onNativeEventId?(id: string): void;
  onNativeMessageReceived?(id: string): void;
  onNativeActivity?(activity: import('./native').NativeActivity): void;
  onNativeToolStart?(tool: string, args: unknown): Promise<void>;
  onNativeContextLoad?(load: import('./native').NativeContextLoad): void;
  onNativePermission?(
    request: import('./native').NativePermissionPrompt,
  ): Promise<import('./native').NativePermissionAnswer>;
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
  sendMessage?(
    sessionId: string,
    content: string,
    images?: import('./images').ImageAttachment[],
  ): Promise<string | undefined>;
  setPermissionMode?(
    sessionId: string,
    mode: import('./native').NativePermissionMode,
  ): Promise<void>;
  deleteSessions?(ids: string[]): Promise<void>;
  check(): Promise<RuntimeStatus>;
  run(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal): Promise<RunResult>;
  dispose(): Promise<void>;
  discoverMcp?(server: McpServerConfig): Promise<McpCatalog>;
}
