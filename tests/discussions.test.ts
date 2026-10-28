import { screenshot } from './image-fixture';
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
  it('persists an attached image and forwards it separately again on the next stateless turn', async () => {
    const request = { ...input(), images: [screenshot] };
    await service.send(request);
    await vi.waitFor(() =>
      expect(service.state.discussions[0].messages.at(-1)?.status).toBe('complete'),
    );
    expect(vi.mocked(adapter.run).mock.calls[0][0].images).toEqual([screenshot]);
    expect(vi.mocked(adapter.run).mock.calls[0][0].preparedPrompt).not.toContain(screenshot.data);
    await service.dispose();
    const legacy = JSON.parse(await readFile(join(directory, 'discussions.json'), 'utf8'));
    delete legacy.discussions[0].activeImageIds;
    delete legacy.discussions[0].contextWindow;
    await writeFile(join(directory, 'discussions.json'), JSON.stringify(legacy));
    service = create();
    await service.initialize();
    expect(service.state.discussions[0].messages[0].images).toEqual([screenshot]);
    await service.send({ ...input(request.discussionId), content: 'Et cette zone ?' });
    await vi.waitFor(() => expect(adapter.run).toHaveBeenCalledTimes(2));
    expect(vi.mocked(adapter.run).mock.calls[1][0].images).toEqual([screenshot]);
  });
  it('replaces and reselects active images while preserving every original across reload', async () => {
    const first = input();
    const images = Array.from({ length: 4 }, (_, i) => ({
      ...screenshot,
      id: randomUUID(),
      name: `capture-${i}.png`,
    }));
    await service.send({ ...first, images });
    await service.settled();
    const replacement = { ...screenshot, id: randomUUID(), name: 'nouvelle.png' };
    await service.send({ ...input(first.discussionId), images: [replacement] });
    await service.settled();
    expect(vi.mocked(adapter.run).mock.calls[1][0].images).toEqual([replacement]);
    expect(service.state.discussions[0].messages.flatMap((m) => m.images ?? [])).toHaveLength(5);
    await service.dispose();
    service = create();
    await service.initialize();
    expect(service.state.discussions[0].activeImageIds).toEqual([replacement.id]);
    await service.send({ ...input(first.discussionId), contextImageIds: [images[0].id] });
    await service.settled();
    expect(vi.mocked(adapter.run).mock.calls[2][0].images).toEqual([images[0]]);
    await expect(
      service.send({ ...input(first.discussionId), contextImageIds: [randomUUID()] }),
    ).rejects.toThrow('images existantes');
    await expect(
      service.send({ ...input(first.discussionId), contextImageIds: [images[0].id, images[0].id] }),
    ).rejects.toThrow('images existantes');
    await expect(
      service.send({
        ...input(first.discussionId),
        contextImageIds: [...images.map((image) => image.id), replacement.id],
      }),
    ).rejects.toThrow('images existantes');
    expect(adapter.run).toHaveBeenCalledTimes(3);
    await service.send({ ...input(first.discussionId), contextImageIds: [] });
    await service.settled();
    expect(vi.mocked(adapter.run).mock.calls[3][0].images).toEqual([]);
  });
  it('continues long histories with a visible recent window and keeps all original messages', async () => {
    const first = input();
    await service.send(first);
    await service.settled();
    const discussion = service.state.discussions[0];
    for (let i = 0; i < 10; i++)
      discussion.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: `Archive ${i} ` + 'x'.repeat(40000),
        status: 'complete',
        createdAt: new Date().toISOString(),
      });
    await service.send({ ...input(first.discussionId), content: 'Nouvelle question récente' });
    await service.settled();
    const run = vi.mocked(adapter.run).mock.calls[1][0];
    expect(run.preparedPrompt).toContain('Nouvelle question récente');
    expect(run.preparedPrompt!.length).toBeLessThan(200000);
    expect(discussion.contextWindow?.omittedMessages).toBeGreaterThan(0);
    expect(discussion.messages).toHaveLength(14);
    expect(discussion.messages[2].content.length).toBeGreaterThan(40000);
    expect(discussion.contextWindow?.sentCharacters).toBe(run.preparedPrompt!.length);
    expect(discussion.contextWindow?.imageCount).toBe(0);
    await service.dispose();
    service = create();
    await service.initialize();
    expect(service.state.discussions[0].messages).toHaveLength(14);
    expect(service.state.discussions[0].messages[2].content).toBe(discussion.messages[2].content);
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
  it('reloads discussions written by another cockpit after the first tab releases the store', async () => {
    await service.send(input());
    await service.settled();
    await service.unload();
    await expect(service.send(input())).rejects.toThrow(/indisponible/);
    const other = create();
    try {
      await other.initialize();
      await other.send(input());
      await other.settled();
    } finally {
      await other.dispose();
    }
    await service.initialize();
    expect(service.state.discussions).toHaveLength(2);
    await service.send(input());
    await service.settled();
    expect(
      JSON.parse(await readFile(join(directory, 'discussions.json'), 'utf8')).discussions,
    ).toHaveLength(3);
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

describe('session discussions and feature proposals', () => {
  let root: string;
  const services: DiscussionService[] = [];
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.dispose()));
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function fixture() {
    root = await mkdtemp(join(tmpdir(), 'discussion-bridge-'));
    let profiles: DiscussionProfile[] = [
      {
        key: 'global:guide',
        profile: {
          id: 'guide',
          name: 'Guide',
          description: 'Aider à cadrer',
          instructions: 'Instructions initiales',
          skills: [],
          tools: ['read', 'edit'],
          path: '',
          source: 'user',
          roastLevel: 'spicy',
        },
        skills: [],
      },
    ];
    const run = vi.fn(async (_input: RunInput, _callbacks: RunCallbacks) => ({
      content: 'Réponse',
      questions: [],
      changedFiles: [],
      model: 'model-a',
    }));
    const create = async () => {
      const service = new DiscussionService({
        directory: root,
        workspacePath: root,
        profiles: async () => profiles,
        defaults: () => ({ defaultModel: 'changed-default', timeoutMinutes: 1 }),
        assertTrusted() {},
        adapter: async () => ({ run, check: vi.fn(), dispose: vi.fn() }),
      });
      services.push(service);
      await service.initialize();
      return service;
    };
    const source = {
      featureId: 'feature',
      featureTitle: 'Besoin',
      stepId: 'step',
      stepName: 'Plan',
      attemptId: 'attempt',
      revision: 0,
      capturedAt: new Date().toISOString(),
      agent: structuredClone(profiles[0].profile),
      model: 'model-a',
      reasoning: 'high',
      context: 'Contexte historique avec skills sélectionnés',
      output: 'Sortie originale',
      warnings: [],
    };
    return {
      service: await create(),
      create,
      run,
      source,
      profiles,
      removeProfiles: () => {
        profiles = [];
      },
    };
  }
  it('opens without a paid call, deduplicates a version and keeps its profile/context after reload and profile removal', async () => {
    const f = await fixture();
    const id = await f.service.openSource(f.source);
    expect(await f.service.openSource(f.source)).toBe(id);
    expect(f.run).not.toHaveBeenCalled();
    f.source.output = 'Mutated caller';
    f.profiles[0].profile.instructions = 'Changed profile';
    await f.service.dispose();
    f.removeProfiles();
    const restored = await f.create();
    const discussion = restored.state.discussions[0];
    await restored.send({
      type: 'sendDiscussion',
      requestId: randomUUID(),
      discussionId: id,
      agentKey: discussion.agentKey,
      model: 'model-a',
      reasoning: 'high',
      content: 'Pourquoi ?',
    });
    await restored.settled();
    expect(f.run.mock.calls[0][0]).toMatchObject({
      mode: 'discussion',
      agent: { instructions: 'Instructions initiales' },
      step: { policy: 'read-only', model: 'model-a', reasoning: 'high' },
    });
    expect(f.run.mock.calls[0][0].preparedPrompt).toContain(
      'Contexte historique avec skills sélectionnés',
    );
    expect(f.run.mock.calls[0][0].preparedPrompt).toContain('Sortie originale');
    expect(f.run.mock.calls[0][0].preparedPrompt).not.toContain('Changed profile');
    expect(discussion.messages).toHaveLength(2);
    expect(discussion.source?.output).toBe('Sortie originale');
  });
  it('keeps edited report revisions separate, rejects configuration overrides and windows oversized archives', async () => {
    const f = await fixture();
    const id = await f.service.openSource(f.source);
    const other = await f.service.openSource({
      ...f.source,
      revision: 1,
      output: 'Human edit',
      originalOutput: 'Sortie originale',
    });
    expect(other).not.toBe(id);
    await expect(
      f.service.send({
        type: 'sendDiscussion',
        requestId: randomUUID(),
        discussionId: id,
        agentKey: f.service.state.discussions[0].agentKey,
        model: 'changed',
        content: 'Question',
      }),
    ).rejects.toThrow('configuration');
    await f.service.openSource({ ...f.source, revision: 2, context: 'x'.repeat(210000) });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.service.state.discussions).toHaveLength(3);
  });
  it('keeps bounded historical warnings before oversized source excerpts without changing originals', async () => {
    const f = await fixture();
    const warnings = [
      'SENTINELLE : tentative précédente omise, raisonnement non attesté.',
      ...Array.from({ length: 100 }, (_, i) => `Ancienne limitation ${i} : ${'x'.repeat(5000)}`),
    ];
    const source = { ...f.source, context: 'CONTEXTE'.repeat(30_000), warnings };
    const id = await f.service.openSource(source);
    await f.service.send({
      type: 'sendDiscussion',
      requestId: randomUUID(),
      discussionId: id,
      agentKey: f.service.state.discussions[0].agentKey,
      model: source.model,
      reasoning: source.reasoning,
      content: 'Pourquoi ce résultat ?',
    });
    await f.service.settled();
    const prompt = f.run.mock.calls[0][0].preparedPrompt!;
    expect(prompt).toContain(warnings[0]);
    expect(prompt.indexOf(warnings[0])).toBeLessThan(prompt.indexOf('CONTEXTE'));
    expect(prompt).toContain('Avertissements source partiels');
    expect(prompt).toContain('Sortie originale');
    expect(prompt.length).toBeLessThan(200_000);
    expect(f.service.state.discussions[0].source?.warnings).toEqual(warnings);
    expect(f.service.state.discussions[0].source?.context).toBe(source.context);
  });
  it('prepares a persisted editable proposal from conversation decisions without launching a feature', async () => {
    const f = await fixture();
    const id = randomUUID();
    const request = { discussionId: id, agentKey: 'global:guide', model: 'model-a' };
    await f.service.send({
      ...request,
      type: 'sendDiscussion',
      requestId: randomUUID(),
      content: 'Nous voulons une recherche au clavier sans réseau.',
    });
    await f.service.settled();
    const plan = {
      title: 'Recherche au clavier',
      description: 'Une recherche locale sans réseau.',
      criteria: ['Entrée ouvre le résultat sélectionné.'],
      team: [
        {
          agentId: 'guide',
          name: 'Cadrage',
          description: 'Définir les interactions clavier.',
          policy: 'read-only',
        },
      ],
    };
    f.run.mockResolvedValue({
      content: JSON.stringify(plan),
      questions: [],
      changedFiles: [],
      model: 'model-a',
    });
    const requestId = randomUUID();
    await f.service.prepareFeature(
      { ...request, requestId },
      f.profiles.map((item) => item.profile),
    );
    await f.service.settled();
    expect(f.run.mock.calls[1][0].preparedPrompt).toContain('sans réseau');
    expect(f.run.mock.calls[1][0]).toMatchObject({
      mode: 'discussion',
      step: { policy: 'read-only' },
    });
    expect(f.service.state.discussions[0].featureDraft).toMatchObject({ ...plan, requestId });
    expect(f.service.state.discussions[0].messages.at(-1)?.content).toContain(
      'Aucune feature n’a encore été créée',
    );
    await f.service.prepareFeature(
      { ...request, requestId },
      f.profiles.map((item) => item.profile),
    );
    expect(f.run).toHaveBeenCalledTimes(2);
    await f.service.dispose();
    expect((await f.create()).state.discussions[0].featureDraft).toMatchObject(plan);
  });
  it('rejects an invented team and preserves the conversation on malformed proposals', async () => {
    const f = await fixture();
    const discussionId = randomUUID();
    const request = { discussionId, agentKey: 'global:guide', model: 'model-a' };
    await expect(
      f.service.prepareFeature(
        { ...request, requestId: randomUUID() },
        f.profiles.map((item) => item.profile),
      ),
    ).rejects.toThrow('Échangez');
    await f.service.send({
      ...request,
      type: 'sendDiscussion',
      requestId: randomUUID(),
      content: 'Une idée.',
    });
    await f.service.settled();
    for (const content of [
      'broken json',
      JSON.stringify({
        title: 'Titre',
        description: 'Besoin',
        criteria: ['Vérifier'],
        team: [{ agentId: 'invented', name: 'Step', description: 'Do', policy: 'workspace-write' }],
      }),
    ]) {
      f.run.mockResolvedValue({ content, questions: [], changedFiles: [], model: 'model-a' });
      await f.service.prepareFeature(
        { ...request, requestId: randomUUID() },
        f.profiles.map((item) => item.profile),
      );
      await f.service.settled();
      expect(f.service.state.discussions[0].messages.at(-1)?.status).toBe('error');
      expect(f.service.state.discussions[0].messages.at(-1)?.content).toBe('');
      expect(f.service.state.discussions[0].featureDraft).toBeUndefined();
    }
    expect(f.service.state.discussions[0].messages[0].content).toBe('Une idée.');
  });
  it('accepts only source identifiers from the webview, never a forged execution context', () => {
    const message = {
      type: 'openReportDiscussion',
      requestId: randomUUID(),
      featureId: 'f',
      stepId: 's',
      attemptId: 'a',
      revision: 0,
    };
    expect(parseMessage(message)).toMatchObject(message);
    expect(() => parseMessage({ ...message, context: 'forged', agent: {} })).toThrow();
  });
});
