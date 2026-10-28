import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { runProcess } from '../src/host/process';
import type { AgentAdapter, RunInput } from '../src/shared/types';
import type { RunLaunchOptions } from '../src/shared/evolutions';
const roots: string[] = [],
  services: StudioService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'navigation-prepare-')));
  roots.push(root);
  const workspace = join(root, 'repo');
  await mkdir(workspace);
  const result = await runProcess('git', ['init', '-b', 'fixture'], workspace);
  if (result.code) throw new Error(result.stderr);
  const service = new StudioService(
    workspace,
    resolve('defaults'),
    new Store(join(root, 'storage')),
    () => true,
  );
  services.push(service);
  Object.defineProperty(service.registry, 'userPath', { value: join(root, 'personal') });
  service.navigationProjects = () => [{ id: 'project', path: workspace }];
  await service.initialize();
  const inputs: RunInput[] = [];
  const adapter: AgentAdapter = {
    check: vi.fn(async () => ({
      state: 'ready' as const,
      authenticated: true,
      version: 'fixture',
      models: [{ id: 'fixture-model', name: 'Fixture' }],
    })),
    run: vi.fn(async (input, callbacks) => {
      inputs.push(input);
      callbacks.onSession('fixture-session');
      return {
        content: '# Observation simulée',
        model: 'fixture-model',
        questions: [],
        changedFiles: [],
      };
    }),
    dispose: vi.fn(async () => undefined),
  };
  service.adapter = adapter;
  await service.checkRuntime();
  const feature = await service.createFeature({
    title: 'Navigation preparation',
    description: 'Synthetic',
    workflowId: 'single',
  });
  const step = feature.steps[0];
  const now = new Date().toISOString();
  await service.navigation.store.saveApplication({
    id: 'app',
    name: 'Synthetic application',
    projectIds: ['project'],
    origin: 'http://localhost:3999',
    allowedOrigins: ['http://localhost:3999'],
    ownerNavigatorId: step.agentId,
    interactionPolicy: 'confirm',
    createdAt: now,
    updatedAt: now,
  });
  const launch: RunLaunchOptions = {
    initialContext: '',
    mcpServerIds: [],
    memoryIds: [],
    useProjectMemory: false,
    navigation: {
      applicationId: 'app',
      parameters: {},
      intent: 'reach-state',
      allowInteractions: false,
    },
  };
  return { root, workspace, service, feature, step, adapter, inputs, launch };
}
describe('StudioService freezes navigation before the simulated agent begins', () => {
  it('selects the sole assigned application for the Navigator and loads its two bundled skills', async () => {
    const f = await fixture();
    f.step.agentId = 'fs-navigator';
    f.step.inheritAgent = true;
    const app = f.service.navigation.snapshot().applications[0];
    await f.service.navigation.store.saveApplication({ ...app, ownerNavigatorId: 'fs-navigator' });
    const verify = vi.spyOn(f.service.navigation.anchors, 'verify');
    const preview = await f.service.previewRun(f.feature.id, f.step.id);
    expect(verify).toHaveBeenCalled();
    expect(preview.prompt).toContain('Synthetic application');
    await f.service.runStep(f.feature.id, f.step.id, '', false, undefined, preview.fingerprint);
    expect(f.inputs[0].navigation?.application.id).toBe('app');
    expect(f.inputs[0].skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(['navigation-discovery', 'navigation-context']),
    );
  });
  it('requires an explicit Navigator application when the choice is ambiguous or omitted', async () => {
    const f = await fixture();
    f.step.agentId = 'fs-navigator';
    f.step.inheritAgent = true;
    const app = f.service.navigation.snapshot().applications[0];
    await f.service.navigation.store.saveApplication({ ...app, ownerNavigatorId: 'fs-navigator' });
    await f.service.navigation.store.saveApplication({
      ...app,
      id: 'second',
      ownerNavigatorId: 'fs-navigator',
    });
    await expect(f.service.previewRun(f.feature.id, f.step.id)).rejects.toThrow(
      /Application du parcours/,
    );
    await expect(
      f.service.previewRun(f.feature.id, f.step.id, '', false, {
        ...f.launch,
        omitNavigation: true,
      }),
    ).rejects.toThrow(/Application du parcours/);
    expect(f.adapter.run).not.toHaveBeenCalled();
  });
  it('forces the designated owner to code read-only and persists the exact host context', async () => {
    const f = await fixture();
    expect(f.step.policy).toBe('workspace-write');
    const preview = await f.service.previewRun(f.feature.id, f.step.id, '', false, f.launch);
    expect(preview.prompt).toContain('Synthetic application');
    await f.service.runStep(f.feature.id, f.step.id, '', false, f.launch, preview.fingerprint);
    expect(f.inputs).toHaveLength(1);
    expect(f.inputs[0].step.policy).toBe('read-only');
    expect(f.inputs[0].navigation).toMatchObject({
      application: { id: 'app', ownerNavigatorId: f.step.agentId },
      selection: f.launch.navigation,
      binding: { projectIds: ['project'], roots: [f.workspace] },
    });
    const saved = f.service.engine.getStep(f.feature.id, f.step.id).attempts.at(-1)!;
    expect(saved.navigation?.digest).toBe(f.inputs[0].navigation?.digest);
    expect(saved.navigation?.application).toEqual(f.inputs[0].navigation?.application);
  });
  it('rejects stale profile previews without starting an agent and skips anchor reads without selection', async () => {
    const f = await fixture();
    const verify = vi.spyOn(f.service.navigation.anchors, 'verify');
    await f.service.previewRun(f.feature.id, f.step.id);
    expect(verify).not.toHaveBeenCalled();
    const preview = await f.service.previewRun(f.feature.id, f.step.id, '', false, f.launch);
    expect(verify).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ applicationId: 'app', limit: 64 }),
    );
    const app = f.service.navigation.store.snapshot().applications[0];
    await f.service.navigation.store.saveApplication({ ...app, interactionPolicy: 'inspect' });
    await expect(
      f.service.runStep(f.feature.id, f.step.id, '', false, f.launch, preview.fingerprint),
    ).rejects.toThrow();
    expect(f.adapter.run).not.toHaveBeenCalled();
    expect(f.inputs).toEqual([]);
  });
});

it('pauses on a navigation request without spending the remaining automatic calls', async () => {
  const f = await fixture();
  let calls = 0;
  f.adapter.run = async (_input, callbacks) => {
    calls++;
    callbacks.onSession('nav-session-' + calls);
    await callbacks.onNavigationRequest!({
      reason: 'missing-journey',
      observations: 'A verified journey is needed.',
    });
    return { content: 'Navigation requires input', questions: [], changedFiles: [] };
  };
  await f.service.saveAutopilot(f.feature.id, {
    checkpoints: [],
    maxRuns: 3,
    maxCorrectionCycles: 0,
    stepInputs: { [f.step.id]: f.launch },
  });
  await f.service.startAutopilot(f.feature.id);
  expect(calls).toBe(1);
  expect(f.feature.autopilot).toMatchObject({ status: 'paused', runs: 1 });
  expect(f.feature.autopilot?.reason).toMatch(/Navigation/);
  await f.service.startAutopilot(f.feature.id);
  expect(calls).toBe(1);
  expect(f.feature.autopilot?.decisions?.some((entry) => entry.kind === 'pause')).toBe(true);
});

it.each([false, true])(
  'inherits session navigation unless explicitly omitted (%s)',
  async (omitNavigation) => {
    const f = await fixture();
    f.feature.navigation = f.launch.navigation;
    const launch = {
      initialContext: '',
      mcpServerIds: [],
      memoryIds: [],
      useProjectMemory: false,
      omitNavigation,
    };
    await f.service.saveAutopilot(f.feature.id, {
      checkpoints: [],
      maxRuns: 1,
      maxCorrectionCycles: 0,
      stepInputs: { [f.step.id]: launch },
    });
    const preview = await f.service.previewAutopilot(f.feature.id);
    expect(f.inputs).toHaveLength(0);
    expect(preview.errors).toEqual([]);
    expect(preview.steps[0].notes.some((note) => note.startsWith('Navigation :'))).toBe(
      !omitNavigation,
    );
    await f.service.startAutopilot(f.feature.id);
    expect(f.inputs).toHaveLength(1);
    expect(f.inputs[0].navigation?.selection).toEqual(
      omitNavigation ? undefined : f.feature.navigation,
    );
  },
);
