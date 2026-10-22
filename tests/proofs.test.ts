import { expect, it } from 'vitest';
import { proofDossier, proofDossierMarkdown } from '../src/shared/proofs';
import { proofTools } from '../src/host/ProofTools';
import { WorkflowEngine } from '../src/core/workflow';
import { approvalBlockers } from '../src/core/validation';
import { screenshot } from './image-fixture';
import { parseMessage } from '../src/host/messages';
import { randomUUID } from 'node:crypto';
import type { Feature } from '../src/shared/types';
function fixture() {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(undefined, { title: 'Bug', description: 'Capture' });
  feature.images = [screenshot];
  // An unconfigured feature is intentionally empty in the product.
  feature.steps = [
    {
      id: 'research',
      name: 'Recherche',
      description: '',
      agentId: 'agent',
      skills: [],
      policy: 'read-only',
      dependsOn: [],
      artifact: 'doc.md',
      maxAttempts: 0,
      status: 'pending',
      attempts: [],
    },
  ];
  feature.activeStepId = 'research';
  const step = feature.steps[0];
  const attempt = engine.beginRun(feature.id, step.id);
  attempt.nativeActivity = [
    {
      id: 'view1',
      source: 'copilot',
      sessionId: 's',
      tool: 'view',
      startedAt: '2026-10-23T00:00:00Z',
      finishedAt: '2026-10-23T00:00:01Z',
      status: 'completed',
      directory: '/repo',
      arguments: '{"path":"/repo/src/app.ts"}',
      output: '12. if (!response.ok) throw Error("network")',
    },
  ];
  engine.finishRun(feature.id, step.id, { content: '# Corrigé', questions: [], changedFiles: [] });
  return { engine, feature, step, attempt };
}
it('keeps runtime observations separate from conclusions, follows report revisions and later writes across steps', () => {
  const { feature, attempt } = fixture();
  const source = proofDossier(feature).sources.find((s) => s.kind === 'file')!;
  attempt.proofClaims = [
    {
      id: randomUUID(),
      text: 'L’erreur réseau est traitée.',
      proofIds: [source.id],
      verdict: 'supported',
      author: 'agent',
      at: 'now',
      reportRevision: attempt.revision!,
    },
  ];
  expect(proofDossier(feature).claims[0].stale).toBe(false);
  expect(proofDossier(feature).sources.find((s) => s.kind === 'file')?.content).toContain(
    'response.ok',
  );
  feature.steps.push({
    ...feature.steps[0],
    id: 'write',
    attempts: [
      {
        ...attempt,
        id: 'another',
        proofClaims: [],
        nativeActivity: [
          {
            ...attempt.nativeActivity![0],
            id: 'edit2',
            tool: 'edit',
            startedAt: '2026-10-23T00:00:03Z',
            finishedAt: '2026-10-23T00:00:04Z',
          },
        ],
      },
    ],
  });
  expect(proofDossier(feature).sources.find((s) => s.id === source.id)?.state).toBe('recheck');
  expect(proofDossier(feature).claims[0].stale).toBe(true);
  expect(proofDossierMarkdown(feature)).not.toContain(screenshot.data);
  expect(proofDossierMarkdown(feature)).toContain('pixels non inclus');
});
it('keeps superseded conclusions, catches missing evidence and blocks a current contradiction', () => {
  const { feature, attempt, step } = fixture();
  const id = randomUUID();
  attempt.proofClaims = [
    {
      id,
      text: 'Non vérifié',
      proofIds: [],
      verdict: 'unverified',
      author: 'agent',
      at: 'now',
      reportRevision: attempt.revision!,
    },
    {
      id: randomUUID(),
      supersedes: id,
      text: 'Le code contredit cette affirmation',
      proofIds: ['runtime:view1'],
      verdict: 'contradicted',
      author: 'human',
      at: 'now',
      reportRevision: attempt.revision!,
    },
  ];
  expect(proofDossier(feature).claims[0].stale).toBe(true);
  expect(approvalBlockers(feature, step, 'human').join()).toContain('contredite');
  attempt.proofClaims[1].proofIds = ['unknown'];
  expect(proofDossier(feature).claims[1].missingIds).toEqual(['unknown']);
  attempt.revision!++;
  expect(proofDossier(feature).claims.every((c) => c.stale)).toBe(true);
});
it('never accepts model supplied origins and does not expose image pixels in the proof listing', async () => {
  const { feature } = fixture();
  const tools = proofTools(
    {
      onSession() {},
      onEvent() {},
      getProofs: () => proofDossier(feature).sources,
      onProofClaim: async () => {
        throw Error('unused');
      },
    },
    new AbortController().signal,
  );
  const response = await tools[0].handler!({}, {} as never);
  expect(JSON.stringify(response)).not.toContain(screenshot.data);
  expect(JSON.stringify(response)).toContain('capture.png');
  await expect(
    tools[1].handler!(
      { text: 'x', proofIds: [], verdict: 'unverified', author: 'human' },
      {} as never,
    ),
  ).rejects.toThrow();
  expect(() =>
    parseMessage({
      type: 'saveProofClaim',
      featureId: feature.id,
      stepId: 'research',
      attemptId: 'a',
      requestId: randomUUID(),
      revision: 1,
      claim: { text: 'x', proofIds: [], verdict: 'unverified', author: 'agent' },
    }),
  ).toThrow();
});
