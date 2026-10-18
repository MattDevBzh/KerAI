import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowEngine } from '../src/core/workflow';
import { Store, defaultSettings } from '../src/core/store';
import { correctionContext, featureStateKey, previewCorrection } from '../src/shared/collaboration';
import type { CorrectionRequest, Workflow } from '../src/shared/types';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function fixture() {
  const step = (id: string, dependsOn: string[] = []) => ({
    id,
    name: id,
    description: '',
    agentId: 'agent',
    policy: 'read-only' as const,
    skills: [],
    maxAttempts: 8,
    artifact: `${id}.md`,
    dependsOn,
  });
  const workflow: Workflow = {
    id: 'custom',
    name: 'Custom',
    description: '',
    icon: '',
    steps: [
      step('brief'),
      step('dev', ['brief']),
      step('docs', ['brief']),
      step('review', ['dev', 'docs']),
      step('independent'),
    ],
  };
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(workflow, { title: 'Change', description: 'Original need' });
  const finish = (id: string) => {
    engine.beginRun(feature.id, id);
    engine.finishRun(feature.id, id, {
      content: `Original ${id}`,
      questions: [],
      changedFiles: [],
    });
    engine.approveStep(feature.id, id);
  };
  const approved = () => {
    for (const id of ['brief', 'dev', 'docs', 'review', 'independent']) finish(id);
  };
  const request = (): CorrectionRequest => ({
    expectedStateKey: featureStateKey(feature),
    sourceStepId: 'review',
    rootStepIds: ['dev', 'docs'],
    feedback: 'Fix code and docs together',
    findingIds: [],
    commentIds: [],
  });
  return { engine, feature, finish, approved, request };
}

describe('human collaboration contracts', () => {
  it('keeps agent original and human revisions without mutating structured verdicts or receipts, and rejects stale edits', () => {
    const f = fixture();
    f.approved();
    const attempt = f.feature.steps[1].attempts[0];
    attempt.review = {
      verdict: 'changes_requested',
      summary: 'Fix',
      findings: [{ id: 'f', severity: 'blocking', message: 'Code broken' }],
    };
    const verdict = structuredClone(attempt.review);
    const options = {
      expectedAttemptId: attempt.id,
      expectedRevision: attempt.revision ?? 0,
      expectedStateKey: featureStateKey(f.feature),
      reason: 'Clarify report',
    };
    f.engine.saveArtifact(f.feature.id, 'dev', 'Human report', options);
    expect(attempt.artifactVersions?.map((version) => [version.author, version.content])).toEqual([
      ['agent', 'Original dev'],
      ['human', 'Human report'],
    ]);
    expect(attempt.review).toEqual(verdict);
    expect(f.feature.steps[3].status).toBe('stale');
    expect(f.feature.steps[2].status).toBe('approved');
    expect(() => f.engine.saveArtifact(f.feature.id, 'dev', 'Overwrite', options)).toThrow(
      /obsolète/,
    );
    expect(attempt.artifact?.content).toBe('Human report');
    const stale = f.feature.steps[3].attempts[0];
    f.engine.saveArtifact(f.feature.id, 'review', 'A typo fixed', {
      expectedAttemptId: stale.id,
      expectedRevision: stale.revision ?? 0,
      expectedStateKey: featureStateKey(f.feature),
    });
    expect(f.feature.steps[3].status).toBe('stale');
  });
  it('invalidates all branches on brief changes and blocks old session, report and answer reuse', () => {
    const f = fixture();
    f.approved();
    const old = f.feature.steps[0].attempts[0];
    old.sessionId = 'copilot-old';
    old.questions = [{ id: 'who', text: 'Audience?' }];
    old.answers = { who: 'Old audience' };
    const review = f.feature.steps[3].attempts[0];
    f.engine.saveArtifact(f.feature.id, 'review', 'Edited review', {
      expectedAttemptId: review.id,
      expectedRevision: review.revision ?? 0,
      expectedStateKey: featureStateKey(f.feature),
      description: 'New need',
      reason: 'Changed scope',
    });
    expect(f.feature.steps.every((step) => step.status === 'stale')).toBe(true);
    expect(f.feature.descriptionVersions?.map((version) => version.content)).toEqual([
      'Original need',
      'New need',
    ]);
    expect(() => f.engine.beginRun(f.feature.id, 'brief', '', true)).toThrow(/nouvelle session/);
    const next = f.engine.beginRun(f.feature.id, 'brief');
    expect(next.sessionId).toBeUndefined();
    expect(next.artifact).toBeUndefined();
    expect(next.answers).toEqual({});
    expect(old.artifact?.content).toBe('Original brief');
    expect(old.answers.who).toBe('Old audience');
  });
  it('unions several correction roots transitively, preserves independent approvals, and freezes provenance', () => {
    const f = fixture();
    f.approved();
    const source = f.feature.steps[3].attempts[0];
    source.review = {
      verdict: 'changes_requested',
      summary: 'Problem',
      findings: [{ id: 'finding', severity: 'blocking', message: 'Fix the behavior' }],
    };
    f.feature.criteria = [
      { id: 'accept', text: 'Actual behavior', status: 'passed', evidence: 'Previous acceptance' },
    ];
    const request = {
      ...f.request(),
      findingIds: ['finding'],
      artifactContext: { dev: { enabled: false }, review: { content: 'Selected review excerpt' } },
    };
    const preview = previewCorrection(f.feature, request);
    expect(preview.errors).toEqual([]);
    expect(preview.routeStepIds).toEqual(['dev', 'docs', 'review']);
    expect(preview.preservedStepIds).toEqual(['brief', 'independent']);
    const cycle = f.engine.requestCorrection(f.feature.id, request);
    expect(f.feature.steps.map((step) => step.status)).toEqual([
      'approved',
      'stale',
      'stale',
      'stale',
      'approved',
    ]);
    expect(f.feature.criteria[0]).toMatchObject({ status: 'pending', evidence: '' });
    source.artifact!.content = 'External later edit';
    source.review.summary = 'New report';
    expect(
      cycle.snapshot.artifacts.find((report) => report.stepId === 'review')?.artifact.content,
    ).toBe('Original review');
    expect(cycle.snapshot.review?.summary).toBe('Problem');
    const context = correctionContext(cycle);
    expect(context).toContain('Selected review excerpt');
    expect(context).not.toContain('Original dev');
    expect(context).toContain('historique avant correction');
  });
  it('requires a fresh feature state and explicit human final action, then invalidates completion on new work', () => {
    const f = fixture();
    f.approved();
    expect(f.feature.status).toBe('awaiting_final_validation');
    const obsolete = featureStateKey(f.feature);
    f.feature.reviewComments = [
      {
        id: 'comment',
        stepId: 'review',
        attemptId: f.feature.steps[3].attempts[0].id,
        text: 'Open question',
        blocking: true,
        resolved: false,
        createdAt: new Date().toISOString(),
      },
    ];
    expect(() => f.engine.finalizeFeature(f.feature.id, obsolete)).toThrow(/changé/);
    expect(() => f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature))).toThrow(
      /remarques/,
    );
    f.feature.reviewComments[0].resolved = true;
    const cycle = f.engine.requestCorrection(f.feature.id, f.request());
    f.finish('dev');
    f.finish('docs');
    f.finish('review');
    f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature));
    expect(f.feature.status).toBe('completed');
    expect(cycle.status).toBe('completed');
    expect(f.feature.activeCorrectionId).toBeUndefined();
    expect(() => f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature))).toThrow(
      /déjà/,
    );
    f.engine.beginRun(f.feature.id, 'dev');
    expect(f.feature.finalValidation).toBeUndefined();
    expect(f.feature.status).toBe('running');
  });
  it('persists interrupted corrections and editorial history with schema5, and migrates legacy completion to the human gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-collaboration-'));
    roots.push(root);
    const store = new Store(root);
    const f = fixture();
    f.approved();
    const attempt = f.feature.steps[1].attempts[0];
    f.engine.saveArtifact(f.feature.id, 'dev', 'Human version', {
      expectedAttemptId: attempt.id,
      expectedRevision: attempt.revision ?? 0,
      expectedStateKey: featureStateKey(f.feature),
    });
    f.finish('dev');
    f.finish('review');
    const cycle = f.engine.requestCorrection(f.feature.id, f.request());
    const running = f.engine.beginRun(f.feature.id, 'dev');
    running.sessionId = 'paused-session';
    await store.save(f.engine.features, defaultSettings);
    const reloaded = await store.load();
    expect(reloaded.schemaVersion).toBe(6);
    expect(reloaded.features[0].corrections?.[0].id).toBe(cycle.id);
    expect(reloaded.features[0].corrections?.[0].status).toBe('interrupted');
    expect(reloaded.features[0].steps[1].status).toBe('interrupted');
    expect(reloaded.features[0].steps[1].attempts).toHaveLength(3);
    expect(reloaded.features[0].steps[1].attempts[0].artifactVersions?.[1].content).toBe(
      'Human version',
    );
    expect(JSON.parse(await readFile(store.path, 'utf8')).schemaVersion).toBe(6);
    const legacy = fixture();
    legacy.approved();
    legacy.feature.status = 'completed';
    await writeFile(
      store.path,
      JSON.stringify({
        schemaVersion: 3,
        features: legacy.engine.features,
        settings: defaultSettings,
        memory: [],
      }),
    );
    const migrated = await store.load();
    expect(migrated.features[0].status).toBe('awaiting_final_validation');
    expect(migrated.features[0].finalValidation).toBeUndefined();
  });
});
