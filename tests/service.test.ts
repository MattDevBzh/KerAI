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

it('launches with the current base profile, rejects stale previews and keeps only team model overrides', async () => {
  const f = await fixture();
  const user = join(f.root, 'personal');
  Object.defineProperty(f.service.registry, 'userPath', { value: user });
  await mkdir(join(user, 'agents'), { recursive: true });
  await mkdir(join(user, 'skills/live-skill'), { recursive: true });
  await writeFile(
    join(user, 'skills/live-skill/SKILL.md'),
    '---\nname: live-skill\ndescription: Live\n---\nLIVE_SKILL_INSTRUCTIONS',
  );
  const writeAgent = async (model: string, reasoning: string, instructions: string) =>
    writeFile(
      join(user, 'agents/fs-dev.agent.md'),
      `---\n${JSON.stringify({ name: 'Live developer', description: 'Live role', tools: ['read'], model, reasoning, policy: 'read-only', skills: ['live-skill'], emptyContextByDefault: false, roastLevel: 'off' })}\n---\n${instructions}`,
    );
  await writeAgent('first-model', 'high', 'INITIAL_PROFILE');
  await f.service.refresh();
  await f.service.checkRuntime();
  const feature = await f.service.createFeature({
    title: 'Live inheritance',
    description: '',
    workflowId: 'single',
  });
  const step = feature.steps[0];
  expect(step.inheritAgent).toBe(true);
  expect(step.model).toBe('');
  expect(step.skills).toEqual([]);
  const preview = await f.service.previewRun(feature.id, step.id);
  expect(preview.prompt).toContain('LIVE_SKILL_INSTRUCTIONS');
  await writeAgent('updated-model', 'low', 'UPDATED_PROFILE');
  await expect(
    f.service.runStep(feature.id, step.id, '', false, undefined, preview.fingerprint),
  ).rejects.toThrow();
  expect(f.adapter.run).not.toHaveBeenCalled();
  step.skills = ['stale-copy-must-not-run'];
  await f.service.runStep(feature.id, step.id);
  expect(f.inputs[0].step).toMatchObject({
    model: '',
    reasoning: 'high',
    skills: ['live-skill'],
    policy: 'read-only',
    description: 'Live role',
  });
  expect(f.inputs[0].agent).toMatchObject({ instructions: 'UPDATED_PROFILE', tools: ['read'] });
  expect(f.inputs[0].preparedPrompt).toContain('LIVE_SKILL_INSTRUCTIONS');
  step.model = 'team-model';
  step.reasoning = '';
  await f.service.runStep(feature.id, step.id);
  expect(f.inputs[1].step).toMatchObject({
    model: 'team-model',
    reasoning: '',
    skills: ['live-skill'],
  });
});
// Real Git/checkpoint preparation can exceed Vitest's one-second polling default on Windows.
// Fail immediately if execution ends early, and observe its rejection even when the wait fails.
async function waitForInteraction(check: () => void, running: Promise<unknown>): Promise<void> {
  await Promise.race([
    vi.waitFor(check, { timeout: 10000 }),
    running.then(() => {
      throw new Error('Execution finished before the expected human interaction.');
    }),
  ]);
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
    expect(feature.status).toBe('awaiting_final_validation');
    await f.service.finalizeFeature(feature.id, featureStateKey(feature));
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
    expect(feature.status).toBe('awaiting_final_validation');
    await f.service.finalizeFeature(feature.id, featureStateKey(feature));
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
    // Legacy sessions retain their explicit step skills.
    feature.steps[0].inheritAgent = false;
    feature.steps[0].skills.push('missing-custom-skill');
    await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow(/skill|compétence/i);
    expect(f.adapter.run).not.toHaveBeenCalled();
  });
  it('previews missing agent and step skills, then runs only after their explicit exclusion', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Incomplete skill configuration',
      description: '',
      workflowId: 'single',
    });
    // Legacy sessions retain their explicit step skills.
    feature.steps[0].inheritAgent = false;
    feature.steps[0].skills.push('missing-step-skill');
    const agent = f.service.state.agents.find((a) => a.id === feature.steps[0].agentId)!;
    const user = await mkdtemp(join(tmpdir(), 'studio-missing-skills-user-'));
    roots.push(user);
    Object.defineProperty(f.service.registry, 'userPath', { value: user });
    await mkdir(join(user, 'agents'), { recursive: true });
    const { stringify } = await import('yaml');
    await writeFile(
      join(user, 'agents', `${agent.id}.agent.md`),
      `---\n${stringify({ name: agent.name, description: agent.description, skills: ['missing-agent-skill'] })}---\nAgent instructions\n`,
    );
    const preview = await f.service.previewRun(feature.id, 'session');
    expect(preview.sections.filter((s) => s.unavailable).map((s) => s.id)).toEqual([
      'skill:missing-agent-skill',
      'skill:missing-step-skill',
    ]);
    expect(preview.errors.join(' ')).toContain('missing-agent-skill');
    expect(preview.errors.join(' ')).toContain(agent.id);
    expect(preview.errors.join(' ')).toContain('missing-step-skill');
    await expect(f.service.runStep(feature.id, 'session')).rejects.toThrow('missing-agent-skill');
    expect(f.adapter.run).not.toHaveBeenCalled();
    const launch = {
      initialContext: '',
      mcpServerIds: [],
      memoryIds: [],
      useProjectMemory: false,
      contextBlocks: {
        'skill:missing-agent-skill': { enabled: false },
        'skill:missing-step-skill': { enabled: false },
      },
    };
    const excluded = await f.service.previewRun(feature.id, 'session', '', false, launch);
    expect(excluded.errors).toEqual([]);
    expect(excluded.prompt).not.toContain('Skill introuvable');
    await f.service.runStep(feature.id, 'session', '', false, launch, excluded.fingerprint);
    expect(f.adapter.run).toHaveBeenCalledOnce();
  });
  it('reloads skills installed manually and rejects a removal since preview without charging a run', async () => {
    const f = await fixture();
    await f.service.checkRuntime();
    const feature = await f.service.createFeature({
      title: 'Reload catalog',
      description: '',
      workflowId: 'single',
    });
    const user = await mkdtemp(join(tmpdir(), 'studio-restored-skill-'));
    roots.push(user);
    Object.defineProperty(f.service.registry, 'userPath', { value: user });
    // Legacy sessions retain their explicit step skills.
    feature.steps[0].inheritAgent = false;
    feature.steps[0].skills.push('restored-skill');
    expect((await f.service.previewRun(feature.id, 'session')).errors.join(' ')).toContain(
      'restored-skill',
    );
    const directory = join(user, 'skills/restored-skill');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'SKILL.md'),
      '---\nname: Restored\ndescription: Restored skill\n---\nFresh instructions',
    );
    const preview = await f.service.previewRun(feature.id, 'session');
    expect(preview.errors).toEqual([]);
    expect(preview.prompt).toContain('Fresh instructions');
    await rm(directory, { recursive: true });
    await expect(
      f.service.runStep(feature.id, 'session', '', false, undefined, preview.fingerprint),
    ).rejects.toThrow('restored-skill');
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
    delete feature.execution; // The legacy Studio file tool still verifies its own byte grants.
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
    expect(stored.launch).toEqual({ ...selected, permissionMode: 'manual' });
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
    await waitForInteraction(() => expect(f.service.state.humanRequests).toHaveLength(1), running);
    const question = f.service.state.humanRequests![0];
    expect(question.kind).toBe('question');
    f.service.answerHumanRequest(question.id, 'US-207');
    await waitForInteraction(
      () => expect(f.service.state.humanRequests![0]?.kind).toBe('mcp-permission'),
      running,
    );
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
    await waitForInteraction(() => expect(f.service.state.humanRequests).toHaveLength(1), running);
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
    expect(feature.status).toBe('awaiting_final_validation');
    await f.service.finalizeFeature(feature.id, featureStateKey(feature));
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
    await waitForInteraction(() => expect(f.service.state.humanRequests).toHaveLength(1), running);
    expect(feature.autopilot?.status).toBe('paused');
    f.service.answerHumanRequest(f.service.state.humanRequests![0].id, 'Only export');
    await running;
    expect(feature.steps[0].status).toBe('awaiting_review');
    expect(f.inputs).toHaveLength(1);
    await f.service.startAutopilot(feature.id);
    expect(feature.status).toBe('awaiting_final_validation');
    await f.service.finalizeFeature(feature.id, featureStateKey(feature));
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
    expect(feature.status).toBe('awaiting_final_validation');
    await f.service.finalizeFeature(feature.id, featureStateKey(feature));
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
    expect(feature.status).toBe('awaiting_final_validation');
    await f.service.finalizeFeature(feature.id, featureStateKey(feature));
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

describe('editable feature teams', () => {
  it('persists an empty draft, accepts a composition, rejects stale saves, and retains the template', async () => {
    const f = await fixture();
    const feature = await f.service.createFeature({ title: 'Compose', description: 'No preset' });
    expect((await f.service.store.load()).features[0].steps).toEqual([]);
    const template = structuredClone(
      f.service.state.workflows.find((workflow) => workflow.id === 'feature')!,
    );
    const { instantiateTeam } = await import('../src/shared/team');
    const steps = instantiateTeam(template.steps);
    expect(await f.service.saveFeatureTeam(feature.id, 0, steps)).toBe(1);
    expect((await f.service.store.load()).features[0].steps).toHaveLength(steps.length);
    await expect(f.service.saveFeatureTeam(feature.id, 0, [])).rejects.toThrow('changé');
    expect(feature.steps).toHaveLength(steps.length);
    expect(f.service.state.workflows.find((workflow) => workflow.id === 'feature')).toEqual(
      template,
    );
    await f.service.saveFeatureTeam(feature.id, 1, []);
    expect((await f.service.store.load()).features[0]).toMatchObject({
      status: 'draft',
      activeStepId: '',
      steps: [],
      teamRevision: 2,
    });
    await expect(f.service.startAutopilot(feature.id)).rejects.toThrow('Compose');
    await expect(
      f.service.saveAutopilot(feature.id, {
        checkpoints: [],
        maxRuns: 10,
        maxCorrectionCycles: 0,
        stepInputs: {},
      }),
    ).rejects.toThrow('Compose');
  });
  it('does not lock on preflight rejection, but retains the lock after runtime failure and reload', async () => {
    const f = await fixture();
    const feature = await f.service.createFeature({
      title: 'Lock',
      description: '',
      workflowId: 'single',
    });
    const step = feature.steps[0];
    await expect(f.service.runStep(feature.id, step.id)).rejects.toThrow('Connecte');
    expect(feature.teamLockedAt).toBeUndefined();
    const { teamSteps } = await import('../src/shared/team');
    await f.service.saveFeatureTeam(feature.id, 0, teamSteps(feature));
    await f.service.checkRuntime();
    await f.service.previewRun(feature.id, step.id);
    expect(feature.teamLockedAt).toBeUndefined();
    f.run(async () => {
      throw new Error('Runtime stopped');
    });
    await f.service.runStep(feature.id, step.id).catch(() => undefined);
    expect(feature.teamLockedAt).toBeTruthy();
    await expect(f.service.saveFeatureTeam(feature.id, 1, [])).rejects.toThrow('historique');
    expect((await f.service.store.load()).features[0].teamLockedAt).toBe(feature.teamLockedAt);
  });
  it('rejects invalid compositions and queues valid changes while an operation runs', async () => {
    const f = await fixture();
    const feature = await f.service.createFeature({
      title: 'Validate',
      description: '',
      workflowId: 'feature',
    });
    const { teamSteps } = await import('../src/shared/team');
    const original = teamSteps(feature);
    const unknown = structuredClone(original);
    unknown[0].agentId = 'missing';
    await expect(f.service.saveFeatureTeam(feature.id, 0, unknown)).rejects.toThrow(
      'Agent introuvable',
    );
    const collision = structuredClone(original);
    collision[1].artifact = collision[0].artifact.toUpperCase().replace(/MD$/, 'md');
    await expect(f.service.saveFeatureTeam(feature.id, 0, collision)).rejects.toThrow(
      'même livrable',
    );
    const cycle = structuredClone(original);
    cycle[0].dependsOn = [cycle.at(-1)!.id];
    await expect(f.service.saveFeatureTeam(feature.id, 0, cycle)).rejects.toThrow();
    expect(teamSteps(feature)).toEqual(original);
    let release!: () => void, enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const operation = f.service.withWorkspaceMutation(
      'Launching',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          enter();
        }),
    );
    await entered;
    try {
      await expect(f.service.saveFeatureTeam(feature.id, 0, [])).resolves.toBe(1);
      expect(feature.pendingTeam).toBeDefined();
    } finally {
      release();
    }
    await operation;
    expect(feature.pendingTeam).toBeUndefined();
    expect(feature.steps).toHaveLength(0);
  });
  it('rolls back the in-memory composition if durable saving fails', async () => {
    const f = await fixture();
    const feature = await f.service.createFeature({
      title: 'Rollback',
      description: '',
      workflowId: 'single',
    });
    const before = structuredClone(feature);
    const save = vi.spyOn(f.service.store, 'save').mockRejectedValueOnce(new Error('Disk full'));
    await expect(f.service.saveFeatureTeam(feature.id, 0, [])).rejects.toThrow('Disk full');
    expect(feature).toEqual(before);
    save.mockRestore();
  });
});

it('creates an adjusted discussion proposal atomically with pending criteria and a team, without any run', async () => {
  const f = await fixture();
  const requestId = 'b65b0906-056a-43f7-a77f-3b5459d08e31';
  const discussionId = '3f98001e-c9de-4d69-b0a5-9ae61c4c7b27';
  const agentId = f.service.state.agents[0].id;
  const input = {
    requestId,
    discussionId,
    title: 'Besoin ajusté',
    description: 'Choix humain',
    criteria: ['Entrée ouvre le résultat'],
    team: [
      {
        agentId,
        name: 'Analyse',
        description: 'Préciser les interactions',
        policy: 'read-only' as const,
      },
      {
        agentId,
        name: 'Réalisation',
        description: 'Implémenter le choix validé',
        policy: 'workspace-write' as const,
      },
    ],
  };
  const feature = await f.service.createFeature(input);
  expect(feature).toMatchObject({
    discussionId,
    status: 'draft',
    title: 'Besoin ajusté',
    criteria: [{ text: 'Entrée ouvre le résultat', status: 'pending', evidence: '' }],
  });
  expect(feature.steps.map((step) => step.policy)).toEqual([
    agentPolicy(f.service.state.agents[0]),
    agentPolicy(f.service.state.agents[0]),
  ]);
  expect(feature.steps[1].dependsOn).toEqual([feature.steps[0].id]);
  expect(feature.steps.every((step) => !step.attempts.length)).toBe(true);
  expect(f.adapter.run).not.toHaveBeenCalled();
  expect((await f.service.createFeature(input)).id).toBe(feature.id);
  expect((await f.service.store.load()).features[0].discussionId).toBe(discussionId);
  await expect(
    f.service.createFeature({
      ...input,
      requestId: undefined,
      team: [{ ...input.team[0], agentId: 'missing' }],
    }),
  ).rejects.toThrow('disponible');
  expect(f.service.engine.features).toHaveLength(1);
});

it('freezes a report discussion from the real execution archive and rejects stale revisions', async () => {
  const f = await fixture();
  await f.service.checkRuntime();
  const feature = await f.service.createFeature({
    title: 'Report discussion',
    description: 'Original need',
    workflowId: 'feature',
  });
  const step = feature.steps[0];
  step.reasoning = 'high';
  await f.service.runStep(feature.id, step.id);
  const attempt = step.attempts[0];
  const source = await f.service.discussionSource(
    feature.id,
    step.id,
    attempt.id,
    attempt.revision ?? 0,
  );
  expect(source.context).toContain('Original need');
  expect(source.reasoning).toBe('high');
  expect(source.output).toBe('# Livrable');
  feature.description = 'Changed after the run';
  expect(
    (await f.service.discussionSource(feature.id, step.id, attempt.id, attempt.revision ?? 0))
      .context,
  ).not.toContain('Changed after the run');
  await expect(f.service.discussionSource(feature.id, step.id, attempt.id, 999)).rejects.toThrow(
    'changé',
  );
});

async function optionalFixture() {
  const f = await fixture();
  await f.service.checkRuntime();
  const feature = await f.service.createFeature({
    title: 'Choix facultatif',
    description: '',
    workflowId: 'single',
  });
  const template = { ...feature.steps[0] };
  const { status: _status, attempts: _attempts, ...configuration } = template;
  await f.service.saveFeatureTeam(feature.id, 0, [
    {
      ...configuration,
      id: 'optional',
      name: 'Documentation',
      optional: true,
      dependsOn: [],
      artifact: 'docs.md',
    },
    {
      ...configuration,
      id: 'required',
      name: 'Relecture',
      optional: false,
      dependsOn: ['optional'],
      artifact: 'review.md',
    },
  ]);
  await f.service.saveAutopilot(feature.id, {
    checkpoints: [],
    maxRuns: 3,
    maxCorrectionCycles: 0,
    stepInputs: {},
  });
  return { ...f, feature };
}
it('pauses optional work durably without inference, notifies once, then skips and continues', async () => {
  const f = await optionalFixture();
  const notified = vi.fn();
  f.service.on('optionalStep', notified);
  await f.service.startAutopilot(f.feature.id);
  expect(f.inputs).toHaveLength(0);
  expect(f.feature.status).toBe('attention');
  expect(f.feature.autopilot?.status).toBe('paused');
  const decision = f.feature.optionalRequest!;
  expect(decision.stepId).toBe('optional');
  expect((await new Store(f.storage).load()).features[0].optionalRequest).toEqual(decision);
  await f.service.startAutopilot(f.feature.id);
  expect(notified).toHaveBeenCalledTimes(1);
  const message = {
    type: 'resolveOptionalStep' as const,
    featureId: f.feature.id,
    stepId: decision.stepId,
    decisionId: decision.id,
    choice: 'skip' as const,
    expectedStateKey: decision.stateKey,
    continueAutopilot: true,
  };
  await f.service.resolveOptionalStep(message);
  expect(f.inputs.map((input) => input.step.id)).toEqual(['required']);
  expect(f.inputs[0].preparedPrompt).toContain(`${f.feature.steps[0].name} (optional)`);
  expect(f.feature.steps[0].attempts).toHaveLength(0);
  expect(f.feature.autopilot?.runs).toBe(1);
  expect(f.feature.status).toBe('awaiting_final_validation');
  expect(f.feature.optionalRequest).toBeUndefined();
  await expect(f.service.resolveOptionalStep(message)).rejects.toThrow('notification');
  await f.service.finalizeFeature(f.feature.id, featureStateKey(f.feature));
  expect(f.feature.status).toBe('completed');
});
it('executes an optional member only after the user choice, retaining normal checkpoints', async () => {
  const f = await optionalFixture();
  f.feature.autopilot!.checkpoints = ['optional'];
  await f.service.startAutopilot(f.feature.id);
  const decision = f.feature.optionalRequest!;
  await f.service.resolveOptionalStep({
    type: 'resolveOptionalStep',
    featureId: f.feature.id,
    stepId: decision.stepId,
    decisionId: decision.id,
    choice: 'run',
    expectedStateKey: decision.stateKey,
    continueAutopilot: true,
  });
  expect(f.inputs.map((input) => input.step.id)).toEqual(['optional']);
  expect(f.feature.steps[0].status).toBe('awaiting_review');
  expect(f.feature.autopilot?.status).toBe('paused');
  expect(f.feature.steps[0].optionalDecisionHistory).toHaveLength(1);
});
it('rejects stale optional notifications, concurrent answers and untrusted decisions', async () => {
  const f = await optionalFixture();
  await f.service.startAutopilot(f.feature.id);
  const decision = f.feature.optionalRequest!;
  const message = {
    type: 'resolveOptionalStep' as const,
    featureId: f.feature.id,
    stepId: decision.stepId,
    decisionId: decision.id,
    choice: 'skip' as const,
    expectedStateKey: decision.stateKey,
  };
  f.feature.description += ' changed';
  await expect(f.service.resolveOptionalStep(message)).rejects.toThrow('changé');
  f.trust(false);
  await expect(
    f.service.resolveOptionalStep({ ...message, expectedStateKey: featureStateKey(f.feature) }),
  ).rejects.toThrow();
  f.trust(true);
  const answers = await Promise.allSettled(
    [1, 2].map(() =>
      f.service.resolveOptionalStep({ ...message, expectedStateKey: featureStateKey(f.feature) }),
    ),
  );
  expect(answers.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(f.feature.steps[0].optionalDecisionHistory).toHaveLength(1);
  expect(f.inputs).toHaveLength(0);
});
it('rolls back an optional decision if its durable save fails', async () => {
  const f = await optionalFixture();
  await f.service.startAutopilot(f.feature.id);
  const before = structuredClone(f.feature);
  const decision = f.feature.optionalRequest!;
  vi.spyOn(f.service.store, 'save').mockRejectedValueOnce(new Error('disk full'));
  await expect(
    f.service.resolveOptionalStep({
      type: 'resolveOptionalStep',
      featureId: f.feature.id,
      stepId: decision.stepId,
      decisionId: decision.id,
      choice: 'skip',
      expectedStateKey: decision.stateKey,
    }),
  ).rejects.toThrow('disk full');
  expect(f.feature).toEqual(before);
  expect(f.inputs).toHaveLength(0);
});

it('reopens an unresolved optional choice in pause without launching an agent', async () => {
  const f = await optionalFixture();
  await f.service.startAutopilot(f.feature.id);
  const request = structuredClone(f.feature.optionalRequest!);
  await f.service.dispose();
  const reopened = new StudioService(
    f.workspace,
    resolve('defaults'),
    new Store(f.storage),
    () => true,
  );
  services.push(reopened);
  const notified = vi.fn();
  reopened.on('optionalStep', notified);
  await reopened.initialize();
  reopened.adapter = f.adapter;
  await reopened.checkRuntime();
  const feature = reopened.engine.getFeature(f.feature.id);
  expect(feature.autopilot?.status).toBe('paused');
  expect(feature.optionalRequest).toEqual(request);
  expect(notified).not.toHaveBeenCalled();
  expect(f.inputs).toHaveLength(0);
  await reopened.resolveOptionalStep({
    type: 'resolveOptionalStep',
    featureId: feature.id,
    stepId: request.stepId,
    decisionId: request.id,
    expectedStateKey: request.stateKey,
    choice: 'skip',
    continueAutopilot: true,
  });
  expect(f.inputs.map((input) => input.step.id)).toEqual(['required']);
});

it('persists native permissions, refusal, runtime evidence and observed edits without inventing ownership', async () => {
  const f = await fixture();
  await f.service.checkRuntime();
  const feature = await f.service.createFeature({
    title: 'Native session',
    description: 'Fix a file',
    workflowId: 'single',
  });
  expect(feature.execution).toEqual({ mode: 'copilot-native', permissionMode: 'manual' });
  await f.service.setPermissionMode(feature.id, 'allow-all');
  const stale = await f.service.previewRun(feature.id, 'session');
  await f.service.setPermissionMode(feature.id, 'manual');
  await expect(
    f.service.runStep(feature.id, 'session', '', false, undefined, stale.fingerprint),
  ).rejects.toThrow(/contexte a changé/);
  expect(f.inputs).toHaveLength(0);
  await writeFile(join(f.workspace, 'already-dirty.txt'), 'human work');
  let permitted: boolean | undefined;
  f.run(async (_input, callbacks) => {
    permitted = await callbacks.onNativePermission!({
      kind: 'shell',
      question: 'Execute npm test?',
      details: 'npm test',
    });
    await writeFile(join(f.workspace, 'already-dirty.txt'), 'human work plus native edit');
    callbacks.onNativeActivity!({
      id: 'tool1',
      sessionId: 'session-1',
      source: 'copilot',
      tool: 'bash',
      startedAt: new Date().toISOString(),
      status: 'completed',
      directory: f.workspace,
      arguments: '{}',
      command: 'npm test',
      output: 'real tool output',
      exitCode: 0,
    });
    return finished();
  });
  const run = f.service.runStep(feature.id, 'session');
  const error = run.catch((reason) => {
    throw reason;
  });
  await expect.poll(() => f.service.state.humanRequests?.length, { timeout: 10000 }).toBe(1);
  const request = f.service.state.humanRequests![0];
  expect(request.kind).toBe('native-permission');
  await expect(f.service.setPermissionMode(feature.id, 'allow-all')).rejects.toThrow(
    /demande en cours/,
  );
  f.service.answerHumanRequest(request.id, 'deny');
  await error;
  expect(permitted).toBe(false);
  const stored = (await f.service.store.load()).features.find((item) => item.id === feature.id)!;
  expect(stored.execution?.permissionMode).toBe('manual');
  const attempt = stored.steps[0].attempts.at(-1)!;
  expect(attempt.nativeActivity?.[0]).toMatchObject({ source: 'copilot', exitCode: 0 });
  expect(attempt.changedFiles).toContain('already-dirty.txt');
  expect(attempt.fileHashes?.['already-dirty.txt']).toBeUndefined();
  expect(stored.workspaceFileHashes?.['already-dirty.txt']).toBeUndefined();
  expect(f.service.state.humanRequests).toHaveLength(0);
});

it('cancels native permission waits and keeps changes visible after interruption', async () => {
  const f = await fixture();
  await f.service.checkRuntime();
  const feature = await f.service.createFeature({
    title: 'Native interruption',
    description: '',
    workflowId: 'single',
  });
  f.run(async (_input, callbacks) => {
    await writeFile(join(f.workspace, 'partial.txt'), 'partial work');
    await callbacks.onNativePermission!({
      kind: 'shell',
      question: 'Continue?',
      details: 'fixture',
    });
    throw new Error('The cancelled permission must never continue.');
  });
  const run = f.service.runStep(feature.id, 'session');
  await expect.poll(() => f.service.state.humanRequests?.length, { timeout: 10000 }).toBe(1);
  const requestId = f.service.state.humanRequests![0].id;
  f.service.cancel(feature.id);
  await run;
  expect(feature.steps[0].status).toBe('cancelled');
  expect(feature.steps[0].attempts[0].changedFiles).toContain('partial.txt');
  expect(f.service.state.humanRequests).toHaveLength(0);
  expect(() => f.service.answerHumanRequest(requestId, 'allow')).toThrow(/plus active/);
});
