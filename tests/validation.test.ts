import { describe, expect, it } from 'vitest';
import { featureStateKey, finalValidationReady } from '../src/shared/collaboration';
import { reviewApprovalRequest, acceptedReviewRemarks } from '../src/shared/reviewApproval';
import { WorkflowEngine } from '../src/core/workflow';
import { approvalBlockers } from '../src/core/validation';
import type { TestEvidence } from '../src/shared/types';
const proof = (exitCode: number | null = 0, commandId = 'unit'): TestEvidence => ({
  id: `proof-${commandId}-${exitCode}`,
  source: 'host',
  commandId,
  name: 'Unit',
  command: 'node',
  args: ['--test'],
  startedAt: 'now',
  finishedAt: 'later',
  exitCode,
  stdout: 'observed',
  stderr: '',
  truncated: false,
  fileHashes: {},
});
function fixture(policy: 'tests' | 'read-only' = 'tests') {
  const engine = new WorkflowEngine(),
    feature = engine.createFeature(
      {
        id: 'single',
        name: 'Single',
        description: '',
        icon: '',
        steps: [
          {
            id: 'run',
            name: 'Run',
            description: '',
            agentId: 'agent',
            policy,
            skills: [],
            maxAttempts: 5,
            artifact: 'run.md',
            dependsOn: [],
          },
        ],
      },
      { title: 'Validation', description: '' },
    );
  const attempt = engine.beginRun(feature.id, 'run');
  engine.finishRun(feature.id, 'run', { content: '# Artifact', questions: [], changedFiles: [] });
  return { engine, feature, step: feature.steps[0], attempt };
}
describe('validation based on current proofs', () => {
  it('requires a real host test for auto tests approval, without inventing a manual proof', () => {
    const f = fixture();
    expect(approvalBlockers(f.feature, f.step, 'autopilot')).toContain(
      'Aucune preuve de tests réellement exécutés par le host.',
    );
    expect(approvalBlockers(f.feature, f.step, 'human')).toEqual([]);
    f.attempt.evidence = [proof()];
    expect(approvalBlockers(f.feature, f.step, 'autopilot')).toEqual([]);
    f.engine.approveStep(f.feature.id, 'run', 'autopilot', f.attempt.id, f.attempt.revision);
    expect(f.attempt.approvedBy).toBe('autopilot');
  });
  it('retains all evidence but uses the latest result for each configured command', () => {
    const f = fixture();
    f.attempt.evidence = [proof(1), proof(0)];
    expect(approvalBlockers(f.feature, f.step, 'autopilot')).toEqual([]);
    f.attempt.evidence.push(proof(2, 'integration'));
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toMatch(/échec/);
    f.attempt.evidence = [{ ...proof(null), error: 'Timeout' }];
    expect(approvalBlockers(f.feature, f.step, 'autopilot').join(' ')).toMatch(/incomplète/);
  });
  it('rejects proofs taken before later file edits', () => {
    const f = fixture();
    f.attempt.fileHashes = { 'tests/unit.ts': 'new' };
    f.attempt.evidence = [{ ...proof(), fileHashes: { 'tests/unit.ts': 'old' } }];
    expect(approvalBlockers(f.feature, f.step, 'autopilot').join(' ')).toMatch(/obsolète/);
    f.attempt.evidence[0].fileHashes['tests/unit.ts'] = 'new';
    expect(approvalBlockers(f.feature, f.step, 'autopilot')).toEqual([]);
  });
  it('requires human acknowledgement of review findings/comments while retaining other blockers', () => {
    const f = fixture('read-only');
    f.feature.criteria = [{ id: 'criterion', text: 'Works', status: 'passed', evidence: '' }];
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toMatch(/critères/);
    f.feature.criteria[0].evidence = 'Observed path';
    f.attempt.review = { verdict: 'changes_requested', summary: 'Bug', findings: [] };
    expect(approvalBlockers(f.feature, f.step, 'human')).toEqual([]);
    expect(approvalBlockers(f.feature, f.step, 'autopilot').join(' ')).toMatch(/corrections/);
    f.feature.reviewComments = [
      {
        id: 'comment',
        stepId: 'run',
        attemptId: f.attempt.id,
        text: 'Check',
        blocking: true,
        resolved: false,
        createdAt: 'now',
      },
    ];
    expect(approvalBlockers(f.feature, f.step, 'human')).toEqual([]);
    expect(approvalBlockers(f.feature, f.step, 'autopilot').join(' ')).toMatch(/commentaires/);
    expect(() => f.engine.approveStep(f.feature.id, 'run')).toThrow(/Confirme/);
    expect(f.step.status).toBe('awaiting_review');
    const key = reviewApprovalRequest(f.feature, f.step)!.key;
    f.engine.approveStep(f.feature.id, 'run', 'human', f.attempt.id, f.attempt.revision, key);
    expect(f.step.status).toBe('approved');
    expect(f.attempt.review.verdict).toBe('changes_requested');
    expect(f.feature.reviewComments[0].resolved).toBe(false);
    expect(acceptedReviewRemarks(f.step)?.comments).toHaveLength(1);
    expect(finalValidationReady(f.feature)).toBe(true);
    f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature));
    expect(f.feature.status).toBe('completed');
  });
  it.each(['info', 'warning', 'blocking'] as const)(
    'confirms %s findings and binds acceptance to the exact remarks',
    (severity) => {
      const f = fixture('read-only');
      f.attempt.review = {
        verdict: severity === 'blocking' ? 'changes_requested' : 'pass',
        summary: 'Review',
        findings: [{ id: 'finding', severity, message: 'Original remark' }],
      };
      expect(() => f.engine.approveStep(f.feature.id, 'run')).toThrow(/Confirme/);
      const key = reviewApprovalRequest(f.feature, f.step)!.key;
      f.attempt.review.findings[0].message = 'Updated remark';
      expect(() =>
        f.engine.approveStep(f.feature.id, 'run', 'human', f.attempt.id, f.attempt.revision, key),
      ).toThrow(/remarques ont changé/);
      expect(f.step.status).toBe('awaiting_review');
      expect(f.attempt.reviewAcceptance).toBeUndefined();
    },
  );
  it('never uses acknowledgement to bypass failed tests or acceptance criteria', () => {
    const f = fixture('read-only');
    f.attempt.review = { verdict: 'changes_requested', summary: 'Bug', findings: [] };
    const key = reviewApprovalRequest(f.feature, f.step)!.key;
    f.attempt.evidence = [proof(1)];
    expect(() =>
      f.engine.approveStep(f.feature.id, 'run', 'human', f.attempt.id, f.attempt.revision, key),
    ).toThrow(/échec/);
    f.attempt.evidence = [];
    f.feature.criteria = [{ id: 'criterion', text: 'Works', status: 'pending', evidence: '' }];
    expect(() =>
      f.engine.approveStep(f.feature.id, 'run', 'human', f.attempt.id, f.attempt.revision, key),
    ).toThrow(/critères/);
    expect(f.attempt.reviewAcceptance).toBeUndefined();
  });
  it('does not let autopilot use human acknowledgement to accept requested corrections', () => {
    const f = fixture('read-only');
    f.attempt.review = { verdict: 'changes_requested', summary: 'Bug', findings: [] };
    expect(() =>
      f.engine.approveStep(
        f.feature.id,
        'run',
        'autopilot',
        f.attempt.id,
        f.attempt.revision,
        reviewApprovalRequest(f.feature, f.step)!.key,
      ),
    ).toThrow(/corrections/);
    expect(f.attempt.reviewAcceptance).toBeUndefined();
  });
  it('asks again after editing an accepted report or replaying the step', () => {
    const f = fixture('read-only');
    f.attempt.review = { verdict: 'changes_requested', summary: 'Bug', findings: [] };
    const key = reviewApprovalRequest(f.feature, f.step)!.key;
    f.engine.approveStep(f.feature.id, 'run', 'human', f.attempt.id, f.attempt.revision, key);
    f.engine.saveArtifact(f.feature.id, 'run', 'Updated report');
    expect(acceptedReviewRemarks(f.step)).toBeUndefined();
    expect(() =>
      f.engine.approveStep(f.feature.id, 'run', 'human', f.attempt.id, f.attempt.revision, key),
    ).toThrow(/remarques ont changé/);
    const next = f.engine.beginRun(f.feature.id, 'run');
    expect(next.reviewAcceptance).toBeUndefined();
  });
  it('lets the last step acknowledge outstanding comments from earlier steps', () => {
    const f = fixture('read-only');
    f.feature.steps.unshift({
      ...structuredClone(f.step),
      id: 'prior',
      status: 'approved',
      attempts: [
        {
          ...structuredClone(f.attempt),
          id: 'prior-attempt',
          status: 'approved',
          approvedBy: 'human',
        },
      ],
    });
    f.step.dependsOn = ['prior'];
    f.feature.reviewComments = [
      {
        id: 'prior-comment',
        stepId: 'prior',
        attemptId: 'prior-attempt',
        text: 'Prior remark',
        blocking: true,
        resolved: false,
        createdAt: new Date().toISOString(),
      },
    ];
    const warning = reviewApprovalRequest(f.feature, f.step)!;
    expect(warning.comments.map((c) => c.id)).toEqual(['prior-comment']);
    expect(approvalBlockers(f.feature, f.step, 'human')).toEqual([]);
    expect(() => f.engine.approveStep(f.feature.id, 'run')).toThrow(/Confirme/);
    f.engine.approveStep(
      f.feature.id,
      'run',
      'human',
      f.attempt.id,
      f.attempt.revision,
      warning.key,
    );
    expect(finalValidationReady(f.feature)).toBe(true);
  });
  it('refuses approvals of an unseen attempt or changed revision', () => {
    const f = fixture('read-only'),
      revision = f.attempt.revision!;
    expect(() => f.engine.approveStep(f.feature.id, 'run', 'human', 'old', revision)).toThrow(
      /obsolète/,
    );
    f.engine.saveArtifact(f.feature.id, 'run', 'Edited');
    expect(f.attempt.revision).toBe(revision + 1);
    expect(() =>
      f.engine.approveStep(f.feature.id, 'run', 'human', f.attempt.id, revision),
    ).toThrow(/obsolète/);
    f.engine.approveStep(f.feature.id, 'run', 'human', f.attempt.id, f.attempt.revision);
    expect(f.attempt.approvedBy).toBe('human');
  });
  it('refreshes completion status when acceptance criteria or blocking comments change', () => {
    const f = fixture('read-only');
    f.engine.approveStep(f.feature.id, 'run');
    expect(f.feature.status).toBe('awaiting_final_validation');
    f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature));
    expect(f.feature.status).toBe('completed');
    f.feature.criteria = [{ id: 'criterion', text: 'Behavior', status: 'pending', evidence: '' }];
    f.engine.refreshFeatureStatus(f.feature.id);
    expect(f.feature.status).toBe('attention');
    f.feature.criteria[0] = { ...f.feature.criteria[0], status: 'passed', evidence: 'Observed' };
    f.engine.refreshFeatureStatus(f.feature.id);
    expect(f.feature.status).toBe('awaiting_final_validation');
    f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature));
    expect(f.feature.status).toBe('completed');
    f.feature.reviewComments = [
      {
        id: 'comment',
        stepId: 'run',
        attemptId: f.attempt.id,
        text: 'Blocker',
        blocking: true,
        resolved: false,
        createdAt: 'now',
      },
    ];
    f.engine.refreshFeatureStatus(f.feature.id);
    expect(f.feature.status).toBe('attention');
    f.feature.reviewComments[0].resolved = true;
    f.engine.refreshFeatureStatus(f.feature.id);
    expect(f.feature.status).toBe('awaiting_final_validation');
    f.engine.finalizeFeature(f.feature.id, featureStateKey(f.feature));
    expect(f.feature.status).toBe('completed');
  });
  it('preserves live questions and answers, usage and test evidence when completing the artifact', () => {
    const f = fixture('read-only');
    f.engine.beginRun(f.feature.id, 'run');
    const attempt = f.step.attempts.at(-1)!;
    attempt.questions = [{ id: 'live', text: 'Live question' }];
    attempt.answers.live = 'Human answer';
    attempt.usage = { source: 'measured', inputTokens: 12 };
    attempt.evidence = [proof()];
    f.engine.finishRun(f.feature.id, 'run', {
      content: 'Final',
      questions: [{ id: 'final', text: 'Remaining question' }],
      changedFiles: [],
    });
    expect(attempt.questions.map((q) => q.id)).toEqual(['live', 'final']);
    expect(attempt.answers.live).toBe('Human answer');
    expect(attempt.usage?.inputTokens).toBe(12);
    expect(attempt.evidence).toHaveLength(1);
    expect(f.step.status).toBe('waiting_input');
  });
});
