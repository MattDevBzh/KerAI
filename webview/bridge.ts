import { StateReceiver } from '../src/shared/stateTransfer';
import type { ClientMessage, HostMessage } from '../src/shared/types';
interface PersistedView {
  sessionStarter?: import('../src/shared/sessionStarters').SessionStarterId;
  deliveryDrafts?: Record<string, import('../src/shared/deliveryDraft').DeliveryDraft>;
  hqFeatureId?: string;
  statistics?: import('../src/shared/statistics').StatsFilters;
  sessionList?: import('../src/shared/sessionList').SessionListFilters;
  navigationVersion?: number;
  view?: string;
  featureId?: string;
  stepId?: string;
  discussionId?: string;
  pairOpen?: boolean;
  pairDrafts?: Record<string, string>;
  celebrationEnabled?: boolean;
  featureProposal?: {
    discussionId: string;
    draft: import('../src/shared/discussions').DiscussionFeatureDraft;
  };
}
interface VsCodeApi {
  postMessage(message: ClientMessage): void;
  getState(): PersistedView | undefined;
  setState(state: PersistedView): void;
}
declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}
const vscode = window.acquireVsCodeApi?.();
export const isHosted = Boolean(vscode);
export const isDemo = !isHosted && new URLSearchParams(window.location.search).get('demo') === '1';
let persistedView = vscode?.getState() ?? {};
export const initialView = {
  ...persistedView,
  view:
    persistedView.navigationVersion !== 2 && persistedView.view === 'dashboard'
      ? 'sessions'
      : persistedView.view,
};
export function savedFeatureProposal() {
  return persistedView.featureProposal;
}
export function savedSessionList() {
  return persistedView.sessionList;
}
export function savedStatistics() {
  return persistedView.statistics;
}
export function celebrationEnabled() {
  return persistedView.celebrationEnabled !== false;
}
export function saveCelebrationEnabled(enabled: boolean) {
  persistedView = { ...persistedView, celebrationEnabled: enabled };
  vscode?.setState(persistedView);
}
export function persistView(state: PersistedView) {
  persistedView = { ...persistedView, ...state, navigationVersion: 2 };
  vscode?.setState(persistedView);
}
export function send(message: ClientMessage) {
  vscode?.postMessage(message);
}
const listeners = new Set<(message: HostMessage) => void>();
const receiver = new StateReceiver();
let resyncPending = false;
window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  let message = event.data;
  if (!message) return;
  if (message.type === 'state' || message.type === 'stateDelta') {
    const state = receiver.receive(message);
    if (!state) {
      if (!resyncPending) {
        resyncPending = true;
        send({ type: 'resyncState' });
      }
      return;
    }
    resyncPending = false;
    message = { type: 'state', state };
  }
  if (
    [
      'dashboardState',
      'autopilotSaved',
      'autopilotPreview',
      'dashboardSaved',
      'state',
      'hqWindowResult',
      'navigationState',
      'accountCredits',
      'questState',
      'rewardState',
      'secretThemeState',
      'discussionState',
      'discussionResult',
      'reportDiscussionOpened',
      'discussionReportOpened',
      'featureCreateResult',
      'workflowDeleteResult',
      'projectResult',
      'featureTeamResult',
      'optionalStepResult',
      'agentFavoriteResult',
      'devopsState',
      'error',
      'notice',
      'navigate',
      'runPreview',
      'pairActionResult',
      'checkpointComparison',
      'stepApprovalResult',
      'artifactSaveResult',
      'agentReportExported',
      'sessionBatchResult',
      'sessionBatchProgress',
      'statsStorageResult',
      'correctionResult',
      'featureFinalizationResult',
      'profileSaveResult',
      'kitResult',
      'themeState',
      'zoomState',
      'livingHqState',
      'observationPreview',
      'observationSource',
      'sessionStorage',
      'sessionJournal',
      'deleteFeatureResult',
    ].includes(message.type)
  )
    for (const listener of listeners) listener(message);
});
export function subscribe(callback: (message: HostMessage) => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function savedPairDraft(attemptId: string) {
  return persistedView.pairDrafts?.[attemptId] ?? '';
}
export function savePairDraft(attemptId: string, content: string) {
  if (!attemptId) return;
  const drafts = { ...persistedView.pairDrafts };
  if (content) drafts[attemptId] = content;
  else delete drafts[attemptId];
  persistedView = { ...persistedView, pairDrafts: drafts };
  vscode?.setState(persistedView);
}

export function savedSessionStarter() {
  return persistedView.sessionStarter;
}
export function savedDeliveryDraft(key: string) {
  return persistedView.deliveryDrafts?.[key];
}
export function saveDeliveryDraft(
  key: string,
  draft: import('../src/shared/deliveryDraft').DeliveryDraft,
) {
  persistView({ deliveryDrafts: { ...persistedView.deliveryDrafts, [key]: draft } });
}
