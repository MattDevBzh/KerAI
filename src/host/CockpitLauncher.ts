import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { z } from 'zod';

const launcherMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('open') }).strict(),
]);

const escapeAttribute = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!;
  });

/** A local welcome view: resolving it never opens or initializes a project. */
export class CockpitLauncher implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private readonly foldersChanged: vscode.Disposable;
  private viewListeners: vscode.Disposable[] = [];
  private viewGeneration = 0;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.foldersChanged = vscode.workspace.onDidChangeWorkspaceFolders(() => this.render());
  }

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
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources')],
    };
    const messages = view.webview.onDidReceiveMessage((raw: unknown) => {
      if (this.view !== view || this.viewGeneration !== generation) return;
      const message = launcherMessage.safeParse(raw);
      if (!message.success) return;
      if (message.data.type === 'ready') {
        this.ready = true;
        return;
      }
      // Only these fixed, argument-free commands can cross the welcome boundary.
      const command = vscode.workspace.workspaceFolders?.length
        ? 'featureStudio.open'
        : 'vscode.openFolder';
      void vscode.commands.executeCommand(command).then(undefined, (error: unknown) => {
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Impossible d’ouvrir le projet.',
        );
      });
    });
    this.viewListeners.push(
      messages,
      view.onDidDispose(() => {
        if (this.view === view && this.viewGeneration === generation) this.releaseView();
      }),
    );
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    this.ready = false;
    const webview = this.view.webview;
    const nonce = randomBytes(20).toString('hex');
    const avatar = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'cockpit-avatar.png'),
    );
    const hasProject = Boolean(vscode.workspace.workspaceFolders?.length);
    const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'none'; base-uri 'none'; form-action 'none';`;
    webview.html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bienvenue dans Feature Studio</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    main { padding: 24px 16px; text-align: center; max-width: 320px; margin: 0 auto; }
    img { display: block; width: 112px; height: 112px; max-width: 100%; object-fit: contain; image-rendering: pixelated; margin: 0 auto 18px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); border-radius: 16px; }
    h1 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
    p { margin: 0 0 20px; line-height: 1.5; color: var(--vscode-descriptionForeground); }
    button { display: block; width: 100%; min-height: 32px; padding: 7px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; overflow-wrap: anywhere; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 3px; }
    .vscode-high-contrast button, .vscode-high-contrast-light button { border-color: var(--vscode-contrastBorder); }
  </style>
</head>
<body>
  <main>
    <img id="avatar" src="${escapeAttribute(avatar.toString())}" width="112" height="112" alt="">
    <h1>Prêt à créer ?</h1>
    <p>${hasProject ? 'Tes idées, ton projet, ton cockpit.' : 'Ouvre ton projet pour prendre les commandes.'}</p>
    <button id="open" type="button">${hasProject ? 'Ouvrir le cockpit' : 'Ouvrir un dossier'}</button>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => vscode.postMessage({ type: 'open' }));
    const avatar = document.getElementById('avatar');
    const ready = () => { if (avatar.naturalWidth > 0) vscode.postMessage({ type: 'ready' }); };
    if (avatar.complete) ready();
    else avatar.addEventListener('load', ready, { once: true });
  </script>
</body>
</html>`;
  }

  private releaseView(): void {
    this.viewGeneration++;
    this.view = undefined;
    this.ready = false;
    for (const listener of this.viewListeners) listener.dispose();
    this.viewListeners = [];
  }

  dispose(): void {
    this.foldersChanged.dispose();
    this.releaseView();
  }
}
