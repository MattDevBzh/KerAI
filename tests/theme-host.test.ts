import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage, StudioState } from '../src/shared/types';
import { DRAGON_BALL_CODE, DRAGON_BALL_UNLOCK_KEY } from '../src/shared/dragonBall';

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
    questTrophies: 0,
    rewardJson: undefined as string | undefined,
    secretUnlocked: undefined as unknown,
    secretWrites: 0,
    failSecretWrite: false,
    zoom: undefined as unknown,
    livingHq: undefined as unknown,
    cliPath: undefined as unknown,
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
    snapshot() {
      return { counts: {}, completed: {}, trophies: host.questTrophies };
    }
    on() {}
    async initialize() {}
    async record() {}
    async flush() {}
    publish() {}
  },
}));
vi.mock('../src/host/SessionFiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/host/SessionFiles')>()),
  readPrivate: async (_directory: string, file: string) => {
    if (file === 'rewards.json' && host.rewardJson !== undefined) return host.rewardJson;
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  },
  writePrivate: async (_directory: string, file: string, value: string) => {
    if (host.failWrite) throw new Error('Préférences en lecture seule');
    if (file === 'rewards.json') host.rewardJson = value;
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
        key === 'appearance.theme'
          ? host.theme
          : key === 'appearance.zoom'
            ? host.zoom
            : key === 'appearance.livingHq'
              ? host.livingHq
              : key === 'cliPath'
                ? host.cliPath
                : fallback,
      update: async (...args: unknown[]) => {
        host.writes.push(args);
        if (host.failWrite) throw new Error('Le profil est en lecture seule.');
        if (args[0] === 'appearance.zoom') host.zoom = args[1];
        else if (args[0] === 'appearance.livingHq') host.livingHq = args[1];
        else if (args[0] === 'cliPath') host.cliPath = args[1];
        else host.theme = args[1];
        host.configurationChanged?.({
          affectsConfiguration: (key) => key === `featureStudio.${args[0]}`,
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
    host.questTrophies = 0;
    host.rewardJson = undefined;
    host.secretUnlocked = undefined;
    host.secretWrites = 0;
    host.failSecretWrite = false;
    host.zoom = undefined;
    host.livingHq = undefined;
    host.cliPath = undefined;
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
      globalState: {
        get: (key: string) => (key === DRAGON_BALL_UNLOCK_KEY ? host.secretUnlocked : undefined),
        update: async (key: string, value: unknown) => {
          if (host.failSecretWrite) throw new Error('Stockage personnel indisponible');
          expect(key).toBe(DRAGON_BALL_UNLOCK_KEY);
          host.secretUnlocked = value;
          host.secretWrites++;
        },
      },
      secrets: {},
    } as never);
  };
  it('opens the native trust editor without granting trust, initializing a project or changing settings', async () => {
    const api = await activate();
    const before = structuredClone(host.state);
    const initializations = host.initialize.mock.calls.length;
    await api.dispatch({ type: 'manageWorkspaceTrust' });
    expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith('workbench.trust.manage');
    expect(host.state).toEqual(before);
    expect(host.state.workspace.trusted).toBe(false);
    expect(host.writes).toHaveLength(0);
    expect(host.initialize).toHaveBeenCalledTimes(initializations);
    await expect(
      api.dispatch({ type: 'manageWorkspaceTrust', trusted: true } as never),
    ).rejects.toThrow();
    expect(host.executeCommand).toHaveBeenCalledTimes(1);
    host.executeCommand.mockRejectedValueOnce(new Error('Écran de confiance indisponible'));
    await expect(api.dispatch({ type: 'manageWorkspaceTrust' })).rejects.toThrow(
      'Écran de confiance indisponible',
    );
    expect(host.state.workspace.trusted).toBe(false);
  });
  it('keeps Dragon Ball hidden until the exact code, then persists it once without touching business state or trophies', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    host.theme = 'dragonball';
    expect(api.getTheme()).toBe('auto');
    await api.dispatch({ type: 'setTheme', theme: 'dragonball', requestId: 'locked' });
    expect(host.writes).toHaveLength(0);
    await expect(
      api.dispatch({ type: 'unlockDragonBall', sequence: ['ArrowUp'], requestId: 'bad' }),
    ).rejects.toThrow();
    const before = structuredClone(host.state);
    const initializations = host.initialize.mock.calls.length;
    await api.dispatch({
      type: 'unlockDragonBall',
      sequence: DRAGON_BALL_CODE,
      requestId: 'secret',
    });
    expect(api.getTheme()).toBe('dragonball');
    expect(host.secretUnlocked).toBe(true);
    expect(host.messages.at(-1)).toMatchObject({
      type: 'secretThemeState',
      requestId: 'secret',
      dragonBallUnlocked: true,
    });
    await api.dispatch({ type: 'setTheme', theme: 'auto', requestId: 'normal' });
    await api.dispatch({
      type: 'unlockDragonBall',
      sequence: DRAGON_BALL_CODE,
      requestId: 'again',
    });
    expect(host.secretWrites).toBe(1);
    expect(host.state).toEqual(before);
    expect(host.questTrophies).toBe(0);
    expect(host.initialize).toHaveBeenCalledTimes(initializations);
    host.disposePanel?.();
    await host.commands.get('featureStudio.open')!();
    expect(api.getTheme()).toBe('dragonball');
  });
  it('never invents a secret unlock on storage failure and retains the earned secret if only activation fails', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    host.theme = 'papier-clair';
    host.failSecretWrite = true;
    await api.dispatch({ type: 'unlockDragonBall', sequence: DRAGON_BALL_CODE, requestId: 'disk' });
    expect(host.secretUnlocked).toBeUndefined();
    expect(host.writes).toHaveLength(0);
    expect(host.messages.at(-1)).toMatchObject({
      dragonBallUnlocked: false,
      error: expect.any(String),
    });
    host.failSecretWrite = false;
    host.failWrite = true;
    await api.dispatch({
      type: 'unlockDragonBall',
      sequence: DRAGON_BALL_CODE,
      requestId: 'config',
    });
    expect(host.secretUnlocked).toBe(true);
    expect(api.getTheme()).toBe('papier-clair');
    expect(host.messages.at(-1)).toMatchObject({
      dragonBallUnlocked: true,
      error: expect.any(String),
    });
    host.failWrite = false;
    await api.dispatch({ type: 'setTheme', theme: 'dragonball', requestId: 'retry' });
    expect(api.getTheme()).toBe('dragonball');
  });
  it('gates reward themes and cosmetics at the host, including direct settings and forged messages', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    host.theme = 'matrix';
    expect(api.getTheme()).toBe('auto');
    await api.dispatch({ type: 'setTheme', theme: 'matrix', requestId: 'locked-theme' });
    expect(host.writes).toHaveLength(0);
    expect(host.messages.at(-1)).toMatchObject({
      type: 'themeState',
      requestId: 'locked-theme',
      theme: 'auto',
      error: expect.stringContaining('pas encore'),
    });
    await api.dispatch({
      type: 'setReward',
      rewardId: 'kitten',
      enabled: true,
      requestId: 'locked-pet',
    });
    expect(api.getRewardState().selection.mascot).toBeNull();
    expect(host.rewardJson).toBeUndefined();
    await expect(
      api.dispatch({
        type: 'setReward',
        rewardId: 'matrix',
        enabled: true,
        requestId: 'forged',
        trophies: 200,
      } as never),
    ).rejects.toThrow();
  });
  it('applies earned rewards personally, keeps other slots and preserves confirmed values on write failure', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    host.questTrophies = 200;
    const before = structuredClone(host.state);
    await api.dispatch({ type: 'setReward', rewardId: 'noob', enabled: true, requestId: 'theme' });
    expect(api.getTheme()).toBe('noob');
    expect(host.writes.at(-1)).toEqual(['appearance.theme', 'noob', 1]);
    await api.dispatch({
      type: 'setReward',
      rewardId: 'architecte',
      enabled: true,
      requestId: 'title',
    });
    await api.dispatch({ type: 'setReward', rewardId: 'kitten', enabled: true, requestId: 'pet' });
    await api.dispatch({
      type: 'setReward',
      rewardId: 'dresseur',
      enabled: true,
      requestId: 'title-2',
    });
    expect(api.getRewardState().selection).toEqual({
      title: 'dresseur',
      celebration: null,
      mascot: 'kitten',
    });
    host.failWrite = true;
    await api.dispatch({
      type: 'setReward',
      rewardId: 'eiffel',
      enabled: true,
      requestId: 'failed',
    });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'rewardState',
      requestId: 'failed',
      error: expect.stringContaining('lecture seule'),
    });
    expect(api.getRewardState().selection.celebration).toBeNull();
    expect(host.state).toEqual(before);
  });
  it('resets a stale CLI path globally and leaves it unchanged if saving fails', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    host.cliPath = 'C:\\missing\\copilot.bat';
    host.failWrite = true;
    await expect(api.dispatch({ type: 'autoDetectCli' })).rejects.toThrow('lecture seule');
    expect(host.cliPath).toBe('C:\\missing\\copilot.bat');
    host.failWrite = false;
    await api.dispatch({ type: 'autoDetectCli' });
    expect(host.cliPath).toBe('auto');
    expect(host.writes.at(-1)).toEqual(['cliPath', 'auto', 1]);
    expect(host.messages.at(-1)).toMatchObject({
      type: 'notice',
      message: expect.stringContaining('activée'),
    });
  });
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
    expect(host.panel.webview.html).toMatch(/<html\b[^>]*\bdata-studio-theme="auto"/);
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
    expect(host.panel.webview.html).toMatch(/<html\b[^>]*\bdata-studio-theme="auto"/);
    await api.dispatch({ type: 'ready' });
    await host.commands.get('featureStudio.open')!();
    expect(host.createPanel).toHaveBeenCalledTimes(1);
    expect(host.executeCommand).toHaveBeenCalledWith('workbench.action.closeSidebar');
  });
  it('persists the session HQ globally, serializes choices and recovers after failed writes without running agents', async () => {
    const api = await activate();
    expect(api.getLivingHq()).toBe(false);
    const before = api.getState();
    await Promise.all([
      api.dispatch({ type: 'setLivingHq', enabled: true, requestId: 'hq-first' }),
      api.dispatch({ type: 'setLivingHq', enabled: false, requestId: 'hq-last' }),
    ]);
    expect(host.writes).toEqual([
      ['appearance.livingHq', true, 1],
      ['appearance.livingHq', false, 1],
    ]);
    expect(api.getLivingHq()).toBe(false);
    expect(api.getState()).toEqual(before);
    expect(host.initialize).not.toHaveBeenCalled();
    await host.commands.get('featureStudio.open')!();
    const opened = api.getState();
    host.failWrite = true;
    await api.dispatch({ type: 'setLivingHq', enabled: true, requestId: 'hq-failure' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'livingHqState',
      enabled: false,
      requestId: 'hq-failure',
      error: 'Le profil est en lecture seule.',
    });
    host.failWrite = false;
    await api.dispatch({ type: 'setLivingHq', enabled: true, requestId: 'hq-recovered' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'livingHqState',
      enabled: true,
      requestId: 'hq-recovered',
    });
    expect(api.getState()).toEqual(opened);
  });
  it('restores the HQ preference in HTML and follows personal configuration changes', async () => {
    host.livingHq = true;
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    expect(host.panel.webview.html).toContain('data-studio-living-hq="true"');
    await api.dispatch({ type: 'ready' });
    expect(host.messages).toContainEqual(
      expect.objectContaining({ type: 'livingHqState', enabled: true }),
    );
    host.livingHq = false;
    host.configurationChanged?.({
      affectsConfiguration: (key) => key === 'featureStudio.appearance.livingHq',
    });
    expect(host.messages.at(-1)).toMatchObject({ type: 'livingHqState', enabled: false });
    host.livingHq = 'true';
    expect(api.getLivingHq()).toBe(false);
    await expect(
      api.dispatch({ type: 'setLivingHq', enabled: 'true', requestId: 'bad' } as never),
    ).rejects.toThrow();
    await expect(
      api.dispatch({
        type: 'setLivingHq',
        enabled: true,
        requestId: 'bad',
        target: 'workspace',
      } as never),
    ).rejects.toThrow();
  });
  it('persists zoom globally without a project or agent run and restores the saved value on failure', async () => {
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    const before = api.getState();
    await api.dispatch({ type: 'setZoom', zoom: 150, requestId: 'zoom-save' });
    expect(host.writes).toEqual([['appearance.zoom', 150, 1]]);
    expect(api.getZoom()).toBe(150);
    expect(host.messages.at(-1)).toMatchObject({
      type: 'zoomState',
      zoom: 150,
      requestId: 'zoom-save',
    });
    host.failWrite = true;
    await api.dispatch({ type: 'setZoom', zoom: 200, requestId: 'zoom-failure' });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'zoomState',
      zoom: 150,
      requestId: 'zoom-failure',
      error: 'Le profil est en lecture seule.',
    });
    expect(api.getState()).toEqual(before);
    host.failWrite = false;
    await api.dispatch({ type: 'setZoom', zoom: 'auto', requestId: 'zoom-reset' });
    expect(api.getZoom()).toBe('auto');
  });
  it('injects the saved zoom on reopen and announces external configuration changes', async () => {
    host.zoom = 175;
    const api = await activate();
    await host.commands.get('featureStudio.open')!();
    expect(host.panel.webview.html).toContain('data-studio-zoom="175"');
    host.zoom = 125;
    host.configurationChanged?.({
      affectsConfiguration: (key) => key === 'featureStudio.appearance.zoom',
    });
    expect(host.messages.at(-1)).toMatchObject({ type: 'zoomState', zoom: 125 });
    await api.dispatch({ type: 'ready' });
    expect(host.messages).toContainEqual(expect.objectContaining({ type: 'zoomState', zoom: 125 }));
    await expect(
      api.dispatch({ type: 'setZoom', zoom: 999, requestId: 'bad' } as never),
    ).rejects.toThrow();
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
    for (const attribute of ['data-studio-theme="auto"', 'data-studio-zoom="auto"', 'lang="fr"']) {
      expect(host.panel.webview.html.split('>')[0]).toContain(attribute);
    }
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
