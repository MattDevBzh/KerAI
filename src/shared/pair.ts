import type { AgentProfile, FeatureStep, RunInput, StudioSettings, WorkflowStep } from './types';

export interface PairPreferences {
  pace: 'small' | 'blocks' | 'oneshot';
  explanation: 'concise' | 'detailed';
  instructions: string;
}
export const defaultPairPreferences: PairPreferences = {
  pace: 'blocks',
  explanation: 'detailed',
  instructions: '',
};
/** Included verbatim in the initial context preview and the first model call. */
export function pairPlanningContract(preferences: PairPreferences, native = false): string {
  return `Tu travailles en mode pair avec l’utilisateur sur cette étape. Présente-toi brièvement et propose une organisation courte, adaptée à la mission et aux préférences ${JSON.stringify(preferences)}. Attends son accord explicite avant le travail. Si une information manque, pose ta question dans la conversation. Pour proposer une organisation, termine par un seul bloc JSON feature-studio-pair-plan de forme {"summary":"Approche et points de contrôle","blocks":[{"id":"bloc_1","title":"Titre","description":"Travail précis et critère de fin"}]}. Avec le rythme oneshot, regroupe le travail dans un bloc après le cadrage. ${native ? 'Tu peux explorer le code avec les outils natifs de lecture autorisés ; aucune écriture, commande ni MCP ne sont disponibles avant accord.' : 'Pendant ce cadrage aucun outil, hook, accès au dépôt ou MCP n’est disponible.'} Les consignes de réalisation et de verdict présentes dans la mission s’appliqueront aux blocs d’exécution après validation. La proposition ne vaut jamais accord humain ; l’application contrôle les validations et les pauses.`;
}
export interface PairBlock {
  id: string;
  title: string;
  description: string;
  corrects?: string;
}
export interface PairPlan {
  revision: number;
  summary: string;
  blocks: PairBlock[];
  acceptedAt?: string;
}
export interface PairMessage {
  images?: import('./images').ImageAttachment[];
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: string;
  status: 'complete' | 'streaming' | 'interrupted';
  requestId?: string;
  kind?: 'text' | 'reasoning';
  delivery?: 'pending' | 'sent' | 'received' | 'uncertain' | 'skipped';
  nativeId?: string;
}
export type PairTurn = { kind: 'planning' | 'chat' | 'work' | 'solo'; blockId?: string };
export interface PairSnapshot {
  navigation?: import('./navigation').NavigationContextSnapshot;
  prompt: string;
  agent: AgentProfile;
  step: WorkflowStep;
  settings: StudioSettings;
  skills: RunInput['skills'];
  projects?: RunInput['projects'];
  mcpServers?: RunInput['mcpServers'];
  devopsProjectKey?: string;
  workspacePath: string;
  qualityStoragePath?: string;
  existingChangeGrants?: Record<string, string>;
}
export interface PairState {
  /** Native conversation shared by solo and pair, introduced in 1.23. */
  nativeConversation?: boolean;
  origin?: 'solo' | 'pair';
  engaged?: boolean;
  soloResultReady?: boolean;
  contextDelivered?: boolean;
  requestedMode?: 'solo' | 'pair';
  nativeEventIds?: string[];
  deliveredMessageIds?: string[];
  sourceKey?: string;
  version: number;
  approvedRevision?: number;
  mode: 'pair' | 'solo';
  phase: 'planning' | 'working' | 'checkpoint' | 'review' | 'paused' | 'interrupted';
  preferences: PairPreferences;
  snapshot: PairSnapshot;
  plans: PairPlan[];
  messages: PairMessage[];
  results: { planRevision: number; blockId: string; title: string; content: string; at: string }[];
  decisions: string[];
  requests: string[];
  pendingMessages: string[];
  turn?: PairTurn;
  busy: boolean;
  pauseRequested?: boolean;
  error?: string;
  calls: number;
  sessionIds: string[];
}
export type PairAction = {
  type: 'pairAction';
  featureId: string;
  stepId: string;
  attemptId: string;
  requestId: string;
  expectedVersion: number;
  action:
    | 'message'
    | 'approve-plan'
    | 'continue'
    | 'solo'
    | 'pair'
    | 'pause'
    | 'resume'
    | 'reorganize'
    | 'preferences'
    | 'retry-message'
    | 'keep-message'
    | 'revise';
  messageId?: string;
  content?: string;
  images?: import('./images').ImageAttachment[];
  preferences?: PairPreferences;
};
export const pairPlan = (pair: PairState) => pair.plans.at(-1);
export const isPairWork = (pair?: PairState) =>
  Boolean(pair && (pair.origin !== 'solo' || pair.engaged));
export const isWorkTurn = (turn?: PairTurn) => turn?.kind === 'work' || turn?.kind === 'solo';
/** A completed, unapproved result can be discussed directly, including after a solo run. */
export const canDiscussResult = (status: FeatureStep['status'], pair: PairState) =>
  status === 'awaiting_review' && pair.phase === 'review' && !pair.busy;
export function nextPairBlock(pair: PairState) {
  const plan = pairPlan(pair);
  return plan?.blocks.find(
    (block) =>
      !pair.results.some(
        (result) => result.planRevision === plan.revision && result.blockId === block.id,
      ),
  );
}
export const pairPhaseLabels: Record<PairState['phase'], string> = {
  planning: 'Organisation à convenir',
  working: 'Travail en cours',
  checkpoint: 'À vous de jouer',
  review: 'Résultat à valider',
  paused: 'En pause',
  interrupted: 'Reprise nécessaire',
};
