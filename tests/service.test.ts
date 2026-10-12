import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentAdapter, RunCallbacks, RunInput, RunResult } from '../src/shared/types';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { runProcess } from '../src/host/process';
import type { Tool } from '@github/copilot-sdk';

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
async function invoke(tools: Tool[], name: string, args: unknown) {
  const tool = tools.find((tool) => tool.name === name);
  if (!tool?.handler) throw new Error(`Missing tool ${name}`);
  return (await tool.handler(args, {
    sessionId: 'session',
    toolCallId: 'call',
    toolName: name,
    arguments: args,
  })) as { resultType: string; textResultForLlm: string };
}

describe('StudioService end-to-end workflow with local mocked runtime', () => {
  it('completes five steps with real host file tools, explicit local tests and persisted evidence', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    await f.service.saveSettings({
      ...f.service.state.settings,
      defaultModel: 'fixture-real-model',
      testCommands: [
        {
          id: 'fixture',
          name: 'Fixture check',
          command: process.execPath,
          args: ['-e', 'console.log("fixture test passed")'],
        },
      ],
    });
    const feature = await f.service.createFeature({
      title: 'Implement fixture',
      description: 'Five steps',
      workflowId: 'feature',
    });
    f.run(async (input, callbacks, signal) => {
      const tools = await f.service.getTools(input, callbacks, signal);
      if (input.step.id === 'dev')
        expect(
          (
            await invoke(tools, 'studio_write_file', {
              path: 'src/fixture.ts',
              content: 'export const answer = 42;\n',
            })
          ).resultType,
        ).toBe('success');
      if (input.step.id === 'tests') {
        expect(
          (
            await invoke(tools, 'studio_write_file', {
              path: 'tests/fixture.test.ts',
              content: '// criterion test fixture\n',
            })
          ).resultType,
        ).toBe('success');
        expect(
          (
            await invoke(tools, 'studio_write_file', {
              path: 'src/forbidden.ts',
              content: 'must not exist',
            })
          ).resultType,
        ).toBe('failure');
        expect(
          (await invoke(tools, 'studio_run_test', { id: 'fixture' })).textResultForLlm,
        ).toContain('fixture test passed');
      }
      return finished(`# ${input.step.id}`);
    });
    for (const step of feature.steps) {
      await f.service.runStep(feature.id, step.id);
      expect(step.status).toBe('awaiting_review');
      f.service.engine.approveStep(feature.id, step.id);
      await f.service.persist();
    }
    expect(feature.status).toBe('completed');
    expect(await readFile(join(f.workspace, 'src/fixture.ts'), 'utf8')).toContain('42');
    expect(f.inputs.every((input) => input.settings.defaultModel === 'fixture-real-model')).toBe(
      true,
    );
    const restored = await f.service.store.load();
    expect(restored.features[0].status).toBe('completed');
    expect(restored.features[0].steps[2].attempts[0].changedFiles).toEqual(['src/fixture.ts']);
    expect(restored.features[0].steps[2].attempts[0].fileHashes?.['src/fixture.ts']).toHaveLength(
      64,
    );
    expect(
      restored.features[0].steps[3].attempts[0].logs.some((log) =>
        log.message.includes('fixture test passed'),
      ),
    ).toBe(true);
    expect(restored.settings.defaultModel).toBe('fixture-real-model');
    expect(f.service.snapshot().runtime.models[0].id).toBe('fixture-real-model');
  });
  it('passes questions, answers, human feedback and the previous artifact to a resumed attempt', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Questions',
      description: '',
      workflowId: 'single',
    });
    f.run(async () => ({
      ...finished('# Partial'),
      questions: [{ id: 'audience', text: 'Qui utilise ceci ?' }],
    }));
    await f.service.runStep(feature.id, 'session');
    expect(feature.steps[0].status).toBe('waiting_input');
    f.service.engine.answerQuestions(feature.id, 'session', { audience: 'Matt' });
    await f.service.persist();
    f.run(async (input) => {
      expect(input.resumeSessionId).toBe('session-1');
      expect(input.attempt.answers.audience).toBe('Matt');
      expect(input.attempt.feedback).toBe('Garde la réponse courte');
      expect(input.attempt.artifact?.content).toBe('# Partial');
      return finished('# Complete');
    });
    await f.service.runStep(feature.id, 'session', 'Garde la réponse courte', true);
    f.service.engine.approveStep(feature.id, 'session');
    await f.service.persist();
    expect(feature.status).toBe('completed');
    expect(feature.steps[0].attempts).toHaveLength(2);
    expect(feature.steps[0].attempts[0].questions).toHaveLength(1);
  });
  it('recovers an interrupted run and resumes its session without inventing runtime readiness', async () => {
    const f = await fixture();
    const feature = await f.service.createFeature({
      title: 'Interrupted',
      description: '',
      workflowId: 'single',
    });
    f.service.engine.beginRun(feature.id, 'session');
    f.service.engine.setSession(feature.id, 'session', 'recoverable-session');
    await f.service.persist();
    const recovered = new StudioService(
      f.workspace,
      resolve('defaults'),
      new Store(f.storage),
      () => true,
    );
    services.push(recovered);
    recovered.adapter = f.adapter;
    await recovered.initialize();
    expect(recovered.state.runtime.state).toBe('unchecked');
    expect(recovered.engine.getStep(feature.id, 'session').status).toBe('interrupted');
    await expect(recovered.runStep(feature.id, 'session', '', true)).rejects.toThrow(/CLI Copilot/);
    await recovered.checkRuntime();
    await recovered.runStep(feature.id, 'session', '', true);
    expect(f.inputs.at(-1)?.resumeSessionId).toBe('recoverable-session');
  });
  it('invalidates downstream outcomes after corrections, preserves history and clears active lease on errors', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Correct',
      description: '',
      workflowId: 'feature',
    });
    for (const id of ['specs', 'plan']) {
      await f.service.runStep(feature.id, id);
      f.service.engine.approveStep(feature.id, id);
      await f.service.persist();
    }
    f.run(async () => {
      throw new Error('Runtime failed');
    });
    await f.service.runStep(feature.id, 'specs', 'Change target');
    expect(feature.steps[0].status).toBe('failed');
    expect(feature.steps[1].status).toBe('stale');
    expect(feature.steps[1].attempts[0].status).toBe('approved');
    f.run(async () => finished('Corrected'));
    await f.service.runStep(feature.id, 'specs', 'Correct this');
    expect(feature.steps[0].status).toBe('awaiting_review');
    expect(feature.steps[0].attempts.at(-1)?.feedback).toBe('Correct this');
  });
});

describe('StudioService execution gates', () => {
  it('rechecks trust after async Git inspection before starting a paid adapter call', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Trust race',
      description: '',
      workflowId: 'single',
    });
    const run = f.service.runStep(feature.id, 'session');
    f.trust(false);
    await expect(run).rejects.toThrow(/Approuve/);
    expect(f.adapter.run).not.toHaveBeenCalled();
    expect(feature.steps[0].attempts).toHaveLength(0);
  });
  it('rejects missing configured skills instead of quietly omitting their instructions', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Missing skill',
      description: '',
      workflowId: 'single',
    });
    f.service.state.skills = f.service.state.skills.filter((skill) => skill.id !== 'ai-implement');
    await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow(/skill|compétence/i);
    expect(f.adapter.run).not.toHaveBeenCalled();
  });
  it('requires workspace trust, runtime authentication and the feature branch', async () => {
    const f = await fixture();
    const feature = await f.service.createFeature({
      title: 'Gates',
      description: '',
      workflowId: 'single',
    });
    f.trust(false);
    await expect(f.service.checkRuntime()).rejects.toThrow(/Approuve/);
    await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow(/Approuve/);
    f.trust(true);
    await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow(/CLI Copilot/);
    await f.service.checkRuntime();
    await git(f.workspace, 'checkout', '-b', 'other');
    await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow(/branche fixture/);
    expect(feature.steps[0].attempts).toHaveLength(0);
    expect(f.adapter.run).not.toHaveBeenCalled();
  });
  it('enforces one active run under rapid double dispatch and releases it after cancellation', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const first = await f.service.createFeature({
      title: 'First',
      description: '',
      workflowId: 'single',
    });
    const second = await f.service.createFeature({
      title: 'Second',
      description: '',
      workflowId: 'single',
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.run(async (_input, _callbacks, signal) => {
      started();
      return await new Promise<RunResult>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }),
      );
    });
    const active = f.service.runStep(first.id, 'session');
    await ready;
    await expect(f.service.runStep(second.id, 'session')).rejects.toThrow(/déjà active/);
    await expect(f.service.saveSettings(f.service.state.settings)).rejects.toThrow(/Arrête/);
    f.service.cancel(first.id);
    await active;
    expect(first.steps[0].status).toBe('cancelled');
    f.run(async () => finished());
    await f.service.runStep(second.id, 'session');
    expect(second.steps[0].status).toBe('awaiting_review');
  });
});
