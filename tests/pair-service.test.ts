import { agentPolicy } from '../src/shared/agentInheritance';
import { featureStateKey } from '../src/shared/collaboration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentAdapter, RunCallbacks, RunInput, RunResult } from '../src/shared/types';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { runProcess } from '../src/host/process';
import type { Tool } from '@github/copilot-sdk';

// End-to-end scenarios perform real Git checkpoints and spawn local test processes.
// Keep the Windows allowance consistent across this integration suite.
if (process.platform === 'win32') vi.setConfig({ testTimeout: 60_000 });

const roots: string[] = [],
  services: StudioService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function git(root: string, ...args: string[]) {
  const result = await runProcess('git', args, root);
  if (result.code !== 0) throw new Error(result.stderr);
}
const finished = (content = '# Livrable'): RunResult => ({
  content,
  questions: [],
  changedFiles: [],
  model: 'fixture-real-model',
  usage: { source: 'measured', inputTokens: 10, outputTokens: 20 },
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-service-')));
  roots.push(root);
  const workspace = join(root, 'repo');
  await mkdir(workspace);
  await git(workspace, 'init', '-b', 'fixture');
  const storage = join(root, 'storage');
  let trusted = true;
  const service = new StudioService(
    workspace,
    resolve('defaults'),
    new Store(storage),
    () => trusted,
  );
  services.push(service);
  await service.initialize();
  const inputs: RunInput[] = [];
  let behavior = async (
    _input: RunInput,
    _callbacks: RunCallbacks,
    _signal: AbortSignal,
  ): Promise<RunResult> => finished();
  const adapter: AgentAdapter = {
    check: vi.fn(async () => ({
      state: 'ready' as const,
      authenticated: true,
      version: 'fixture',
      models: [{ id: 'fixture-real-model', name: 'Fixture model' }],
    })),
    run: vi.fn(async (input, callbacks, signal) => {
      inputs.push(input);
      callbacks.onSession(`session-${inputs.length}`);
      return await behavior(input, callbacks, signal);
    }),
    dispose: vi.fn(async () => {}),
  };
  service.adapter = adapter;
  return {
    root,
    workspace,
    storage,
    service,
    adapter,
    inputs,
    trust(value: boolean) {
      trusted = value;
    },
    run(fn: typeof behavior) {
      behavior = fn;
    },
  };
}

const launch = {
  initialContext: 'CONTEXTE CONFIRMÉ',
  mcpServerIds: [],
  memoryIds: [],
  useProjectMemory: false,
  pairPace: 'batches' as const,
};
async function startPair() {
  const f = await fixture();
  await f.service.checkRuntime();
  const feature = await f.service.createFeature({
    title: 'Pair',
    description: 'Une mission',
    workflowId: 'single',
  });
  const step = feature.steps[0];
  const preview = await f.service.previewRun(feature.id, step.id, '', false, launch);
  await f.service.runStep(feature.id, step.id, '', false, launch, preview.fingerprint);
  const command = (action: import('../src/shared/pair').PairAction, message = '') => ({
    attemptId: step.attempts.at(-1)!.id,
    expectedRevision: step.attempts.at(-1)!.pair!.revision,
    action,
    message,
    pace: 'batches' as const,
  });
  return { ...f, feature, step, command };
}
it('frames without project tools, pauses each lot and keeps one attempt and the confirmed context', async () => {
  const f = await startPair(),
    attempt = f.step.attempts[0];
  expect(f.inputs[0].mode).toBe('discussion');
  expect(f.inputs[0].preparedPrompt).toContain('CONTEXTE CONFIRMÉ');
  expect(f.step.status).toBe('waiting_input');
  expect(attempt.pair?.phase).toBe('planning');
  expect(attempt.artifact).toBeUndefined();
  expect(f.service.state.workspaceOperation).toBeUndefined();
  expect(await f.service.pairContext(f.feature.id, f.step.id, attempt.id)).toContain(
    'CONTEXTE CONFIRMÉ',
  );
  await f.service.pairTurn(
    f.feature.id,
    f.step.id,
    f.command('discuss', 'Une petite étape à la fois.'),
  );
  expect(f.inputs.at(-1)?.mode).toBe('discussion');
  await f.service.pairTurn(f.feature.id, f.step.id, { ...f.command('work'), pace: 'guided' });
  expect(f.inputs.at(-1)?.mode).toBeUndefined();
  expect(f.inputs.at(-1)?.preparedPrompt).toContain('UNE petite action');
  expect(f.inputs.at(-1)?.preparedPrompt).toContain('Une petite étape à la fois.');
  expect(f.step.status).toBe('waiting_input');
  expect(attempt.pair?.phase).toBe('paused');
  expect(f.step.attempts).toHaveLength(1);
  expect(attempt.usage?.inputTokens).toBe(30);
  expect(attempt.pair?.turns).toBe(3);
  await f.service.pairTurn(f.feature.id, f.step.id, f.command('finish'));
  expect(f.inputs.at(-1)?.mode).toBe('discussion');
  expect(f.step.status).toBe('awaiting_review');
  expect(attempt.pair?.phase).toBe('review');
  expect(attempt.artifact?.content).toBe('# Livrable');
  expect(attempt.usage?.inputTokens).toBe(40);
});
it('rejects stale controls and changed sources before a paid call', async () => {
  const f = await startPair(),
    stale = f.command('work');
  await f.service.pairTurn(f.feature.id, f.step.id, f.command('discuss', 'Ajuste le plan'));
  await expect(f.service.pairTurn(f.feature.id, f.step.id, stale)).rejects.toThrow(
    'conversation a changé',
  );
  f.feature.description = 'Mission changée';
  await expect(f.service.pairTurn(f.feature.id, f.step.id, f.command('work'))).rejects.toThrow(
    'sources ont changé',
  );
  expect(f.inputs).toHaveLength(2);
});
it('restores a paused conversation and its frozen profile without creating another attempt', async () => {
  const f = await startPair();
  const id = f.step.attempts[0].id;
  await f.service.dispose();
  const service = new StudioService(
    f.workspace,
    resolve('defaults'),
    new Store(f.storage),
    () => true,
  );
  services.push(service);
  await service.initialize();
  service.adapter = f.adapter;
  await service.checkRuntime();
  const feature = service.engine.getFeature(f.feature.id),
    step = feature.steps[0];
  expect(step.attempts[0].pair?.phase).toBe('planning');
  await service.pairTurn(feature.id, step.id, { ...f.command('solo'), attemptId: id });
  expect(step.attempts).toHaveLength(1);
  expect(step.status).toBe('awaiting_review');
  expect(step.attempts[0].pair?.messages).toHaveLength(3);
  expect(f.inputs.at(-1)?.preparedPrompt).toContain('CONTEXTE CONFIRMÉ');
});
it('deduplicates streamed usage within a turn, preserves failed costs and supports explicit recovery', async () => {
  const f = await startPair();
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
    throw new Error('Échec du tour');
  });
  await f.service.pairTurn(f.feature.id, f.step.id, f.command('work'));
  expect(f.step.status).toBe('failed');
  expect(f.step.attempts[0].usage?.inputTokens).toBe(19);
  expect(f.step.attempts[0].usage?.cost).toBe(200);
  expect(f.step.attempts[0].pair?.phase).toBe('paused');
  f.run(async () => finished('Terminé\n<!-- feature-studio-pair-complete -->'));
  await f.service.pairTurn(f.feature.id, f.step.id, f.command('work'));
  expect(f.step.status).toBe('awaiting_review');
  expect(f.step.attempts[0].artifact?.content).toBe('Terminé');
  expect(f.step.attempts[0].usage?.inputTokens).toBe(29);
  expect(f.step.attempts[0].usage?.incompleteCost).toBe(true);
});
it('queues a solo handoff during an active lot and retains its decisions', async () => {
  const f = await startPair();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let calls = 0;
  f.run(async () => {
    if (++calls === 1) {
      entered();
      await gate;
    }
    return finished('Lot terminé');
  });
  const work = f.service.pairTurn(f.feature.id, f.step.id, f.command('work'));
  await started;
  await f.service.pairTurn(
    f.feature.id,
    f.step.id,
    f.command('solo', 'Conserve la méthode convenue.'),
  );
  expect(f.step.attempts[0].pair?.soloRequested).toBe(true);
  release();
  await work;
  expect(calls).toBe(2);
  expect(f.step.status).toBe('awaiting_review');
  expect(f.step.attempts[0].pair?.pace).toBe('autonomous');
  expect(f.inputs.at(-1)?.preparedPrompt).toContain('Conserve la méthode convenue.');
  expect(f.step.attempts).toHaveLength(1);
});
it('keeps a paused conversation intact when its turn budget is exhausted', async () => {
  const f = await startPair();
  f.feature.budget = { maxRuns: 1, maxPromptChars: 60000, modelProfile: 'current' };
  await expect(f.service.pairTurn(f.feature.id, f.step.id, f.command('work'))).rejects.toThrow(
    'Budget',
  );
  expect(f.step.status).toBe('waiting_input');
  expect(f.inputs).toHaveLength(1);
});

it('retains file ownership across lots and refuses to overwrite a later human edit', async () => {
  const f = await startPair();
  const invoke = async (tools: Tool[], name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name)!;
    return (await tool.handler!(args, {
      sessionId: 'test',
      toolCallId: 'call',
      toolName: name,
      arguments: args,
    })) as { resultType: string };
  };
  f.run(async (input, callbacks, signal) => {
    const tools = await f.service.getTools(input, callbacks, signal);
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'first.ts', content: 'first\n' }))
        .resultType,
    ).toBe('success');
    return finished('Premier lot');
  });
  await f.service.pairTurn(f.feature.id, f.step.id, f.command('work'));
  f.run(async (input, callbacks, signal) => {
    const tools = await f.service.getTools(input, callbacks, signal);
    await invoke(tools, 'studio_read_file', { path: 'first.ts' });
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'first.ts', content: 'second\n' }))
        .resultType,
    ).toBe('success');
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'second.ts', content: 'new\n' }))
        .resultType,
    ).toBe('success');
    return finished('Deuxième lot');
  });
  await f.service.pairTurn(f.feature.id, f.step.id, f.command('work'));
  expect(f.step.attempts[0].changedFiles.sort()).toEqual(['first.ts', 'second.ts']);
  await writeFile(join(f.workspace, 'first.ts'), 'human\n');
  f.run(async (input, callbacks, signal) => {
    const tools = await f.service.getTools(input, callbacks, signal);
    await invoke(tools, 'studio_read_file', { path: 'first.ts' });
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'first.ts', content: 'overwrite\n' }))
        .resultType,
    ).toBe('failure');
    return finished('Modification humaine conservée');
  });
  await f.service.pairTurn(f.feature.id, f.step.id, f.command('work'));
  expect(await readFile(join(f.workspace, 'first.ts'), 'utf8')).toBe('human\n');
});
it('keeps unresolved final questions in the conversation instead of offering premature approval', async () => {
  const f = await startPair();
  f.run(async () => ({
    ...finished('Une précision est nécessaire.'),
    questions: [{ id: 'target', text: 'Quel environnement ?', choices: ['Dev', 'Test'] }],
  }));
  await f.service.pairTurn(f.feature.id, f.step.id, f.command('solo'));
  expect(f.step.status).toBe('waiting_input');
  expect(f.step.attempts[0].pair?.phase).toBe('paused');
  expect(f.step.attempts[0].pair?.messages.at(-1)?.content).toContain('Quel environnement ?');
});
