import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { z } from 'zod';

const launcherMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('open') }).strict(),
]);

/** Selecting the activity view opens the cockpit; the small view is only a retry fallback. */
export class CockpitLauncher implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private opening = false;
  private viewListeners: vscode.Disposable[] = [];
  private viewGeneration = 0;

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  get isReady(): boolean {
    return this.ready;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.releaseView();
    this.view = view;
    const generation = this.viewGeneration;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.viewListeners.push(
      view.webview.onDidReceiveMessage((raw: unknown) => {
        if (this.view !== view || this.viewGeneration !== generation) return;
        const message = launcherMessage.safeParse(raw);
        if (!message.success) return;
        if (message.data.type === 'ready') this.ready = true;
        else void this.open(view, generation);
      }),
      view.onDidChangeVisibility(() => {
        if (view.visible) void this.open(view, generation);
      }),
      view.onDidDispose(() => {
        if (this.view === view && this.viewGeneration === generation) this.releaseView();
      }),
    );
    const nonce = randomBytes(20).toString('hex');
    view.webview.html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'none'; base-uri 'none'; form-action 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Feature Studio</title>
  <style nonce="${nonce}">
    body { padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); }
    p { line-height: 1.5; }
    button { width: 100%; padding: 8px; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  </style>
</head>
<body>
  <p>Le cockpit s’ouvre dans l’éditeur de cette fenêtre.</p>
  <button id="open" type="button">Ouvrir le cockpit</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => vscode.postMessage({ type: 'open' }));
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    if (view.visible) void this.open(view, generation);
  }

  private async open(view: vscode.WebviewView, generation: number): Promise<void> {
    if (this.opening || this.view !== view || this.viewGeneration !== generation || !view.visible)
      return;
    this.opening = true;
    try {
      const opened = await vscode.commands.executeCommand<boolean>('featureStudio.open');
      // Do not hide another sidebar if the user changed views while the cockpit was loading.
      if (opened && this.view === view && this.viewGeneration === generation && view.visible)
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
    } catch (error) {
      if (this.view === view && this.viewGeneration === generation)
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Impossible d’ouvrir le cockpit.',
        );
    } finally {
      if (this.viewGeneration === generation) this.opening = false;
    }
  }

  private releaseView(): void {
    this.viewGeneration++;
    this.view = undefined;
    this.ready = false;
    this.opening = false;
    for (const listener of this.viewListeners) listener.dispose();
    this.viewListeners = [];
  }

  dispose(): void {
    this.releaseView();
  }
}
