import type { ClientMessage, HostMessage } from '../src/shared/types';
interface PersistedView {
  sessionList?: import('../src/shared/sessionList').SessionListFilters;
  navigationVersion?: number;
  view?: string;
  featureId?: string;
  stepId?: string;
  discussionId?: string;
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
export function subscribe(callback: (message: HostMessage) => void) {
  const handler = (event: MessageEvent<HostMessage>) => {
    if (
      event.data &&
      [
        'dashboardState',
        'dashboardSaved',
        'state',
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
        'checkpointComparison',
        'stepApprovalResult',
        'artifactSaveResult',
        'agentReportExported',
        'sessionBatchResult',
        'sessionBatchProgress',
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
      ].includes(event.data.type)
    )
      callback(event.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
