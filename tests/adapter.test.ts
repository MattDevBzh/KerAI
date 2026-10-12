import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CopilotClient,
  CopilotClientOptions,
  SessionConfig,
  SessionEvent,
} from '@github/copilot-sdk';
import { buildPrompt, CopilotCliAdapter, parseQuestions } from '../src/host/CopilotCliAdapter';
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
      tools: {
        initializeAndValidate: vi.fn(async () => ({})),
        getCurrentMetadata: vi.fn(async () => ({
          tools: [{ name: 'studio_read_file', description: 'Read' }],
        })),
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
      cliPath: '/bin/copilot',
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

  it('checks live metadata without creating or sending a session', async () => {
    const status = await adapter.check();
    expect(status).toMatchObject({ state: 'ready', version: '1.0.96', authenticated: true });
    expect(status.models.map((m) => m.id)).toEqual(['auto', 'gpt-test']);
    expect(fake.client.createSession).not.toHaveBeenCalled();
    expect(fake.session.send).not.toHaveBeenCalled();
    expect(options?.baseDirectory).toBe(join(storage, 'copilot-runtime'));
    expect(options?.workingDirectory).toBe(options?.baseDirectory);
    expect(options?.connection).toMatchObject({ kind: 'stdio', path: '/bin/copilot' });
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
      availableTools: ['studio_read_file'],
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
  it('restores permission filters, handlers and agent config on resume', async () => {
    const run = input();
    run.resumeSessionId = 'previous-session';
    await adapter.run(run, callbacks, new AbortController().signal);
    expect(fake.client.resumeSession).toHaveBeenCalledWith(
      'previous-session',
      expect.objectContaining({
        availableTools: ['studio_read_file'],
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
