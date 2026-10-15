import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscussionService, type DiscussionProfile } from '../src/host/DiscussionService';
import { parseMessage } from '../src/host/messages';
import type { AgentAdapter, RunInput, RunCallbacks } from '../src/shared/types';
import { discussionUsage } from '../src/core/discussionUsage';
import { analyzeUsage } from '../src/core/analytics';

describe('persisted discussions', () => {
  let directory: string;
  let service: DiscussionService;
  let trusted: boolean;
  let profiles: DiscussionProfile[];
  let adapter: AgentAdapter;
  const input = (discussionId = randomUUID()) => ({
    type: 'sendDiscussion' as const,
    requestId: randomUUID(),
    discussionId,
    agentKey: 'global:guide',
    content: 'Explique le choix.',
    model: 'model-a',
    reasoning: 'high',
  });
  const create = () =>
    new DiscussionService({
      directory,
      workspacePath: directory,
      profiles: async () => structuredClone(profiles),
      adapter: async () => adapter,
      defaults: () => ({ defaultModel: 'default-model', timeoutMinutes: 10 }),
      assertTrusted: () => {
        if (!trusted) throw new Error('Not trusted');
      },
    });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-discussions-'));
    trusted = true;
    profiles = [
      {
        key: 'global:guide',
        profile: {
          id: 'guide',
          name: 'Guide',
          nickname: 'Ada',
          description: 'Conseiller',
          instructions: 'Clarifier les décisions.',
          source: 'user',
          path: '/personal/guide.agent.md',
          tools: ['read', 'edit'],
          skills: ['method'],
          avatar: 'software-architect',
          discussionAgent: true,
        },
        skills: [
          {
            id: 'method',
            name: 'Méthode',
            description: '',
            content: 'Comparer les compromis.',
            path: '/personal/method',
            source: 'user',
          },
        ],
      },
    ];
    adapter = {
      check: vi.fn(),
      dispose: vi.fn(),
      run: vi.fn(async (_input: RunInput, callbacks: RunCallbacks) => {
        callbacks.onEvent({
          id: 'event',
          at: new Date().toISOString(),
          kind: 'message',
          message: 'Une réponse',
        });
        callbacks.onUsage?.({
          source: 'measured',
          inputTokens: 12,
          outputTokens: 3,
          cost: 24,
          unit: 'nano-AIU',
        });
        return {
          content: 'Une réponse complète.',
          model: 'model-actual',
          questions: [],
          changedFiles: [],
        };
      }),
    };
    service = create();
    await service.initialize();
  });
  afterEach(async () => {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  it('keeps instructions, skills, ordered history and per-turn model/avatar snapshots across reloads', async () => {
    const first = input();
    await service.send(first);
    await service.settled();
    const run = vi.mocked(adapter.run).mock.calls[0][0];
    expect(run).toMatchObject({
      mode: 'discussion',
      workspacePath: directory,
      step: { model: 'model-a', reasoning: 'high', policy: 'read-only' },
    });
    expect(run.preparedPrompt).toContain('Clarifier les décisions.');
    expect(run.preparedPrompt).toContain('Comparer les compromis.');
    expect(run.settings.hooks).toEqual([]);
    expect(run.mcpServers).toBeUndefined();
    expect(service.state.discussions[0].messages[1]).toMatchObject({
      status: 'complete',
      content: 'Une réponse complète.',
      agent: { nickname: 'Ada' },
      model: 'model-actual',
      usage: { inputTokens: 12 },
    });
    await service.dispose();
    service = create();
    await service.initialize();
    expect(service.state.discussions[0].id).toBe(first.discussionId);
    profiles[0].profile.nickname = 'Nouveau nom';
    await service.send({
      ...input(first.discussionId),
      content: 'Et ensuite ?',
      model: 'model-b',
      reasoning: undefined,
    });
    await service.settled();
    const next = vi.mocked(adapter.run).mock.calls[1][0];
    expect(next.preparedPrompt).toContain('Une réponse complète.');
    expect(next.preparedPrompt!.indexOf(first.content)).toBeLessThan(
      next.preparedPrompt!.indexOf('Et ensuite ?'),
    );
    expect(next.step).toMatchObject({ model: 'model-b', reasoning: undefined });
    expect(service.state.discussions[0].messages[1].agent?.nickname).toBe('Ada');
    expect(service.state.discussions[0].messages[3].agent?.nickname).toBe('Nouveau nom');
    expect(profiles[0].profile.model).toBeUndefined();
  });
  it('deduplicates requests even after the response has completed', async () => {
    const message = input();
    await Promise.all([service.send(message), service.send(message)]);
    await service.settled();
    await service.send(message);
    expect(adapter.run).toHaveBeenCalledOnce();
    expect(service.state.discussions[0].messages).toHaveLength(2);
    const usage = analyzeUsage(discussionUsage(service.state.discussions));
    expect(usage.summary).toMatchObject({
      runs: 1,
      humanApprovals: 0,
      autopilotApprovals: 0,
      inputTokens: { value: 12 },
      nanoAiu: { value: 24 },
    });
    expect(usage.workflows[0].label).toBe('Discussions');
  });
  it('stops a streaming response, retains partial text and measured usage, and allows another turn', async () => {
    vi.mocked(adapter.run).mockImplementationOnce(async (_input, callbacks, signal) => {
      callbacks.onEvent({
        id: 'delta',
        at: new Date().toISOString(),
        kind: 'message',
        message: 'Début de réponse',
      });
      callbacks.onUsage?.({ source: 'measured', inputTokens: 9, outputTokens: 2 });
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(new Error('Stopped'));
        else signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
      });
      throw new Error('Unreachable');
    });
    const first = input();
    await service.send(first);
    await expect(service.send(input(first.discussionId))).rejects.toThrow('déjà en cours');
    service.cancel(first.discussionId);
    await service.settled();
    expect(service.state.discussions[0].messages[1]).toMatchObject({
      status: 'interrupted',
      content: 'Début de réponse',
      usage: { inputTokens: 9 },
    });
    await service.send(input(first.discussionId));
    await service.settled();
    expect(service.state.discussions[0].messages.at(-1)?.status).toBe('complete');
  });
  it('pauses concurrent conversations on panel close and can resume after reopening', async () => {
    const stream = async (_input: RunInput, callbacks: RunCallbacks, signal: AbortSignal) => {
      callbacks.onEvent({
        id: 'delta',
        at: new Date().toISOString(),
        kind: 'message',
        message: 'Réponse partielle',
      });
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(new Error('Stopped'));
        else signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
      });
      throw new Error('Unreachable');
    };
    vi.mocked(adapter.run).mockImplementationOnce(stream).mockImplementationOnce(stream);
    const first = input(),
      second = input();
    await Promise.all([service.send(first), service.send(second)]);
    await service.pause();
    expect(service.state.discussions).toHaveLength(2);
    for (const discussion of service.state.discussions)
      expect(discussion.messages[1]).toMatchObject({
        status: 'interrupted',
        content: 'Réponse partielle',
      });
    const stored = JSON.parse(await readFile(join(directory, 'discussions.json'), 'utf8'));
    expect(
      stored.discussions.every(
        (discussion: { messages: { status: string }[] }) =>
          discussion.messages[1].status === 'interrupted',
      ),
    ).toBe(true);
    await service.send(input(first.discussionId));
    await service.settled();
    expect(
      service.state.discussions
        .find((discussion) => discussion.id === first.discussionId)
        ?.messages.at(-1)?.status,
    ).toBe('complete');
  });
  it('does not call Copilot for untrusted workspaces, missing agents or excessive context', async () => {
    trusted = false;
    await expect(service.send(input())).rejects.toThrow('Not trusted');
    trusted = true;
    await expect(service.send({ ...input(), agentKey: 'absent' })).rejects.toThrow(
      'plus disponible',
    );
    profiles[0].profile.instructions = 'x'.repeat(200001);
    await expect(service.send(input())).rejects.toThrow('taille de contexte');
    expect(adapter.run).not.toHaveBeenCalled();
    expect(service.state.discussions).toEqual([]);
  });
  it('preserves the human message and shows runtime errors', async () => {
    vi.mocked(adapter.run).mockRejectedValueOnce(new Error('Modèle indisponible'));
    await service.send(input());
    await service.settled();
    expect(service.state.discussions[0].messages).toHaveLength(2);
    expect(service.state.discussions[0].messages[1]).toMatchObject({
      status: 'error',
      error: 'Modèle indisponible',
    });
  });
  it('recovers interrupted turns and deletes a selected discussion persistently', async () => {
    const first = input();
    await service.send(first);
    await service.settled();
    await service.dispose();
    const path = join(directory, 'discussions.json');
    const stored = JSON.parse(await readFile(path, 'utf8'));
    stored.discussions[0].messages[1].status = 'streaming';
    await writeFile(path, JSON.stringify(stored));
    service = create();
    await service.initialize();
    expect(service.state.discussions[0].messages[1].status).toBe('interrupted');
    await service.delete(first.discussionId);
    expect(JSON.parse(await readFile(path, 'utf8')).discussions).toEqual([]);
  });
  it('never replaces a malformed historical store with an empty one', async () => {
    await service.dispose();
    const path = join(directory, 'discussions.json');
    await writeFile(path, '{broken');
    service = create();
    await service.initialize();
    expect(service.state.error).toContain('Historique indisponible');
    await expect(service.send(input())).rejects.toThrow('Historique indisponible');
    expect(await readFile(path, 'utf8')).toBe('{broken');
  });
  it('rejects invalid requests at the webview boundary', () => {
    expect(parseMessage(input()).type).toBe('sendDiscussion');
    for (const patch of [
      { discussionId: '../file' },
      { content: '' },
      { content: 'x'.repeat(40001) },
      { reasoning: 'x'.repeat(51) },
      { mcpServers: ['secret'] },
    ])
      expect(() => parseMessage({ ...input(), ...patch })).toThrow();
  });
});
