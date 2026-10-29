import { screenshot } from './image-fixture';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { runProcess } from '../src/host/process';
import { emptyLaunch } from '../src/core/context';
import { defaultPairPreferences, nextPairBlock, type PairAction } from '../src/shared/pair';
import { approvalBlockers } from '../src/core/validation';
import { usageTotals } from '../src/core/budgets';
import type { AgentAdapter, RunCallbacks, RunInput, RunResult } from '../src/shared/types';

vi.setConfig({ testTimeout: 60_000 });
const roots: string[] = [],
  services: StudioService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()));
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const result = (content = '# Résultat conservé'): RunResult => ({
  content,
  changedFiles: [],
  questions: [],
  usage: { source: 'measured', inputTokens: 10, outputTokens: 5, cost: 2, unit: 'nano-AIU' },
});
const proposal = (ids = ['one', 'two']) =>
  'Voici les blocs restants.\n```feature-studio-pair-plan\n' +
  JSON.stringify({
    summary: 'Construire puis vérifier.',
    blocks: ids.map((id) => ({ id, title: id, description: `Travail ${id}` })),
  }) +
  '\n```';

async function fixture(pairMode = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-conversation-')));
  roots.push(root);
  const workspace = join(root, 'repo');
  await mkdir(workspace);
  await runProcess('git', ['init', '-b', 'fixture'], workspace);
  const store = new Store(join(root, 'state'));
  const service = new StudioService(workspace, resolve('defaults'), store, () => true);
  services.push(service);
  await service.initialize();
  const feature = await service.createFeature({
    title: 'Une conversation',
    description: 'Le contexte initial UNIQUE_BRIEF reste dans Copilot.',
    workflowId: 'single',
  });
  feature.budget!.maxRuns = 50;
  const step = feature.steps[0],
    inputs: RunInput[] = [];
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let callbacks!: RunCallbacks;
  let behavior = async (_input: RunInput, _callbacks: RunCallbacks, _signal: AbortSignal) =>
    result(pairMode ? proposal() : undefined);
  const adapter: AgentAdapter = {
    check: async () => ({ state: 'ready', authenticated: true, models: [] }),
    run: async (input, events, signal) => {
      inputs.push(structuredClone(input));
      callbacks = events;
      events.onSession('same-native-session');
      events.onPromptSending?.();
      events.onPromptSent?.();
      signalStarted();
      return behavior(input, events, signal);
    },
    dispose: async () => {},
    setPermissionMode: vi.fn(async () => {}),
  };
  service.adapter = adapter;
  await service.checkRuntime();
  const launch = {
    ...emptyLaunch(),
    permissionMode: 'manual' as const,
    ...(pairMode ? { pair: { ...defaultPairPreferences } } : {}),
  };
  const start = async () => {
    const preview = await service.previewRun(feature.id, step.id, '', false, launch);
    await service.runStep(feature.id, step.id, '', false, launch, preview.fingerprint);
    return preview;
  };
  const startRunning = async () => {
    const preview = await service.previewRun(feature.id, step.id, '', false, launch);
    const completed = service.runStep(feature.id, step.id, '', false, launch, preview.fingerprint);
    // Git preflight can exceed a polling timeout on Windows; wait for the actual adapter entry.
    await Promise.race([
      started,
      completed.then(() => {
        throw new Error('The run finished before the conversation adapter started.');
      }),
    ]);
    return { completed };
  };
  const idle = () =>
    vi.waitFor(
      () => {
        expect(service.state.workspaceOperation).toBeUndefined();
        expect(step.attempts.at(-1)?.pair?.busy).toBe(false);
      },
      { timeout: 30000 },
    );
  const action = async (action: PairAction['action'], extra: Partial<PairAction> = {}) => {
    const attempt = step.attempts.at(-1)!;
    const command: PairAction = {
      type: 'pairAction',
      featureId: feature.id,
      stepId: step.id,
      attemptId: attempt.id,
      expectedVersion: attempt.pair!.version,
      requestId: randomUUID(),
      action,
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
    adapter,
    start,
    startRunning,
    idle,
    action,
    get callbacks() {
      return callbacks;
    },
    run(fn: typeof behavior) {
      behavior = fn;
    },
  };
}

it('keeps a solo artifact and native session while explaining it, then negotiates an explicit correction before final validation', async () => {
  const f = await fixture();
  await f.start();
  const attempt = f.step.attempts[0],
    pair = attempt.pair!;
  expect(pair).toMatchObject({
    nativeConversation: true,
    mode: 'solo',
    origin: 'solo',
    phase: 'review',
  });
  expect(approvalBlockers(f.feature, f.step, 'human')).toEqual([]);
  const artifact = structuredClone(attempt.artifact),
    revision = attempt.revision;
  f.run(async (input) => {
    expect(input.nativeReadOnly).toBe(true);
    expect(input.resumeSessionId).toBe('same-native-session');
    expect(input.preparedPrompt).toContain('Pourquoi ?');
    expect(input.preparedPrompt).not.toContain('UNIQUE_BRIEF');
    return result('Pour conserver une navigation simple.');
  });
  const command = await f.action('message', { content: 'Pourquoi ?' });
  await f.idle();
  expect(attempt.artifact).toEqual(artifact);
  expect(attempt.revision).toBe(revision);
  expect(pair).toMatchObject({ mode: 'pair', engaged: true, phase: 'review' });
  expect(f.feature.execution?.permissionMode).toBe('manual');
  expect(f.step.status).toBe('awaiting_review');
  expect(approvalBlockers(f.feature, f.step, 'human')).toEqual([]);
  expect(pair.pendingMessages).toEqual([]);
  await f.service.pairAction(command);
  expect(f.inputs).toHaveLength(2);
  f.run(async () => result(proposal(['correction'])));
  await f.action('message', { content: 'Ajoute le raccourci clavier.' });
  await f.idle();
  expect(pair.phase).toBe('planning');
  expect(attempt.artifact).toEqual(artifact);
  expect(approvalBlockers(f.feature, f.step, 'human').length).toBeGreaterThan(0);
  f.run(async (input) => {
    expect(input.nativeReadOnly).toBe(false);
    expect(input.resumeSessionId).toBe('same-native-session');
    expect(input.preparedPrompt).toContain('livrable complet et à jour');
    await writeFile(join(f.workspace, 'shortcut.txt'), 'Ctrl+K');
    return result(
      'Raccourci ajouté.\n```feature-studio-pair-result\n{"blockId":"correction","outcome":"completed","decisions":[]}\n```',
    );
  });
  await f.action('approve-plan');
  await f.idle();
  expect(attempt.artifact?.content).toContain('Raccourci ajouté');
  expect(attempt.artifact?.content).not.toContain('Organisation validée');
  expect(attempt.changedFiles).toContain('shortcut.txt');
  expect(f.step.attempts).toHaveLength(1);
  expect(usageTotals(f.feature)).toMatchObject({ inputTokens: 40, outputTokens: 20, nanoAiu: 8 });
  await f.service.approveStep(f.feature.id, f.step.id, attempt.id, attempt.revision!);
  await expect(f.action('message', { content: 'Change encore' })).rejects.toThrow('actuelle');
  const restored = (await f.store.load()).features[0].steps[0].attempts[0];
  expect(restored.pair).toEqual(JSON.parse(JSON.stringify(pair)));
});

it('starts with the previewed read-only plan, applies preferences, preserves completed blocks and reuses the native session', async () => {
  const f = await fixture(true),
    preview = await f.start();
  const pair = f.step.attempts[0].pair!;
  expect(f.inputs[0].nativeReadOnly).toBe(true);
  expect(f.inputs[0].preparedPrompt).toBe(preview.prompt);
  await f.action('preferences', {
    preferences: { ...defaultPairPreferences, explanation: 'concise' },
  });
  expect(f.inputs).toHaveLength(1);
  f.run(async (input) => {
    expect(input.resumeSessionId).toBe('same-native-session');
    expect(input.nativeReadOnly).toBe(false);
    expect(input.preparedPrompt).toContain('concise');
    const id = nextPairBlock(pair)!.id;
    await writeFile(join(f.workspace, `${id}.txt`), 'agent');
    return result(
      `Bloc terminé.\n\`\`\`feature-studio-pair-result\n{"blockId":"${id}","outcome":"completed","decisions":[]}\n\`\`\``,
    );
  });
  await f.action('approve-plan');
  await f.idle();
  expect(pair.phase).toBe('checkpoint');
  expect(f.inputs).toHaveLength(2);
  await writeFile(join(f.workspace, 'one.txt'), 'human');
  f.run(async (input) => {
    expect(input.nativeReadOnly).toBe(true);
    return result(proposal(['remaining']));
  });
  await f.action('preferences', { preferences: { ...pair.preferences, pace: 'small' } });
  await f.idle();
  expect(pair.plans).toHaveLength(2);
  expect(pair.results).toHaveLength(1);
  expect(pair.approvedRevision).toBeUndefined();
  expect(await readFile(join(f.workspace, 'one.txt'), 'utf8')).toBe('human');
  expect(f.inputs.at(-1)?.preparedPrompt).not.toContain('UNIQUE_BRIEF');
});

it('steers a running solo conversation exactly once, keeps mode changes separate from permissions and waits for a confirmed stop', async () => {
  const f = await fixture();
  f.run(
    async (_input, callbacks, signal) =>
      new Promise<RunResult>((_resolve, reject) => {
        callbacks.onNativeMessage?.({
          id: 'native:message',
          kind: 'text',
          content: 'Je lis le contexte.',
          at: new Date().toISOString(),
          complete: false,
        });
        signal.addEventListener('abort', () => setTimeout(() => reject(new Error('Stopped')), 30), {
          once: true,
        });
      }),
  );
  const { completed: running } = await f.startRunning();
  const pair = f.step.attempts[0].pair!;
  await expect(f.action('message', { content: 'Pendant le travail solo' })).rejects.toThrow(
    'Passe en pair',
  );
  await f.action('pair');
  expect(pair.mode).toBe('solo');
  expect(pair.requestedMode).toBe('pair');
  f.adapter.sendMessage = vi.fn(async (_id, content) => {
    expect(content).toBe('Préserve mon fichier.');
    f.callbacks.onNativeMessageReceived?.('sent-1');
    return 'sent-1';
  });
  const command = await f.action('message', { content: 'Préserve mon fichier.' });
  await f.service.pairAction(command);
  expect(f.adapter.sendMessage).toHaveBeenCalledTimes(1);
  expect(pair.pendingMessages).toEqual([]);
  expect(pair.messages.find((m) => m.requestId === command.requestId)?.delivery).toBe('received');
  await f.service.setPermissionMode(f.feature.id, 'allow-all');
  expect(f.adapter.setPermissionMode).toHaveBeenCalledWith('same-native-session', 'allow-all');
  await f.action('pause');
  expect(pair.busy).toBe(true);
  expect(pair.phase).toBe('working');
  await running;
  expect(pair).toMatchObject({ mode: 'pair', busy: false, phase: 'paused' });
  expect(f.feature.execution?.permissionMode).toBe('allow-all');
  expect(pair.messages.find((m) => m.id === 'native:message')?.status).toBe('interrupted');
  expect(f.inputs).toHaveLength(1);
});

it('queues messages when live steering is unavailable and sends only new context after the checkpoint', async () => {
  const f = await fixture();
  let finish!: (r: RunResult) => void;
  f.run(
    async () =>
      new Promise<RunResult>((r) => {
        finish = r;
      }),
  );
  const { completed: running } = await f.startRunning();
  await f.action('pair');
  await f.action('message', { content: 'Explique le choix de structure.' });
  expect(f.step.attempts[0].pair!.pendingMessages).toHaveLength(1);
  f.run(async (input) => {
    expect(input.nativeReadOnly).toBe(true);
    expect(input.preparedPrompt).toContain('Explique le choix');
    return result('La structure facilite la lecture.');
  });
  finish(result());
  await running;
  await f.idle();
  expect(f.inputs).toHaveLength(2);
  expect(f.step.attempts[0].pair!.pendingMessages).toEqual([]);
  expect(f.step.attempts[0].artifact?.content).toBe('# Résultat conservé');
});

it('never automatically retries an uncertain message, keeps it across reopening, and requires an explicit delivery decision', async () => {
  const f = await fixture();
  let finish!: (r: RunResult) => void;
  f.run(
    async () =>
      new Promise<RunResult>((r) => {
        finish = r;
      }),
  );
  const { completed: running } = await f.startRunning();
  await f.action('pair');
  f.adapter.sendMessage = vi.fn(async () => {
    throw new Error('RPC disconnected after send');
  });
  const command = await f.action('message', { content: 'Ce message ne doit pas repartir seul.' });
  finish(result());
  await running;
  const pair = f.step.attempts[0].pair!,
    message = pair.messages.find((m) => m.requestId === command.requestId)!;
  expect(message.delivery).toBe('uncertain');
  expect(pair.phase).toBe('interrupted');
  expect(f.inputs).toHaveLength(1);
  const loaded = await f.store.load();
  expect(
    loaded.features[0].steps[0].attempts[0].pair!.messages.find((m) => m.id === message.id)
      ?.delivery,
  ).toBe('uncertain');
  const restored = new StudioService(f.workspace, resolve('defaults'), f.store, () => true);
  services.push(restored);
  restored.adapter = f.adapter;
  await restored.initialize();
  expect(f.inputs).toHaveLength(1);
  await f.action('keep-message', { messageId: message.id });
  expect(message.delivery).toBe('skipped');
  expect(pair.pendingMessages).toEqual([]);
  f.run(async (input) => {
    expect(input.preparedPrompt).not.toContain('Ce message ne doit');
    return result('Voici une explication.');
  });
  await f.action('message', { content: 'Une autre question.' });
  await f.idle();
  expect(f.inputs).toHaveLength(2);
});

it('keeps the solo result and draft when saving a direct follow-up fails', async () => {
  const f = await fixture();
  await f.start();
  const pair = f.step.attempts[0].pair!,
    before = structuredClone(pair);
  vi.spyOn(f.store, 'save').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(
    f.action('message', { content: 'Question à conserver dans le brouillon.' }),
  ).rejects.toThrow('Storage unavailable');
  expect(pair).toEqual(before);
  expect(f.inputs).toHaveLength(1);
});

it('retries the original approved context when the first runtime connection fails before sending a prompt', async () => {
  const f = await fixture(),
    run = f.adapter.run;
  f.adapter.run = async (_input, callbacks) => {
    callbacks.onSession('same-native-session');
    throw new Error('Catalog unavailable before send');
  };
  await f.start();
  const pair = f.step.attempts[0].pair!;
  expect(pair.contextDelivered).not.toBe(true);
  expect(pair.phase).toBe('interrupted');
  f.adapter.run = run;
  await f.action('resume');
  await f.idle();
  expect(f.inputs[0].preparedPrompt).toContain(pair.snapshot.prompt);
  expect(pair.contextDelivered).toBe(true);
  expect(pair.phase).toBe('review');
});

it('preserves feature and chat images, sends pending attachments and excludes unchecked feature context', async () => {
  const f = await fixture(true);
  f.feature.images = [screenshot];
  await f.start();
  expect(f.inputs[0].images).toEqual([screenshot]);
  const chatImage = { ...screenshot, id: randomUUID(), name: 'detail.png' };
  await f.action('message', { content: 'Regarde cette zone', images: [chatImage] });
  await f.idle();
  expect(f.inputs.at(-1)?.images).toEqual([chatImage]);
  const excluded = await fixture();
  excluded.feature.images = [screenshot];
  excluded.launch.contextBlocks = { images: { enabled: false } };
  await excluded.start();
  expect(excluded.inputs[0].images).toEqual([]);
  expect(
    f.step.attempts.at(-1)?.pair?.messages.find((m) => m.content === 'Regarde cette zone')?.images,
  ).toEqual([chatImage]);
});

it('persists factual sources and agent claims, rejects invented sources and checks changed test files', async () => {
  const f = await fixture();
  await writeFile(join(f.workspace, 'api.ts'), 'before');
  const { sha256 } = await import('../src/host/PolicyEngine');
  f.run(async (_input, callbacks) => {
    callbacks.onEvidence?.({
      id: 'test-one',
      source: 'host',
      commandId: 'unit',
      name: 'Erreur réseau',
      command: 'node',
      args: ['test'],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      stdout: 'passed',
      stderr: '',
      truncated: false,
      fileHashes: { 'api.ts': sha256('before') },
    });
    const source = callbacks.getProofs!().find((s) => s.kind === 'test')!;
    await expect(
      callbacks.onProofClaim!({
        id: randomUUID(),
        text: 'Inventé',
        proofIds: ['fake'],
        verdict: 'supported',
      }),
    ).rejects.toThrow('absente');
    await callbacks.onProofClaim!({
      id: randomUUID(),
      text: 'Le cas réseau passe.',
      proofIds: [source.id],
      verdict: 'supported',
    });
    return result();
  });
  await f.start();
  const attempt = f.step.attempts.at(-1)!;
  expect(attempt.proofClaims?.[0].reportRevision).toBe(attempt.revision);
  const saved = (await f.store.load()).features.find((v) => v.id === f.feature.id)!;
  expect(saved.steps[0].attempts[0].proofClaims).toEqual(attempt.proofClaims);
  await f.service.checkProofDossier(f.feature.id);
  expect(Object.values(f.feature.proofChecks!)[0].state).toBe('unchanged');
  await writeFile(join(f.workspace, 'api.ts'), 'after');
  await f.service.checkProofDossier(f.feature.id);
  expect(Object.values(f.feature.proofChecks!)[0].state).toBe('changed');
  await expect(
    f.service.saveProofClaim({
      type: 'saveProofClaim',
      featureId: f.feature.id,
      stepId: f.step.id,
      attemptId: attempt.id,
      requestId: randomUUID(),
      revision: attempt.revision!,
      claim: {
        text: 'Tout est vérifié',
        proofIds: attempt.proofClaims![0].proofIds,
        verdict: 'supported',
      },
    }),
  ).rejects.toThrow('revérifier');
});
