import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  folders: [] as unknown[],
  changed: undefined as undefined | (() => void),
  receive: undefined as undefined | ((message: unknown) => void),
  disposeView: undefined as undefined | (() => void),
  executeCommand: vi.fn(async () => {}),
  showErrorMessage: vi.fn(),
  disposable: { dispose: vi.fn() },
}));

vi.mock('vscode', () => ({
  Uri: { joinPath: (_base: unknown, ...segments: string[]) => segments.join('/') },
  workspace: {
    get workspaceFolders() {
      return host.folders;
    },
    onDidChangeWorkspaceFolders: (callback: () => void) => {
      host.changed = callback;
      return host.disposable;
    },
  },
  commands: { executeCommand: host.executeCommand },
  window: { showErrorMessage: host.showErrorMessage },
}));

import { CockpitLauncher } from '../src/host/CockpitLauncher';

describe('local cockpit launcher boundary', () => {
  beforeEach(() => {
    host.folders = [];
    host.changed = undefined;
    host.receive = undefined;
    host.disposeView = undefined;
    host.executeCommand.mockClear();
    host.showErrorMessage.mockClear();
  });

  const resolve = (launcher = new CockpitLauncher({} as never)) => {
    const messageListeners: { dispose: ReturnType<typeof vi.fn> }[] = [];
    const disposalListeners: { dispose: ReturnType<typeof vi.fn> }[] = [];
    const webview = {
      html: '',
      options: {} as { localResourceRoots?: unknown[] },
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: unknown) => ({ toString: () => `vscode-webview:/${uri}` }),
      onDidReceiveMessage: (callback: (message: unknown) => void) => {
        host.receive = callback;
        const listener = { dispose: vi.fn() };
        messageListeners.push(listener);
        return listener;
      },
    };
    const view = {
      visible: true,
      webview,
      onDidDispose: (callback: () => void) => {
        host.disposeView = callback;
        const listener = { dispose: vi.fn() };
        disposalListeners.push(listener);
        return listener;
      },
    };
    launcher.resolveWebviewView(view as never);
    return {
      launcher,
      webview,
      view,
      messageListener: messageListeners[0],
      disposalListener: disposalListeners[0],
      messageListeners,
      disposalListeners,
    };
  };

  it('renders without dispatching a command and switches action from authoritative workspace state', () => {
    const { launcher, webview } = resolve();
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(launcher.isReady).toBe(false);
    expect(webview.html).toContain('Ouvrir un dossier');
    host.receive!({ type: 'ready' });
    expect(launcher.isReady).toBe(true);
    expect(host.executeCommand).not.toHaveBeenCalled();
    host.receive!({ type: 'open' });
    expect(host.executeCommand).toHaveBeenLastCalledWith('vscode.openFolder');
    host.folders = [{}];
    host.changed!();
    expect(launcher.isReady).toBe(false);
    expect(webview.html).toContain('Ouvrir le cockpit');
    host.receive!({ type: 'open' });
    expect(host.executeCommand).toHaveBeenLastCalledWith('featureStudio.open');
    host.folders = [];
    host.receive!({ type: 'open' });
    expect(host.executeCommand).toHaveBeenLastCalledWith('vscode.openFolder');
    host.disposeView!();
    expect(launcher.visible).toBe(false);
    host.executeCommand.mockClear();
    host.receive!({ type: 'open' });
    expect(host.executeCommand).not.toHaveBeenCalled();
    launcher.dispose();
  });

  it('rejects unknown messages and command, URL or argument injection', () => {
    const { launcher } = resolve();
    for (const message of [
      null,
      'open',
      [],
      {},
      { type: 'ready', arbitrary: true },
      { type: 'open', command: 'workbench.action.terminal.new' },
      { type: 'open', args: ['https://example.com'] },
      { type: 'open', url: 'https://example.com' },
      { type: 'runStep' },
    ])
      host.receive!(message);
    expect(launcher.isReady).toBe(false);
    expect(host.executeCommand).not.toHaveBeenCalled();
    launcher.dispose();
  });

  it('retires previous view listeners on resolve and all current listeners on disposal', () => {
    const first = resolve();
    const previousMessage = host.receive!;
    const previousDispose = host.disposeView!;
    const second = resolve(first.launcher);
    expect(first.messageListener.dispose).toHaveBeenCalledOnce();
    expect(first.disposalListener.dispose).toHaveBeenCalledOnce();
    previousMessage({ type: 'open' });
    previousDispose();
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(second.launcher.visible).toBe(true);
    const secondMessage = host.receive!;
    const secondDispose = host.disposeView!;
    second.launcher.resolveWebviewView(second.view as never);
    expect(second.messageListener.dispose).toHaveBeenCalledOnce();
    expect(second.disposalListener.dispose).toHaveBeenCalledOnce();
    secondMessage({ type: 'open' });
    secondDispose();
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(second.launcher.visible).toBe(true);
    host.receive!({ type: 'ready' });
    expect(second.launcher.isReady).toBe(true);
    second.launcher.dispose();
    expect(second.messageListener.dispose).toHaveBeenCalledOnce();
    expect(second.disposalListener.dispose).toHaveBeenCalledOnce();
    expect(second.messageListeners[1].dispose).toHaveBeenCalledOnce();
    expect(second.disposalListeners[1].dispose).toHaveBeenCalledOnce();
    expect(second.launcher.isReady).toBe(false);
    host.receive!({ type: 'open' });
    expect(host.executeCommand).not.toHaveBeenCalled();
  });

  it('limits local assets to resources and permits only nonce-bearing inline script and style', () => {
    const { launcher, webview } = resolve();
    expect(webview.options.localResourceRoots).toEqual(['resources']);
    const policy = webview.html.match(/Content-Security-Policy" content="([^"]+)"/)![1];
    const scriptNonce = webview.html.match(/<script nonce="([a-f0-9]+)"/)![1];
    const styleNonce = webview.html.match(/<style nonce="([a-f0-9]+)"/)![1];
    expect(scriptNonce).toBe(styleNonce);
    expect(policy).toContain(`script-src &#39;nonce-${scriptNonce}&#39;`);
    expect(policy).toContain(`style-src &#39;nonce-${styleNonce}&#39;`);
    expect(policy).toContain('default-src &#39;none&#39;');
    expect(policy).toContain('img-src vscode-webview:;');
    expect(policy).toContain('connect-src &#39;none&#39;');
    expect(policy).not.toMatch(/unsafe-inline|data:|https:/);
    expect(webview.html).toContain('src="vscode-webview:/resources/cockpit-avatar.png"');
    launcher.dispose();
  });
});
