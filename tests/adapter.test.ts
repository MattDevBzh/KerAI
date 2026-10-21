import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CopilotClient,
  CopilotClientOptions,
  SessionConfig,
  SessionEvent,
  CurrentToolMetadata,
} from '@github/copilot-sdk';
import {
  buildPrompt,
  CopilotCliAdapter,
  parseQuestions,
  parseReview,
} from '../src/host/CopilotCliAdapter';
import type { RunCallbacks, RunInput } from '../src/shared/types';

function input(): RunInput {
  const attempt = {
    id: 'attempt',
    startedAt: '2026-10-13',
    status: 'running' as const,
    feedback: 'Préciser le comportement',
    logs: [],
    questions: [],
    answers: {},
    changedFiles: [],
  };
  const step = {
    id: 'step',
    name: 'Cadrage',
    description: 'Définir la feature',
    agentId: 'agent',
    policy: 'read-only' as const,
    skills: [],
    maxAttempts: 3,
    artifact: 'spec.md',
    dependsOn: [],
    status: 'running' as const,
    attempts: [attempt],
  };
  return {
    feature: {
      id: 'feature',
      title: 'Recherche',
      description: 'Recherche locale',
      workflowId: 'flow',
      workflowName: 'Flow',
      createdAt: 'date',
      updatedAt: 'date',
      branch: 'main',
      status: 'running',
      activeStepId: 'step',
      steps: [step],
    },
    step,
    attempt,
    agent: {
      id: 'agent',
      name: 'Produit',
      description: 'Cadrer',
      instructions: 'Poser des questions',
      tools: ['read'],
      skills: [],
      path: '',
      source: 'bundled',
    },
    skills: [],
    workspacePath: '/workspace',
    settings: { defaultModel: '', timeoutMinutes: 20, testCommands: [], testPaths: [], hooks: [] },
  };
}
function transport() {
  let config: SessionConfig | undefined;
  let listener: ((event: SessionEvent) => void) | undefined;
  let onSend: () => void = () => {
    emit('assistant.message_delta', { messageId: 'answer', deltaContent: 'Bonjour ' });
    emit('assistant.message_delta', { messageId: 'answer', deltaContent: 'Matt' });
    emit('assistant.usage', { model: 'gpt-real', inputTokens: 8, outputTokens: 3 });
    emit('assistant.message', { messageId: 'answer', content: '# Livrable\nBonjour Matt' });
    emit('session.idle', {});
  };
  function emit(type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    listener?.({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      parentId: null,
      type,
      data,
      ...extra,
    } as SessionEvent);
  }
  const session = {
    sessionId: 'persistent-session',
    rpc: {
      managedSettings: {
        get: vi.fn(async () => ({
          failClosed: false,
          clientManaged: true,
          bypassPermissionsDisabled: true,
          settings: config?.managedSettings,
        })),
      },
      permissions: { configure: vi.fn(async () => ({ success: true })) },
      mcp: {
        startServer: vi.fn(async () => {}),
        listTools: vi.fn(async () => ({
          tools: [
            { name: 'read_story', description: 'Read' },
            { name: 'write_story', description: 'Write' },
          ],
        })),
      },
      tools: {
        initializeAndValidate: vi.fn(async () => ({})),
        getCurrentMetadata: vi.fn(
          async (): Promise<{ tools: CurrentToolMetadata[] }> => ({
            tools: [
              { name: 'studio_read_file', description: 'Read' },
              { name: 'studio_ask_human', description: 'Ask' },
            ],
          }),
        ),
      },
    },
    on: vi.fn((fn: (event: SessionEvent) => void) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    }),
    send: vi.fn(async () => {
      onSend();
      return 'user-message';
    }),
    abort: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
  const client = {
    rpc: {
      account: {
        getQuota: vi.fn(async () => ({
          quotaSnapshots: {
            premium_interactions: {
              usedRequests: 123.5,
              entitlementRequests: 1500,
              isUnlimitedEntitlement: false,
              overage: 0,
              overageAllowedWithExhaustedQuota: false,
            },
          },
        })),
        getCurrentAuth: vi.fn(async () => ({
          authInfo: {
            type: 'token',
            token: 'must-never-leave-host',
            copilotUser: { token_based_billing: true },
          },
        })),
      },
    },
    start: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({ version: '1.0.96', protocolVersion: 3 })),
    getAuthStatus: vi.fn(async () => ({ isAuthenticated: true, login: 'matt' })),
    listModels: vi.fn(async () => [
      { id: 'auto', name: 'Auto', capabilities: { supports: { reasoningEffort: false } } },
      {
        id: 'gpt-test',
        name: 'Test',
        capabilities: { supports: { reasoningEffort: true } },
        supportedReasoningEfforts: ['high'],
      },
    ]),
    createSession: vi.fn(async (c: SessionConfig) => {
      config = c;
      return session;
    }),
    resumeSession: vi.fn(async (_id: string, c: SessionConfig) => {
      config = c;
      return session;
    }),
    stop: vi.fn(async () => []),
    forceStop: vi.fn(async () => {}),
  };
  return {
    session,
    client,
    emit,
    get config() {
      return config;
    },
    setOnSend(fn: () => void) {
      onSend = fn;
    },
  };
}

describe('Copilot adapter transport contract (no real prompts)', () => {
  let storage: string;
  let fake: ReturnType<typeof transport>;
  let adapter: CopilotCliAdapter;
  let options: CopilotClientOptions | undefined;
  let callbacks: RunCallbacks;
  beforeEach(async () => {
    storage = await mkdtemp(join(tmpdir(), 'studio-adapter-test-'));
    fake = transport();
    callbacks = { onEvent: vi.fn(), onSession: vi.fn() };
    adapter = new CopilotCliAdapter({
      cliPath: process.execPath,
      launcherPath: resolve('scripts/copilot-launcher.js'),
      storagePath: storage,
      getTools: async () => [{ name: 'studio_read_file', handler: async () => 'file contents' }],
      clientFactory: (settings) => {
        options = settings;
        return fake.client as unknown as CopilotClient;
      },
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await adapter.dispose();
    await rm(storage, { recursive: true, force: true });
  });

  it('polls account credits without sessions, prompts, credentials in output or repeated launches', async () => {
    const first = await adapter.getAccountCredits();
    const second = await adapter.getAccountCredits();
    expect(first).toMatchObject({ state: 'ready', used: 123.5, included: 1500 });
    expect(JSON.stringify(second)).not.toContain('must-never-leave-host');
    expect(fake.client.start).toHaveBeenCalledOnce();
    expect(fake.client.rpc.account.getQuota).toHaveBeenCalledTimes(2);
    expect(fake.client.createSession).not.toHaveBeenCalled();
    expect(fake.session.send).not.toHaveBeenCalled();
    fake.client.rpc.account.getQuota.mockRejectedValueOnce(new Error('unsupported RPC'));
    expect(await adapter.getAccountCredits()).toMatchObject({ state: 'unavailable' });
    expect(fake.client.forceStop).toHaveBeenCalledOnce();
    expect((await adapter.getAccountCredits()).state).toBe('ready');
    expect(fake.client.start).toHaveBeenCalledTimes(2);
  });
  it('uses conversation overrides with no tools and preserves conversational Markdown', async () => {
    fake.session.rpc.tools.getCurrentMetadata.mockResolvedValue({ tools: [] });
    const request = input();
    request.mode = 'discussion';
    request.step.model = 'gpt-test';
    request.step.reasoning = 'high';
    request.preparedPrompt = 'Historical conversation';
    const result = await adapter.run(request, callbacks, new AbortController().signal);
    expect(fake.config).toMatchObject({
      availableTools: [],
      tools: [],
      reasoningEffort: 'high',
      model: 'gpt-test',
      mcpServers: {},
      enableSkills: false,
      enableHostGitOperations: false,
    });
    expect(fake.config?.systemMessage).toMatchObject({
      content: expect.stringContaining('conversation Feature Studio'),
    });
    expect(fake.session.send).toHaveBeenCalledWith({ prompt: 'Historical conversation' });
    expect(result.content).toBe('# Livrable\nBonjour Matt');
    expect(result.questions).toEqual([]);
  });
  it('refuses a discussion before any prompt when the runtime exposes a tool', async () => {
    const request = input();
    request.mode = 'discussion';
    await expect(adapter.run(request, callbacks, new AbortController().signal)).rejects.toThrow(
      'confinement',
    );
    expect(fake.session.send).not.toHaveBeenCalled();
  });

  it('checks live metadata without creating or sending a session', async () => {
    const status = await adapter.check();
    expect(status).toMatchObject({ state: 'ready', version: '1.0.96', authenticated: true });
    expect(status).toMatchObject({ cliPath: process.execPath, cliSource: 'configured' });
    expect(status.models.map((m) => m.id)).toEqual(['auto', 'gpt-test']);
    expect(fake.client.createSession).not.toHaveBeenCalled();
    expect(fake.session.send).not.toHaveBeenCalled();
    expect(options?.baseDirectory).toBe(join(storage, 'copilot-runtime'));
    expect(options?.workingDirectory).toBe(options?.baseDirectory);
    expect(options?.connection).toMatchObject({
      kind: 'stdio',
      path: resolve('scripts/copilot-launcher.js'),
    });
    expect(options?.env?.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(options?.connection && 'args' in options.connection && options.connection.args).toEqual([
      expect.stringContaining('config.json'),
      '--no-remote',
      '--no-custom-instructions',
      '--disable-builtin-mcps',
      '--disallow-temp-dir',
    ]);
  });
  it('keeps the resolved CLI path visible when authentication or startup fails', async () => {
    fake.client.getAuthStatus.mockResolvedValueOnce({ isAuthenticated: false, login: '' });
    expect(await adapter.check()).toMatchObject({
      state: 'unavailable',
      authenticated: false,
      cliPath: process.execPath,
      cliSource: 'configured',
    });
    fake.client.start.mockRejectedValueOnce(new Error('startup failed'));
    expect(await adapter.check()).toMatchObject({
      state: 'unavailable',
      cliPath: process.execPath,
      error: 'startup failed',
    });
    expect(fake.session.send).not.toHaveBeenCalled();
  });
  it('discovers server tools without prompt or model-visible execution tools', async () => {
    const catalog = await adapter.discoverMcp({
      id: 'fixture',
      name: 'Fixture',
      transport: 'stdio',
      command: 'node',
      args: ['fixture.mjs'],
      envKeys: [],
      headers: {},
      tools: [],
      enabled: false,
      autoApproveReadOnly: false,
    });
    expect(catalog.state).toBe('ready');
    expect(catalog.tools.map((t) => t.name)).toEqual(['read_story', 'write_story']);
    expect(fake.config?.availableTools).toEqual([]);
    expect(fake.config?.mcpServers?.fixture.tools).toEqual(['*']);
    expect(fake.session.send).not.toHaveBeenCalled();
  });
  it('streams actual deltas and returns only final artifact, observed model and usage', async () => {
    const result = await adapter.run(input(), callbacks, new AbortController().signal);
    expect(result).toMatchObject({
      content: '# Livrable\nBonjour Matt',
      sessionId: 'persistent-session',
      model: 'gpt-real',
      usage: { inputTokens: 8, outputTokens: 3, source: 'measured' },
    });
    expect(result.usage?.cost).toBeUndefined();
    expect(
      vi
        .mocked(callbacks.onEvent)
        .mock.calls.filter(([e]) => e.kind === 'message')
        .map(([e]) => e.message),
    ).toEqual(['Bonjour ', 'Matt']);
    expect(fake.session.rpc.tools.getCurrentMetadata).toHaveBeenCalledBefore(fake.session.send);
    expect(fake.session.disconnect).toHaveBeenCalled();
  });
  it('supplies exact allowlist, disables ambient settings and explicitly rejects native permissions', async () => {
    await adapter.run(input(), callbacks, new AbortController().signal);
    expect(fake.config).toMatchObject({
      availableTools: ['studio_read_file', 'studio_ask_human'],
      enableConfigDiscovery: false,
      enableFileHooks: false,
      enableSkills: false,
      skipCustomInstructions: true,
      remoteSession: 'off',
    });
    expect(fake.config?.tools?.[0]).toMatchObject({ skipPermission: true, defer: 'never' });
    const hook = fake.config?.hooks?.onPreToolUse;
    expect(
      await hook?.(
        {
          sessionId: 's',
          timestamp: new Date(),
          workingDirectory: '/workspace',
          toolName: 'bash',
          toolArgs: {},
        },
        { sessionId: 's' },
      ),
    ).toMatchObject({ permissionDecision: 'deny' });
    const permission = fake.config?.onPermissionRequest;
    expect(
      await permission?.(
        { kind: 'shell', fullCommandText: 'rm -rf /' } as Parameters<
          NonNullable<SessionConfig['onPermissionRequest']>
        >[0],
        { sessionId: 's' },
      ),
    ).toMatchObject({ kind: 'reject' });
  });
  it('adds selected MCP tools with exact provenance and both custom-agent namespace aliases', async () => {
    const run = input();
    run.mcpServers = [
      {
        id: 'fixture',
        name: 'Fixture',
        transport: 'stdio',
        command: 'node',
        args: ['fixture.mjs'],
        envKeys: [],
        headers: {},
        tools: ['read_story'],
        enabled: true,
        autoApproveReadOnly: false,
      },
    ];
    fake.session.rpc.tools.getCurrentMetadata.mockResolvedValue({
      tools: [
        { name: 'studio_read_file', description: 'Read' },
        { name: 'studio_ask_human', description: 'Ask' },
        {
          name: 'fixture-read_story',
          description: 'Read story',
          mcpServerName: 'fixture',
          mcpToolName: 'read_story',
          namespacedName: 'fixture/read_story',
        },
      ],
    });
    let decision: unknown;
    fake.setOnSend(() => {
      decision = fake.config!.hooks!.onPreToolUse!(
        {
          sessionId: 's',
          timestamp: new Date(),
          workingDirectory: '/workspace',
          toolName: 'fixture-read_story',
          toolArgs: { id: 1 },
        },
        { sessionId: 's' },
      );
      fake.emit('assistant.message', { content: 'Final' });
      fake.emit('session.idle', {});
    });
    await adapter.run(run, callbacks, new AbortController().signal);
    expect(decision).toEqual({});
    expect(fake.config?.availableTools).toEqual([
      'studio_read_file',
      'studio_ask_human',
      'fixture-read_story',
    ]);
    expect(fake.config?.customAgents?.[0].tools).toEqual([
      'studio_read_file',
      'studio_ask_human',
      'fixture-read_story',
      'fixture/read_story',
    ]);
    expect(fake.config?.customAgents?.[0].prompt).not.toContain(run.agent.instructions);
    expect(fake.config?.managedSettings?.permissions?.ask).toEqual(['Mcp(fixture/read_story)']);
    expect(fake.session.rpc.permissions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        approveAllReadPermissionRequests: false,
        approveAllToolPermissionRequests: false,
      }),
    );
    fake.session.rpc.managedSettings.get.mockRejectedValue(
      new Error('Unhandled method session.managedSettings.get'),
    );
    fake.session.send.mockClear();
    await expect(adapter.run(run, callbacks, new AbortController().signal)).rejects.toThrow(
      'confinement des outils non vérifiable',
    );
    expect(fake.session.send).not.toHaveBeenCalled();
  });
  it('refuses paid send when runtime exposes native tools or cannot introspect them', async () => {
    fake.session.rpc.tools.getCurrentMetadata.mockResolvedValue({
      tools: [{ name: 'bash', description: 'Shell' }],
    });
    await expect(adapter.run(input(), callbacks, new AbortController().signal)).rejects.toThrow(
      'confinement des outils non vérifiable',
    );
    expect(fake.session.send).not.toHaveBeenCalled();
    fake.session.rpc.tools.initializeAndValidate.mockRejectedValue(new Error('Method not found'));
    await expect(adapter.run(input(), callbacks, new AbortController().signal)).rejects.toThrow(
      'Method not found',
    );
    expect(fake.session.send).not.toHaveBeenCalled();
  });
  it('never invents a model or zero cost when runtime omits usage', async () => {
    fake.setOnSend(() => {
      fake.emit('assistant.message', { content: 'Final' });
      fake.emit('session.idle', {});
    });
    const result = await adapter.run(input(), callbacks, new AbortController().signal);
    expect(result.model).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });
  it('sends the exact prepared preview and never silently recompiles it', async () => {
    const run = input();
    run.preparedPrompt = 'Exact reviewed prompt';
    await adapter.run(run, callbacks, new AbortController().signal);
    expect(fake.session.send).toHaveBeenCalledWith({ prompt: 'Exact reviewed prompt' });
  });
  it('waits for a real human answer inside the same run', async () => {
    let answer!: (value: string) => void;
    callbacks.onQuestion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    let toolResponse: unknown;
    fake.setOnSend(() => {
      const tool = fake.config!.tools!.find((t) => t.name === 'studio_ask_human')!;
      void Promise.resolve(
        tool.handler!(
          { question: 'Quel périmètre ?', choices: ['A', 'B'], allowFreeform: false },
          { sessionId: 's', toolCallId: 'ask', toolName: tool.name, arguments: {} },
        ),
      ).then(
        (result) => {
          toolResponse = result;
          fake.emit('assistant.message', { content: 'Livrable après réponse' });
          fake.emit('session.idle', {});
        },
        (error) => fake.emit('session.error', { message: String(error), errorType: 'tool' }),
      );
    });
    let finished = false;
    const run = adapter.run(input(), callbacks, new AbortController().signal).then((result) => {
      finished = true;
      return result;
    });
    await vi.waitFor(() => expect(callbacks.onQuestion).toHaveBeenCalled());
    expect(finished).toBe(false);
    answer('B');
    expect((await run).content).toBe('Livrable après réponse');
    expect(toolResponse).toMatchObject({ textResultForLlm: '{"answer":"B"}' });
  });
  it('excludes human thinking time from the execution deadline', async () => {
    vi.useFakeTimers();
    let answer!: (value: string) => void;
    callbacks.onQuestion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    fake.setOnSend(() => {
      const tool = fake.config!.tools!.find((t) => t.name === 'studio_ask_human')!;
      void Promise.resolve(
        tool.handler!(
          { question: 'Ton choix ?' },
          { sessionId: 's', toolCallId: 'wait', toolName: tool.name, arguments: {} },
        ),
      ).then(() => {
        fake.emit('assistant.message', { content: 'Travail terminé après la vraie réponse.' });
        fake.emit('session.idle', {});
      });
    });
    const request = input();
    request.settings.timeoutMinutes = 1;
    const running = adapter.run(request, callbacks, new AbortController().signal);
    await vi.waitFor(() => expect(callbacks.onQuestion).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(180000);
    expect(fake.session.abort).not.toHaveBeenCalled();
    answer('Mon choix');
    expect((await running).content).toContain('vraie réponse');
  });
  it('rejects absent human dialogs instead of inventing a default answer', async () => {
    fake.setOnSend(() => {
      const tool = fake.config!.tools!.find((t) => t.name === 'studio_ask_human')!;
      void Promise.resolve(
        tool.handler!(
          { question: 'Question ?' },
          { sessionId: 's', toolCallId: 'ask', toolName: tool.name, arguments: {} },
        ),
      ).then(
        () => fake.emit('session.idle', {}),
        (error) => fake.emit('session.error', { message: String(error), errorType: 'tool' }),
      );
    });
    await expect(adapter.run(input(), callbacks, new AbortController().signal)).rejects.toThrow(
      'Aucun dialogue humain',
    );
  });
  it('cancels a pending human question without sending an invented answer', async () => {
    const controller = new AbortController();
    callbacks.onQuestion = vi.fn(() => new Promise<string>(() => {}));
    fake.setOnSend(() => {
      const tool = fake.config!.tools!.find((t) => t.name === 'studio_ask_human')!;
      void Promise.resolve(
        tool.handler!(
          { question: 'Question ?' },
          { sessionId: 's', toolCallId: 'ask', toolName: tool.name, arguments: {} },
        ),
      ).catch(() => {});
    });
    const run = adapter.run(input(), callbacks, controller.signal);
    const rejected = expect(run).rejects.toThrow('annulée');
    await vi.waitFor(() => expect(callbacks.onQuestion).toHaveBeenCalled());
    controller.abort();
    await rejected;
    expect(fake.session.abort).toHaveBeenCalled();
  });
  it('reports cumulative deduplicated usage before logs, including usage before a budget cancellation', async () => {
    const controller = new AbortController();
    const order: string[] = [];
    callbacks.onEvent = (event) => {
      if (event.kind === 'usage') order.push('event');
    };
    callbacks.onUsage = vi.fn((snapshot) => {
      order.push('usage');
      if ((snapshot.inputTokens ?? 0) >= 20) controller.abort(new Error('Budget dépassé'));
    });
    fake.setOnSend(() => {
      const usage = {
        model: 'real-model',
        inputTokens: 10,
        outputTokens: 2,
        apiCallId: 'call-1',
        copilotUsage: { totalNanoAiu: 50 },
      };
      fake.emit('assistant.usage', usage, { id: 'usage-1' });
      fake.emit('assistant.usage', usage, { id: 'usage-1' });
      fake.emit('assistant.usage', usage, { id: 'usage-other-id' });
      fake.emit('assistant.usage', { ...usage, apiCallId: 'call-2' }, { id: 'usage-2' });
    });
    await expect(adapter.run(input(), callbacks, controller.signal)).rejects.toThrow(
      'Budget dépassé',
    );
    expect(callbacks.onUsage).toHaveBeenCalledTimes(2);
    expect(callbacks.onUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputTokens: 20, outputTokens: 4, cost: 100, unit: 'nano-AIU' }),
    );
    expect(order.slice(0, 2)).toEqual(['usage', 'event']);
    expect(fake.session.abort).toHaveBeenCalled();
  });
  it('keeps incomplete accounting markers after later complete usage events', async () => {
    callbacks.onUsage = vi.fn();
    fake.setOnSend(() => {
      fake.emit('assistant.usage', {
        inputTokens: 10,
        outputTokens: 2,
        copilotUsage: { totalNanoAiu: 50 },
      });
      fake.emit('assistant.usage', { inputTokens: 3 });
      fake.emit('assistant.usage', {
        inputTokens: 4,
        outputTokens: 1,
        copilotUsage: { totalNanoAiu: 0 },
      });
      fake.emit('assistant.message', { messageId: 'answer', content: 'Livrable' });
      fake.emit('session.idle', {});
    });
    const result = await adapter.run(input(), callbacks, new AbortController().signal);
    expect(callbacks.onUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ inputTokens: 10, outputTokens: 2, cost: 50 }),
    );
    expect(callbacks.onUsage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        inputTokens: 13,
        outputTokens: 2,
        cost: 50,
        incompleteTokens: true,
        incompleteCost: true,
      }),
    );
    expect(result.usage).toEqual(
      expect.objectContaining({
        inputTokens: 17,
        outputTokens: 3,
        cost: 50,
        incompleteTokens: true,
        incompleteCost: true,
      }),
    );
  });
  it('restores permission filters, handlers and agent config on resume', async () => {
    const run = input();
    run.resumeSessionId = 'previous-session';
    await adapter.run(run, callbacks, new AbortController().signal);
    expect(fake.client.resumeSession).toHaveBeenCalledWith(
      'previous-session',
      expect.objectContaining({
        availableTools: ['studio_read_file', 'studio_ask_human'],
        allowTranscriptRecovery: false,
        agent: 'feature-studio',
      }),
    );
    expect(fake.client.createSession).not.toHaveBeenCalled();
  });
  it('still stops the runtime gracefully when legacy CLI rejects session.detach', async () => {
    fake.session.disconnect.mockRejectedValue(new Error('Unhandled method session.detach'));
    const result = await adapter.run(input(), callbacks, new AbortController().signal);
    expect(result.content).toContain('Bonjour Matt');
    expect(fake.client.stop).toHaveBeenCalled();
    expect(fake.client.forceStop).toHaveBeenCalled();
  });
  it('refuses unavailable model and reasoning before creating a session', async () => {
    const run = input();
    run.step.model = 'unavailable';
    await expect(adapter.run(run, callbacks, new AbortController().signal)).rejects.toThrow(
      'n’est pas proposé',
    );
    run.step.model = 'auto';
    run.step.reasoning = 'high';
    await expect(adapter.run(run, callbacks, new AbortController().signal)).rejects.toThrow(
      'niveau de raisonnement',
    );
    expect(fake.client.createSession).not.toHaveBeenCalled();
  });
  it('aborts SDK work and rejects partial output when human cancels', async () => {
    const controller = new AbortController();
    fake.setOnSend(() => {
      fake.emit('assistant.message_delta', { messageId: 'x', deltaContent: 'Partiel' });
      controller.abort();
    });
    await expect(adapter.run(input(), callbacks, controller.signal)).rejects.toThrow('annulée');
    expect(fake.session.abort).toHaveBeenCalled();
    expect(fake.session.disconnect).toHaveBeenCalled();
  });
  it('wait timeout aborts runtime rather than merely abandoning the wait', async () => {
    vi.useFakeTimers();
    fake.setOnSend(() => {});
    const run = input();
    run.settings.timeoutMinutes = 1;
    const result = adapter.run(run, callbacks, new AbortController().signal);
    const rejected = expect(result).rejects.toThrow('Délai maximal');
    await vi.waitFor(() => expect(fake.session.send).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(60_001);
    await rejected;
    expect(fake.session.abort).toHaveBeenCalled();
  });
  it('propagates quota errors rather than treating stream as a successful artifact', async () => {
    fake.setOnSend(() =>
      fake.emit('session.error', { message: 'Quota épuisé', errorType: 'quota' }),
    );
    await expect(adapter.run(input(), callbacks, new AbortController().signal)).rejects.toThrow(
      'Quota épuisé',
    );
  });
  it('does not finalize an aborted idle or incomplete message', async () => {
    fake.setOnSend(() => {
      fake.emit('assistant.message', { content: 'Partiel' });
      fake.emit('session.idle', { aborted: true });
    });
    await expect(adapter.run(input(), callbacks, new AbortController().signal)).rejects.toThrow(
      'annulée',
    );
    fake.setOnSend(() => {
      fake.emit('assistant.message_delta', { deltaContent: 'Partiel', messageId: 'x' });
      fake.emit('session.idle', {});
    });
    await expect(adapter.run(input(), callbacks, new AbortController().signal)).rejects.toThrow(
      'sans livrable final',
    );
  });
});

describe('human questions and canonical approved context', () => {
  it('parses strict review reports and never invents a pass for unstructured text', () => {
    expect(parseReview('Looks fine')).toBeUndefined();
    expect(
      parseReview(
        '```feature-studio-review\n{"verdict":"changes_requested","summary":"Bug observé","findings":[{"id":"bug","severity":"blocking","message":"Corriger","file":"app.ts","line":5}]}\n```',
      ),
    ).toMatchObject({ verdict: 'changes_requested', findings: [{ id: 'bug', line: 5 }] });
    expect(() =>
      parseReview(
        '```feature-studio-review\n{"verdict":"pass","summary":"OK","findings":[{"id":"bug","severity":"blocking","message":"Bug"}]}\n```',
      ),
    ).toThrow('contradictoire');
    expect(() =>
      parseReview(
        '```feature-studio-review\n{"verdict":"pass","summary":"OK","findings":[],"approved":true}\n```',
      ),
    ).toThrow('contrat');
  });
  it('extracts strict question JSON and preserves normal JSON code examples', () => {
    const text =
      '# Spec\n```json\n{"name":"example"}\n```\n```feature-studio-questions\n{"questions":[{"id":"scope","text":"Quel périmètre ?","choices":["A","B"]}]}\n```';
    expect(parseQuestions(text)).toEqual({
      content: '# Spec\n```json\n{"name":"example"}\n```',
      questions: [{ id: 'scope', text: 'Quel périmètre ?', choices: ['A', 'B'] }],
    });
  });
  it.each([
    '```feature-studio-questions\n{',
    '```feature-studio-questions\n{"questions":[{"id":"constructor","text":"Danger"}]}\n```',
    '```feature-studio-questions\n{"questions":[{"id":"q","text":"A"},{"id":"q","text":"B"}]}\n```',
    '```feature-studio-questions\n{"questions":[{"id":"q","text":"A","answer":"invented"}]}\n```',
  ])('refuses malformed or ambiguous question payload %s', (text) =>
    expect(() => parseQuestions(text)).toThrow(),
  );
  it('includes only latest approved attempts in currently approved steps', () => {
    const run = input();
    const old = {
      ...run.attempt,
      status: 'approved' as const,
      artifact: { name: 'spec', content: 'OBSOLETE', updatedAt: '' },
    };
    const current = { ...old, artifact: { name: 'spec', content: 'CURRENT', updatedAt: '' } };
    run.feature.steps.push({
      ...run.step,
      id: 'upstream',
      status: 'approved',
      attempts: [old, current],
    });
    run.feature.steps.push({ ...run.step, id: 'stale', status: 'stale', attempts: [old] });
    const prompt = buildPrompt(run);
    expect(prompt).toContain('CURRENT');
    expect(prompt).not.toContain('OBSOLETE');
  });
});
