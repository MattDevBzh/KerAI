import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateTaskBoard } from '../src/core/taskBoard';
import { taskBoardTools } from '../src/host/TaskBoardTools';
import { Store, defaultSettings } from '../src/core/store';
import { demoState } from '../webview/demo';
import { hqBoard, hqScene, hqSpeech, speechPages } from '../src/shared/hqCinema';
import { parseMessage } from '../src/host/messages';
import type { TaskBoardUpdate } from '../src/shared/taskBoard';
import type { RunCallbacks } from '../src/shared/types';

const plan: TaskBoardUpdate = {
  mode: 'plan',
  title: 'Développement',
  items: [
    { id: 'form', text: 'Construire le formulaire', status: 'in_progress' },
    { id: 'save', text: 'Enregistrer les réponses', status: 'pending' },
  ],
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { force: true, recursive: true })));
});

describe('agent task board', () => {
  it('preserves the initial plan and omitted rows, tracks additions, and rejects erasing a plan', () => {
    const first = updateTaskBoard(undefined, plan);
    const next = updateTaskBoard(first, {
      ...plan,
      items: [
        { id: 'form', text: 'Créer le formulaire accessible', status: 'done' },
        { id: 'check', text: 'Vérifier le clavier', status: 'in_progress' },
      ],
    });
    expect(next.revision).toBe(2);
    expect(next.initialPlan).toEqual(first.initialPlan);
    expect(next.items.map((i) => i.id)).toEqual(['form', 'save', 'check']);
    expect(first.items[0].status).toBe('in_progress');
    expect(() =>
      updateTaskBoard(next, { mode: 'task', title: 'Effacé', items: [plan.items[0]] }),
    ).toThrow('plan');
  });
  it('uses one current task without inventing a plan and can later establish a real plan', () => {
    const first = updateTaskBoard(undefined, { ...plan, mode: 'task', items: [plan.items[0]] });
    expect(first.initialPlan).toEqual([]);
    const next = updateTaskBoard(first, { ...plan, mode: 'task', items: [plan.items[1]] });
    expect(next.items).toEqual([plan.items[1]]);
    expect(updateTaskBoard(next, plan).initialPlan).toEqual(
      plan.items.map(({ id, text }) => ({ id, text })),
    );
  });
  it('bounds metadata and refuses duplicates, invalid status, oversized lists and concurrent active lines', () => {
    for (const update of [
      { ...plan, items: [...plan.items, plan.items[0]] },
      { ...plan, items: plan.items.map((i) => ({ ...i, status: 'in_progress' })) },
      { ...plan, items: [{ ...plan.items[0], status: 'approved' }] },
      { ...plan, items: [{ ...plan.items[0], id: '__proto__' }] },
      { ...plan, mode: 'task' },
      { ...plan, items: [] },
      { ...plan, title: 'x'.repeat(101) },
      {
        ...plan,
        items: Array.from({ length: 49 }, (_, i) => ({
          id: `i${i}`,
          text: 'x',
          status: 'pending',
        })),
      },
      { ...plan, approveStep: true },
    ])
      expect(() => updateTaskBoard(undefined, update)).toThrow();
  });
  it('round trips notes and the baseline through storage without approving a step or copying to a retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hq-board-'));
    roots.push(root);
    const feature = structuredClone(demoState.features[0]);
    const step = feature.steps[0];
    step.status = 'awaiting_review';
    step.attempts[0].status = 'awaiting_review';
    step.attempts[0].taskBoard = updateTaskBoard(undefined, {
      ...plan,
      items: plan.items.map((i) => ({ ...i, status: 'done' })),
    });
    const store = new Store(root);
    await store.save([feature], defaultSettings);
    const restored = (await store.load()).features[0].steps[0];
    expect(restored.status).toBe('awaiting_review');
    expect(restored.attempts[0].taskBoard).toEqual(step.attempts[0].taskBoard);
    const { taskBoard: _, ...retry } = restored.attempts[0];
    restored.attempts.push({ ...retry, id: 'retry', status: 'running' });
    restored.status = 'running';
    expect(hqBoard(restored).source).toBe('mission');
  });
  it('registers a metadata-only tool, sanitizes notes and refuses cancelled invocations', async () => {
    const onTaskBoard = vi.fn(async (update: TaskBoardUpdate) =>
      updateTaskBoard(undefined, update),
    );
    const callbacks: RunCallbacks = { onEvent: vi.fn(), onSession: vi.fn(), onTaskBoard };
    const abort = new AbortController();
    const tool = taskBoardTools(callbacks, abort.signal, (s) =>
      s.replaceAll('secret', '[masqué]'),
    )[0];
    expect(tool).toMatchObject({
      name: 'studio_update_task_board',
      skipPermission: true,
      defer: 'never',
    });
    await tool.handler!(
      { ...plan, title: 'secret', items: [{ ...plan.items[0], note: 'secret' }] },
      { sessionId: 's', toolCallId: 't', toolName: tool.name, arguments: plan },
    );
    expect(onTaskBoard.mock.calls[0][0]).toMatchObject({
      title: '[masqué]',
      items: [{ note: '[masqué]' }],
    });
    abort.abort();
    await expect(
      tool.handler!(plan, {
        sessionId: 's',
        toolCallId: 't',
        toolName: tool.name,
        arguments: plan,
      }),
    ).rejects.toThrow('annulée');
    expect(onTaskBoard).toHaveBeenCalledOnce();
    expect(taskBoardTools({ onEvent: vi.fn(), onSession: vi.fn() }, abort.signal)).toEqual([]);
  });
  it('follows nested workshops and human requests, then returns to the parent without mutating the run', () => {
    const root = structuredClone(demoState.features[0]);
    const parentStep = root.steps[2];
    root.activeStepId = parentStep.id;
    root.steps.forEach((s) => {
      if (s.status === 'running') s.status = 'approved';
    });
    const child = structuredClone(demoState.features[1]);
    child.id = 'child';
    child.status = 'running';
    child.parent = { featureId: root.id, stepId: parentStep.id, iterationId: 'i1' };
    child.steps[0].status = 'running';
    child.activeStepId = child.steps[0].id;
    parentStep.subplanState = {
      acceptedRevisions: [1],
      iterations: [
        {
          id: 'i1',
          number: 1,
          taskId: 'one',
          title: 'Connexion',
          description: '',
          planRevision: 1,
          orchestrationAttemptId: 'a',
          feature: child,
        },
      ],
    };
    const before = structuredClone(root);
    const scene = hqScene(root, {});
    expect(scene).toMatchObject({ feature: { id: 'child' }, number: 1, total: 1 });
    expect(scene.path.map((f) => f.id)).toEqual([root.id, child.id]);
    const request = {
      id: 'q',
      featureId: root.id,
      stepId: root.steps[0].id,
      attemptId: 'a',
      kind: 'question' as const,
      question: 'Un choix ?',
      allowFreeform: true,
      createdAt: new Date().toISOString(),
    };
    expect(hqScene(root, { humanRequests: [request] }).feature.id).toBe(root.id);
    expect(root).toEqual(before);
    child.status = 'completed';
    child.steps[0].status = 'approved';
    expect(hqScene(root, {}).feature.id).toBe(root.id);
  });
  it('never shows private reasoning or structured result blocks in comic bubbles', () => {
    const root = structuredClone(demoState.features[0]);
    const step = root.steps[0];
    root.activeStepId = step.id;
    step.status = 'running';
    const attempt = step.attempts[0];
    attempt.pair = {
      messages: [
        {
          id: 'text',
          role: 'assistant',
          kind: 'text',
          content:
            'Le formulaire est prêt.\n```feature-studio-pair-result\n{"internal":"payload"}\n```',
          status: 'complete',
          at: '',
        },
        {
          id: 'why',
          role: 'assistant',
          kind: 'reasoning',
          content: 'PRIVATE REASONING',
          status: 'complete',
          at: '',
        },
      ],
    } as never;
    expect(hqSpeech(hqScene(root, {})).text).toBe('Le formulaire est prêt.');
    expect(speechPages('mot '.repeat(500)).length).toBeGreaterThan(1);
    expect(speechPages('x'.repeat(10000)).every((page) => page.length <= 260)).toBe(true);
  });
  it('accepts only display commands for the floating window', () => {
    const message = { type: 'hqWindow', action: 'detach', requestId: 'window' };
    expect(parseMessage(message)).toEqual(message);
    for (const change of [{ action: 'runStep' }, { approve: true }, { requestId: '' }])
      expect(() => parseMessage({ ...message, ...change })).toThrow();
  });
});
