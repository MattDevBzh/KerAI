import { describe, expect, it, vi } from 'vitest';
import { demoState } from '../webview/demo';
import { validationDecisions } from '../src/shared/validationDecisions';
import {
  deliveryTicket,
  prepareSessionPullRequest,
  suggestedDeliveryFeature,
} from '../src/shared/deliveryDraft';
import { pullRequestDiff } from '../src/host/DevOpsDelivery';
import type { DevOpsState } from '../src/shared/devops';
import type { TestEvidence } from '../src/shared/types';
const state = (): DevOpsState => ({
  authenticated: true,
  busy: false,
  config: { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' },
  notices: [],
  links: [],
  tickets: [],
  pullRequests: [],
  history: [],
});
function feature() {
  const value = structuredClone(demoState.features[0]);
  value.criteria = [
    {
      id: 'criterion',
      text: 'Le menu est utilisable',
      status: 'passed',
      evidence: 'Déclaré par l’agent',
    },
  ];
  value.steps = [value.steps[0]];
  const step = value.steps[0];
  step.status = 'awaiting_review';
  step.dependsOn = [];
  step.attempts = [
    {
      id: 'attempt',
      revision: 0,
      descriptionRevision: value.descriptionRevision ?? 0,
      status: 'awaiting_review',
      startedAt: value.createdAt,
      feedback: '',
      logs: [],
      questions: [],
      answers: {},
      changedFiles: ['src/menu.ts'],
      artifact: {
        name: 'report.md',
        content: 'Le test npm test est décrit par l’agent.',
        updatedAt: value.updatedAt,
      },
    },
  ];
  return value;
}
const proof = (): TestEvidence => ({
  id: 'proof',
  source: 'host',
  commandId: 'unit',
  name: 'Tests unitaires',
  command: 'npm',
  args: ['test'],
  startedAt: '2026-10-28T08:00:00Z',
  finishedAt: '2026-10-28T08:01:00Z',
  exitCode: 0,
  stdout: 'PASS',
  stderr: '',
  truncated: false,
  fileHashes: { 'src/menu.ts': 'hash' },
});
describe('validation decisions and delivery drafting', () => {
  it('never upgrades an agent test declaration or a criterion to an execution proof', () => {
    const session = feature();
    const [decision] = validationDecisions({ features: [session] });
    expect(decision.tests).toEqual([]);
    const draft = prepareSessionPullRequest(session, state());
    expect(draft.description).toContain('Aucun test exécuté par le host');
    expect(draft.description).toContain('Ces déclarations ne prouvent pas');
    expect(draft.description).toContain(session.id);
    expect(draft.description).toContain('src/menu.ts');
  });
  it('keeps failed, superseded and changed test evidence distinct from a recorded success', () => {
    const session = feature();
    const attempt = session.steps[0].attempts[0];
    attempt.evidence = [proof(), { ...proof(), id: 'failure', commandId: 'other', exitCode: 1 }];
    session.proofChecks = {
      'test:attempt:proof': { at: session.updatedAt, state: 'changed', reason: 'Fichier modifié' },
    };
    const [decision] = validationDecisions({ features: [session] });
    expect(decision.tests.map((entry) => entry.state)).toEqual(['recheck', 'failed']);
    expect(decision.blockers.join(' ')).toContain('échec');
    const draft = prepareSessionPullRequest(session, state());
    expect(draft.description).toContain('à revérifier');
    expect(draft.description).toContain('échec ou exécution incomplète');
    expect(draft.description).not.toContain('exécution réussie enregistrée');
  });
  it('prioritizes blocked decisions and waiting questions over an ordinary review, excludes archived sessions', () => {
    const normal = feature();
    normal.id = 'normal';
    const blocked = feature();
    blocked.id = 'blocked';
    blocked.steps[0].attempts[0].evidence = [{ ...proof(), exitCode: 1 }];
    const question = feature();
    question.id = 'question';
    question.steps[0].status = 'waiting_input';
    const archived = feature();
    archived.archived = true;
    const list = validationDecisions({ features: [normal, question, archived, blocked] });
    expect(list.map((entry) => entry.feature.id)).toEqual(['blocked', 'question', 'normal']);
    expect(list[0].stepId).toBe(blocked.steps[0].id);
  });
  it('uses only one unambiguous ticket in this repository and refuses branch ambiguity', () => {
    const session = feature(),
      data = state();
    data.links = [
      {
        featureId: session.id,
        ticketId: 42,
        ticketUrl: 'https://dev.azure.com/org/project/_workitems/edit/42',
        projectKey: 'org/project/repo',
        pullRequestIds: [],
      },
      { featureId: session.id, ticketId: 99, projectKey: 'org/other/repo', pullRequestIds: [] },
    ];
    expect(deliveryTicket(session.id, data)).toBe('42');
    expect(prepareSessionPullRequest(session, data).description).toContain('Ticket : #42');
    expect(prepareSessionPullRequest(session, data).description).not.toContain('#99');
    data.links.push({ ...data.links[0], ticketId: 43 });
    expect(deliveryTicket(session.id, data)).toBe('');
    data.snapshot = {
      branch: session.branch,
      head: 'a'.repeat(40),
      fingerprint: 'hash',
      files: [],
      diff: '',
      diffTruncated: false,
    };
    expect(suggestedDeliveryFeature([session], data)).toBe(session.id);
    expect(suggestedDeliveryFeature([session, { ...session, id: 'duplicate' }], data)).toBe('');
  });
  it('compares committed PR history without diff drivers or uncommitted workspace content', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: 'COMMITTED_DIFF', stderr: '' }));
    expect(await pullRequestDiff({ run }, 'a'.repeat(40), 'b'.repeat(40))).toEqual({
      diff: 'COMMITTED_DIFF',
      diffTruncated: false,
    });
    expect(run).toHaveBeenCalledWith([
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      `${'a'.repeat(40)}...${'b'.repeat(40)}`,
      '--',
    ]);
    await expect(pullRequestDiff({ run }, '--output=/tmp/file', 'b'.repeat(40))).rejects.toThrow(
      'invalide',
    );
    expect(run).toHaveBeenCalledOnce();
  });
  it('reports missing local history and truncated comparisons explicitly', async () => {
    const unavailable = await pullRequestDiff(
      { run: async () => ({ code: 128, stdout: '', stderr: '' }) },
      'a'.repeat(40),
      'b'.repeat(40),
    );
    expect(unavailable.diff).toContain('indisponible');
    const long = await pullRequestDiff(
      { run: async () => ({ code: 0, stdout: 'x'.repeat(100_001), stderr: '' }) },
      'a'.repeat(40),
      'b'.repeat(40),
    );
    expect(long.diffTruncated).toBe(true);
    expect(long.diff.length).toBe(100_000);
  });
});
