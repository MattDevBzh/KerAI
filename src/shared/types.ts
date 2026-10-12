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
}
export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  model?: string;
  source: 'bundled' | 'workspace';
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
  source: 'bundled' | 'workspace';
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
  schemaVersion: 1;
  workspace: { name: string; path: string; trusted: boolean; branch: string };
  features: Feature[];
  workflows: Workflow[];
  agents: AgentProfile[];
  skills: SkillInfo[];
  runtime: RuntimeStatus;
  settings: StudioSettings;
  notices: string[];
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
    }
  | { type: 'runStep'; featureId: string; stepId: string; feedback?: string; resume?: boolean }
  | { type: 'cancelRun'; featureId: string }
  | { type: 'approveStep'; featureId: string; stepId: string }
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
    }
  | { type: 'archiveFeature'; featureId: string; archived: boolean }
  | { type: 'openDiff'; path: string }
  | { type: 'openFile'; path: string }
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
  | { type: 'createWorkflow' };
export type HostMessage =
  | { type: 'state'; state: StudioState }
  | { type: 'error'; message: string }
  | { type: 'notice'; message: string }
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
}
export interface RunResult {
  content: string;
  sessionId?: string;
  model?: string;
  usage?: Usage;
  questions: Question[];
  changedFiles: string[];
  fileHashes?: Record<string, string>;
}
export interface RunCallbacks {
  onEvent(event: RunEvent): void;
  onSession(id: string): void;
}
export interface AgentAdapter {
  check(): Promise<RuntimeStatus>;
  run(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal): Promise<RunResult>;
  dispose(): Promise<void>;
}
