import { expect, it, vi } from 'vitest';
import { parsePrAdministrationProposal } from '../src/host/PrAdministrationProposal';
import { writePrAdministration } from '../src/host/PrAdministrationWriter';
import { defaultPrAdministrationSettings } from '../src/shared/prAdministration';
import type { AgentAdapter, RunInput } from '../src/shared/types';
import { demoState } from '../webview/demo';

const valid = {
  summary: 'Explication du changement',
  comments: [
    { blockId: 'block-1', rule: '', explanation: 'Le cas vide est traité.', reference: '' },
  ],
};
function fixture(replies: string[], abort = new AbortController()) {
  const run = vi.fn(async (_input: RunInput) => ({
    content: replies.shift()!,
    changedFiles: [],
    questions: [],
    model: 'chosen',
  }));
  const input: Parameters<typeof writePrAdministration>[0] = {
    feature: demoState.features[0],
    agent: demoState.agents[0],
    adapter: { run } as unknown as AgentAdapter,
    settings: demoState.settings,
    workspacePath: '/session',
    signal: abort.signal,
    administration: defaultPrAdministrationSettings,
    devops: {
      authenticated: true,
      busy: false,
      notices: [],
      tickets: [],
      pullRequests: [],
      links: [],
      history: [],
    },
    snapshot: {
      id: 42,
      url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/42',
      title: 'PR',
      description: '',
      sourceBranch: 'refs/heads/fix',
      targetBranch: 'refs/heads/main',
      sourceHead: 'a'.repeat(40),
      targetHead: 'b'.repeat(40),
      baseHead: 'b'.repeat(40),
      iteration: 1,
      status: 'active',
    },
    blocks: [
      {
        id: 'block-1',
        stableKey: 'stable',
        path: 'app.ts',
        side: 'right',
        startLine: 1,
        endLine: 2,
        changeTrackingId: 1,
        code: '+ if (!value) return;',
      },
    ],
  };
  return { input, run };
}
it('normalizes optional empty text without changing explanations, references or action targets', () => {
  const value = {
    ...valid,
    title: null,
    description: '  ',
    comments: [{ blockId: 'block-1', explanation: valid.comments[0].explanation, rule: null }],
  };
  expect(parsePrAdministrationProposal('```json\n' + JSON.stringify(value) + '\n```')).toEqual(
    valid,
  );
  expect(parsePrAdministrationProposal('{"summary":"Rien à proposer","comments":null}')).toEqual({
    summary: 'Rien à proposer',
    comments: [],
  });
  expect(parsePrAdministrationProposal('{"summary":"Rien à proposer"}').comments).toEqual([]);
});
it.each([
  [{ ...valid, comments: [{ explanation: 'Texte' }] }, 'comments.0.blockId'],
  [{ ...valid, comments: [{ ...valid.comments[0], explanation: '' }] }, 'comments.0.explanation'],
  [{ ...valid, title: 'x'.repeat(201) }, 'title : limite de 200'],
  [{ ...valid, comments: Array(51).fill(valid.comments[0]) }, 'comments : limite de 50'],
  [{ ...valid, comments: {} }, 'comments :'],
  [{ ...valid, secret_key_do_not_echo: 'private_value' }, 'champ supplémentaire'],
])(
  'rejects invalid content with field diagnostics, without truncating or echoing data',
  (value, expected) => {
    expect(() => parsePrAdministrationProposal(JSON.stringify(value))).toThrow(expected);
    try {
      parsePrAdministrationProposal(JSON.stringify(value));
    } catch (error) {
      expect(String(error)).not.toContain('private_value');
      expect(String(error)).not.toContain('secret_key_do_not_echo');
    }
  },
);
it('normalizes without spending another model call', async () => {
  const f = fixture([JSON.stringify({ ...valid, title: null })]);
  expect((await writePrAdministration(f.input)).proposal).toEqual(valid);
  expect(f.run).toHaveBeenCalledTimes(1);
});
it('repairs a malformed response once with the original scope and no tool access', async () => {
  const f = fixture(['{"summary":', JSON.stringify(valid)]);
  expect((await writePrAdministration(f.input)).proposal).toEqual(valid);
  expect(f.run).toHaveBeenCalledTimes(2);
  const retry = f.run.mock.calls[1][0];
  expect(retry.preparedPrompt).toContain('Réponse JSON invalide ou tronquée');
  expect(retry.preparedPrompt).toContain('B1');
  expect(retry.preparedPrompt).not.toContain('stable');
  expect(retry.agent.tools).toEqual([]);
  expect(retry.settings.mcpServers).toEqual([]);
});
it('stops after one repair and names the remaining invalid field', async () => {
  const invalid = JSON.stringify({
    ...valid,
    comments: [{ blockId: 'block-1', explanation: 123 }],
  });
  const f = fixture([invalid, invalid]);
  await expect(writePrAdministration(f.input)).rejects.toThrow(
    /comments.0.explanation.*Aucune modification publiée/,
  );
  expect(f.run).toHaveBeenCalledTimes(2);
});
it('does not retry a provider failure or cancellation', async () => {
  const f = fixture([]);
  f.run.mockRejectedValueOnce(new Error('Provider unavailable'));
  await expect(writePrAdministration(f.input)).rejects.toThrow('Provider unavailable');
  expect(f.run).toHaveBeenCalledTimes(1);
  const abort = new AbortController(),
    cancelled = fixture([], abort);
  cancelled.run.mockImplementationOnce(async () => {
    abort.abort();
    return { content: '{}', changedFiles: [], questions: [], model: 'chosen' };
  });
  await expect(writePrAdministration(cancelled.input)).rejects.toThrow(/arrêtée/);
  expect(cancelled.run).toHaveBeenCalledTimes(1);
});

it('exposes short snapshot-local block references and resolves them to the verified host coordinates', async () => {
  const proposal = { ...valid, comments: [{ ...valid.comments[0], blockId: 'B2' }] };
  const f = fixture([JSON.stringify(proposal)]);
  f.input.blocks.push({
    ...f.input.blocks[0],
    id: 'verified-second',
    stableKey: 'second-key',
    path: 'other.ts',
    side: 'left',
    startLine: 7,
    endLine: 9,
    code: '-old',
  });
  const result = await writePrAdministration(f.input);
  expect(result.proposal.comments[0].blockId).toBe('verified-second');
  const prompt = f.run.mock.calls[0][0].preparedPrompt!;
  expect(prompt).toContain('"id":"B2","path":"other.ts","side":"left","startLine":7,"endLine":9');
  expect(prompt).not.toContain('verified-second');
  expect(prompt).not.toContain('second-key');
  expect(f.run).toHaveBeenCalledTimes(1);
});
it.each(['F04', 'app.ts:1-2', 'B0', 'B99', 'invented-hash'])(
  'repairs invalid block reference %s before returning a proposal',
  async (blockId) => {
    const invalid = { ...valid, comments: [{ ...valid.comments[0], blockId }] };
    const repaired = { ...valid, comments: [{ ...valid.comments[0], blockId: 'B1' }] };
    const f = fixture([JSON.stringify(invalid), JSON.stringify(repaired)]);
    expect((await writePrAdministration(f.input)).proposal).toEqual(valid);
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.run.mock.calls[1][0].preparedPrompt).toContain('comments.0.blockId');
  },
);
it('refuses an unresolved block after one repair instead of guessing the only available target', async () => {
  const invalid = JSON.stringify({
    ...valid,
    comments: [{ ...valid.comments[0], blockId: 'missing' }],
  });
  const f = fixture([invalid, invalid]);
  await expect(writePrAdministration(f.input)).rejects.toThrow(
    /comments.0.blockId.*bloc absent.*Aucune modification publiée/,
  );
  expect(f.run).toHaveBeenCalledTimes(2);
});
it('allows the agent to explain an absent range without creating an annotation', async () => {
  const f = fixture([
    JSON.stringify({ ...valid, comments: [{ ...valid.comments[0], blockId: 'missing' }] }),
    JSON.stringify({
      summary: 'La plage du bilan ne figure pas dans le diff publié.',
      comments: [],
    }),
  ]);
  expect((await writePrAdministration(f.input)).proposal).toEqual({
    summary: 'La plage du bilan ne figure pas dans le diff publié.',
    comments: [],
  });
});
it.each(['permissions', 'rules', 'duplicates'])(
  'also repairs invalid %s in the same bounded correction flow',
  async (kind) => {
    const invalid = structuredClone(valid);
    if (kind === 'permissions') Object.assign(invalid, { title: 'Unauthorized title' });
    if (kind === 'rules') invalid.comments[0].rule = 'ABSENT-99';
    if (kind === 'duplicates') invalid.comments.push({ ...invalid.comments[0], blockId: 'B1' });
    const f = fixture([JSON.stringify(invalid), JSON.stringify(valid)]);
    expect((await writePrAdministration(f.input)).proposal).toEqual(valid);
    expect(f.run).toHaveBeenCalledTimes(2);
  },
);
