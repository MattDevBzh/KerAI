import type { ClientMessage, HostMessage } from '../src/shared/types';
interface PersistedView {
  view?: string;
  featureId?: string;
  stepId?: string;
  discussionId?: string;
  celebrationEnabled?: boolean;
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
export const initialView = persistedView;
export function celebrationEnabled() {
  return persistedView.celebrationEnabled !== false;
}
export function saveCelebrationEnabled(enabled: boolean) {
  persistedView = { ...persistedView, celebrationEnabled: enabled };
  vscode?.setState(persistedView);
}
export function persistView(state: PersistedView) {
  persistedView = { ...persistedView, ...state };
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
        'state',
        'discussionState',
        'discussionResult',
        'workflowDeleteResult',
        'projectResult',
        'featureTeamResult',
        'agentFavoriteResult',
        'devopsState',
        'error',
        'notice',
        'navigate',
        'runPreview',
        'checkpointComparison',
        'stepApprovalResult',
        'artifactSaveResult',
        'correctionResult',
        'featureFinalizationResult',
        'profileSaveResult',
        'kitResult',
        'themeState',
      ].includes(event.data.type)
    )
      callback(event.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
