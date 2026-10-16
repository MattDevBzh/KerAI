import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    acquireLease: vi.fn(),
    releaseLease: vi.fn(),
    disposePanel: undefined as undefined | (() => void),
    subscriptions: [] as { dispose(): void }[],
    restorePanel: undefined as undefined | ((panel: unknown) => Promise<void>),
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
      visible: true,
      webview: {
        html: '',
        options: {},
        cspSource: 'vscode-webview:',
        asWebviewUri: () => ({ toString: () => 'vscode-webview:/assets' }),
        postMessage: (message: HostMessage) => messages.push(message),
        onDidReceiveMessage: () => disposable,
      },
      onDidDispose: (callback: () => void) => {
        host.disposePanel = callback;
        return disposable;
      },
      onDidChangeViewState: () => disposable,
      reveal() {},
    },
  };
});

vi.mock('../src/host/QuestService', () => ({
  QuestService: class {
    on() {}
    async initialize() {}
    async record() {}
    async flush() {}
    publish() {}
  },
}));
vi.mock('../src/host/questFacts', () => ({
  studioQuestFacts: () => [],
  discussionQuestFacts: () => [],
}));
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
    registerWebviewPanelSerializer: (
      _type: string,
      serializer: { deserializeWebviewPanel(panel: unknown): Promise<void> },
    ) => {
      host.restorePanel = serializer.deserializeWebviewPanel;
      return host.disposable;
    },
    createWebviewPanel: () => {
      host.createPanel();
      return host.panel;
    },
    showErrorMessage: vi.fn(),
    showQuickPick: vi.fn(async () => undefined),
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
    acquire = host.acquireLease;
    release = host.releaseLease;
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
  afterEach(() => {
    for (const subscription of host.subscriptions) subscription.dispose();
    host.subscriptions.length = 0;
  });
  beforeEach(async () => {
    vi.resetModules();
    host.theme = undefined;
    host.dedicated = false;
    host.mode = 3;
    host.executeCommand.mockClear();
    host.enqueue.mockClear();
    host.createPanel.mockClear();
    host.acquireLease.mockClear();
    host.releaseLease.mockClear();
    host.failWrite = false;
    host.messages.length = 0;
    host.writes.length = 0;
    host.initialize.mockClear();
    host.commands.clear();
  });
  const activate = async () => {
    const extension = await import('../src/extension');
    return extension.activate({
      subscriptions: host.subscriptions,
      extensionUri: {},
      extensionPath: '/extension',
      extensionMode: host.mode,
      storageUri: { fsPath: '/storage' },
      globalStorageUri: { fsPath: '/global' },
      secrets: {},
    } as never);
  };
  it('opens and reuses the cockpit in the ordinary project window in production mode', async () => {
    host.mode = 1;
    await activate();
    await host.commands.get('featureStudio.open')!();
    await host.commands.get('featureStudio.open')!();
    expect(host.initialize).toHaveBeenCalledOnce();
    expect(host.createPanel).toHaveBeenCalledOnce();
    expect(host.executeCommand).not.toHaveBeenCalled();
  });
  it('keeps the explicit dedicated-window command separate from normal opening', async () => {
    host.mode = 1;
    await activate();
    await host.commands.get('featureStudio.openDedicated')!();
    expect(host.initialize).not.toHaveBeenCalled();
    expect(host.createPanel).not.toHaveBeenCalled();
    expect(host.executeCommand).toHaveBeenCalledWith(
      'vscode.openFolder',
      { scheme: 'file', fsPath: '/global/Feature Studio.code-workspace' },
      { forceNewWindow: true },
    );
  });
  it('opens the observer and new-session commands in the current window', async () => {
    host.mode = 1;
    await activate();
    await host.commands.get('featureStudio.analyzeSession')!();
    await host.commands.get('featureStudio.newFeature')!();
    expect(host.initialize).toHaveBeenCalledOnce();
    expect(host.createPanel).toHaveBeenCalledOnce();
    expect(host.enqueue).not.toHaveBeenCalled();
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(host.messages).toContainEqual({ type: 'navigate', view: 'create' });
  });
  it('restores the cockpit into the same ordinary window after reload', async () => {
    host.mode = 1;
    await activate();
    await host.restorePanel!(host.panel);
    expect(host.panel.webview.html).toContain('<html data-studio-theme="auto"');
    expect(host.initialize).toHaveBeenCalledOnce();
    expect(host.createPanel).not.toHaveBeenCalled();
    expect(host.executeCommand).not.toHaveBeenCalled();
  });
  it('releases the shared cockpit on tab close so another window can open it', async () => {
    await activate();
    await host.commands.get('featureStudio.open')!();
    expect(host.acquireLease).toHaveBeenCalledOnce();
    host.disposePanel!();
    await vi.waitFor(() => expect(host.releaseLease).toHaveBeenCalledOnce());
    await host.commands.get('featureStudio.open')!();
    expect(host.acquireLease).toHaveBeenCalledTimes(2);
    expect(host.createPanel).toHaveBeenCalledTimes(2);
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
  it('sends account availability to the cockpit when ready without bypassing workspace trust', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    expect(host.messages.some((message) => message.type === 'accountCredits')).toBe(false);
    await api.dispatch({ type: 'ready' });
    expect(host.messages).toContainEqual({
      type: 'accountCredits',
      state: {
        state: 'unavailable',
        message: 'Approuve cet espace de travail pour connecter Copilot CLI.',
      },
    });
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
