import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
    await expect(f.service.runStep(second.id, 'session')).rejects.toThrow(/opération en cours/);
    await expect(f.service.saveSettings(f.service.state.settings)).rejects.toThrow(/Arrête/);
    f.service.cancel(first.id);
    await active;
    expect(first.steps[0].status).toBe('cancelled');
    f.run(async () => finished());
    await f.service.runStep(second.id, 'session');
    expect(second.steps[0].status).toBe('awaiting_review');
  });
});

describe('manual context, human questions and MCP sessions', () => {
  const launch = {
    initialContext: 'US-208 : export CSV avec accents',
    mcpServerIds: [] as string[],
    memoryIds: [] as string[],
    useProjectMemory: false,
  };
  it('binds existing-file authorization to preview bytes, backs them up and preserves unselected files', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Existing changes',
      description: '',
      workflowId: 'single',
    });
    feature.steps[0].agentId = 'fs-dev';
    const original = '// existing feature work\r\nRemoveRange();\r\n';
    await writeFile(join(f.workspace, 'SyfadisProvider.cs'), original);
    await writeFile(join(f.workspace, 'Other.cs'), 'human work');
    const first = await f.service.previewRun(feature.id, 'session');
    expect(first.existingChanges?.files.map((file) => file.path)).toContain('SyfadisProvider.cs');
    const selected = { ...launch, editableExistingFiles: ['SyfadisProvider.cs'] };
    await expect(f.service.runStep(feature.id, 'session', '', false, selected)).rejects.toThrow(
      /aperçu/,
    );
    const stale = await f.service.previewRun(feature.id, 'session', '', false, selected);
    const authorized = original + '// latest human edit\r\n';
    await writeFile(join(f.workspace, 'SyfadisProvider.cs'), authorized);
    await expect(
      f.service.runStep(feature.id, 'session', '', false, selected, stale.fingerprint),
    ).rejects.toThrow(/aperçu/);
    expect(f.adapter.run).not.toHaveBeenCalled();
    const fresh = await f.service.previewRun(feature.id, 'session', '', false, selected);
    f.run(async (input, callbacks, signal) => {
      const tools = await f.service.getTools(input, callbacks, signal);
      const read = await invoke(tools, 'studio_read_file', { path: 'SyfadisProvider.cs' });
      const hash = JSON.parse(read.textResultForLlm).sha256;
      const edited = await invoke(tools, 'studio_replace_text', {
        path: 'SyfadisProvider.cs',
        expectedSha256: hash,
        oldText: 'RemoveRange();',
        newText: 'if (!isTargeted) RemoveRange();',
      });
      expect(edited.resultType).toBe('success');
      await invoke(tools, 'studio_read_file', { path: 'Other.cs' });
      expect(
        (await invoke(tools, 'studio_write_file', { path: 'Other.cs', content: 'overwrite' }))
          .resultType,
      ).toBe('failure');
      return finished();
    });
    await f.service.runStep(feature.id, 'session', '', false, selected, fresh.fingerprint);
    expect(await readFile(join(f.workspace, 'SyfadisProvider.cs'), 'utf8')).toBe(
      authorized.replace('RemoveRange();', 'if (!isTargeted) RemoveRange();'),
    );
    expect(await readFile(join(f.workspace, 'Other.cs'), 'utf8')).toBe('human work');
    const saved = (await f.service.store.load()).features[0].steps[0].attempts[0];
    expect(saved.changedFiles).toEqual(['SyfadisProvider.cs']);
    expect(await readFile(join(saved.existingChangesBackup!, '0.bin'), 'utf8')).toBe(authorized);
    expect(
      JSON.parse(await readFile(join(saved.existingChangesBackup!, 'manifest.json'), 'utf8'))
        .files[0].path,
    ).toBe('SyfadisProvider.cs');
  });
  it('persists block choices, sends exactly the preview and avoids resuming excluded context', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Context controls',
      description: 'SOURCE_A_EXCLURE',
      workflowId: 'single',
    });
    await f.service.runStep(feature.id, 'session');
    const selected = {
      ...launch,
      contextMode: 'empty' as const,
      contextBlocks: { 'initial-context': { enabled: true, content: 'CONTEXTE_MODIFIÉ' } },
    };
    const preview = await f.service.previewRun(feature.id, 'session', '', true, selected);
    expect(preview.resumesSession).toBe(false);
    expect(preview.prompt).not.toContain('SOURCE_A_EXCLURE');
    expect(preview.prompt).toContain('CONTEXTE_MODIFIÉ');
    await expect(
      f.service.runStep(
        feature.id,
        'session',
        '',
        true,
        { ...selected, contextMode: 'all' },
        preview.fingerprint,
      ),
    ).rejects.toThrow(/aperçu/);
    await f.service.runStep(feature.id, 'session', '', true, selected, preview.fingerprint);
    expect(f.inputs.at(-1)?.resumeSessionId).toBeUndefined();
    expect(f.inputs.at(-1)?.preparedPrompt).toBe(preview.prompt);
    const stored = (await f.service.store.load()).features[0].steps[0].attempts.at(-1)!;
    expect(stored.launch).toEqual(selected);
    expect(f.service.engine.getFeature(feature.id).description).toBe('SOURCE_A_EXCLURE');
  });
  it('binds a run to its preview, persists the user story and selects only explicit MCPs', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    await f.service.saveSettings({
      ...f.service.state.settings,
      mcpServers: [
        {
          id: 'ado',
          name: 'Azure DevOps',
          transport: 'stdio',
          command: 'fixture',
          args: [],
          envKeys: [],
          headers: {},
          tools: ['wit_work_item'],
          autoApproveReadOnly: true,
          enabled: true,
        },
      ],
    });
    const feature = await f.service.createFeature({
      title: 'Initial context',
      description: '',
      workflowId: 'single',
    });
    const options = { ...launch, mcpServerIds: ['ado'] };
    const preview = await f.service.previewRun(feature.id, 'session', '', false, options);
    expect(preview.prompt).toContain('US-208');
    await expect(
      f.service.runStep(
        feature.id,
        'session',
        '',
        false,
        { ...options, initialContext: 'changed' },
        preview.fingerprint,
      ),
    ).rejects.toThrow(/aperçu/);
    expect(f.adapter.run).not.toHaveBeenCalled();
    await f.service.runStep(feature.id, 'session', '', false, options, preview.fingerprint);
    expect(f.inputs[0].preparedPrompt).toBe(preview.prompt);
    expect(f.inputs[0].mcpServers?.map((server) => server.id)).toEqual(['ado']);
    const saved = (await f.service.store.load()).features[0].steps[0].attempts[0];
    expect(saved.launch?.initialContext).toBe(launch.initialContext);
    expect(saved.promptFingerprint).toBe(preview.fingerprint);
  });
  it('awaits live human answers and permission, preserving the exchange through finish and reload', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Interaction',
      description: '',
      workflowId: 'single',
    });
    f.run(async (_input, callbacks) => {
      expect(await callbacks.onQuestion!({ question: 'Quelle US ?', allowFreeform: true })).toBe(
        'US-207',
      );
      expect(
        await callbacks.onMcpPermission!({
          serverId: 'ado',
          toolName: 'wit_add_work_item',
          args: '{"title":"US"}',
          readOnly: false,
        }),
      ).toBe(false);
      return finished();
    });
    const running = f.service.runStep(feature.id, 'session', '', false, launch);
    await vi.waitFor(() => expect(f.service.state.humanRequests).toHaveLength(1));
    const question = f.service.state.humanRequests![0];
    expect(question.kind).toBe('question');
    f.service.answerHumanRequest(question.id, 'US-207');
    await vi.waitFor(() => expect(f.service.state.humanRequests![0]?.kind).toBe('mcp-permission'));
    expect(() =>
      f.service.answerHumanRequest(f.service.state.humanRequests![0].id, 'perhaps'),
    ).toThrow(/réponses proposées/);
    f.service.answerHumanRequest(f.service.state.humanRequests![0].id, 'deny');
    await running;
    const saved = (await f.service.store.load()).features[0].steps[0].attempts[0];
    expect(saved.questions[0].text).toBe('Quelle US ?');
    expect(saved.answers[question.id]).toBe('US-207');
    expect(feature.steps[0].status).toBe('awaiting_review');
    expect(f.service.state.humanRequests).toEqual([]);
  });
  it('clears pending human requests on cancellation and keeps already reported usage', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Cancel',
      description: '',
      workflowId: 'single',
    });
    f.run(async (_input, callbacks) => {
      callbacks.onUsage!({ source: 'measured', inputTokens: 80, outputTokens: 12 });
      await callbacks.onQuestion!({ question: 'Blocked?', allowFreeform: true });
      return finished();
    });
    const running = f.service.runStep(feature.id, 'session');
    await vi.waitFor(() => expect(f.service.state.humanRequests).toHaveLength(1));
    f.service.cancel(feature.id);
    await running;
    expect(feature.steps[0].status).toBe('cancelled');
    expect(feature.steps[0].attempts[0].usage?.inputTokens).toBe(80);
    expect(f.service.state.humanRequests).toEqual([]);
  });
  it('discovers MCP tools without an agent run and refuses disabled MCP selections', async () => {
    const f = await fixture();
    await f.service.saveSettings({
      ...f.service.state.settings,
      mcpServers: [
        {
          id: 'ado',
          name: 'ADO',
          transport: 'stdio',
          command: 'fixture',
          args: [],
          envKeys: [],
          headers: {},
          tools: ['read'],
          autoApproveReadOnly: false,
          enabled: false,
        },
      ],
    });
    f.adapter.discoverMcp = vi.fn(async () => ({
      state: 'ready' as const,
      tools: [{ name: 'read', description: 'Read US' }],
    }));
    await f.service.testMcp('ado');
    expect(f.service.state.mcpCatalogs?.ado.state).toBe('ready');
    expect(f.adapter.run).not.toHaveBeenCalled();
    const feature = await f.service.createFeature({
      title: 'MCP',
      description: '',
      workflowId: 'single',
    });
    await expect(
      f.service.previewRun(feature.id, 'session', '', false, { ...launch, mcpServerIds: ['ado'] }),
    ).rejects.toThrow(/activé/);
  });
});

describe('bounded autopilot and local project memory', () => {
  it('runs to a human checkpoint then completes with a real host test receipt and bounded measured calls', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    await f.service.saveSettings({
      ...f.service.state.settings,
      testCommands: [
        {
          id: 'unit',
          name: 'Unit',
          command: process.execPath,
          args: ['-e', 'console.log("passed")'],
        },
      ],
    });
    const feature = await f.service.createFeature({
      title: 'Autopilot',
      description: '',
      workflowId: 'feature',
    });
    await f.service.saveAutopilot(feature.id, {
      checkpoints: ['plan'],
      maxRuns: 5,
      maxCorrectionCycles: 0,
      reviewStepId: 'review',
      correctionStepId: 'dev',
      stepInputs: {
        specs: {
          initialContext: 'My initial US',
          mcpServerIds: [],
          memoryIds: [],
          useProjectMemory: false,
        },
      },
    });
    f.run(async (input, callbacks, signal) => {
      if (input.step.id === 'tests') {
        const tools = await f.service.getTools(input, callbacks, signal);
        expect((await invoke(tools, 'studio_run_test', { id: 'unit' })).resultType).toBe('success');
      }
      return {
        ...finished(),
        ...(input.step.id === 'review'
          ? { review: { verdict: 'pass' as const, summary: 'Reviewed', findings: [] } }
          : {}),
      };
    });
    await f.service.startAutopilot(feature.id);
    expect(f.inputs.map((input) => input.step.id)).toEqual(['specs', 'plan']);
    expect(f.inputs[0].preparedPrompt).toContain('My initial US');
    expect(feature.autopilot?.status).toBe('paused');
    expect(feature.steps[0].status).toBe('approved');
    const plan = feature.steps[1].attempts[0];
    await f.service.approveStep(feature.id, 'plan', plan.id, plan.revision ?? 0);
    await f.service.startAutopilot(feature.id);
    expect(feature.status).toBe('completed');
    expect(feature.autopilot?.runs).toBe(5);
    expect(feature.autopilot?.status).toBe('completed');
    expect(feature.steps[3].attempts[0].evidence?.[0]).toMatchObject({
      source: 'host',
      exitCode: 0,
      stdout: 'passed\n',
    });
    expect(f.inputs).toHaveLength(5);
  });
  it('pauses on human questions without automatically advancing after the answer', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Pause',
      description: '',
      workflowId: 'single',
    });
    await f.service.saveAutopilot(feature.id, {
      checkpoints: [],
      maxRuns: 1,
      maxCorrectionCycles: 0,
      stepInputs: {},
    });
    f.run(async (_input, callbacks) => {
      await callbacks.onQuestion!({ question: 'Scope?', allowFreeform: true });
      return finished();
    });
    const running = f.service.startAutopilot(feature.id);
    await vi.waitFor(() => expect(f.service.state.humanRequests).toHaveLength(1));
    expect(feature.autopilot?.status).toBe('paused');
    f.service.answerHumanRequest(f.service.state.humanRequests![0].id, 'Only export');
    await running;
    expect(feature.steps[0].status).toBe('awaiting_review');
    expect(f.inputs).toHaveLength(1);
    await f.service.startAutopilot(feature.id);
    expect(feature.status).toBe('completed');
    expect(f.inputs).toHaveLength(1); // validation is local and allowed even at the call limit
  });
  it('blocks excess calls and never silently chooses an unconfigured economy model', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Budget',
      description: '',
      workflowId: 'single',
    });
    await f.service.saveBudget(feature.id, {
      maxRuns: 1,
      maxPromptChars: 60000,
      modelProfile: 'economy',
    });
    await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow(/Configure le modèle/);
    await f.service.saveSettings({
      ...f.service.state.settings,
      modelProfiles: { economy: { model: 'fixture-real-model', reasoning: 'low' } },
    });
    await f.service.runStep(feature.id, 'session');
    expect(f.inputs[0].step.model).toBe('fixture-real-model');
    await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow(
      /nombre maximal de runs/,
    );
    expect(f.inputs).toHaveLength(1);
  });
  it('uses only opt-in approved memory and rejects a source invalidated by replay', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const source = await f.service.createFeature({
      title: 'Source',
      description: '',
      workflowId: 'single',
    });
    await f.service.runStep(source.id, 'session');
    const attempt = source.steps[0].attempts[0];
    await f.service.approveStep(source.id, 'session', attempt.id, attempt.revision ?? 0);
    await f.service.saveMemory({
      id: 'architecture',
      title: 'Validated decision',
      content: 'Prefer existing store',
      category: 'decision',
      enabled: true,
      agentIds: [],
      updatedAt: '',
      source: { featureId: source.id, stepId: 'session', attemptId: attempt.id },
    });
    const target = await f.service.createFeature({
      title: 'Target',
      description: '',
      workflowId: 'single',
    });
    expect((await f.service.previewRun(target.id, 'session')).prompt).not.toContain(
      'Prefer existing store',
    );
    const launch = {
      initialContext: '',
      mcpServerIds: [],
      memoryIds: ['architecture'],
      useProjectMemory: true,
    };
    expect((await f.service.previewRun(target.id, 'session', '', false, launch)).prompt).toContain(
      'Prefer existing store',
    );
    f.service.engine.saveArtifact(source.id, 'session', 'Changed decision');
    await expect(f.service.previewRun(target.id, 'session', '', false, launch)).rejects.toThrow(
      /plus validé/,
    );
    expect(f.inputs).toHaveLength(1); // memory saving and preview are entirely local
  });
});

describe('host approval proofs and revision guards', () => {
  it('rejects changed test inputs and obsolete revisions instead of approving stale proof', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    await f.service.saveSettings({
      ...f.service.state.settings,
      testCommands: [
        {
          id: 'unit',
          name: 'Unit',
          command: process.execPath,
          args: ['-e', 'console.log("passed")'],
        },
      ],
    });
    const feature = await f.service.createFeature({
      title: 'Proof',
      description: '',
      workflowId: 'single',
    });
    feature.steps[0].policy = 'tests';
    feature.steps[0].agentId = 'fs-tests';
    f.run(async (input, callbacks, signal) => {
      const tools = await f.service.getTools(input, callbacks, signal);
      await invoke(tools, 'studio_write_file', { path: 'tests/fixture.ts', content: 'initial' });
      await invoke(tools, 'studio_run_test', { id: 'unit' });
      return finished();
    });
    await f.service.runStep(feature.id, 'session');
    const attempt = feature.steps[0].attempts[0];
    await expect(f.service.approveStep(feature.id, 'session', attempt.id, -1)).rejects.toThrow(
      /changé/,
    );
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(f.workspace, 'tests/fixture.ts'), 'human change');
    await expect(
      f.service.approveStep(feature.id, 'session', attempt.id, attempt.revision ?? 0),
    ).rejects.toThrow(/preuve de test est obsolète/);
    expect(feature.steps[0].status).toBe('awaiting_review');
    await writeFile(join(f.workspace, 'tests/fixture.ts'), 'initial');
    await f.service.approveStep(feature.id, 'session', attempt.id, attempt.revision ?? 0);
    expect(feature.status).toBe('completed');
    expect(
      (await f.service.store.load()).features.find((item) => item.id === feature.id)?.status,
    ).toBe('completed');
    await f.service.saveCriteria(feature.id, [
      { id: 'criterion', text: 'Human acceptance', status: 'pending', evidence: '' },
    ]);
    expect(feature.status).toBe('attention');
    await f.service.saveCriteria(feature.id, [
      { id: 'criterion', text: 'Human acceptance', status: 'passed', evidence: 'Verified by Matt' },
    ]);
    expect(feature.status).toBe('completed');
  });
});

describe('branch and memory invalidation regressions', () => {
  it('binds a newly created feature to the actual branch after an external checkout', async () => {
    const f = await fixture();
    await git(f.workspace, 'checkout', '-b', 'new-feature');
    const feature = await f.service.createFeature({
      title: 'Fresh branch',
      description: '',
      workflowId: 'single',
    });
    expect(feature.branch).toBe('new-feature');
    await f.service.checkRuntime();
    await f.service.runStep(feature.id, 'session');
    expect(feature.steps[0].status).toBe('awaiting_review');
  });
  it('refuses memory sourced from a downstream artifact before a replay invalidates it', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Cross-step memory',
      description: '',
      workflowId: 'feature',
    });
    for (const id of ['specs', 'plan']) {
      await f.service.runStep(feature.id, id);
      const attempt = f.service.engine.getStep(feature.id, id).attempts.at(-1)!;
      await f.service.approveStep(feature.id, id, attempt.id, attempt.revision ?? 0);
    }
    await f.service.saveMemory({
      id: 'old-plan',
      title: 'Old plan',
      content: 'Old decision',
      category: 'decision',
      enabled: true,
      agentIds: [],
      updatedAt: '',
      source: { featureId: feature.id, stepId: 'plan', attemptId: feature.steps[1].attempts[0].id },
    });
    await expect(
      f.service.previewRun(feature.id, 'specs', '', false, {
        initialContext: '',
        mcpServerIds: [],
        memoryIds: ['old-plan'],
        useProjectMemory: true,
      }),
    ).rejects.toThrow(/va invalider/);
    expect(feature.steps[1].status).toBe('approved');
    expect(f.inputs).toHaveLength(2);
  });
});
