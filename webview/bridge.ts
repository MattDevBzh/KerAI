import type { ClientMessage, HostMessage } from '../src/shared/types';
interface PersistedView {
  view?: string;
  featureId?: string;
  stepId?: string;
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
export const initialView = vscode?.getState() ?? {};
export function persistView(state: PersistedView) {
  vscode?.setState(state);
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
        'devopsState',
        'error',
        'notice',
        'navigate',
        'runPreview',
        'checkpointComparison',
        'stepApprovalResult',
        'profileSaveResult',
      ].includes(event.data.type)
    )
      callback(event.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
