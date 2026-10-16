import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  receive: undefined as undefined | ((message: unknown) => void),
  visibilityChanged: undefined as undefined | (() => void),
  disposeView: undefined as undefined | (() => void),
  executeCommand: vi.fn<(...args: unknown[]) => Promise<boolean | undefined>>(),
  showErrorMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: { executeCommand: host.executeCommand },
  window: { showErrorMessage: host.showErrorMessage },
}));

import { CockpitLauncher } from '../src/host/CockpitLauncher';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const resolve = (launcher = new CockpitLauncher(), visible = true) => {
  const listeners: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const listen = () => {
    const listener = { dispose: vi.fn() };
    listeners.push(listener);
    return listener;
  };
  const webview = {
    html: '',
    options: {} as { localResourceRoots?: unknown[] },
    onDidReceiveMessage: (callback: (message: unknown) => void) => {
      host.receive = callback;
      return listen();
    },
  };
  const view = {
    visible,
    webview,
    onDidChangeVisibility: (callback: () => void) => {
      host.visibilityChanged = callback;
      return listen();
    },
    onDidDispose: (callback: () => void) => {
      host.disposeView = callback;
      return listen();
    },
  };
  launcher.resolveWebviewView(view as never);
  return { launcher, webview, view, listeners };
};

describe('direct cockpit launcher', () => {
  beforeEach(() => {
    host.executeCommand.mockReset().mockResolvedValue(true);
    host.showErrorMessage.mockClear();
  });

  it('opens the current-window cockpit immediately without requiring a folder or a second click', async () => {
    const { launcher, webview } = resolve();
    expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith('featureStudio.open');
    await settle();
    expect(host.executeCommand).toHaveBeenLastCalledWith('workbench.action.closeSidebar');
    expect(webview.html).not.toContain('Crédits');
    host.receive!({ type: 'ready' });
    expect(launcher.isReady).toBe(true);
    launcher.dispose();
  });

  it('waits for visibility and reopens the cockpit on later activity-bar selections', async () => {
    const { launcher, view } = resolve(undefined, false);
    expect(host.executeCommand).not.toHaveBeenCalled();
    for (let selection = 1; selection <= 2; selection++) {
      view.visible = true;
      host.visibilityChanged!();
      await settle();
      expect(
        host.executeCommand.mock.calls.filter(([name]) => name === 'featureStudio.open'),
      ).toHaveLength(selection);
      view.visible = false;
      host.visibilityChanged!();
    }
    launcher.dispose();
  });

  it('coalesces repeated selections and preserves a different sidebar selected during opening', async () => {
    let finish!: (value: boolean) => void;
    host.executeCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { launcher, view } = resolve();
    host.visibilityChanged!();
    host.receive!({ type: 'open' });
    expect(host.executeCommand).toHaveBeenCalledOnce();
    view.visible = false;
    finish(true);
    await settle();
    expect(host.executeCommand).toHaveBeenCalledOnce();
    launcher.dispose();
  });

  it('keeps the retry available after a failed opening and hides the fallback only after success', async () => {
    host.executeCommand.mockResolvedValueOnce(false);
    const { launcher } = resolve();
    await settle();
    expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith('featureStudio.open');
    host.receive!({ type: 'open' });
    await settle();
    expect(host.executeCommand).toHaveBeenLastCalledWith('workbench.action.closeSidebar');
    launcher.dispose();
  });

  it('ignores unknown messages and retired views, including pending openings after disposal', async () => {
    const first = resolve();
    await settle();
    const previousMessage = host.receive!;
    const previousVisibility = host.visibilityChanged!;
    const previousDispose = host.disposeView!;
    const second = resolve(first.launcher, false);
    host.executeCommand.mockClear();
    previousMessage({ type: 'open' });
    previousVisibility();
    previousDispose();
    for (const message of [
      null,
      'open',
      [],
      {},
      { type: 'ready', arbitrary: true },
      { type: 'open', command: 'workbench.action.terminal.new' },
      { type: 'open', args: ['https://example.com'] },
      { type: 'runStep' },
    ])
      host.receive!(message);
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(second.launcher.isReady).toBe(false);
    for (const listener of first.listeners) expect(listener.dispose).toHaveBeenCalledOnce();
    let finish!: (value: boolean) => void;
    host.executeCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    second.view.visible = true;
    host.visibilityChanged!();
    second.launcher.dispose();
    finish(true);
    await settle();
    expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith('featureStudio.open');
    for (const listener of second.listeners) expect(listener.dispose).toHaveBeenCalledOnce();
  });

  it('restricts the retry view to nonce-bearing inline script and style without local assets', async () => {
    const { launcher, webview } = resolve();
    const policy = webview.html.match(/Content-Security-Policy" content="([^"]+)"/)![1];
    const scriptNonce = webview.html.match(/<script nonce="([a-f0-9]+)"/)![1];
    const styleNonce = webview.html.match(/<style nonce="([a-f0-9]+)"/)![1];
    expect(scriptNonce).toBe(styleNonce);
    expect(policy).toContain(`script-src 'nonce-${scriptNonce}'`);
    expect(policy).toContain(`style-src 'nonce-${scriptNonce}'`);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toMatch(/unsafe-inline|data:|https:/);
    expect(webview.options.localResourceRoots).toEqual([]);
    await settle();
    launcher.dispose();
  });
});
