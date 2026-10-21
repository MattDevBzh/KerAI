import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowEngine, validateWorkflow } from '../src/core/workflow';
import { Store, defaultSettings } from '../src/core/store';
import { nextAutopilotAction } from '../src/core/autopilot';
import { featureStateKey, finalValidationReady } from '../src/shared/collaboration';
import { teamSteps, instantiateTeam } from '../src/shared/team';
import { stepResolved, progressLabel } from '../src/shared/optionalSteps';
import { buildPrompt, emptyLaunch } from '../src/core/context';
import { sessionMarkdown } from '../src/shared/sessionExport';
import { parseMessage } from '../src/host/messages';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function fixture() {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'optional-fixture',
      name: 'Équipe',
      description: '',
      icon: 'users',
      steps: ['us', 'plan', 'code', 'docs'].map((id, index, ids) => ({
        id,
        name: id,
        description: '',
        agentId: 'agent',
        policy: 'read-only',
        skills: [],
        maxAttempts: 8,
        artifact: `${id}.md`,
        dependsOn: index ? [ids[index - 1]] : [],
        optional: id === 'plan' || id === 'docs',
      })),
    },
    { title: 'Quotidien', description: 'Une vraie feature' },
  );
  function finish(id: string) {
    const attempt = engine.beginRun(feature.id, id);
    engine.finishRun(feature.id, id, {
      content: `Livrable ${id}`,
      questions: [],
      changedFiles: [],
    });
    engine.approveStep(feature.id, id);
    return attempt;
  }
  const skip = (id: string) =>
    engine.decideOptionalStep(feature.id, id, 'skip', featureStateKey(feature));
  return { engine, feature, finish, skip };
}

describe('optional interventions with human decisions', () => {
  it('preserves template defaults, independent occurrences and clean copies without history', () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    const copied = instantiateTeam(teamSteps(f.feature));
    expect(copied[1].optional).toBe(true);
    expect(copied[1]).not.toHaveProperty('optionalDecision');
    expect(copied[1]).not.toHaveProperty('optionalDecisionHistory');
    expect(() =>
      validateWorkflow({ id: 'copy', name: 'copy', description: '', icon: '', steps: copied }),
    ).not.toThrow();
    copied[0].optional = true;
    expect(f.feature.steps[0].optional).toBe(false);
  });
  it('skips without an attempt or fake artifact and unblocks only ordering', () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    expect(f.feature.steps[1]).toMatchObject({
      status: 'skipped',
      attempts: [],
      optionalDecision: { action: 'skip', author: 'human' },
    });
    expect(stepResolved(f.feature.steps[1])).toBe(true);
    expect(f.feature.activeStepId).toBe('code');
    f.finish('code');
    f.feature.criteria = [
      { id: 'criterion', text: 'Code works', status: 'passed', evidence: 'Observed by Matt' },
    ];
    f.skip('docs');
    expect(f.feature.criteria[0].status).toBe('passed');
    expect(f.feature.status).toBe('awaiting_final_validation');
    expect(finalValidationReady(f.feature)).toBe(true);
    expect(progressLabel(f.feature)).toBe('2 validées · 2 passées / 4 interventions');
    f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature));
    expect(f.feature.status).toBe('completed');
    const exported = sessionMarkdown(f.feature, '/fixture');
    expect(exported).toContain('Passée par l’humain — non exécutée');
    expect(exported).toContain('Décision humaine : Passer sans exécuter');
  });
  it('does not bypass remaining criteria or blocking comments when the last step is skipped', () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    f.finish('code');
    f.feature.criteria = [{ id: 'c', text: 'Verify', status: 'pending', evidence: '' }];
    f.skip('docs');
    expect(f.feature.status).toBe('attention');
    expect(() => f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature))).toThrow();
  });
  it('refuses mandatory, locked, already decided, stale and already attempted choices', () => {
    const f = fixture();
    expect(() => f.skip('us')).toThrow('facultative');
    expect(() => f.skip('plan')).toThrow('disponible');
    f.finish('us');
    const key = featureStateKey(f.feature);
    f.feature.description += ' changed';
    expect(() => f.engine.decideOptionalStep(f.feature.id, 'plan', 'skip', key)).toThrow('changé');
    f.engine.beginRun(f.feature.id, 'plan');
    f.engine.failRun(f.feature.id, 'plan', 'Real failure');
    expect(() => f.skip('plan')).toThrow('jamais exécutée');
    expect(f.feature.steps[1].status).toBe('failed');
  });
  it('invalidates skipped decisions on upstream replay and preserves their history', () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    f.finish('code');
    f.skip('docs');
    f.engine.beginRun(f.feature.id, 'us');
    expect(f.feature.steps[1]).toMatchObject({ status: 'pending', attempts: [] });
    expect(f.feature.steps[1].optionalDecision).toBeUndefined();
    expect(f.feature.steps[1].optionalDecisionHistory).toHaveLength(1);
    expect(f.feature.steps[2].status).toBe('stale');
    expect(f.feature.steps[3].status).toBe('pending');
  });
  it('reopens a skipped root explicitly selected in a correction route', () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    f.finish('code');
    f.engine.requestCorrection(f.feature.id, {
      expectedStateKey: featureStateKey(f.feature),
      sourceStepId: 'code',
      rootStepIds: ['plan'],
      findingIds: [],
      commentIds: [],
      feedback: 'Revoir le plan avant de corriger le code.',
    });
    expect(f.feature.steps[1].status).toBe('pending');
    expect(f.feature.steps[1].optionalDecision).toBeUndefined();
    expect(f.feature.steps[1].optionalDecisionHistory).toHaveLength(1);
    expect(f.feature.steps[2].status).toBe('stale');
  });
  it('does not fabricate another human optional choice during a replay', () => {
    const f = fixture();
    f.finish('us');
    f.finish('plan');
    expect(f.feature.steps[1].optionalDecisionHistory).toHaveLength(1);
    f.finish('us');
    f.finish('plan');
    expect(f.feature.steps[1].optionalDecisionHistory).toHaveLength(1);
    expect(f.feature.steps[1].attempts).toHaveLength(2);
  });
  it('permits manual reactivation of a passed intervention and invalidates its descendants', () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    f.finish('code');
    f.skip('docs');
    f.engine.beginRun(f.feature.id, 'plan');
    expect(f.feature.steps[1].optionalDecisionHistory?.map((item) => item.action)).toEqual([
      'skip',
      'run',
    ]);
    expect(f.feature.steps[2].status).toBe('stale');
    expect(f.feature.steps[3].optionalDecision).toBeUndefined();
  });
  it('invalidates choices after restoring files or changing the optional agent configuration', () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    f.engine.configureStep(f.feature.id, 'plan', { agentId: 'other', skills: [] });
    expect(f.feature.steps[1].status).toBe('pending');
    expect(f.feature.steps[1].optionalDecision).toBeUndefined();
    f.skip('plan');
    f.engine.invalidateAfterRestore(f.feature.id);
    expect(f.feature.steps[1].status).toBe('pending');
    expect(f.feature.steps[1].optionalDecisionHistory).toHaveLength(2);
  });
  it('pauses before optional inference and keeps ask-before-run and budgets after a choice', () => {
    const f = fixture();
    f.finish('us');
    f.feature.autopilot = {
      status: 'running',
      runs: 0,
      maxRuns: 3,
      correctionCycles: 0,
      maxCorrectionCycles: 0,
      checkpoints: [],
      stepInputs: {},
      updatedAt: 'now',
    };
    expect(nextAutopilotAction(f.feature)).toMatchObject({ kind: 'pause', optionalStepId: 'plan' });
    f.feature.autopilot.status = 'paused';
    f.feature.steps[1].askBeforeRun = true;
    f.engine.decideOptionalStep(f.feature.id, 'plan', 'run', featureStateKey(f.feature));
    f.feature.autopilot.status = 'running';
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringContaining('Confirmation'),
    });
    f.feature.steps[1].askBeforeRun = false;
    expect(nextAutopilotAction(f.feature)).toMatchObject({ kind: 'run', stepId: 'plan' });
    f.feature.autopilot.runs = 3;
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringContaining('maximal'),
    });
  });
  it('informs the next agent about passed work even with empty optional context', () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    const attempt = f.engine.beginRun(f.feature.id, 'code');
    const prompt = buildPrompt({
      feature: f.feature,
      step: f.feature.steps[2],
      attempt,
      workspacePath: '/fixture',
      settings: defaultSettings,
      skills: [],
      agent: {
        id: 'agent',
        name: 'Agent',
        description: '',
        instructions: '',
        tools: ['read'],
        skills: [],
        source: 'bundled',
        path: '',
      },
      launch: { ...emptyLaunch(), contextMode: 'empty' },
    });
    expect(prompt).toContain('Interventions explicitement passées');
    expect(prompt).toContain('plan (plan)');
    expect(prompt).not.toContain('Livrable approuvé · plan');
  });
  it('persists decisions and pending choices, and migrates a v5 index conservatively', async () => {
    const f = fixture();
    f.finish('us');
    f.skip('plan');
    const root = await mkdtemp(join(tmpdir(), 'optional-store-'));
    roots.push(root);
    const store = new Store(root);
    await store.save([f.feature], defaultSettings);
    expect((await store.load()).features[0]).toEqual(f.feature);
    const index = JSON.parse(await readFile(store.path, 'utf8'));
    index.schemaVersion = 5;
    await writeFile(store.path, JSON.stringify(index));
    const migrated = await store.load();
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.features[0].steps[0].optional).toBe(false);
    expect(migrated.features[0].steps[1].status).toBe('skipped');
    expect(JSON.parse(await readFile(store.path, 'utf8')).schemaVersion).toBe(8);
  });
  it('rejects corrupt passed states and validates the host action contract', async () => {
    const f = fixture();
    const root = await mkdtemp(join(tmpdir(), 'optional-corrupt-'));
    roots.push(root);
    f.feature.steps[0].status = 'skipped';
    expect(() => new Store(root).save([f.feature], defaultSettings)).toThrow();
    const message = {
      type: 'resolveOptionalStep',
      requestId: randomUUID(),
      featureId: f.feature.id,
      stepId: 'plan',
      choice: 'skip',
      expectedStateKey: featureStateKey(f.feature),
    };
    expect(parseMessage(message)).toEqual(message);
    expect(() => parseMessage({ ...message, choice: 'approve' })).toThrow();
  });
});
