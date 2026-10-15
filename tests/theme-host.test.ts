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
    dedicated: false,
    mode: 3,
    executeCommand: vi.fn(),
    enqueue: vi.fn(),
    createPanel: vi.fn(),
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
  ExtensionMode: { Test: 3 },
  StatusBarAlignment: { Left: 1 },
  ViewColumn: { One: 1 },
  Uri: { joinPath: () => ({}), file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
  RelativePattern: class {},
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
    createFileSystemWatcher: () => ({ ...host.disposable, onDidCreate: () => host.disposable }),
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
    createWebviewPanel: () => {
      host.createPanel();
      return host.panel;
    },
    showErrorMessage: vi.fn(),
    onDidChangeWindowState: () => host.disposable,
  },
  commands: {
    executeCommand: host.executeCommand,
    getCommands: async () => [
      'workbench.action.closeSidebar',
      'workbench.action.closePanel',
      'workbench.action.closeAuxiliaryBar',
    ],
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
vi.mock('../src/host/DedicatedWindow', () => ({
  DedicatedWindow: class {
    home = '/global/home';
    workspace = '/global/Feature Studio.code-workspace';
    requests = '/global/requests';
    isDedicated() {
      return host.dedicated;
    }
    enqueue = host.enqueue;
    async takeRequests() {
      return [];
    }
    async prepare() {}
  },
}));
vi.mock('../src/host/ProjectCatalog', () => ({
  ProjectCatalog: class {
    state = {
      projects: [{ id: 'fixture', name: 'Fixture', path: '/fixture' }],
      selectedProjectIds: ['fixture'],
    };
    async load() {}
    async add() {
      return this.state.projects;
    }
    storage() {
      return '/fixture';
    }
  },
}));
vi.mock('../src/core/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/store')>()),
  Store: class {
    path = '/fixture/state.json';
    rootPath = '/fixture';
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
    async recoverSessionDeletions() {}
    async recordHumanAction() {}
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
    host.dedicated = false;
    host.mode = 3;
    host.executeCommand.mockClear();
    host.enqueue.mockClear();
    host.createPanel.mockClear();
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
      extensionMode: host.mode,
      storageUri: { fsPath: '/storage' },
      globalStorageUri: { fsPath: '/global' },
      secrets: {},
    } as never);
  };
  it('redirects from an ordinary project without initializing another cockpit', async () => {
    host.mode = 1;
    await activate();
    await host.commands.get('featureStudio.open')!();
    expect(host.initialize).not.toHaveBeenCalled();
    expect(host.createPanel).not.toHaveBeenCalled();
    expect(host.executeCommand).toHaveBeenCalledWith(
      'vscode.openFolder',
      { scheme: 'file', fsPath: '/global/Feature Studio.code-workspace' },
      { forceNewWindow: true },
    );
  });
  it('routes the observer menu to the dedicated window before accessing session storage', async () => {
    host.mode = 1;
    await activate();
    await host.commands.get('featureStudio.analyzeSession')!();
    expect(host.initialize).not.toHaveBeenCalled();
    expect(host.createPanel).not.toHaveBeenCalled();
    expect(host.enqueue).toHaveBeenCalledWith('analyzeSession', 'fixture');
    expect(host.executeCommand).toHaveBeenCalledWith('vscode.openFolder', expect.anything(), {
      forceNewWindow: true,
    });
  });
  it('mounts the full cockpit automatically in the dedicated workspace and reuses its panel', async () => {
    host.mode = 1;
    host.dedicated = true;
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    expect(host.initialize).toHaveBeenCalledTimes(1);
    expect(host.createPanel).toHaveBeenCalledTimes(1);
    expect(host.panel.webview.html).toContain('<html data-studio-theme="auto"');
    await api.dispatch({ type: 'ready' });
    await host.commands.get('featureStudio.open')!();
    expect(host.createPanel).toHaveBeenCalledTimes(1);
    expect(host.executeCommand).toHaveBeenCalledWith('workbench.action.closeSidebar');
  });
  it('writes globally without initializing business state or requiring trust', async () => {
    const api = await activate();
    await api.dispatch({ type: 'setTheme', theme: 'papier-clair', requestId: 'personal' });
    expect(host.writes).toEqual([['appearance.theme', 'papier-clair', 1]]);
    expect(api.getTheme()).toBe('papier-clair');
    expect(host.initialize).not.toHaveBeenCalled();
  });
  it('correlates acknowledgements, preserves busy read-only state and reports failed saves honestly', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    const before = api.getState();
    await api.dispatch({ type: 'setTheme', theme: 'guilde-clair', requestId: 'success' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'themeState',
      theme: 'guilde-clair',
      requestId: 'success',
    });
    host.failWrite = true;
    await api.dispatch({ type: 'setTheme', theme: 'jardin-sombre', requestId: 'failure' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'themeState',
      theme: 'guilde-clair',
      requestId: 'failure',
      error: 'Le profil est en lecture seule.',
    });
    expect(api.getState()).toEqual(before);
  });
  it('serializes requests and remains usable after a rejected profile write', async () => {
    const api = await activate();
    await Promise.all([
      api.dispatch({ type: 'setTheme', theme: 'papier-clair', requestId: 'first' }),
      api.dispatch({ type: 'setTheme', theme: 'jardin-clair', requestId: 'last' }),
    ]);
    expect(host.writes.map((args) => args[1])).toEqual(['papier-clair', 'jardin-clair']);
    expect(api.getTheme()).toBe('jardin-clair');
    host.failWrite = true;
    await api.dispatch({ type: 'setTheme', theme: 'guilde-clair', requestId: 'failed' });
    host.failWrite = false;
    await api.dispatch({ type: 'setTheme', theme: 'guilde-sombre', requestId: 'recovered' });
    expect(api.getTheme()).toBe('guilde-sombre');
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
    host.theme = 'jardin-sombre';
    host.configurationChanged?.({ affectsConfiguration: () => true });
    expect(host.messages.at(-1)).toMatchObject({ type: 'themeState', theme: 'jardin-sombre' });
    const count = host.messages.length;
    host.configurationChanged?.({ affectsConfiguration: () => false });
    expect(host.messages).toHaveLength(count);
  });
});
