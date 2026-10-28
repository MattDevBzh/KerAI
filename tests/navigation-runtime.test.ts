import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CopilotClient,
  SessionConfig,
  SessionEvent,
  Tool,
  ModelInfo,
} from '@github/copilot-sdk';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';
import { NATIVE_READ_TOOLS } from '../src/host/NativeCopilot';
import { navigationTools } from '../src/host/NavigationTools';
import type { NavigationService } from '../src/host/NavigationService';
import { screenshot } from './image-fixture';
import type { RunInput, RunCallbacks } from '../src/shared/types';
import type { NavigationContextSnapshot } from '../src/shared/navigation';

function runInput(): RunInput {
  const attempt = {
    id: 'attempt',
    startedAt: '2026-10-23T10:00:00.000Z',
    status: 'running' as const,
    feedback: '',
    logs: [],
    questions: [],
    answers: {},
    changedFiles: [],
  };
  const step = {
    id: 'step',
    name: 'Navigation',
    description: 'Lire le code et le navigateur',
    agentId: 'fs-navigator',
    policy: 'read-only' as const,
    skills: [],
    maxAttempts: 3,
    artifact: 'observation.md',
    dependsOn: [],
    status: 'running' as const,
    attempts: [attempt],
  };
  const navigation: NavigationContextSnapshot = {
    selection: {
      applicationId: 'app',
      parameters: {},
      intent: 'reach-state',
      allowInteractions: true,
    },
    application: {
      id: 'app',
      name: 'Synthetic',
      projectIds: [],
      origin: 'http://localhost:3999',
      allowedOrigins: ['http://localhost:3999'],
      interactionPolicy: 'confirm',
      ownerNavigatorId: 'fs-navigator',
      createdAt: '2026-10-23T10:00:00.000Z',
      updatedAt: '2026-10-23T10:00:00.000Z',
    },
    contextText: 'Contexte navigation synthétique',
    digest: 'a'.repeat(64),
  };
  return {
    navigation,
    feature: {
      id: 'feature',
      title: 'Navigation',
      description: 'Lire',
      workflowId: 'flow',
      workflowName: 'Flow',
      createdAt: 'date',
      updatedAt: 'date',
      branch: 'main',
      status: 'running',
      activeStepId: 'step',
      steps: [step],
      execution: { mode: 'copilot-native', permissionMode: 'manual' },
    },
    step,
    attempt,
    agent: {
      id: 'fs-navigator',
      name: 'Navigateur',
      description: 'Navigation',
      instructions: 'Observe',
      tools: ['read', 'navigation'],
      skills: [],
      path: '',
      source: 'bundled',
    },
    skills: [],
    workspacePath: '/synthetic',
    settings: { defaultModel: '', timeoutMinutes: 1, testCommands: [], testPaths: [], hooks: [] },
  };
}
/** Models the SDK transport boundary only. No CLI, browser or model inference is invoked. */
function mockRuntime() {
  let config: SessionConfig | undefined;
  let listener: ((event: SessionEvent) => void) | undefined;
  let mode = 'manual';
  let extraTool: string | undefined;
  let onSend: (() => Promise<void>) | undefined;
  const session = {
    sessionId: 'runtime-navigation',
    rpc: {
      instructions: { getSources: vi.fn(async () => ({ sources: [] })) },
      managedSettings: { get: vi.fn(async () => ({ failClosed: false })) },
      permissions: {
        configure: vi.fn(async () => ({ success: true })),
        setMode: vi.fn(async (value: { mode: string }) => {
          mode = value.mode;
          return { success: true, mode };
        }),
        getMode: vi.fn(async () => ({ mode })),
      },
      tools: {
        initializeAndValidate: vi.fn(async () => ({})),
        getCurrentMetadata: vi.fn(async () => ({
          tools: [
            ...(Array.isArray(config?.availableTools) ? config.availableTools : []),
            ...(extraTool ? [extraTool] : []),
          ].map((name) => ({ name, description: name })),
        })),
      },
    },
    on: vi.fn((callback: (event: SessionEvent) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    }),
    send: vi.fn(async () => {
      await onSend?.();
      for (const [type, data] of [
        ['assistant.message', { messageId: 'answer', content: 'Observation locale simulée.' }],
        ['session.idle', {}],
      ] as const)
        listener?.({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          parentId: null,
          type,
          data,
        } as SessionEvent);
      return 'message';
    }),
    abort: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  const client = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => []),
    forceStop: vi.fn(async () => undefined),
    getAuthStatus: vi.fn(async () => ({ isAuthenticated: true })),
    listModels: vi.fn(async (): Promise<ModelInfo[]> => []),
    createSession: vi.fn(async (value: SessionConfig) => {
      config = value;
      return session;
    }),
    resumeSession: vi.fn(async (_id: string, value: SessionConfig) => {
      config = value;
      return session;
    }),
  };
  return {
    client,
    session,
    get config() {
      return config;
    },
    setOnSend(handler: () => Promise<void>) {
      onSend = handler;
    },
    emit(event: SessionEvent) {
      listener?.(event);
    },
    injectUnexpectedTool(name: string) {
      extraTool = name;
    },
  };
}
let storage: string;
let adapter: CopilotCliAdapter;
let runtime: ReturnType<typeof mockRuntime>;
let getTools: ReturnType<
  typeof vi.fn<(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal) => Promise<Tool[]>>
>;
const hostTools = [
  'studio_navigation_search',
  'studio_navigation_context',
  'studio_navigation_propose',
  'studio_navigation_commit',
  'studio_browser_inspect',
  'studio_browser_act',
  'studio_browser_capture',
  'studio_read_file',
  'studio_write_file',
  'studio_apply_patch',
  'studio_run_command',
  'studio_run_test',
  'studio_devops_write',
  'studio_remote_review',
  'studio_read_personal_resource',
  'studio_write_review_report',
];
beforeEach(async () => {
  storage = await mkdtemp(join(tmpdir(), 'navigation-runtime-'));
  runtime = mockRuntime();
  getTools = vi.fn(async (_input: RunInput, _callbacks: RunCallbacks, _signal: AbortSignal) =>
    hostTools.map((name) => ({ name, handler: async () => 'host-fixture' }) as Tool),
  );
  adapter = new CopilotCliAdapter({
    cliPath: process.execPath,
    launcherPath: resolve('scripts/copilot-launcher.js'),
    storagePath: storage,
    getTools,
    clientFactory: () => runtime.client as unknown as CopilotClient,
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await adapter.dispose();
  await rm(storage, { recursive: true, force: true });
});
const callbacks = { onEvent: vi.fn(), onSession: vi.fn() };
describe('navigation model-facing catalog with simulated SDK transport', () => {
  it('keeps optional screenshot pixels out of archived SDK traces', async () => {
    const traces: string[] = [];
    runtime.setOnSend(async () => {
      runtime.emit({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        parentId: null,
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'image',
          success: true,
          result: {
            content: 'Image consultée',
            binaryResultsForLlm: [
              { type: 'image', mimeType: 'image/png', data: 'PRIVATE_SCREENSHOT_BASE64' },
            ],
          },
        },
      } as SessionEvent);
    });
    await adapter.run(
      runInput(),
      {
        ...callbacks,
        onTrace: (trace) => {
          traces.push(trace.data);
        },
      },
      new AbortController().signal,
    );
    expect(traces.some((trace) => trace.includes('image/png'))).toBe(true);
    expect(traces.join('\n')).not.toContain('PRIVATE_SCREENSHOT_BASE64');
  });
  it('keeps only native reads and closed browser/navigation tools for a read-only Navigator', async () => {
    const input = runInput();
    input.mcpServers = [
      {
        id: 'unsafe',
        name: 'External MCP',
        transport: 'stdio',
        command: 'never-launch',
        args: [],
        envKeys: [],
        headers: {},
        tools: ['write_everything'],
        enabled: true,
        autoApproveReadOnly: true,
      },
    ];
    await adapter.run(input, callbacks, new AbortController().signal);
    const configured = runtime.config!;
    expect(getTools).toHaveBeenCalledOnce();
    expect(runtime.session.rpc.tools.getCurrentMetadata).toHaveBeenCalledOnce();
    const names = configured.availableTools as string[];
    for (const name of NATIVE_READ_TOOLS) expect(names).toContain(name);
    for (const name of [
      'studio_navigation_search',
      'studio_navigation_commit',
      'studio_browser_act',
      'studio_browser_inspect',
    ])
      expect(names).toContain(name);
    for (const name of [
      'edit',
      'create',
      'apply_patch',
      'bash',
      'powershell',
      'write_bash',
      'studio_write_file',
      'studio_apply_patch',
      'studio_run_command',
      'studio_run_test',
      'studio_devops_write',
      'studio_remote_review',
      'studio_read_personal_resource',
      'studio_write_review_report',
    ])
      expect(names).not.toContain(name);
    expect(configured.mcpServers ?? {}).toEqual({});
    expect(names.some((name) => name.includes('*'))).toBe(false);
    expect(runtime.session.send).toHaveBeenCalledOnce();
  });
  it('offers browser inspection in planning while keeping interactions and publication unavailable', async () => {
    const input = runInput();
    input.nativeReadOnly = true;
    await adapter.run(input, callbacks, new AbortController().signal);
    expect(getTools).toHaveBeenCalledOnce();
    expect(runtime.config!.availableTools).toEqual(
      expect.arrayContaining([
        'studio_navigation_search',
        'studio_navigation_context',
        'studio_browser_inspect',
      ]),
    );
    for (const name of [
      'studio_browser_act',
      'studio_navigation_replay',
      'studio_navigation_commit',
      'studio_navigation_propose',
    ])
      expect(runtime.config!.availableTools).not.toContain(name);
    expect(runtime.config!.mcpServers ?? {}).toEqual({});
  });
  it('fails before any prompt if the runtime returns an unexpected editor despite the allowlist', async () => {
    runtime.injectUnexpectedTool('edit');
    await expect(adapter.run(runInput(), callbacks, new AbortController().signal)).rejects.toThrow(
      /Catalogue natif inattendu/,
    );
    expect(runtime.session.send).not.toHaveBeenCalled();
  });
  it('refuses to start a navigation prompt with a missing host catalog', async () => {
    getTools.mockResolvedValue([]);
    await expect(adapter.run(runInput(), callbacks, new AbortController().signal)).rejects.toThrow(
      /outils de navigation ne sont pas chargés/,
    );
    expect(runtime.session.send).not.toHaveBeenCalled();
  });
});

function visionModel(
  id: string,
  vision: boolean,
  media = ['image/png'],
  maxBytes = 2 * 1024 * 1024,
): ModelInfo {
  return {
    id,
    name: id,
    capabilities: {
      supports: { vision, reasoningEffort: false },
      limits: {
        vision: {
          max_prompt_images: 4,
          max_prompt_image_size: maxBytes,
          supported_media_types: media,
        },
      },
    },
  } as ModelInfo;
}
function captureService(input: RunInput): NavigationService {
  const bytes = Buffer.from(screenshot.data, 'base64');
  const context = input.navigation!;
  return {
    beginAgent: vi.fn(),
    assertAgent: vi.fn(() => context),
    snapshot: vi.fn(() => ({
      captures: [
        {
          id: screenshot.id,
          applicationId: context.application.id,
          attemptId: input.attempt.id,
          bytes: bytes.length,
          sha256: 'b'.repeat(64),
        },
      ],
    })),
    verifiedCapture: vi.fn(async () => bytes),
  } as unknown as NavigationService;
}

describe('explicit navigation image request through simulated SDK callbacks', () => {
  it.each([
    {
      label: 'selected vision model',
      model: 'vision',
      expected: 'success',
      media: ['image/png'],
      bytes: 2097152,
    },
    {
      label: 'selected text-only model',
      model: 'text',
      expected: 'failure',
      media: ['image/png'],
      bytes: 2097152,
    },
    {
      label: 'no explicitly selected model',
      model: undefined,
      expected: 'failure',
      media: ['image/png'],
      bytes: 2097152,
    },
    {
      label: 'model format restriction',
      model: 'vision',
      expected: 'failure',
      media: ['image/jpeg'],
      bytes: 2097152,
    },
    {
      label: 'model byte restriction',
      model: 'vision',
      expected: 'failure',
      media: ['image/png'],
      bytes: 16,
    },
  ])('respects $label before returning image pixels', async ({ model, expected, media, bytes }) => {
    const input = runInput();
    input.step.model = model;
    runtime.client.listModels.mockResolvedValue([
      visionModel('vision', true, media, bytes),
      visionModel('text', false),
    ]);
    const service = captureService(input);
    getTools.mockImplementation(async (resolved, wrapped, signal) =>
      navigationTools(service, resolved, wrapped, signal),
    );
    let result: { resultType?: string; binaryResultsForLlm?: unknown[] } | undefined;
    runtime.setOnSend(async () => {
      const tool = runtime.config!.tools!.find(
        (item) => item.name === 'studio_browser_view_capture',
      )!;
      result = (await tool.handler!({ captureId: screenshot.id }, {} as never)) as typeof result;
    });
    await adapter.run(input, callbacks, new AbortController().signal);
    expect(result?.resultType).toBe(expected);
    if (expected === 'success') expect(result?.binaryResultsForLlm).toHaveLength(1);
    else expect(result?.binaryResultsForLlm).toBeUndefined();
    expect(runtime.config!.model).toBe(model);
    expect(runtime.session.send).toHaveBeenCalledOnce();
  });
  it('enforces the attempt budget of four explicit image transfers', async () => {
    const input = runInput();
    input.step.model = 'vision';
    runtime.client.listModels.mockResolvedValue([visionModel('vision', true)]);
    const service = captureService(input);
    getTools.mockImplementation(async (resolved, wrapped, signal) =>
      navigationTools(service, resolved, wrapped, signal),
    );
    const results: { resultType: string; binaryResultsForLlm?: unknown[] }[] = [];
    runtime.setOnSend(async () => {
      const tool = runtime.config!.tools!.find(
        (item) => item.name === 'studio_browser_view_capture',
      )!;
      for (let index = 0; index < 5; index++)
        results.push(
          (await tool.handler!(
            { captureId: screenshot.id },
            {} as never,
          )) as (typeof results)[number],
        );
    });
    await adapter.run(input, callbacks, new AbortController().signal);
    expect(results.map((result) => result.resultType)).toEqual([
      'success',
      'success',
      'success',
      'success',
      'failure',
    ]);
    expect(results[4].binaryResultsForLlm).toBeUndefined();
  });
});

describe('navigation intervention lifecycle through simulated SDK', () => {
  it('denies further native and host tools while preserving the human question tool', async () => {
    const decisions: Record<string, unknown> = {};
    runtime.setOnSend(async () => {
      for (const toolName of [
        'view',
        'studio_browser_act',
        'studio_navigation_search',
        'ask_user',
      ]) {
        decisions[toolName] = await runtime.config!.hooks!.onPreToolUse!(
          { toolName, toolArgs: {} } as never,
          {} as never,
        );
      }
    });
    await adapter.run(
      runInput(),
      { ...callbacks, navigationBlocked: () => true },
      new AbortController().signal,
    );
    for (const name of ['view', 'studio_browser_act', 'studio_navigation_search'])
      expect(decisions[name]).toMatchObject({ permissionDecision: 'deny' });
    expect(decisions.ask_user).toEqual({});
  });
  it('suspends the active deadline while a host navigation permission question awaits the human', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let answer!: (value: string) => void;
    const onQuestion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    getTools.mockImplementation(async (_input, wrapped) => [
      ...['studio_navigation_search', 'studio_navigation_context', 'studio_browser_inspect'].map(
        (name) => ({ name, handler: async () => 'fixture' }) as Tool,
      ),
      {
        name: 'studio_browser_act',
        handler: async () =>
          wrapped.onQuestion!({
            question: 'Autoriser cette interaction ?',
            choices: ['Autoriser', 'Refuser'],
            allowFreeform: false,
          }),
      },
    ]);
    runtime.setOnSend(async () => {
      const tool = runtime.config!.tools!.find((item) => item.name === 'studio_browser_act')!;
      await tool.handler!({}, {} as never);
    });
    const active = adapter.run(
      runInput(),
      { ...callbacks, onQuestion },
      new AbortController().signal,
    );
    const settled = active.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    try {
      await vi.waitFor(() => expect(onQuestion).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(120000);
      expect(runtime.session.abort).not.toHaveBeenCalled();
      answer('Autoriser');
      expect(await settled).toMatchObject({ value: { content: 'Observation locale simulée.' } });
    } finally {
      answer?.('Refuser');
    }
  });
});
