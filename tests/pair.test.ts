import { mkdtemp, mkdir, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { runProcess } from '../src/host/process';
import { emptyLaunch } from '../src/core/context';
import { defaultPairPreferences, nextPairBlock, type PairAction } from '../src/shared/pair';
import { approvalBlockers } from '../src/core/validation';
import { usageTotals } from '../src/core/budgets';
import { nextAutopilotAction } from '../src/core/autopilot';
import { messageSchema } from '../src/host/messages';
import type { AgentAdapter, RunCallbacks, RunInput, RunResult } from '../src/shared/types';

// Full workflows use real Git, durable archives and several model turns.
vi.setConfig({ testTimeout: 120000 });
const roots: string[] = [],
  services: StudioService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const proposal = (count = 2) =>
  'Nous travaillons ensemble. Voici mon organisation.\n```feature-studio-pair-plan\n' +
  JSON.stringify({
    summary: 'Construire et vérifier ensemble.',
    blocks: Array.from({ length: count }, (_, i) => ({
      id: `b${i + 1}`,
      title: `Bloc ${i + 1}`,
      description: `Réaliser et vérifier le bloc ${i + 1}`,
    })),
  }) +
  '\n```';
const result = (content: string): RunResult => ({
  content,
  questions: [],
  changedFiles: [],
  usage: { source: 'measured', inputTokens: 10, outputTokens: 5, cost: 100, unit: 'nano-AIU' },
  model: 'test-model',
});

async function fixture(count = 2) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-pair-')));
  roots.push(root);
  const workspace = join(root, 'repo');
  await mkdir(workspace);
  await runProcess('git', ['init', '-b', 'fixture'], workspace);
  const store = new Store(join(root, 'storage'));
  const service = new StudioService(workspace, resolve('defaults'), store, () => true);
  services.push(service);
  await service.initialize();
  const agent = service.state.agents.find((a) => a.id === 'fs-dev')!;
  expect(agent).toBeTruthy();
  const feature = await service.createFeature({
    title: 'Binôme complet',
    description: 'Préserver les décisions et les fichiers.',
    team: [
      {
        agentId: agent.id,
        name: 'Construire ensemble',
        description: 'Implémenter les blocs et vérifier le résultat.',
        policy: 'workspace-write',
      },
    ],
  });
  feature.budget!.maxRuns = 40;
  // This suite covers the existing host-tool pair workflow. Native conversations have their own suite.
  delete feature.execution;
  feature.budget!.maxPromptChars = 200000;
  const step = feature.steps[0];
  const inputs: RunInput[] = [];
  let behavior = async (input: RunInput, callbacks: RunCallbacks, signal: AbortSignal) => {
    if (input.mode === 'discussion') {
      expect(await service.getTools(input, callbacks, signal)).toEqual([]);
      return result(proposal(count));
    }
    const next = nextPairBlock(step.attempts.at(-1)!.pair!)!;
    const tools = await service.getTools(input, callbacks, signal);
    const tool = tools.find((t) => t.name === 'studio_write_file')!;
    const args = { path: `src/${next.id}.ts`, content: `export const ${next.id} = true;\n` };
    const output = await tool.handler!(args, {
      sessionId: 'test',
      toolCallId: randomUUID(),
      toolName: tool.name,
      arguments: args,
    });
    expect(output).toMatchObject({ resultType: 'success' });
    return result(
      `Bloc ${next.id} implémenté.\n\`\`\`feature-studio-pair-result\n${JSON.stringify({ blockId: next.id, outcome: 'completed', decisions: ['Garder le contrôle humain.'] })}\n\`\`\``,
    );
  };
  const adapter: AgentAdapter = {
    check: async () => ({ state: 'ready', authenticated: true, models: [] }),
    run: async (input, callbacks, signal) => {
      inputs.push(input);
      callbacks.onSession(`sdk-${inputs.length}`);
      return behavior(input, callbacks, signal);
    },
    dispose: async () => {},
  };
  service.adapter = adapter;
  await service.checkRuntime();
  const launch = { ...emptyLaunch(), pair: { ...defaultPairPreferences } };
  const start = async () => {
    const preview = await service.previewRun(feature.id, step.id, '', false, launch);
    expect(preview.errors).toEqual([]);
    await service.runStep(feature.id, step.id, '', false, launch, preview.fingerprint);
  };
  const idle = async () =>
    vi.waitFor(
      () => {
        expect(service.state.workspaceOperation).toBeUndefined();
        expect(step.attempts.at(-1)?.pair?.busy).toBe(false);
      },
      { timeout: 60000 },
    );
  const action = async (
    action: PairAction['action'],
    content?: string,
    extra: Partial<PairAction> = {},
  ) => {
    const attempt = step.attempts.at(-1)!;
    const command: PairAction = {
      type: 'pairAction',
      featureId: feature.id,
      stepId: step.id,
      attemptId: attempt.id,
      requestId: randomUUID(),
      expectedVersion: attempt.pair!.version,
      action,
      content,
      ...extra,
    };
    await service.pairAction(command);
    return command;
  };
  return {
    root,
    workspace,
    store,
    service,
    feature,
    step,
    inputs,
    launch,
    start,
    idle,
    action,
    run(fn: typeof behavior) {
      behavior = fn;
    },
    defaultWork: (input: RunInput, callbacks: RunCallbacks, signal: AbortSignal) =>
      behavior(input, callbacks, signal),
  };
}

describe('complete pair execution', () => {
  it('requires the exact preview and explicit organisation approval, stops between blocks, accumulates files and validates the original step', async () => {
    const f = await fixture();
    const preview = await f.service.previewRun(f.feature.id, f.step.id, '', false, f.launch);
    await expect(
      f.service.runStep(
        f.feature.id,
        f.step.id,
        '',
        false,
        { ...f.launch, pair: { ...defaultPairPreferences, pace: 'oneshot' } },
        preview.fingerprint,
      ),
    ).rejects.toThrow('contexte');
    await f.start();
    const attempt = f.step.attempts[0],
      pair = attempt.pair!;
    f.feature.autopilot = {
      checkpoints: [],
      maxRuns: 30,
      maxCorrectionCycles: 0,
      stepInputs: {},
      status: 'running',
      runs: 0,
      correctionCycles: 0,
      updatedAt: new Date().toISOString(),
    };
    const expectPilotPaused = () =>
      expect(nextAutopilotAction(f.feature)).toMatchObject({
        kind: 'pause',
        reason: expect.stringContaining('mode pair'),
      });
    expectPilotPaused();
    expect(f.inputs).toHaveLength(1);
    expect(f.inputs[0].mode).toBe('discussion');
    expect(f.inputs[0].preparedPrompt).toBe(preview.prompt);
    expect(pair.phase).toBe('planning');
    expect(attempt.changedFiles).toEqual([]);
    expect(approvalBlockers(f.feature, f.step, 'human').length).toBeGreaterThan(0);
    await expect(f.action('solo')).rejects.toThrow('Valide');
    const approved = await f.action('approve-plan');
    await f.idle();
    expect(pair.phase, pair.error).toBe('checkpoint');
    expectPilotPaused();
    expect(f.inputs).toHaveLength(2);
    expect(await readFile(join(f.workspace, 'src/b1.ts'), 'utf8')).toContain('b1');
    await f.service.pairAction(approved);
    expect(f.inputs).toHaveLength(2);
    await expect(f.action('continue', undefined, { expectedVersion: 0 })).rejects.toThrow('évolué');
    await f.action('continue');
    await f.idle();
    expect(f.step.attempts).toHaveLength(1);
    expect(f.step.status).toBe('awaiting_review');
    expect(pair.phase).toBe('review');
    expectPilotPaused();
    expect(attempt.changedFiles.sort()).toEqual(['src/b1.ts', 'src/b2.ts']);
    expect(attempt.artifact?.content).toContain('Bloc b1 implémenté');
    expect(attempt.artifact?.content).toContain('Bloc b2 implémenté');
    expect(usageTotals(f.feature)).toMatchObject({
      runs: 1,
      inputTokens: 30,
      outputTokens: 15,
      nanoAiu: 300,
    });
    expect(approvalBlockers(f.feature, f.step, 'autopilot')).toContain(
      'Le travail en pair doit être terminé et validé par l’humain.',
    );
    const restored = await f.store.load();
    expect(restored.schemaVersion).toBe(15);
    expect(restored.features[0].steps[0].attempts[0].pair).toEqual(
      JSON.parse(JSON.stringify(pair)),
    );
    await f.service.approveStep(f.feature.id, f.step.id, attempt.id, attempt.revision!);
    expect(f.step.status).toBe('approved');
    expect(f.feature.finalValidation).toBeUndefined();
    const deleted = vi.fn(async (_ids: string[]) => {});
    f.service.adapter.deleteSessions = deleted;
    await f.service.deleteFeature(f.feature.id);
    expect(deleted).toHaveBeenCalledWith(expect.arrayContaining(['sdk-1', 'sdk-2', 'sdk-3']));
    expect(deleted.mock.calls[0][0]).toHaveLength(3);
    expect(await readFile(join(f.workspace, 'src/b1.ts'), 'utf8')).toContain('b1');
  });

  it('can hand over to solo and rejoin during a block without starting the next block', async () => {
    const f = await fixture(3);
    await f.start();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.run(async () => {
      await wait;
      return result(
        'Premier bloc terminé.\n```feature-studio-pair-result\n{"blockId":"b1","outcome":"completed","decisions":[]}\n```',
      );
    });
    await f.action('approve-plan');
    await vi.waitFor(() => expect(f.step.attempts[0].pair?.busy).toBe(true), { timeout: 60000 });
    await f.action('solo');
    expect(f.step.attempts[0].pair?.mode).toBe('solo');
    await f.action('pair');
    release();
    await f.idle();
    expect(f.inputs).toHaveLength(2);
    expect(f.step.attempts[0].pair?.phase).toBe('checkpoint');
    f.run(async () => {
      const b = nextPairBlock(f.step.attempts[0].pair!)!;
      return result(
        `Bloc terminé.\n\`\`\`feature-studio-pair-result\n{"blockId":"${b.id}","outcome":"completed","decisions":[]}\n\`\`\``,
      );
    });
    await f.action('solo');
    await vi.waitFor(() => expect(f.step.attempts[0].pair?.phase).toBe('review'), {
      timeout: 60000,
    });
    await f.idle();
    expect(f.inputs).toHaveLength(4);
    expect(f.step.status).toBe('awaiting_review');
  });

  it('does not accept an organisation or consume a call when saving the human decision fails', async () => {
    const f = await fixture(1);
    await f.start();
    const pair = f.step.attempts[0].pair!,
      before = structuredClone(pair);
    vi.spyOn(f.store, 'save').mockRejectedValueOnce(new Error('Stockage indisponible'));
    await expect(f.action('approve-plan')).rejects.toThrow('Stockage indisponible');
    expect(pair).toEqual(before);
    expect(f.inputs).toHaveLength(1);
    await f.action('approve-plan');
    await f.idle();
    expect(pair.phase).toBe('review');
    expect(f.inputs).toHaveLength(2);
  });

  it('queues a live message, answers it without tools and pauses the solo chain', async () => {
    const f = await fixture();
    await f.start();
    let release!: () => void;
    f.run(async (input) => {
      if (input.mode === 'discussion') return result('Voici pourquoi ce choix est adapté.');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return result(
        'Bloc terminé.\n```feature-studio-pair-result\n{"blockId":"b1","outcome":"completed","decisions":[]}\n```',
      );
    });
    await f.action('approve-plan');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'), { timeout: 60000 });
    await f.action('solo');
    await f.action('message', 'Explique-moi ce choix.');
    expect(f.step.attempts[0].pair!.pendingMessages).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(f.inputs).toHaveLength(3), { timeout: 60000 });
    await f.idle();
    expect(f.inputs[2].mode).toBe('discussion');
    expect(f.inputs[2].preparedPrompt).toContain('Explique-moi');
    expect(f.step.attempts[0].pair).toMatchObject({
      mode: 'pair',
      phase: 'checkpoint',
      pendingMessages: [],
    });
  });

  it('preserves partial work on pause, never completes the block and resumes explicitly after reopening', async () => {
    const f = await fixture();
    await f.start();
    f.run(async (_input, callbacks, signal) => {
      callbacks.onEvent({
        id: randomUUID(),
        at: new Date().toISOString(),
        kind: 'message',
        message: 'Travail en cours…',
      });
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Interrompu')), { once: true });
      });
      return result('impossible');
    });
    await f.action('approve-plan');
    await vi.waitFor(() => expect(f.inputs).toHaveLength(2), { timeout: 60000 });
    await f.action('pause');
    await f.idle();
    expect(f.step.attempts[0].pair).toMatchObject({ phase: 'paused', busy: false, results: [] });
    expect(f.step.attempts[0].pair!.messages.at(-2)?.status).toBe('interrupted');
    const saved = await f.store.load();
    expect(saved.features[0].steps[0].attempts[0].pair?.phase).toBe('paused');
    f.run(async () =>
      result(
        'Reprise vérifiée.\n```feature-studio-pair-result\n{"blockId":"b1","outcome":"completed","decisions":[]}\n```',
      ),
    );
    await f.action('resume');
    await f.idle();
    expect(f.step.attempts[0].pair?.phase).toBe('checkpoint');
  });

  it('recovers an unanswered human question after pause and includes the real answer in the resumed context', async () => {
    const f = await fixture(1);
    await f.start();
    f.run(async (_input, callbacks) => {
      await callbacks.onQuestion!({ question: 'Quel libellé choisir ?', allowFreeform: true });
      return result('Unexpected');
    });
    await f.action('approve-plan');
    await vi.waitFor(() => expect(f.service.state.humanRequests).toHaveLength(1), {
      timeout: 60000,
    });
    await f.action('pause');
    await f.idle();
    const question = f.step.attempts[0].questions[0];
    f.service.engine.answerQuestions(f.feature.id, f.step.id, {
      [question.id]: 'Voir les résultats',
    });
    await f.service.persist();
    f.run(async (input) => {
      expect(input.preparedPrompt).toContain('Voir les résultats');
      return result(
        'Libellé appliqué.\n```feature-studio-pair-result\n{"blockId":"b1","outcome":"completed","decisions":[]}\n```',
      );
    });
    await f.action('resume');
    await f.idle();
    expect(f.step.status).toBe('awaiting_review');
    expect(f.step.attempts[0].answers[question.id]).toBe('Voir les résultats');
  });

  it('keeps former decisions and outputs while negotiating and executing a correction', async () => {
    const f = await fixture(1);
    await f.start();
    await f.action('approve-plan');
    await f.idle();
    const attempt = f.step.attempts[0],
      originalRevision = attempt.revision!;
    f.run(async (input) =>
      input.mode === 'discussion'
        ? result(
            'D’accord.\n```feature-studio-pair-plan\n{"summary":"Corriger le libellé.","blocks":[{"id":"fix","title":"Corriger","description":"Ajuster et vérifier le libellé."}]}\n```',
          )
        : result(
            'Libellé corrigé.\n```feature-studio-pair-result\n{"blockId":"fix","outcome":"completed","decisions":["Libellé choisi ensemble."]}\n```',
          ),
    );
    await f.action('revise', 'Changeons le libellé.');
    await f.idle();
    expect(attempt.pair?.phase).toBe('planning');
    expect(attempt.pair?.approvedRevision).toBeUndefined();
    await expect(
      f.service.approveStep(f.feature.id, f.step.id, attempt.id, originalRevision),
    ).rejects.toThrow();
    await f.action('approve-plan');
    await f.idle();
    expect(attempt.pair?.results).toHaveLength(2);
    expect(attempt.artifactVersions).toHaveLength(2);
    expect(attempt.pair?.plans).toHaveLength(2);
    expect(attempt.artifact?.content).toContain('Libellé corrigé');
    expect(attempt.artifact?.content).toContain('Bloc b1 implémenté');
    expect(attempt.revision).toBeGreaterThan(originalRevision);
  });

  it('fails closed on malformed proposals, permission changes, wrong attempts and exhausted call budgets', async () => {
    const f = await fixture();
    f.run(async () =>
      result(
        '```feature-studio-pair-plan\n{"summary":"Wrong","blocks":[],"acceptedAt":"now"}\n```',
      ),
    );
    await f.start();
    expect(f.step.attempts[0].pair?.phase).toBe('interrupted');
    await expect(f.action('approve-plan')).rejects.toThrow('proposition');
    await expect(f.action('message', 'test', { attemptId: 'obsolete' })).rejects.toThrow(
      'tentative',
    );
    f.run(async () => result(proposal()));
    await f.action('resume');
    await f.idle();
    f.feature.budget!.maxRuns = f.step.attempts[0].pair!.calls;
    await f.action('approve-plan');
    await vi.waitFor(() => expect(f.step.attempts[0].pair?.error).toContain('Budget'), {
      timeout: 60000,
    });
    await f.idle();
    expect(f.inputs).toHaveLength(2);
    f.feature.budget!.maxRuns = 30;
    await f.service.saveSettings({ ...f.service.state.settings, testPaths: ['new-test-scope'] });
    await f.action('resume');
    await vi.waitFor(() => expect(f.step.attempts[0].pair?.error).toContain('réglages'), {
      timeout: 60000,
    });
    expect(f.inputs).toHaveLength(2);
    expect(messageSchema.safeParse({ ...(await f.action('pair')), approved: true }).success).toBe(
      false,
    );
  });

  it('restores a crashed live exchange as interrupted and never restarts the runtime automatically', async () => {
    const f = await fixture();
    await f.start();
    const pair = f.step.attempts[0].pair!;
    pair.busy = true;
    pair.phase = 'working';
    pair.mode = 'solo';
    pair.messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: 'Partiel',
      at: new Date().toISOString(),
      status: 'streaming',
    });
    f.step.status = f.step.attempts[0].status = 'running';
    await f.service.persist();
    const restored = await f.store.load(),
      recovered = restored.features[0].steps[0].attempts[0];
    expect(recovered.status).toBe('interrupted');
    expect(recovered.pair).toMatchObject({ busy: false, mode: 'pair', phase: 'interrupted' });
    expect(recovered.pair!.messages.at(-1)?.status).toBe('interrupted');
    expect(f.inputs).toHaveLength(1);
  });
  it('refuses changed source configuration before consuming another call', async () => {
    const f = await fixture();
    await f.start();
    f.feature.description = 'Mission modifiée hors du cadrage';
    await f.action('approve-plan');
    await f.idle();
    expect(f.step.attempts[0].pair?.error).toContain('sources ont changé');
    expect(f.inputs).toHaveLength(1);
  });

  it('counts streamed usage once on failure and retains the cost during explicit recovery', async () => {
    const f = await fixture(1);
    await f.start();
    f.run(async (_input, callbacks) => {
      callbacks.onUsage?.({
        source: 'measured',
        inputTokens: 5,
        outputTokens: 2,
        cost: 100,
        unit: 'nano-AIU',
      });
      callbacks.onUsage?.({
        source: 'measured',
        inputTokens: 9,
        outputTokens: 3,
        cost: 200,
        unit: 'nano-AIU',
      });
      throw new Error('Échec du bloc');
    });
    await f.action('approve-plan');
    await f.idle();
    const attempt = f.step.attempts[0];
    expect(attempt.usage).toMatchObject({ inputTokens: 19, cost: 300 });
    f.run(async () =>
      result(
        'Terminé.\n```feature-studio-pair-result\n{"blockId":"b1","outcome":"completed","decisions":[]}\n```',
      ),
    );
    await f.action('resume');
    await f.idle();
    expect(attempt.usage).toMatchObject({ inputTokens: 29, cost: 400 });
    expect(attempt.pair?.phase).toBe('review');
  });

  it('preserves a later human edit between blocks and keeps final questions unresolved', async () => {
    const f = await fixture(2);
    await f.start();
    await f.action('approve-plan');
    await f.idle();
    await writeFile(join(f.workspace, 'src/b1.ts'), 'Human change\n');
    f.run(async (input, callbacks, signal) => {
      const tools = await f.service.getTools(input, callbacks, signal);
      const invoke = async (name: string, args: unknown) => {
        const tool = tools.find((t) => t.name === name)!;
        return tool.handler!(args, {
          sessionId: 'test',
          toolCallId: randomUUID(),
          toolName: name,
          arguments: args,
        });
      };
      await invoke('studio_read_file', { path: 'src/b1.ts' });
      expect(
        await invoke('studio_write_file', { path: 'src/b1.ts', content: 'Overwrite' }),
      ).toMatchObject({ resultType: 'failure' });
      return {
        ...result(
          'Clarification.\n```feature-studio-pair-result\n{"blockId":"b2","outcome":"completed","decisions":[]}\n```',
        ),
        questions: [{ id: 'target', text: 'Quel environnement ?' }],
      };
    });
    await f.action('solo');
    await f.idle();
    const attempt = f.step.attempts[0];
    expect(await readFile(join(f.workspace, 'src/b1.ts'), 'utf8')).toBe('Human change\n');
    expect(f.step.status).toBe('waiting_input');
    expect(attempt.pair?.results).toHaveLength(1);
    expect(attempt.questions).toEqual([{ id: 'target', text: 'Quel environnement ?' }]);
    expect(approvalBlockers(f.feature, f.step, 'human').length).toBeGreaterThan(0);
  });
});
