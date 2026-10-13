import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage, StudioState } from '../src/shared/types';

const host = vi.hoisted(() => {
  const messages: HostMessage[] = [];
  const commands = new Map<string, () => Promise<void>>();
  const state = {
    settings: { defaultModel: '', timeoutMinutes: 20 },
    workspace: { trusted: false },
    features: [{ status: 'running' }],
    workspaceOperation: { label: 'Consultation', readOnly: true },
  } as unknown as StudioState;
  const disposable = { dispose() {} };
  return {
    messages,
    commands,
    state,
    disposable,
    theme: undefined as unknown,
    failWrite: false,
    writes: [] as unknown[][],
    configurationChanged: undefined as
      | undefined
      | ((event: { affectsConfiguration(key: string): boolean }) => void),
    initialize: vi.fn(),
    panel: {
      webview: {
        html: '',
        options: {},
        cspSource: 'vscode-webview:',
        asWebviewUri: () => ({ toString: () => 'vscode-webview:/assets' }),
        postMessage: (message: HostMessage) => messages.push(message),
        onDidReceiveMessage: () => disposable,
      },
      onDidDispose: () => disposable,
      reveal() {},
    },
  };
});

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1 },
  StatusBarAlignment: { Left: 1 },
  ViewColumn: { One: 1 },
  Uri: { joinPath: () => ({}) },
  workspace: {
    workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/fixture' } }],
    isTrusted: false,
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) =>
        key === 'appearance.theme' ? host.theme : fallback,
      update: async (...args: unknown[]) => {
        host.writes.push(args);
        if (host.failWrite) throw new Error('Le profil est en lecture seule.');
        host.theme = args[1];
        host.configurationChanged?.({
          affectsConfiguration: (key) => key === 'featureStudio.appearance.theme',
        });
      },
    }),
    registerTextDocumentContentProvider: () => host.disposable,
    onDidChangeConfiguration: (callback: typeof host.configurationChanged) => {
      host.configurationChanged = callback;
      return host.disposable;
    },
    onDidGrantWorkspaceTrust: () => host.disposable,
    onDidChangeWorkspaceFolders: () => host.disposable,
  },
  window: {
    createOutputChannel: () => ({ ...host.disposable, appendLine() {} }),
    registerWebviewViewProvider: () => host.disposable,
    createStatusBarItem: () => ({ ...host.disposable, show() {} }),
    registerWebviewPanelSerializer: () => host.disposable,
    createWebviewPanel: () => host.panel,
    showErrorMessage: vi.fn(),
  },
  commands: {
    registerCommand: (name: string, command: () => Promise<void>) => {
      host.commands.set(name, command);
      return host.disposable;
    },
  },
}));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: async () => '<html lang="fr"><head></head><body></body></html>',
  writeFile: vi.fn(),
  realpath: async (value: string) => value,
  access: async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  },
}));
vi.mock('../src/core/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/store')>()),
  Store: class {
    path = '/fixture/state.json';
  },
}));
vi.mock('../src/host/WorkspaceLease', () => ({
  WorkspaceLease: class {
    async acquire() {}
    async release() {}
  },
}));
vi.mock('../src/host/CopilotCliAdapter', () => ({ CopilotCliAdapter: class {} }));
vi.mock('../src/host/DevOpsController', () => ({
  DevOpsController: class {
    async initialize() {}
    getState() {
      return {};
    }
    async dispose() {}
  },
}));
vi.mock('../src/host/StudioService', () => ({
  StudioService: class {
    state = host.state;
    initialize = host.initialize;
    async persist() {}
    on() {}
    publish() {}
    snapshot() {
      return structuredClone(this.state);
    }
    assertConfigurable() {
      throw new Error('A run is active.');
    }
    async dispose() {}
  },
}));

describe('personal theme host boundary', () => {
  beforeEach(async () => {
    vi.resetModules();
    host.theme = undefined;
    host.failWrite = false;
    host.messages.length = 0;
    host.writes.length = 0;
    host.initialize.mockClear();
    host.commands.clear();
  });
  const activate = async () => {
    const extension = await import('../src/extension');
    return extension.activate({
      subscriptions: [],
      extensionUri: {},
      extensionPath: '/extension',
      storageUri: { fsPath: '/storage' },
      globalStorageUri: { fsPath: '/global' },
      secrets: {},
    } as never);
  };
  it('writes globally without initializing business state or requiring trust', async () => {
    const api = await activate();
    await api.dispatch({ type: 'setTheme', theme: 'aube', requestId: 'personal' });
    expect(host.writes).toEqual([['appearance.theme', 'aube', 1]]);
    expect(api.getTheme()).toBe('aube');
    expect(host.initialize).not.toHaveBeenCalled();
  });
  it('correlates acknowledgements, preserves busy read-only state and reports failed saves honestly', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    const before = api.getState();
    await api.dispatch({ type: 'setTheme', theme: 'brume', requestId: 'success' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'themeState',
      theme: 'brume',
      requestId: 'success',
    });
    host.failWrite = true;
    await api.dispatch({ type: 'setTheme', theme: 'foret', requestId: 'failure' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'themeState',
      theme: 'brume',
      requestId: 'failure',
      error: 'Le profil est en lecture seule.',
    });
    expect(api.getState()).toEqual(before);
  });
  it('serializes requests and remains usable after a rejected profile write', async () => {
    const api = await activate();
    await Promise.all([
      api.dispatch({ type: 'setTheme', theme: 'aube', requestId: 'first' }),
      api.dispatch({ type: 'setTheme', theme: 'sauge', requestId: 'last' }),
    ]);
    expect(host.writes.map((args) => args[1])).toEqual(['aube', 'sauge']);
    expect(api.getTheme()).toBe('sauge');
    host.failWrite = true;
    await api.dispatch({ type: 'setTheme', theme: 'brume', requestId: 'failed' });
    host.failWrite = false;
    await api.dispatch({ type: 'setTheme', theme: 'minuit', requestId: 'recovered' });
    expect(api.getTheme()).toBe('minuit');
  });
  it('injects only allowed initial values and announces external changes and readiness', async () => {
    const api = await activate();
    host.theme = 'aube" onload="arbitrary';
    await host.commands.get('featureStudio.open')!();
    expect(host.panel.webview.html).toContain('<html data-studio-theme="auto" lang="fr">');
    expect(host.panel.webview.html).not.toContain('arbitrary');
    await api.dispatch({ type: 'ready' });
    expect(host.messages).toContainEqual(
      expect.objectContaining({ type: 'themeState', theme: 'auto' }),
    );
    host.theme = 'foret';
    host.configurationChanged?.({ affectsConfiguration: () => true });
    expect(host.messages.at(-1)).toMatchObject({ type: 'themeState', theme: 'foret' });
    const count = host.messages.length;
    host.configurationChanged?.({ affectsConfiguration: () => false });
    expect(host.messages).toHaveLength(count);
  });
});
