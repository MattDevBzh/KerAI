import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/host/StudioService';
import { Store } from '../src/core/store';
import { markDeletion, pendingDeletions } from '../src/host/SessionCleanup';
import { runProcess } from '../src/host/process';
import { emptyLaunch } from '../src/core/context';
import {
  newSubplanStep,
  allFeatures,
  currentIteration,
  subplanComplete,
  subplanIssues,
} from '../src/shared/subplans';
import { agentStep, insertTeam, teamSteps } from '../src/shared/team';
import { featureStateKey } from '../src/shared/collaboration';
import { approvalBlockers } from '../src/core/validation';
import { budgetBlockReason, executionCallCount } from '../src/core/budgets';
import { assertSubplanExecution, validateSubplanProposal } from '../src/core/subplans';
import type { PairAction } from '../src/shared/pair';
import type { Feature } from '../src/shared/types';

vi.setConfig({ testTimeout: 60_000 });
const roots: string[] = [],
  services: StudioService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()));
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const task = (id: string, corrects?: string) => ({
  id,
  title: `Tâche ${id}`,
  description: `Réaliser et vérifier ${id}`,
  ...(corrects ? { corrects } : {}),
});
function proposal(blocks = [task('one'), task('two')]) {
  return (
    'Découpage proposé.\n```feature-studio-pair-plan\n' +
    JSON.stringify({ summary: 'Construire puis vérifier chaque tâche.', blocks }) +
    '\n```'
  );
}
async function fixture(mode: 'pair' | 'automatic' = 'pair', nested = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-subplans-')));
  roots.push(root);
  const repo = join(root, 'repo');
  await mkdir(repo);
  await runProcess('git', ['init', '-b', 'fixture'], repo);
  const store = new Store(join(root, 'state')),
    service = new StudioService(repo, resolve('defaults'), store, () => true);
  services.push(service);
  await service.initialize();
  const feature = await service.createFeature({
    title: 'Feature racine',
    description: 'Objectif commun',
    workflowId: 'single',
  });
  feature.budget!.maxRuns = 100;
  const dev = agentStep(service.state.agents.find((a) => a.id === 'fs-dev')!),
    tests = agentStep(service.state.agents.find((a) => a.id === 'fs-tests')!);
  tests.dependsOn = [dev.id];
  const card = newSubplanStep();
  card.subplan = { mode, teamName: 'Dev puis tests', steps: [dev, tests] };
  if (nested) {
    const nestedCard = newSubplanStep();
    nestedCard.subplan = { mode: 'pair', teamName: 'Imbriquée', steps: card.subplan.steps };
    card.subplan.steps = [nestedCard];
  }
  await service.saveFeatureTeam(feature.id, 0, [card]);
  const inputs: import('../src/shared/types').RunInput[] = [];
  let blocks = [task('one'), task('two')];
  let gate: Promise<void> | undefined;
  service.adapter = {
    check: async () => ({ state: 'ready', authenticated: true, models: [] }),
    dispose: async () => {},
    run: async (input, callbacks) => {
      inputs.push(structuredClone(input));
      callbacks.onSession(randomUUID());
      callbacks.onPromptSent?.();
      if (gate) await gate;
      return {
        content: input.step.subplan ? proposal(blocks) : `# Livrable ${input.step.name}`,
        questions: [],
        changedFiles: [],
        usage: { source: 'measured', inputTokens: 5, outputTokens: 5, cost: 1, unit: 'nano-AIU' },
      };
    },
  };
  await service.checkRuntime();
  const step = feature.steps[0];
  const idle = () =>
    vi.waitFor(
      () => {
        expect(service.state.workspaceOperation).toBeUndefined();
        expect(
          allFeatures(service.engine.features).some(
            (f) =>
              f.autopilot?.status === 'running' ||
              f.steps.some((s) => s.attempts.at(-1)?.pair?.busy),
          ),
        ).toBe(false);
      },
      { timeout: 30000 },
    );
  const act = async (action: PairAction['action'], content?: string, f = feature, s = step) => {
    const a = s.attempts.at(-1)!;
    await service.pairAction({
      type: 'pairAction',
      featureId: f.id,
      stepId: s.id,
      attemptId: a.id,
      requestId: randomUUID(),
      expectedVersion: a.pair!.version,
      action,
      content,
    });
    await idle();
  };
  const start = async () => {
    const p = await service.previewRun(feature.id, step.id, '', false, emptyLaunch());
    await service.runStep(feature.id, step.id, '', false, emptyLaunch(), p.fingerprint);
    await idle();
  };
  const finish = async (child: Feature) => {
    for (const s of child.steps) {
      await idle();
      const a = s.attempts.at(-1)!;
      expect(a).toBeDefined();
      expect(s.status).toBe('awaiting_review');
      await service.approveStep(child.id, s.id, a.id, a.revision ?? 0);
    }
    await idle();
    expect(child.status).toBe('awaiting_final_validation');
    await service.finalizeFeature(child.id, featureStateKey(child));
    await idle();
  };
  return {
    service,
    store,
    feature,
    step,
    inputs,
    act,
    start,
    idle,
    finish,
    setTasks: (b: ReturnType<typeof task>[]) => {
      blocks = b;
    },
    hold: (p?: Promise<void>) => {
      gate = p;
    },
  };
}
it('runs whole child teams sequentially, with human code approval before tests and durable independent histories', async () => {
  const f = await fixture();
  await f.start();
  expect(f.inputs).toHaveLength(1);
  expect(f.inputs[0].nativeReadOnly).toBe(true);
  expect(f.inputs[0].preparedPrompt).toContain('CARTE SOUS-PLAN');
  expect(f.step.subplanState).toBeUndefined();
  await f.act('approve-plan');
  const [one, two] = f.step.subplanState!.iterations;
  expect(one.feature.steps[0].status).toBe('awaiting_review');
  expect(one.feature.steps[1].attempts).toHaveLength(0);
  await f.service.saveAutopilot(one.feature.id, {
    checkpoints: [],
    maxRuns: 100,
    maxCorrectionCycles: 0,
    stepInputs: {},
  });
  expect(one.feature.autopilot!.checkpoints).toEqual(one.feature.steps.map((s) => s.id));
  expect(approvalBlockers(one.feature, one.feature.steps[0], 'autopilot')).toContain(
    'Chaque étape de la sous-équipe nécessite une validation humaine.',
  );
  expect(two.feature.steps.every((s) => !s.attempts.length)).toBe(true);
  expect(() => assertSubplanExecution(f.service.engine.features, two.feature)).toThrow(
    /historique|attente/,
  );
  expect(approvalBlockers(f.feature, f.step, 'human').length).toBeGreaterThan(0);
  await f.finish(one.feature);
  expect(two.feature.steps[0].status).toBe('awaiting_review');
  await f.finish(two.feature);
  expect(subplanComplete(f.step)).toBe(true);
  expect(f.step.status).toBe('awaiting_review');
  expect(f.step.attempts[0].artifact!.content).toContain('Itération 2');
  expect(f.feature.status).not.toBe('completed');
  const reopened = await f.store.load();
  expect(allFeatures(reopened.features)).toHaveLength(3);
  expect(reopened.features[0].steps[0].subplanState).toEqual(f.step.subplanState);
  const a = f.step.attempts.at(-1)!;
  await f.service.approveStep(f.feature.id, f.step.id, a.id, a.revision ?? 0);
  await f.service.finalizeFeature(f.feature.id, featureStateKey(f.feature));
  expect(f.feature.status).toBe('completed');
  expect(executionCallCount(f.feature)).toBe(5);
});
it('accepts automatic decomposition without a chat approval but keeps the code checkpoint', async () => {
  const f = await fixture('automatic');
  await f.start();
  expect(f.step.attempts[0].pair!.approvedRevision).toBe(1);
  const child = currentIteration(f.step)!.feature;
  expect(child.steps[0].status).toBe('awaiting_review');
  expect(child.steps[1].attempts).toHaveLength(0);
  expect(f.inputs.filter((i) => i.step.subplan).every((i) => i.nativeReadOnly)).toBe(true);
});
it('allows recursive orchestration and counts nested provider calls against the root budget', async () => {
  const f = await fixture('pair', true);
  f.setTasks([task('only')]);
  await f.start();
  await f.act('approve-plan');
  const child = currentIteration(f.step)!.feature,
    card = child.steps[0];
  expect(card.attempts[0].pair!.phase).toBe('planning');
  await f.act('approve-plan', undefined, child, card);
  const grandchild = currentIteration(card)!.feature;
  expect(allFeatures(f.service.engine.features)).toHaveLength(3);
  expect(grandchild.parent!.featureId).toBe(child.id);
  f.feature.budget!.maxRuns = executionCallCount(f.feature);
  expect(budgetBlockReason(f.feature)).toContain('maximal');
  await expect(f.service.previewRun(grandchild.id, grandchild.steps[0].id)).resolves.toMatchObject({
    errors: expect.arrayContaining([expect.stringContaining('maximal')]),
  });
});
it('adds corrective iterations without rewriting approved results and requires subsequent rechecks', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  const [one, two] = f.step.subplanState!.iterations;
  await f.finish(one.feature);
  await f.finish(two.feature);
  const history = structuredClone(one.feature);
  f.setTasks([task('fix-one', one.id), task('recheck-two', two.id)]);
  await f.act('message', 'Corrige la première tâche et revérifie la suivante.');
  expect(f.step.attempts[0].pair!.phase).toBe('planning');
  await f.act('approve-plan');
  expect(one.requiresRecheck).toBe(true);
  expect(two.requiresRecheck).toBe(true);
  expect(one.feature).toEqual(history);
  const fix = f.step.subplanState!.iterations[2],
    recheck = f.step.subplanState!.iterations[3];
  await f.finish(fix.feature);
  expect(one.requiresRecheck).toBe(false);
  expect(two.requiresRecheck).toBe(true);
  await f.finish(recheck.feature);
  expect(subplanComplete(f.step)).toBe(true);
  expect(one.feature).toEqual(history);
  await expect(
    f.service.requestCorrection(one.feature.id, {
      expectedStateKey: featureStateKey(one.feature),
      sourceStepId: one.feature.steps[1].id,
      rootStepIds: [one.feature.steps[0].id],
      feedback: 'Ne réécris pas',
      findingIds: [],
      commentIds: [],
    }),
  ).rejects.toThrow(/historique/);
});
it('rejects invalid subplans before running and preserves executed teams when inserting a member', async () => {
  const f = await fixture();
  const saved = teamSteps(f.feature);
  saved[0].subplan!.steps = [];
  await f.service.saveFeatureTeam(f.feature.id, 1, saved);
  expect(subplanIssues(f.feature.steps)).toHaveLength(1);
  await expect(f.start()).rejects.toThrow(/sous-équipe/);
  expect(f.inputs).toHaveLength(0);
  await f.service.saveFeatureTeam(f.feature.id, 2, [
    {
      ...saved[0],
      subplan: {
        mode: 'pair',
        teamName: 'Simple',
        steps: [agentStep(f.service.state.agents.find((a) => a.id === 'fs-dev')!)],
      },
    },
  ]);
  await f.start();
  await f.act('approve-plan');
  const child = currentIteration(f.step)!.feature,
    old = child.steps[0],
    history = structuredClone(old.attempts);
  const added = agentStep(f.service.state.agents.find((a) => a.id === 'fs-plan')!);
  await f.service.saveFeatureTeam(child.id, 0, insertTeam(teamSteps(child), [added], 0));
  expect(child.steps[0].awaitsCorrection).toBe(true);
  expect(child.steps[1].attempts).toEqual(history);
  expect(child.teamHistory).toHaveLength(1);
  await expect(f.service.runStep(child.id, added.id)).rejects.toThrow(/correction/);
});
it('queues edits while an agent is running, then applies them without removing its attempt', async () => {
  const f = await fixture('automatic');
  let release!: () => void;
  f.hold(
    new Promise<void>((r) => {
      release = r;
    }),
  );
  const running = f.start();
  await vi.waitFor(() => expect(f.inputs).toHaveLength(1), { timeout: 30000 });
  const added = agentStep(f.service.state.agents.find((a) => a.id === 'fs-plan')!);
  await f.service.saveFeatureTeam(f.feature.id, 1, insertTeam(teamSteps(f.feature), [added], 1));
  expect(f.feature.pendingTeam).toBeDefined();
  f.hold();
  release();
  await running;
  expect(f.feature.pendingTeam).toBeUndefined();
  expect(f.feature.steps).toHaveLength(2);
  expect(f.step.attempts).toHaveLength(1);
});
it('rejects rewriting an already started task in a new proposal', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  const pair = f.step.attempts[0].pair!;
  pair.plans.push({
    revision: 2,
    summary: 'Changer',
    blocks: [{ ...task('one'), description: 'Autre mission' }],
  });
  expect(() => validateSubplanProposal(f.step)).toThrow(/déjà démarré/);
});
it('updates future templates without changing an already started iteration', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  const first = currentIteration(f.step)!,
    started = structuredClone(first.feature.steps);
  const configured = teamSteps(f.feature),
    extra = agentStep(f.service.state.agents.find((a) => a.id === 'fs-review')!);
  configured[0].subplan!.steps = insertTeam(configured[0].subplan!.steps, [extra], 2);
  await f.service.saveFeatureTeam(f.feature.id, 1, configured);
  expect(first.feature.steps).toEqual(started);
  await f.finish(first.feature);
  const second = currentIteration(f.step)!;
  expect(second.feature.steps).toHaveLength(3);
  expect(second.feature.steps[2].agentId).toBe('fs-review');
  expect(f.inputs.at(-1)!.launch!.initialContext).toContain(
    'Résultats validés des tâches précédentes',
  );
});
it('replans unstarted tasks while preserving their IDs and their human checkpoints', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  const second = f.step.subplanState!.iterations[1],
    ids = second.feature.steps.map((s) => s.id);
  f.setTasks([task('one'), { ...task('two'), title: 'Deuxième tâche précisée' }]);
  await f.act('message', 'Précise la seconde tâche.');
  await f.act('approve-plan');
  expect(second.title).toBe('Deuxième tâche précisée');
  expect(second.feature.steps.map((s) => s.id)).toEqual(ids);
  expect(second.feature.autopilot!.checkpoints).toEqual(ids);
  await expect(f.store.load()).resolves.toBeDefined();
});
it('reopens interrupted nested work without launching and applies an already queued composition', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  const child = currentIteration(f.step)!.feature,
    step = child.steps[0],
    attempt = step.attempts[0];
  step.status = attempt.status = 'running';
  attempt.pair!.busy = true;
  attempt.pair!.phase = 'working';
  child.status = 'running';
  child.autopilot!.status = 'running';
  child.pendingTeam = {
    expectedRevision: 0,
    steps: insertTeam(teamSteps(child), [agentStep(f.service.state.agents[0])], child.steps.length),
  };
  await f.service.persist();
  const calls = f.inputs.length;
  const loaded = await f.store.load(),
    restored = allFeatures(loaded.features)[1];
  expect(restored.steps[0].status).toBe('interrupted');
  expect(restored.steps[0].attempts[0].pair!.busy).toBe(false);
  expect(restored.autopilot!.status).toBe('paused');
  expect(restored.pendingTeam).toBeUndefined();
  expect(restored.steps).toHaveLength(3);
  expect(f.inputs).toHaveLength(calls);
  step.status = attempt.status = 'interrupted';
  attempt.pair!.busy = false;
  child.autopilot!.status = 'paused';
});
it('uses the root worktree for nested execution and retains child checkpoints', async () => {
  const f = await fixture();
  await runProcess(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'Fixture',
    ],
    f.service.workspacePath,
  );
  f.feature.worktree = await f.service.workspaces.createWorktree(f.feature);
  f.feature.branch = f.feature.worktree.branch;
  await f.start();
  await f.act('approve-plan');
  const child = currentIteration(f.step)!.feature;
  expect(await f.service.featurePath(child.id)).toBe(f.feature.worktree.path);
  expect(child.steps[0].attempts[0].checkpointBeforeId).toBeTruthy();
  expect(child.steps[0].attempts[0].checkpointAfterId).toBeTruthy();
});
it('runs a newly inserted earlier member through the existing corrective route', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  const child = currentIteration(f.step)!.feature,
    source = child.steps[0];
  const added = agentStep(f.service.state.agents.find((a) => a.id === 'fs-plan')!);
  await f.service.saveFeatureTeam(child.id, 0, insertTeam(teamSteps(child), [added], 0));
  await f.service.requestCorrection(child.id, {
    expectedStateKey: featureStateKey(child),
    sourceStepId: source.id,
    rootStepIds: [added.id],
    feedback: 'Compléter le plan avant de relire le code.',
    findingIds: [],
    commentIds: [],
  });
  await f.idle();
  expect(child.steps[0].awaitsCorrection).toBeUndefined();
  expect(child.steps[0].status).toBe('awaiting_review');
  expect(source.status).toBe('stale');
  const a = child.steps[0].attempts.at(-1)!;
  await f.service.approveStep(child.id, added.id, a.id, a.revision ?? 0);
  await f.idle();
  expect(source.status).toBe('awaiting_review');
  expect(source.attempts).toHaveLength(2);
  expect(child.steps[2].attempts).toHaveLength(0);
});

it('pauses the whole subplan and resumes the approved queue without replanning', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  const child = currentIteration(f.step)!.feature,
    dev = child.steps[0],
    a = dev.attempts[0];
  await f.act('pause');
  await f.service.approveStep(child.id, dev.id, a.id, a.revision ?? 0);
  await f.idle();
  expect(child.steps[1].attempts).toHaveLength(0);
  expect(f.step.subplanState!.paused).toBe(true);
  await f.act('resume');
  expect(child.steps[1].status).toBe('awaiting_review');
  expect(f.inputs.filter((i) => i.step.subplan)).toHaveLength(1);
});
it('preserves the running iteration ahead of newly inserted tasks in a revised plan', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  f.setTasks([task('new'), task('one'), task('two')]);
  await f.act('message', 'Ajoute une tâche');
  expect(f.step.attempts[0].pair!.error).toMatch(/tâche en cours/);
  expect(() => validateSubplanProposal(f.step)).toThrow(/tâche en cours/);
  expect(f.step.subplanState!.iterations).toHaveLength(2);
});

it('recovers deletion of the whole tree from one durable record and preserves source files', async () => {
  const f = await fixture();
  await f.start();
  await f.act('approve-plan');
  const descendants = allFeatures([f.feature]);
  await markDeletion(f.store.rootPath, f.feature);
  const pending = await pendingDeletions(f.store.rootPath);
  expect(pending.map((p) => p.featureId).sort()).toEqual(descendants.map((c) => c.id).sort());
  expect((await f.store.load()).features).toEqual([]);
  await f.service.recoverSessionDeletions();
  expect(f.service.engine.features).toEqual([]);
  expect(await pendingDeletions(f.store.rootPath)).toEqual([]);
});
