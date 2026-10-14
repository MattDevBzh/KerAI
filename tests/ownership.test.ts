import { describe, expect, it } from 'vitest';
import { WorkflowEngine } from '../src/core/workflow';
import { currentOwnedFileHashes } from '../src/core/ownership';

function fixture() {
  const step = (id: string, dependsOn: string[] = []) => ({
    id,
    name: id,
    description: '',
    agentId: 'agent',
    policy: 'workspace-write' as const,
    skills: [],
    artifact: `${id}.md`,
    dependsOn,
    maxAttempts: 4,
  });
  const engine = new WorkflowEngine();
  // A custom DAG can be stored in reverse order; order is not ownership provenance.
  const feature = engine.createFeature(
    {
      id: 'custom',
      name: 'Custom',
      description: '',
      icon: '',
      steps: [step('tests', ['dev']), step('dev'), step('branch')],
    },
    { title: 'Current ownership', description: '' },
  );
  const run = (
    id: string,
    content: string,
    hashes: Record<string, string>,
    startedAt: string,
    finishedAt: string,
  ) => {
    const attempt = engine.beginRun(feature.id, id);
    engine.finishRun(feature.id, id, {
      content,
      questions: [],
      changedFiles: Object.keys(hashes),
      fileHashes: hashes,
    });
    attempt.startedAt = startedAt;
    attempt.finishedAt = finishedAt;
    engine.approveStep(feature.id, id);
    return attempt;
  };
  run(
    'dev',
    'Initial implementation',
    { 'tests/foo.test.ts': 'H1' },
    '2026-10-14T10:00:00.000Z',
    '2026-10-14T10:05:00.000Z',
  );
  run(
    'tests',
    'Extended assertions',
    { 'tests/foo.test.ts': 'H2' },
    '2026-10-14T10:06:00.000Z',
    '2026-10-14T10:07:00.000Z',
  );
  return { engine, feature, run };
}
describe('authoritative ownership across sequential stages', () => {
  it('uses the last chronological write in legacy custom DAGs, even after reordering the workflow', () => {
    const f = fixture();
    expect(currentOwnedFileHashes(f.feature)['tests/foo.test.ts']).toBe('H2');
    f.feature.steps.reverse();
    expect(currentOwnedFileHashes(f.feature)['tests/foo.test.ts']).toBe('H2');
    f.feature.steps.find((step) => step.id === 'tests')!.attempts[0].finishedAt = undefined;
    expect(currentOwnedFileHashes(f.feature)['tests/foo.test.ts']).toBe('H2');
  });
  it('uses checkpoint-restored canonical contents rather than a later historical attempt', () => {
    const f = fixture();
    f.feature.workspaceFileHashes = {
      'tests/foo.test.ts': 'RESTORED',
      'src/restored.ts': 'RECOVERED',
    };
    expect(currentOwnedFileHashes(f.feature)).toEqual({
      'tests/foo.test.ts': 'RESTORED',
      'src/restored.ts': 'RECOVERED',
    });
    expect(
      f.feature.steps.find((step) => step.id === 'tests')!.attempts[0].fileHashes?.[
        'tests/foo.test.ts'
      ],
    ).toBe('H2');
  });
  it('refuses ambiguous conflicting legacy writes but does not block an unrelated approval scope', () => {
    const f = fixture();
    const original = f.feature.steps.find((step) => step.id === 'dev')!.attempts[0];
    f.run(
      'branch',
      'Independent branch',
      { 'src/branch.ts': 'BRANCH' },
      '2026-10-14T10:06:00.000Z',
      '2026-10-14T10:07:00.000Z',
    );
    const latest = f.feature.steps.find((step) => step.id === 'tests')!.attempts[0];
    original.startedAt = latest.startedAt;
    original.finishedAt = latest.finishedAt;
    expect(() => currentOwnedFileHashes(f.feature)).toThrow(/ambigu/);
    expect(currentOwnedFileHashes(f.feature, new Set(['src/branch.ts']))).toEqual({
      'src/branch.ts': 'BRANCH',
    });
    f.feature.workspaceFileHashes = { 'tests/foo.test.ts': 'VERIFIED_CURRENT' };
    expect(currentOwnedFileHashes(f.feature)['tests/foo.test.ts']).toBe('VERIFIED_CURRENT');
  });
});
