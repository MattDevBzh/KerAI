import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Tool } from '@github/copilot-sdk';
import { freezeNavigationContext } from '../src/host/NavigationContext';
import { NavigationService } from '../src/host/NavigationService';
import { navigationTools } from '../src/host/NavigationTools';
import type { BrowserSessionManager } from '../src/host/navigation/BrowserSessionManager';
import type {
  ApplicationProfile,
  NavigationJourney,
  NavigationRun,
  NavigationSelection,
  NavigationSnapshot,
} from '../src/shared/navigation';
import type { RunCallbacks, RunInput } from '../src/shared/types';
const now = '2026-10-23T10:00:00.000Z';
const app: ApplicationProfile = {
  id: 'app',
  name: 'Synthetic',
  projectIds: ['project'],
  origin: 'http://localhost:3999',
  allowedOrigins: ['http://localhost:3999'],
  ownerNavigatorId: 'fs-navigator',
  interactionPolicy: 'authorized',
  createdAt: now,
  updatedAt: now,
};
const journey: NavigationJourney = {
  id: 'journey',
  applicationId: 'app',
  revision: 0,
  title: 'Factures',
  intent: 'Afficher les factures',
  tags: [],
  prerequisites: [],
  parameters: [{ name: 'customer', label: 'Client', type: 'string', required: true }],
  steps: [
    { id: 's1', action: 'click', target: { strategy: 'role', value: 'button', name: 'Factures' } },
  ],
  arrival: [{ kind: 'visible', target: { strategy: 'text', value: 'Factures' } }],
  status: 'draft',
  provenance: { mode: 'human' },
  createdAt: now,
  updatedAt: now,
};
const roots = [{ id: 'project', path: '/synthetic' }];
const selection: NavigationSelection = {
  applicationId: 'app',
  journeyId: 'journey',
  revision: 2,
  parameters: { customer: 'demo' },
  intent: 'reproduce',
  allowInteractions: true,
  prerequisitesConfirmed: true,
};
let directory: string;
let service: NavigationService;
let browser: {
  initialize: ReturnType<typeof vi.fn>;
  recoveryRuns: ReturnType<typeof vi.fn>;
  clearRecoveredRuns: ReturnType<typeof vi.fn>;
  acknowledgeRecording: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  act: ReturnType<typeof vi.fn>;
  replay: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};
let callbacks: RunCallbacks;
function input(agentId = 'fs-dev', patch: Partial<NavigationSelection> = {}): RunInput {
  const navigation = freezeNavigationContext(
    service.store.snapshot(),
    { ...selection, ...patch },
    roots,
  );
  // Deliberately minimal host input: tools consume only these fields in this unit boundary.
  return {
    navigation,
    attempt: { id: 'attempt' },
    agent: { id: agentId, tools: ['navigation'] },
    workspacePath: '/synthetic',
    projects: roots,
  } as unknown as RunInput;
}
async function invoke(
  tools: Tool[],
  name: string,
  args: unknown,
): Promise<{ resultType: string; textResultForLlm: string }> {
  const tool = tools.find((item) => item.name === name);
  if (!tool?.handler) throw new Error(`Missing tool ${name}`);
  return (await tool.handler(args, {} as never)) as {
    resultType: string;
    textResultForLlm: string;
  };
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'navigation-integration-'));
  browser = {
    initialize: vi.fn(async () => undefined),
    recoveryRuns: vi.fn(() => []),
    clearRecoveredRuns: vi.fn(async () => undefined),
    acknowledgeRecording: vi.fn(async () => undefined),
    prepare: vi.fn(),
    open: vi.fn(),
    status: vi.fn(() => ({
      id: 'browser',
      applicationId: 'app',
      state: 'idle',
      generation: 1,
      recordedSteps: [],
      recordingPaused: false,
      warnings: [],
    })),
    act: vi.fn(async () => ({ success: true })),
    replay: vi.fn(),
    capture: vi.fn(),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
  service = new NavigationService({
    storageRoot: directory,
    workerPath: '/unused',
    trusted: () => true,
    projects: () => roots,
    browser: browser as unknown as BrowserSessionManager,
  });
  await service.initialize();
  await service.store.saveApplication(app);
  const draft = await service.store.saveDraft(journey, 0, { kind: 'human' });
  const run: NavigationRun = {
    id: 'verified',
    applicationId: 'app',
    journeyId: 'journey',
    revision: 1,
    definitionHash: draft.hash!,
    mode: 'verify',
    status: 'succeeded',
    startedAt: now,
    finishedAt: now,
    arrivalVerified: true,
    prerequisitesConfirmed: true,
    binding: {
      applicationId: 'app',
      origin: app.origin,
      projectIds: ['project'],
      roots: ['/synthetic'],
      verification: 'unknown',
      reason: 'Synthetic',
    },
    events: [{ stepId: 's1', status: 'succeeded', at: now }],
    evidencePaths: [],
    metrics: { actions: 1, durationMs: 1, outputChars: 1, providerCalls: 0 },
  };
  await service.store.recordRun(run);
  await service.store.commit('journey', 1, 'verified', { kind: 'human' });
  callbacks = {
    onEvent: vi.fn(),
    onSession: vi.fn(),
    onQuestion: vi.fn(async () => 'Refuser'),
    onNavigationCapture: vi.fn(async () => undefined),
  };
});
afterEach(async () => {
  await service.dispose();
  await rm(directory, { recursive: true, force: true });
});
it('replaces the preparation spinner message when executable verification fails', async () => {
  browser.prepare.mockRejectedValue(new Error('Exécutable navigateur configuré introuvable.'));
  await expect(service.handle({ action: 'prepare', applicationId: app.id })).rejects.toThrow(
    'introuvable',
  );
  expect(service.snapshot().preparation).toMatchObject({
    ready: false,
    message: 'Exécutable navigateur configuré introuvable.',
  });
  expect(browser.open).not.toHaveBeenCalled();
});
it('preserves the full executable path and launch failure for the Applications view', async () => {
  const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser.prepare.mockResolvedValue({ ready: true, executablePath });
  browser.open.mockRejectedValue(
    new Error('Le profil de navigateur réservé à KerAI est déjà utilisé.'),
  );
  await expect(service.handle({ action: 'prepare', applicationId: app.id })).rejects.toThrow(
    'déjà utilisé',
  );
  expect(service.snapshot().preparation).toMatchObject({
    ready: false,
    browser: executablePath,
    message: 'Le profil de navigateur réservé à KerAI est déjà utilisé.',
  });
});
describe('frozen navigation authority', () => {
  it('never publishes an uncorroborated demonstration marker as an automatic journey', async () => {
    const current = service.store.snapshot().journeys[0];
    const draft = await service.store.saveDraft(
      {
        ...current,
        status: 'draft',
        steps: [...current.steps, { id: 'unconfirmed', action: 'manual', note: 'Geste à revoir.' }],
      },
      current.revision,
      { kind: 'human' },
    );
    const run: NavigationRun = {
      ...service.store.snapshot().runs[0],
      id: 'unconfirmed-run',
      revision: draft.revision,
      definitionHash: draft.hash!,
      events: draft.steps.map((step) => ({ stepId: step.id, status: 'succeeded', at: now })),
    };
    await service.store.recordRun(run);
    await expect(
      service.store.commit(draft.id, draft.revision, run.id, { kind: 'human' }),
    ).rejects.toThrow('rejeu hôte');
    expect(service.store.snapshot().journeys[0].status).toBe('draft');
  });
  it('preserves project identities when application and workspace orders differ', () => {
    const state = service.store.snapshot();
    state.applications[0].projectIds = ['second', 'project'];
    const context = freezeNavigationContext(state, selection, [
      ...roots,
      { id: 'second', path: '/second' },
    ]);
    expect(context.binding?.projectIds).toEqual(['second', 'project']);
    expect(context.binding?.roots).toEqual(['/second', '/synthetic']);
  });
  it('changes digest for selected parameters and rights while preserving independent snapshots', () => {
    const first = input().navigation!;
    const second = input('fs-dev', { parameters: { customer: 'another' } }).navigation!;
    const third = input('fs-dev', { allowInteractions: false }).navigation!;
    expect(first.digest).not.toBe(second.digest);
    expect(first.digest).not.toBe(third.digest);
    first.application.name = 'mutated';
    expect(service.store.snapshot().applications[0].name).toBe('Synthetic');
  });
  it('refuses a changed frozen context under the same active attempt', () => {
    const first = input().navigation!,
      changed = input('fs-dev', { parameters: { customer: 'other' } }).navigation!;
    service.beginAgent('attempt', first);
    expect(() => service.beginAgent('attempt', changed)).toThrow(/contexte|tentative/i);
    expect(service.assertAgent('attempt').digest).toBe(first.digest);
  });
  it('refuses unknown parameters and sensitive values before prompt creation', () => {
    expect(() =>
      input('fs-dev', { parameters: { customer: 'demo', password: 'NEVER_TO_PROMPT' } }),
    ).toThrow(/paramètre|inconnu/i);
    const state = service.store.snapshot();
    state.journeys[0].parameters[0].sensitive = true;
    expect(() =>
      freezeNavigationContext(state, { ...selection, parameters: { customer: 'SECRET' } }, roots),
    ).toThrow(/sensibles/);
    expect(() => freezeNavigationContext(state, selection, [])).toThrow('dépôt');
  });
  it('denies changed profile authority and stale browser leases', async () => {
    service.beginAgent('attempt', input().navigation!);
    await service.store.saveApplication({ ...app, interactionPolicy: 'inspect' });
    expect(() => service.assertAgent('attempt')).toThrow('changé');
    service.endAgent('attempt');
    expect(() => service.assertAgent('attempt')).toThrow('repris');
  });
});
describe('host tool permissions', () => {
  it('allows the same action after a successful fresh inspection, while retaining loop protection', async () => {
    const tools = navigationTools(service, input(), callbacks, new AbortController().signal);
    const step = { id: 'next', action: 'click', target: { strategy: 'css', value: '#next' } };
    vi.spyOn(service, 'inspect').mockResolvedValue({
      url: app.origin,
      title: 'Page suivante',
      observedAt: now,
      text: 'Page suivante',
      elements: [],
      resources: [],
      truncated: false,
    });
    expect((await invoke(tools, 'studio_browser_act', step)).resultType).toBe('success');
    expect((await invoke(tools, 'studio_browser_act', step)).resultType).toBe('success');
    expect((await invoke(tools, 'studio_browser_act', step)).resultType).toBe('failure');
    expect((await invoke(tools, 'studio_browser_inspect', {})).resultType).toBe('success');
    expect((await invoke(tools, 'studio_browser_act', step)).resultType).toBe('success');
    expect(browser.act).toHaveBeenCalledTimes(3);
  });
  it('keeps repetition protection across changing action IDs and failed inspections', async () => {
    const tools = navigationTools(service, input(), callbacks, new AbortController().signal);
    const step = { action: 'click', target: { strategy: 'css', value: '#next' } };
    for (const id of ['first', 'second'])
      expect((await invoke(tools, 'studio_browser_act', { ...step, id })).resultType).toBe(
        'success',
      );
    vi.spyOn(service, 'inspect').mockRejectedValue(new Error('Page indisponible'));
    expect((await invoke(tools, 'studio_browser_inspect', {})).resultType).toBe('failure');
    const blocked = await invoke(tools, 'studio_browser_act', {
      ...step,
      id: 'third',
      note: 'Suite',
    });
    expect(blocked.resultType).toBe('failure');
    expect(blocked.textResultForLlm).toContain('répétée');
    expect(browser.act).toHaveBeenCalledTimes(2);
  });
  it('retains the total exploration budget after fresh inspections', async () => {
    const tools = navigationTools(service, input(), callbacks, new AbortController().signal);
    vi.spyOn(service, 'inspect').mockResolvedValue({
      url: app.origin,
      title: 'Page suivante',
      observedAt: now,
      text: 'Page suivante',
      elements: [],
      resources: [],
      truncated: false,
    });
    const step = { id: 'next', action: 'click', target: { strategy: 'css', value: '#next' } };
    for (let index = 0; index < 30; index++) {
      expect((await invoke(tools, 'studio_browser_inspect', {})).resultType).toBe('success');
      expect((await invoke(tools, 'studio_browser_act', step)).resultType).toBe('success');
    }
    const blocked = await invoke(tools, 'studio_browser_act', step);
    expect(blocked.resultType).toBe('failure');
    expect(blocked.textResultForLlm).toContain('30 opérations');
    expect(browser.act).toHaveBeenCalledTimes(30);
  });
  it('stops an in-flight browser action on SDK tool cancellation and removes its listener', async () => {
    let finish: () => void = () => {};
    browser.act.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ success: true });
        }),
    );
    const tools = navigationTools(service, input(), callbacks, new AbortController().signal);
    const invocation = new AbortController();
    const tool = tools.find((tool) => tool.name === 'studio_browser_act')!;
    const result = tool.handler!(
      { id: 'pending', action: 'click', target: { strategy: 'css', value: '#go' } },
      { signal: invocation.signal } as never,
    );
    await vi.waitFor(() => expect(browser.act).toHaveBeenCalledOnce());
    invocation.abort(new Error('Tool cancelled'));
    const cancelled = (await result) as { resultType: string };
    expect(cancelled.resultType).toBe('failure');
    expect(browser.stop).toHaveBeenCalledOnce();
    finish();
    const completed = new AbortController();
    browser.act.mockResolvedValue({ success: true });
    await tool.handler!(
      { id: 'next', action: 'click', target: { strategy: 'css', value: '#different' } },
      { signal: completed.signal } as never,
    );
    completed.abort();
    expect(browser.stop).toHaveBeenCalledOnce();
  });
  it('never starts a browser action after cancellation during human confirmation', async () => {
    await service.store.saveApplication({ ...app, interactionPolicy: 'confirm' });
    let answer: (value: string) => void = () => {};
    callbacks.onQuestion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    const tools = navigationTools(service, input(), callbacks, new AbortController().signal);
    const invocation = new AbortController();
    const result = tools.find((tool) => tool.name === 'studio_browser_act')!.handler!(
      { id: 'ask', action: 'click', target: { strategy: 'css', value: '#go' } },
      { signal: invocation.signal } as never,
    );
    await vi.waitFor(() => expect(callbacks.onQuestion).toHaveBeenCalledOnce());
    invocation.abort();
    expect(((await result) as { resultType: string }).resultType).toBe('failure');
    answer('Autoriser');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.act).not.toHaveBeenCalled();
    expect(browser.stop).toHaveBeenCalledOnce();
  });
  it('suspends further tools after a missing-context request without replacing the frozen revision', async () => {
    let blocked = false;
    callbacks.navigationBlocked = () => blocked;
    callbacks.onNavigationRequest = vi.fn(async () => {
      blocked = true;
    });
    const run = input();
    const tools = navigationTools(service, run, callbacks, new AbortController().signal);
    const requested = await invoke(tools, 'studio_navigation_request', {
      reason: 'Écran introuvable',
      observations: 'La cible Factures est absente.',
    });
    expect(requested.resultType).toBe('success');
    expect(requested.textResultForLlm).toContain('context-required');
    expect(callbacks.onNavigationRequest).toHaveBeenCalledOnce();
    const retry = await invoke(tools, 'studio_navigation_search', { query: 'Factures' });
    expect(retry.resultType).toBe('failure');
    expect(retry.textResultForLlm).toContain('compléter');
    expect(service.assertAgent('attempt').digest).toBe(run.navigation!.digest);
    expect(browser.act).not.toHaveBeenCalled();
  });

  it('offers editorial tools exclusively to the designated Navigator', () => {
    const consumer = navigationTools(service, input(), callbacks, new AbortController().signal);
    expect(consumer.map((tool) => tool.name)).not.toContain('studio_navigation_propose');
    expect(consumer.map((tool) => tool.name)).not.toContain('studio_navigation_commit');
    expect(() => service.actor('attempt', 'fs-dev')).toThrow('Navigateur');
    const owner = navigationTools(
      service,
      input('fs-navigator'),
      callbacks,
      new AbortController().signal,
    );
    expect(owner.map((tool) => tool.name)).toContain('studio_navigation_commit');
    expect(owner.map((tool) => tool.name)).not.toContain('evaluate');
  });
  it('does not offer navigation to discussions, observers or profiles without capability', () => {
    for (const patch of [
      { mode: 'discussion' },
      { observation: true },
      { agent: { id: 'fs-dev', tools: [] } },
    ]) {
      expect(
        navigationTools(
          service,
          { ...input(), ...patch } as RunInput,
          callbacks,
          new AbortController().signal,
        ),
      ).toEqual([]);
    }
  });
  it('denies action despite a read effect label when frozen interactions are forbidden', async () => {
    const tools = navigationTools(
      service,
      input('fs-dev', { allowInteractions: false }),
      callbacks,
      new AbortController().signal,
    );
    const result = await invoke(tools, 'studio_browser_act', {
      id: 'click',
      action: 'click',
      target: { strategy: 'css', value: '#delete' },
      effect: 'read',
    });
    expect(result.resultType).toBe('failure');
    expect(result.textResultForLlm).toContain('non autorisées');
    expect(browser.act).not.toHaveBeenCalled();
  });
  it('applies explicit host confirmation before effectful browser actions', async () => {
    await service.store.saveApplication({ ...app, interactionPolicy: 'confirm' });
    const tools = navigationTools(service, input(), callbacks, new AbortController().signal);
    const result = await invoke(tools, 'studio_browser_act', {
      id: 'click',
      action: 'click',
      target: { strategy: 'css', value: '#delete' },
      effect: 'read',
    });
    expect(result.resultType).toBe('failure');
    expect(callbacks.onQuestion).toHaveBeenCalledOnce();
    expect(browser.act).not.toHaveBeenCalled();
  });
  it('denies replay of any revision other than the consumer frozen selection', async () => {
    const tools = navigationTools(service, input(), callbacks, new AbortController().signal);
    const result = await invoke(tools, 'studio_navigation_replay', { id: 'journey', revision: 1 });
    expect(result.resultType).toBe('failure');
    expect(result.textResultForLlm).toContain('figée');
    expect(browser.replay).not.toHaveBeenCalled();
  });
  it('refuses extra identity fields and interrupted tool commands', async () => {
    const controller = new AbortController();
    const tools = navigationTools(service, input('fs-navigator'), callbacks, controller.signal);
    const spoof = await invoke(tools, 'studio_navigation_commit', {
      journeyId: 'journey',
      expectedRevision: 2,
      runId: 'verified',
      agentId: 'fs-navigator',
    });
    expect(spoof.resultType).toBe('failure');
    controller.abort();
    const cancelled = await invoke(tools, 'studio_navigation_search', { query: 'Factures' });
    expect(cancelled.resultType).toBe('failure');
  });
  it('returns real verified capture metadata without pixels in the model result', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9h8AAAAASUVORK5CYII=',
      'base64',
    );
    const file = path.join(directory, 'browser', 'objects', 'image.png');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, png);
    browser.capture.mockResolvedValue({
      browser: 'Chromium fixture',
      path: file,
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      url: app.origin,
      createdAt: now,
      viewport: { width: 1, height: 1 },
    });
    const tools = navigationTools(service, input(), callbacks, new AbortController().signal);
    const result = await invoke(tools, 'studio_browser_capture', {});
    expect(result.resultType).toBe('success');
    expect(result.textResultForLlm).not.toContain('data:image');
    const receipt = JSON.parse(result.textResultForLlm);
    expect(receipt).toMatchObject({
      applicationId: 'app',
      journeyId: 'journey',
      revision: 2,
      attemptId: 'attempt',
      bytes: png.length,
    });
    expect(callbacks.onNavigationCapture).toHaveBeenCalledOnce();
    expect(service.snapshot().captures?.[0].previewUrl).toContain('data:image/png');
    const unavailable = await invoke(tools, 'studio_browser_view_capture', {
      captureId: receipt.id,
    });
    expect(unavailable.resultType).toBe('failure');
    callbacks.validateModelImages = vi.fn(() => {
      throw Error('Modèle sans vision');
    });
    expect(
      (await invoke(tools, 'studio_browser_view_capture', { captureId: receipt.id }))
        .textResultForLlm,
    ).toContain('sans vision');
    callbacks.validateModelImages = vi.fn();
    expect(
      (await invoke(tools, 'studio_browser_view_capture', { captureId: 'other-attempt' }))
        .resultType,
    ).toBe('failure');
    for (let i = 0; i < 4; i++) {
      const viewed = (await invoke(tools, 'studio_browser_view_capture', {
        captureId: receipt.id,
      })) as unknown as {
        resultType: string;
        textResultForLlm: string;
        binaryResultsForLlm: { data: string }[];
      };
      expect(viewed.resultType).toBe('success');
      expect(viewed.binaryResultsForLlm[0].data).toBe(png.toString('base64'));
      expect(viewed.textResultForLlm).not.toContain(png.toString('base64'));
    }
    expect(
      (await invoke(tools, 'studio_browser_view_capture', { captureId: receipt.id }))
        .textResultForLlm,
    ).toContain('Budget');
    expect(callbacks.validateModelImages).toHaveBeenCalledTimes(4);
    expect(await readFile(path.join(directory, 'captures.json'), 'utf8')).not.toContain(
      'previewUrl',
    );
    const reopened = new NavigationService({
      storageRoot: directory,
      workerPath: '/unused',
      trusted: () => true,
      projects: () => roots,
      browser: browser as unknown as BrowserSessionManager,
    });
    await reopened.initialize();
    expect(reopened.snapshot().captures?.[0]).toMatchObject({
      browser: 'Chromium fixture',
      sha256: receipt.sha256,
    });
    await reopened.dispose();
    await writeFile(file, Buffer.alloc(png.length));
    const tampered = await invoke(tools, 'studio_browser_capture', {});
    expect(tampered.resultType).toBe('failure');
    expect(callbacks.onNavigationCapture).toHaveBeenCalledOnce();
    expect(service.snapshot().captures).toHaveLength(1);
  });
});

it('prepares a correction with a published recipe while a newer draft stays editable', async () => {
  const published = service.snapshot().journeys[0];
  await service.store.saveDraft(
    { ...published, title: 'En cours de réparation' },
    published.revision,
    { kind: 'human' },
  );
  const result = await service.handle({
    action: 'createBug',
    applicationId: app.id,
    journeyId: journey.id,
    revision: 2,
    parameters: { customer: 'client-42' },
    title: 'Montant erroné',
    observed: 'Le montant est vide',
    expected: 'Le montant est présent',
    currentScreen: false,
  });
  expect(result.bug?.selection).toMatchObject({
    revision: 2,
    parameters: { customer: 'client-42' },
    allowInteractions: false,
  });
  expect(result.bug?.description).toContain('Factures r2');
  expect(browser.act).not.toHaveBeenCalled();
  await expect(
    service.handle({
      action: 'createBug',
      applicationId: app.id,
      journeyId: journey.id,
      revision: 2,
      parameters: { password: 'forbidden' },
      title: 'Bug',
      observed: 'Vu',
      expected: 'Attendu',
      currentScreen: false,
    }),
  ).rejects.toThrow('sensible');
});

it('verifies the served resource against the chosen worktree and detects mismatch', async () => {
  const project = path.join(directory, 'source');
  await mkdir(project);
  await writeFile(path.join(project, 'build.js'), 'build 1');
  const hash = createHash('sha256').update('build 1').digest('hex');
  const assetDigest = vi.fn(async () => ({ sha256: hash, bytes: 7 }));
  Object.assign(browser, { assetDigest });
  await service.store.saveApplication({
    ...app,
    environment: {
      projectId: 'project',
      artifactPath: 'build.js',
      resourceUrl: `${app.origin}/build.js`,
      startTask: 'Démarrer',
      buildTask: 'Construire',
    },
  });
  const binding = await service.checkEnvironment(app.id, [{ id: 'project', path: project }]);
  expect(binding).toMatchObject({ roots: [project], worktree: project, verification: 'verified' });
  expect(binding.reason).toContain('ne couvre que cette ressource');
  expect(assetDigest).toHaveBeenCalledWith(`${app.origin}/build.js`);
  await writeFile(path.join(project, 'build.js'), 'build 2');
  expect(await service.checkEnvironment(app.id, [{ id: 'project', path: project }])).toMatchObject({
    verification: 'unknown',
    reason: expect.stringContaining('diffère'),
  });
  expect(
    await service.handle({ action: 'environmentTask', applicationId: app.id, task: 'start' }),
  ).toEqual({ task: { projectId: 'project', name: 'Démarrer' } });
});

it('requires every composed block step before publication and exports an independent recipe', async () => {
  const parent = await service.store.saveDraft(
    {
      ...journey,
      id: 'composed',
      parameters: [],
      steps: [],
      blocks: [{ journeyId: 'journey', revision: 2 }],
    },
    0,
    { kind: 'human' },
  );
  const verified = {
    ...service.snapshot().runs[0],
    id: 'incomplete',
    journeyId: parent.id,
    revision: parent.revision,
    definitionHash: parent.hash!,
    events: [],
  };
  await service.store.recordRun(verified);
  await expect(
    service.store.commit(parent.id, parent.revision, verified.id, { kind: 'human' }),
  ).rejects.toThrow('rejeu hôte');
  await service.store.recordRun({
    ...verified,
    id: 'complete',
    events: [
      { stepId: 'b0-s1', status: 'succeeded', at: now },
      { stepId: 'b0-arrival', status: 'succeeded', at: now },
    ],
  });
  await service.store.commit(parent.id, parent.revision, 'complete', { kind: 'human' });
  const exported = await service.handle({ action: 'export', journeyId: parent.id });
  const portable = JSON.parse(exported.exportText!);
  expect(portable.journey.blocks).toBeUndefined();
  expect(portable.journey.steps.map((s: { id: string }) => s.id)).toEqual(['b0-s1', 'b0-arrival']);
  expect(portable.journey.parameters[0].name).toBe('customer');
});

it('keeps a verified initial screen capture available to later agents of the correction', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9h8AAAAASUVORK5CYII=',
    'base64',
  );
  const file = path.join(directory, 'browser', 'objects', 'initial.png');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, png);
  browser.capture.mockResolvedValue({
    browser: 'Chromium fixture',
    path: file,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
    url: app.origin,
    createdAt: now,
    viewport: { width: 1, height: 1 },
  });
  const result = await service.handle({
    action: 'createBug',
    applicationId: app.id,
    parameters: {},
    currentScreen: true,
    title: 'Bug',
    observed: 'Vide',
    expected: 'Rempli',
  });
  expect(result.bug?.capture?.sha256).toBeTruthy();
  expect(result.bug?.capture?.previewUrl).toBeUndefined();
  expect(result.bug?.description).toContain(result.bug!.capture!.id);
  const request = input();
  request.feature = { navigationInitialCapture: result.bug!.capture } as RunInput['feature'];
  callbacks.validateModelImages = vi.fn();
  const tools = navigationTools(service, request, callbacks, new AbortController().signal);
  expect(
    (await invoke(tools, 'studio_browser_view_capture', { captureId: result.bug!.capture!.id }))
      .resultType,
  ).toBe('success');
  expect(callbacks.validateModelImages).toHaveBeenCalledOnce();
});

it('does not silently replace the selected published revision when creating a bug', async () => {
  await expect(
    service.handle({
      action: 'createBug',
      applicationId: app.id,
      journeyId: journey.id,
      revision: 1,
      parameters: { customer: 'client-42' },
      title: 'Bug',
      observed: 'Vide',
      expected: 'Montant',
      currentScreen: false,
    }),
  ).rejects.toThrow('révision');
});

it('does not label a requested case as observed before a successful replay', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9h8AAAAASUVORK5CYII=',
    'base64',
  );
  const file = path.join(directory, 'browser', 'objects', 'case.png');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, png);
  browser.capture.mockResolvedValue({
    browser: 'Fixture',
    path: file,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
    url: app.origin,
    createdAt: now,
    viewport: { width: 1, height: 1 },
  });
  const context = input().navigation!;
  const capture = await service.capture(context, 'attempt');
  expect(capture.journeyId).toBe(journey.id);
  expect(capture.caseKey).toBeUndefined();

  const published = service.store.snapshot().journeys[0];
  browser.replay.mockResolvedValue({
    ...service.store.snapshot().runs[0],
    id: 'case-replay',
    revision: published.revision,
    definitionHash: published.hash!,
    mode: 'reproduce',
    resolvedParameters: { customer: 'demo' },
  });
  const replay = () =>
    service.replay(
      published,
      { customer: 'demo' },
      {
        binding: context.binding,
        prerequisitesConfirmed: true,
      },
    );
  await replay();
  const observed = await service.capture(context, 'attempt');
  expect(observed.caseKey).toBeTruthy();
  const other = input('fs-dev', { parameters: { customer: 'other' } }).navigation!;
  expect((await service.capture(other)).caseKey).toBeUndefined();

  browser.capture.mockResolvedValue({ ...capture, url: `${app.origin}/other` });
  expect((await service.capture(context)).caseKey).not.toBe(observed.caseKey);
  await service.act(
    { id: 'move', action: 'click', target: { strategy: 'css', value: '#move' } },
    {},
  );
  expect((await service.capture(context)).caseKey).toBeUndefined();

  await replay();
  browser.replay.mockRejectedValueOnce(new Error('Rejeu indisponible'));
  await expect(replay()).rejects.toThrow('Rejeu indisponible');
  expect((await service.capture(context)).caseKey).toBeUndefined();

  await replay();
  Object.assign(browser, { startRecording: vi.fn(async () => undefined) });
  await service.handle({ action: 'recordStart', applicationId: app.id });
  expect((await service.capture(context)).caseKey).toBeUndefined();
});
