import { featureStateKey } from '../src/shared/collaboration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentAdapter, RunCallbacks, RunInput, RunResult } from '../src/shared/types';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { runProcess } from '../src/host/process';

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

async function configuredLoop() {
  const f = await fixture();
  await f.service.checkRuntime();
  const feature = await f.service.createFeature({
    title: 'Verified correction',
    description: 'Original success contract',
    team: [
      { name: 'Dev', description: 'Implement', agentId: 'fs-dev', policy: 'workspace-write' },
      { name: 'Review', description: 'Review result', agentId: 'fs-review', policy: 'read-only' },
    ],
  });
  await f.service.saveCriteria(feature.id, [
    { id: 'acceptance', text: 'Original behavior', status: 'pending', evidence: '' },
  ]);
  const [dev, review] = feature.steps;
  const config = {
    checkpoints: [],
    maxRuns: 8,
    maxCorrectionCycles: 4,
    reviewStepId: review.id,
    correctionStepId: dev.id,
    stepInputs: {},
    correctionLoop: { maxStagnantCycles: 2 },
  };
  await f.service.saveAutopilot(feature.id, config);
  f.run(async (input) => ({
    ...finished(),
    ...(input.step.id === review.id
      ? {
          review: {
            verdict: 'changes_requested' as const,
            summary: 'Unchanged defect',
            findings: [
              {
                id: 'acceptance-defect',
                severity: 'blocking' as const,
                message: 'Missing acceptance behavior',
              },
            ],
          },
        }
      : {}),
  }));
  return { ...f, feature, dev, review, config };
}

describe('verified correction loop host boundaries', () => {
  it('freezes the contract and blocks changed criterion text before another adapter call', async () => {
    const f = await configuredLoop();
    await f.service.saveAutopilot(f.feature.id, { ...f.config, checkpoints: [f.dev.id] });
    await f.service.startAutopilot(f.feature.id);
    expect(f.inputs).toHaveLength(1);
    await f.service.saveCriteria(f.feature.id, [
      { id: 'acceptance', text: 'A newly required behavior', status: 'pending', evidence: '' },
    ]);
    await f.service.startAutopilot(f.feature.id);
    expect(f.inputs).toHaveLength(1);
    expect(f.feature.autopilot?.status).toBe('paused');
    expect(f.feature.autopilot?.correctionLoopState?.pause).toBe('contract_changed');
    expect(f.feature.autopilot?.correctionLoopState?.contract.criteria).toEqual([
      { id: 'acceptance', text: 'Original behavior' },
    ]);
  });

  it('stops repeated comparable reviews and persists an idempotent bounded ledger', async () => {
    const f = await configuredLoop();
    await f.service.startAutopilot(f.feature.id);
    expect(f.feature.autopilot?.correctionLoopState?.pause).toBe('stagnation');
    expect(f.feature.autopilot).toMatchObject({ runs: 6, correctionCycles: 2, status: 'paused' });
    const original = structuredClone(f.feature.autopilot?.correctionLoopState);
    expect(original?.observations).toHaveLength(3);
    expect(original?.observations.at(-1)?.persistent).toHaveLength(1);
    await f.service.startAutopilot(f.feature.id);
    expect(f.inputs).toHaveLength(6);
    expect(f.feature.autopilot?.correctionLoopState).toEqual(original);
    const restored = await new Store(f.storage).load();
    expect(restored.features[0].autopilot?.correctionLoopState).toEqual(original);
    expect(restored.features[0].autopilot?.runs).toBe(6);
  });

  it('keeps the human checkpoint before a review can dispatch a correction', async () => {
    const f = await configuredLoop();
    await f.service.saveAutopilot(f.feature.id, { ...f.config, checkpoints: [f.review.id] });
    await f.service.startAutopilot(f.feature.id);
    expect(f.inputs.map((input) => input.step.id)).toEqual([f.dev.id, f.review.id]);
    expect(f.feature.autopilot).toMatchObject({ status: 'paused', runs: 2, correctionCycles: 0 });
    expect(f.feature.autopilot?.reason).toMatch(/humaine/);
    expect(f.review.status).toBe('awaiting_review');
  });

  it('does not interpret a transport failure as a verified correction observation', async () => {
    const f = await configuredLoop();
    f.run(async (input) => {
      if (input.step.id === f.review.id) throw new Error('Connection unavailable');
      return finished();
    });
    await f.service.startAutopilot(f.feature.id);
    expect(f.feature.autopilot).toMatchObject({ status: 'paused', runs: 2, correctionCycles: 0 });
    expect(f.feature.autopilot?.correctionLoopState?.observations).toEqual([]);
    expect(f.review.status).toBe('failed');
    expect(f.inputs).toHaveLength(2);
  });
});

it('requires current human renewal and preserves spent budgets and the previous ledger', async () => {
  const f = await configuredLoop();
  await f.service.startAutopilot(f.feature.id);
  const previous = structuredClone(f.feature.autopilot!.correctionLoopState!);
  const stateKey = featureStateKey(f.feature);
  const calls = f.inputs.length;
  await expect(
    f.service.renewCorrectionLoop(f.feature.id, 'stale-contract', stateKey),
  ).rejects.toThrow();
  await expect(
    f.service.renewCorrectionLoop(f.feature.id, previous.contract.id, 'stale-state'),
  ).rejects.toThrow();
  expect(f.feature.autopilot!.correctionLoopState).toEqual(previous);
  await f.service.renewCorrectionLoop(f.feature.id, previous.contract.id, stateKey);
  expect(f.inputs).toHaveLength(calls);
  expect(f.feature.autopilot).toMatchObject({ runs: 6, correctionCycles: 2, status: 'paused' });
  expect(f.feature.autopilot!.correctionLoopState!.contract.id).not.toBe(previous.contract.id);
  expect(f.feature.autopilot!.correctionLoopState!.observations).toEqual([]);
  expect(f.feature.autopilot!.correctionLoopHistory).toEqual([previous]);
  await f.service.saveAutopilot(f.feature.id, f.config);
  expect(f.feature.autopilot!.correctionLoopHistory).toEqual([previous]);
  expect(f.feature.autopilot!.runs).toBe(6);
  expect(f.feature.autopilot!.correctionCycles).toBe(2);
  const restored = await new Store(f.storage).load();
  expect(restored.features[0].autopilot).toEqual(f.feature.autopilot);
});

it('requires renewal when the actual allowed test command changes', async () => {
  const f = await configuredLoop();
  await f.service.saveSettings({
    ...f.service.state.settings,
    testCommands: [
      { id: 'unit', name: 'Unit', command: process.execPath, args: ['-e', 'process.exit(0)'] },
    ],
  });
  await f.service.saveAutopilot(f.feature.id, { ...f.config, checkpoints: [f.dev.id] });
  await f.service.startAutopilot(f.feature.id);
  const original = structuredClone(f.feature.autopilot!.correctionLoopState!.contract);
  await f.service.saveSettings({
    ...f.service.state.settings,
    testCommands: [
      { id: 'unit', name: 'Unit', command: process.execPath, args: ['-e', 'process.exit(1)'] },
    ],
  });
  await f.service.startAutopilot(f.feature.id);
  expect(f.inputs).toHaveLength(1);
  expect(f.feature.autopilot!.correctionLoopState!.pause).toBe('contract_changed');
  expect(f.feature.autopilot!.correctionLoopState!.contract).toEqual(original);
});

it('records real host test receipts without copying their raw output into the ledger', async () => {
  const f = await fixture();
  await f.service.checkRuntime();
  const marker = 'RAW_PRIVATE_TEST_DIAGNOSTIC_739';
  await f.service.saveSettings({
    ...f.service.state.settings,
    testCommands: [
      {
        id: 'unit',
        name: 'Unit',
        command: process.execPath,
        args: ['-e', `console.error('${marker}'); process.exit(1)`],
      },
    ],
  });
  const feature = await f.service.createFeature({
    title: 'Real test failures',
    description: 'Validated success contract',
    team: [
      { name: 'Dev', description: 'Implement', agentId: 'fs-dev', policy: 'workspace-write' },
      { name: 'Tests', description: 'Run tests', agentId: 'fs-tests', policy: 'tests' },
      { name: 'Review', description: 'Review result', agentId: 'fs-review', policy: 'read-only' },
    ],
  });
  await f.service.saveCriteria(feature.id, [
    { id: 'unit-ok', text: 'The real command must pass', status: 'pending', evidence: '' },
  ]);
  const [dev, tests, review] = feature.steps;
  await f.service.saveAutopilot(feature.id, {
    checkpoints: [],
    maxRuns: 8,
    maxCorrectionCycles: 4,
    stepInputs: {},
    correctionStepId: dev.id,
    reviewStepId: review.id,
    correctionLoop: { maxStagnantCycles: 2 },
  });
  f.run(async (input, callbacks, signal) => {
    if (input.step.id === tests.id) {
      const tools = await f.service.getTools(input, callbacks, signal);
      const tool = tools.find((tool) => tool.name === 'studio_run_test');
      if (!tool?.handler) throw new Error('Missing host test tool');
      await tool.handler(
        { id: 'unit' },
        {
          sessionId: 'session',
          toolCallId: 'test',
          toolName: 'studio_run_test',
          arguments: { id: 'unit' },
        },
      );
    }
    return finished();
  });
  await f.service.startAutopilot(feature.id);
  expect(feature.autopilot?.correctionLoopState?.pause).toBe('stagnation');
  const observations = feature.autopilot!.correctionLoopState!.observations;
  expect(observations).toHaveLength(3);
  expect(
    observations.every(
      (observation) => observation.kind === 'test' && observation.evidenceIds.length === 1,
    ),
  ).toBe(true);
  expect(JSON.stringify(observations)).not.toContain(marker);
  expect(tests.attempts.at(-1)?.evidence?.[0]).toMatchObject({ source: 'host', exitCode: 1 });
  expect(tests.attempts.at(-1)?.evidence?.[0].stderr).toContain(marker);
});

it('restores the previous contract and ledger if renewal cannot be persisted', async () => {
  const f = await configuredLoop();
  await f.service.saveAutopilot(f.feature.id, { ...f.config, checkpoints: [f.dev.id] });
  await f.service.startAutopilot(f.feature.id);
  const previous = structuredClone(f.feature.autopilot!);
  vi.spyOn(f.service, 'persist').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(
    f.service.renewCorrectionLoop(
      f.feature.id,
      previous.correctionLoopState!.contract.id,
      featureStateKey(f.feature),
    ),
  ).rejects.toThrow('Storage unavailable');
  expect(f.feature.autopilot).toEqual(previous);
  expect((await new Store(f.storage).load()).features[0].autopilot).toEqual(previous);
  expect(f.inputs).toHaveLength(1);
});

async function successfulVerifiedLoop() {
  const f = await fixture();
  await git(f.workspace, 'config', 'user.name', 'Fixture');
  await git(f.workspace, 'config', 'user.email', 'fixture@example.invalid');
  await git(f.workspace, 'commit', '--allow-empty', '-m', 'Initial verified workspace');
  await f.service.checkRuntime();
  await f.service.saveSettings({
    ...f.service.state.settings,
    testCommands: [
      {
        id: 'unit',
        name: 'Unit',
        command: process.execPath,
        args: ['-e', 'console.log("verified pass")'],
      },
    ],
  });
  const feature = await f.service.createFeature({
    title: 'Verified read-only review',
    description: 'A successful command remains a human-reviewed result',
    team: [
      { name: 'Dev', description: 'Implement', agentId: 'fs-dev', policy: 'workspace-write' },
      { name: 'Tests', description: 'Execute the host test', agentId: 'fs-tests', policy: 'tests' },
      {
        name: 'Review',
        description: 'Read-only review',
        agentId: 'fs-review',
        policy: 'read-only',
      },
    ],
  });
  await f.service.saveCriteria(feature.id, [
    { id: 'verified', text: 'Command and review succeed', status: 'pending', evidence: '' },
  ]);
  const [dev, tests, review] = feature.steps;
  await f.service.saveAutopilot(feature.id, {
    checkpoints: [],
    maxRuns: 8,
    maxCorrectionCycles: 2,
    stepInputs: {},
    correctionStepId: dev.id,
    reviewStepId: review.id,
    correctionLoop: { maxStagnantCycles: 2 },
  });
  f.run(async (input, callbacks, signal) => {
    if (input.step.id === tests.id) {
      const tool = (await f.service.getTools(input, callbacks, signal)).find(
        (tool) => tool.name === 'studio_run_test',
      );
      if (!tool?.handler) throw new Error('Missing host test tool');
      await tool.handler(
        { id: 'unit' },
        {
          sessionId: 'session',
          toolCallId: 'success',
          toolName: 'studio_run_test',
          arguments: { id: 'unit' },
        },
      );
    }
    return {
      ...finished(),
      ...(input.step.id === review.id
        ? {
            review: {
              verdict: 'pass' as const,
              summary: 'Observed successful behavior',
              findings: [],
            },
          }
        : {}),
    };
  });
  await f.service.startAutopilot(feature.id);
  return { ...f, feature, tests, review };
}

it('attests successful host tests and a read-only review without approving pending human criteria', async () => {
  const f = await successfulVerifiedLoop();
  const loop = f.feature.autopilot!.correctionLoopState!;
  expect(loop.readiness).toBe('ready_for_human');
  expect(loop.observations.map((observation) => observation.kind)).toEqual(['test', 'review']);
  const testAttempt = f.tests.attempts.at(-1)!,
    reviewAttempt = f.review.attempts.at(-1)!;
  expect(testAttempt.evidence?.[0]).toMatchObject({
    source: 'host',
    exitCode: 0,
    stdout: 'verified pass\n',
  });
  expect(reviewAttempt.fileHashes ?? {}).toEqual({});
  expect(testAttempt.correctionLoop?.contractId).toBe(loop.contract.id);
  expect(reviewAttempt.correctionLoop?.contractId).toBe(loop.contract.id);
  expect(reviewAttempt.correctionLoop?.workspaceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(testAttempt.correctionLoop?.workspaceFingerprint).toBe(
    reviewAttempt.correctionLoop?.workspaceFingerprint,
  );
  expect(
    loop.observations.every(
      (observation) =>
        observation.workspaceFingerprint === reviewAttempt.correctionLoop!.workspaceFingerprint,
    ),
  ).toBe(true);
  expect(f.feature.criteria).toEqual([
    { id: 'verified', text: 'Command and review succeed', status: 'pending', evidence: '' },
  ]);
  expect(f.feature.finalValidation).toBeUndefined();
  expect(f.feature.autopilot?.status).toBe('paused');
  expect(f.inputs).toHaveLength(3);
});

it('requires fresh attempts under a renewed contract instead of reusing previous successful observations', async () => {
  const f = await successfulVerifiedLoop();
  const previous = structuredClone(f.feature.autopilot!.correctionLoopState!);
  expect(previous.readiness).toBe('ready_for_human');
  await f.service.saveCriteria(f.feature.id, [
    {
      id: 'verified',
      text: 'A changed criterion requires renewed verification',
      status: 'pending',
      evidence: '',
    },
  ]);
  await f.service.startAutopilot(f.feature.id);
  expect(f.feature.autopilot!.correctionLoopState!.pause).toBe('contract_changed');
  expect(f.inputs).toHaveLength(3);
  await f.service.renewCorrectionLoop(
    f.feature.id,
    previous.contract.id,
    featureStateKey(f.feature),
  );
  const renewedId = f.feature.autopilot!.correctionLoopState!.contract.id;
  await f.service.startAutopilot(f.feature.id);
  expect(f.inputs).toHaveLength(3);
  expect(f.feature.autopilot!.correctionLoopState).toMatchObject({
    observations: [],
    readiness: 'unverified',
  });
  expect(f.feature.autopilot!.correctionLoopHistory![0].observations).toEqual(
    previous.observations,
  );
  expect(f.tests.attempts.at(-1)!.correctionLoop!.contractId).toBe(previous.contract.id);
  expect(f.review.attempts.at(-1)!.correctionLoop!.contractId).not.toBe(renewedId);
  const restored = (await new Store(f.storage).load()).features[0];
  expect(restored.autopilot!.correctionLoopState!.observations).toEqual([]);
  expect(restored.autopilot!.runs).toBe(3);
  expect(restored.finalValidation).toBeUndefined();
});
