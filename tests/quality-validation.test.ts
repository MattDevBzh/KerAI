import { describe, expect, it } from 'vitest';
import { WorkflowEngine, validateWorkflow } from '../src/core/workflow';
import { approvalBlockers } from '../src/core/validation';
import type { TestEvidence, Workflow } from '../src/shared/types';
import type { QualityEvidence, QualityKind } from '../src/shared/quality';
function fixture(kind: QualityKind = 'visual', agentId = 'custom') {
  const workflow: Workflow = {
    id: 'quality-feature',
    name: 'Quality',
    description: '',
    icon: '',
    steps: [
      {
        id: 'recipe',
        name: 'Recipe',
        description: '',
        agentId,
        policy: 'tests',
        requiredQuality: kind,
        skills: [],
        maxAttempts: 3,
        artifact: 'recipe.md',
        dependsOn: [],
      },
      {
        id: 'review',
        name: 'Review',
        description: '',
        agentId: 'fs-review',
        policy: 'read-only',
        skills: [],
        maxAttempts: 3,
        artifact: 'review.md',
        dependsOn: ['recipe'],
      },
    ],
  };
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(workflow, { title: 'Quality', description: '' });
  feature.criteria = [
    { id: 'C1', text: 'Show expected result', status: 'passed', evidence: 'Confirmed' },
  ];
  const attempt = engine.beginRun(feature.id, 'recipe');
  engine.finishRun(feature.id, 'recipe', {
    content: 'A result',
    questions: [],
    changedFiles: [],
    fileHashes: { 'screen.ts': 'current' },
  });
  const quality: QualityEvidence = {
    version: 1,
    kind,
    featureId: feature.id,
    attemptId: attempt.id,
    commandId: 'quality-command',
    evidenceId: 'evidence',
    collectedAt: new Date().toISOString(),
    status: 'passed',
    reportPath: '.feature-studio/quality/report.json',
    reportSha256: 'a'.repeat(64),
    runner: 'playwright',
    cases: [
      {
        id: 'case',
        title: 'Result',
        criterionIds: ['C1'],
        status: 'passed',
        steps: ['Assert result'],
        errors: [],
        attachmentIds: ['image'],
      },
    ],
    attachments: [
      {
        id: 'image',
        name: 'Screenshot',
        kind: 'screenshot',
        mime: 'image/png',
        sizeBytes: 10,
        sha256: 'b'.repeat(64),
      },
    ],
  };
  const proof: TestEvidence = {
    id: 'evidence',
    source: 'host',
    commandId: 'quality-command',
    name: 'Quality',
    command: 'node',
    args: [],
    startedAt: attempt.startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout: '',
    stderr: '',
    truncated: false,
    fileHashes: { 'screen.ts': 'current' },
    quality,
  };
  return { engine, feature, step: feature.steps[0], attempt, quality, proof, workflow };
}
describe('required quality contracts', () => {
  it.each(['human', 'autopilot'] as const)(
    'blocks ordinary success and allows only a current bound report for %s',
    (actor) => {
      const f = fixture();
      const { quality: _quality, ...ordinary } = f.proof;
      f.attempt.evidence = [ordinary];
      expect(approvalBlockers(f.feature, f.step, actor).join(' ')).toContain(
        'Rapport qualité visuel',
      );
      expect(() => f.engine.approveStep(f.feature.id, f.step.id, actor)).toThrow(
        'Rapport qualité visuel',
      );
      f.attempt.evidence = [f.proof];
      expect(approvalBlockers(f.feature, f.step, actor)).toEqual([]);
      f.engine.approveStep(f.feature.id, f.step.id, actor);
      expect(f.attempt.approvedBy).toBe(actor);
    },
  );
  it.each(['featureId', 'attemptId', 'evidenceId', 'commandId'] as const)(
    'blocks wrong report %s',
    (field) => {
      const f = fixture();
      f.quality[field] = 'another';
      f.attempt.evidence = [f.proof];
      expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toContain(
        'Rapport qualité visuel',
      );
    },
  );
  it('blocks wrong kind, stale hashes, missing report digest and an unknown criterion', () => {
    const f = fixture();
    f.attempt.evidence = [f.proof];
    f.quality.kind = 'counterexample';
    expect(approvalBlockers(f.feature, f.step, 'autopilot').join(' ')).toContain(
      'Rapport qualité visuel',
    );
    f.quality.kind = 'visual';
    f.proof.fileHashes['screen.ts'] = 'old';
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toContain('obsolète');
    f.proof.fileHashes['screen.ts'] = 'current';
    delete f.quality.reportSha256;
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toContain(
      'Rapport qualité visuel',
    );
    f.quality.reportSha256 = 'a'.repeat(64);
    f.quality.cases[0].criterionIds = ['UNKNOWN'];
    expect(approvalBlockers(f.feature, f.step, 'autopilot').join(' ')).toContain(
      'Rapport qualité visuel',
    );
  });
  it.each([
    ['visual', 'fs-visual-tests'],
    ['counterexample', 'fs-counterexamples'],
  ] as const)(
    'keeps %s agent requirement on customized steps without an explicit field',
    (kind, agent) => {
      const f = fixture(kind, agent);
      delete f.step.requiredQuality;
      const { quality: _quality, ...ordinary } = f.proof;
      f.attempt.evidence = [ordinary];
      expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toContain('Rapport qualité');
      f.attempt.evidence = [f.proof];
      expect(approvalBlockers(f.feature, f.step, 'autopilot')).toEqual([]);
    },
  );
  it('links known criteria without requiring all feature criteria covered by one report', () => {
    const f = fixture();
    f.feature.criteria!.push({
      id: 'C2',
      text: 'A later criterion',
      status: 'pending',
      evidence: '',
    });
    f.attempt.evidence = [f.proof];
    expect(approvalBlockers(f.feature, f.step, 'human')).toEqual([]);
  });
  it('requires both standard agent and differing explicit quality contract', () => {
    const f = fixture('counterexample', 'fs-visual-tests');
    f.attempt.evidence = [f.proof];
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toContain(
      'Rapport qualité visuel',
    );
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).not.toContain(
      'Rapport qualité contre-exemples',
    );
  });
  it('requires a structured review for quality-feature autopilot review', () => {
    const f = fixture();
    f.attempt.evidence = [f.proof];
    f.engine.approveStep(f.feature.id, 'recipe');
    const review = f.engine.beginRun(f.feature.id, 'review');
    f.engine.finishRun(f.feature.id, 'review', {
      content: 'Review',
      questions: [],
      changedFiles: [],
    });
    expect(approvalBlockers(f.feature, f.feature.steps[1], 'autopilot')).toContain(
      'La relecture structurée attendue est absente.',
    );
    review.review = { verdict: 'pass', summary: 'Checked', findings: [] };
    f.feature.criteria![0].status = 'passed';
    f.feature.criteria![0].evidence = 'Confirmed current review';
    expect(approvalBlockers(f.feature, f.feature.steps[1], 'autopilot')).toEqual([]);
  });
  it('validates only known optional quality kinds without breaking legacy workflows', () => {
    const f = fixture();
    expect(validateWorkflow(f.workflow).steps[0].requiredQuality).toBe('visual');
    expect(() =>
      validateWorkflow({
        ...f.workflow,
        steps: [{ ...f.workflow.steps[0], requiredQuality: 'ordinary' }],
      }),
    ).toThrow();
    delete f.workflow.steps[0].requiredQuality;
    expect(validateWorkflow(f.workflow).steps[0].requiredQuality).toBeUndefined();
  });
});
