import { describe, expect, it } from 'vitest';
import { AzureDevOps, detectAzureRemote, type SecretStore } from '../src/host/AzureDevOps';
import { devOpsPlainText } from '../src/shared/devopsText';
const config = {
  organization: 'my-org',
  project: 'My Project',
  repository: 'repo',
  remote: 'origin',
};
function secrets(): SecretStore {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k),
    store: async (k, v) => {
      store.set(k, v);
    },
    delete: async (k) => {
      store.delete(k);
    },
  };
}
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function metadataDashboard(fields: Record<string, unknown>, pr: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = new AzureDevOps(config, secrets(), async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('connectionData'))
      return reply({ authenticatedUser: { id: '11111111-1111-4111-8111-111111111111' } });
    if (String(url).includes('/wiql')) return reply({ workItems: [{ id: 42 }] });
    if (String(url).includes('workitemsbatch')) return reply({ value: [{ id: 42, fields }] });
    return reply({ value: [{ pullRequestId: 7, title: 'PR', status: 'active', ...pr }] });
  });
  await api.authenticate('secret');
  return { data: await api.dashboard(), calls };
}
describe('Azure DevOps API boundary', () => {
  it('detects modern HTTPS, SSH, legacy URLs and rejects foreign/credential remotes', () => {
    expect(detectAzureRemote('git@ssh.dev.azure.com:v3/my-org/My%20Project/repo')).toEqual({
      ...config,
      remote: undefined,
    });
    expect(detectAzureRemote('https://my-org@dev.azure.com/my-org/My%20Project/_git/repo')).toEqual(
      { organization: 'my-org', project: 'My Project', repository: 'repo' },
    );
    expect(
      detectAzureRemote('https://my-org.visualstudio.com/DefaultCollection/My%20Project/_git/repo'),
    ).toEqual({ organization: 'my-org', project: 'My Project', repository: 'repo' });
    expect(detectAzureRemote('https://github.com/owner/repo')).toBeUndefined();
    expect(
      detectAzureRemote('https://user:secret@dev.azure.com/my-org/project/_git/repo'),
    ).toBeUndefined();
  });
  it('queries @Me and paginates created PRs with authenticated identity, limits result and keeps token in header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const api = new AzureDevOps(config, secrets(), async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('connectionData'))
        return reply({
          authenticatedUser: {
            id: '11111111-1111-4111-8111-111111111111',
            providerDisplayName: 'Matt',
          },
        });
      if (String(url).includes('/wiql')) return reply({ workItems: [{ id: 42 }] });
      if (String(url).includes('workitemsbatch'))
        return reply({
          value: [
            {
              id: 42,
              fields: {
                'System.Title': 'Ticket',
                'System.State': 'Active',
                'System.Description': '<p>Hello</p>',
              },
            },
          ],
        });
      if (String(url).includes('$skip=0'))
        return reply({
          value: Array.from({ length: 50 }, (_, i) => ({
            pullRequestId: i + 1,
            title: 'PR',
            status: 'active',
            isDraft: i === 0,
          })),
        });
      return reply({ value: [] });
    });
    await api.authenticate('private-pat');
    const data = await api.dashboard();
    expect(data.account).toBe('Matt');
    expect(data.tickets[0].url).toContain('/My%20Project/_workitems/edit/42');
    expect(data.pullRequests).toHaveLength(50);
    expect(data.pullRequests[0].isDraft).toBe(true);
    expect(data.pullRequests[1].isDraft).toBe(false);
    expect(calls.some((c) => c.url.includes('$skip=50'))).toBe(true);
    expect(calls).toHaveLength(5);
    expect(calls.find((c) => c.url.includes('wiql'))?.init?.body).toContain('@Me');
    expect(JSON.stringify(data)).not.toContain('private-pat');
    for (const call of calls) {
      expect(call.url).not.toContain('private-pat');
      expect(call.init?.redirect).toBe('error');
      expect(call.init?.signal).toBeDefined();
    }
  });
  it('maps ticket and PR metadata from the existing requests without forwarding identity details', async () => {
    const created = '2026-10-12T16:28:08.8900118Z';
    const changed = '2026-10-13T10:30:00+02:00';
    const identity = {
      id: 'reviewer-1',
      displayName: ' Matt ',
      uniqueName: 'private@example.com',
      imageUrl: 'https://private.example/avatar',
      url: 'https://private.example/identity',
    };
    const { data, calls } = await metadataDashboard(
      {
        'System.Title': 'Ticket',
        'System.State': 'Active',
        'System.WorkItemType': ' User Story ',
        'System.AssignedTo': identity,
        'System.IterationPath': 'My Project\\Sprint 2',
        'System.AreaPath': 'My Project\\Product',
        'System.Tags': ' front ; urgent;front;; urgent ;',
        'System.CreatedDate': created,
        'System.ChangedDate': changed,
      },
      {
        description: ' Description de la PR ',
        creationDate: created,
        closedDate: changed,
        createdBy: identity,
        mergeStatus: 'conflicts',
        reviewers: [
          { ...identity, vote: 10, isRequired: true },
          { id: 'reviewer-2', displayName: 'Sam', vote: 0, isRequired: false },
          { id: 'reviewer-3', displayName: 'Future vote', vote: 12 },
        ],
      },
    );
    expect(data.tickets[0]).toMatchObject({
      id: 42,
      workItemType: 'User Story',
      assignedTo: 'Matt',
      iterationPath: 'My Project\\Sprint 2',
      areaPath: 'My Project\\Product',
      tags: ['front', 'urgent'],
      createdDate: created,
      changedDate: changed,
      comments: [],
    });
    expect(data.pullRequests[0]).toMatchObject({
      description: 'Description de la PR',
      creationDate: created,
      closedDate: changed,
      createdBy: 'Matt',
      mergeStatus: 'conflicts',
      reviewers: [
        { id: 'reviewer-1', displayName: 'Matt', vote: 10, isRequired: true },
        { id: 'reviewer-2', displayName: 'Sam', vote: 0, isRequired: false },
        { id: 'reviewer-3', displayName: 'Future vote', vote: 12 },
      ],
    });
    expect(JSON.stringify(data)).not.toContain('private@example.com');
    expect(JSON.stringify(data)).not.toContain('private.example');
    expect(calls.map((call) => call.url)).toEqual([
      'https://dev.azure.com/my-org/_apis/connectionData?api-version=7.1-preview.1',
      'https://dev.azure.com/my-org/My%20Project/_apis/wit/wiql?$top=201&api-version=7.1',
      'https://dev.azure.com/my-org/My%20Project/_apis/wit/workitemsbatch?api-version=7.1',
      'https://dev.azure.com/my-org/My%20Project/_apis/git/repositories/repo/pullrequests?searchCriteria.creatorId=11111111-1111-4111-8111-111111111111&searchCriteria.status=all&$top=50&$skip=0&api-version=7.1',
    ]);
    expect(calls.map((call) => call.init?.method)).toEqual(['GET', 'POST', 'POST', 'GET']);
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      ids: [42],
      fields: [
        'System.Id',
        'System.Title',
        'System.State',
        'System.WorkItemType',
        'System.AssignedTo',
        'System.IterationPath',
        'System.AreaPath',
        'System.Tags',
        'System.CreatedDate',
        'System.ChangedDate',
        'System.Description',
        'Microsoft.VSTS.Common.AcceptanceCriteria',
      ],
      errorPolicy: 'Omit',
    });
  });
  it('preserves legacy assignments and distinguishes empty lists from missing metadata', async () => {
    const { data } = await metadataDashboard(
      { 'System.AssignedTo': ' Matt historique ', 'System.Tags': ' ;; ' },
      { reviewers: [] },
    );
    expect(data.tickets[0].assignedTo).toBe('Matt historique');
    expect(data.tickets[0].tags).toEqual([]);
    expect(data.tickets[0].workItemType).toBeUndefined();
    expect(data.tickets[0].createdDate).toBeUndefined();
    expect(data.pullRequests[0].reviewers).toEqual([]);
    expect(data.pullRequests[0].creationDate).toBeUndefined();
    expect(data.pullRequests[0].description).toBeUndefined();
    expect(data.pullRequests[0].createdBy).toBeUndefined();
  });
  it('retains the 200-item ticket and PR limits with the enriched payloads', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const api = new AzureDevOps(config, secrets(), async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('connectionData'))
        return reply({ authenticatedUser: { id: '11111111-1111-4111-8111-111111111111' } });
      if (String(url).includes('/wiql'))
        return reply({ workItems: Array.from({ length: 201 }, (_, i) => ({ id: i + 1 })) });
      if (String(url).includes('workitemsbatch')) {
        const ids: number[] = JSON.parse(String(init?.body)).ids;
        expect(ids).toHaveLength(200);
        expect(ids[199]).toBe(200);
        return reply({
          value: ids.map((id) => ({
            id,
            fields: { 'System.Title': `Ticket ${id}`, 'System.WorkItemType': 'Task' },
          })),
        });
      }
      const skip = Number(new URL(String(url)).searchParams.get('$skip'));
      return reply({
        value: Array.from({ length: 50 }, (_, i) => ({
          pullRequestId: skip + i + 1,
          title: 'PR',
          status: 'active',
          createdBy: { displayName: 'Matt' },
        })),
      });
    });
    await api.authenticate('secret');
    const data = await api.dashboard();
    expect(data.tickets).toHaveLength(200);
    expect(data.pullRequests).toHaveLength(200);
    expect(data.pullRequests[199].id).toBe(200);
    expect(data.truncated).toBe(true);
    expect(calls).toHaveLength(7);
    expect(
      calls
        .filter((call) => call.url.includes('/pullrequests'))
        .map((call) => new URL(call.url).searchParams.get('$skip')),
    ).toEqual(['0', '50', '100', '150']);
  });
  it.each([undefined, null, 42, false, [], {}, { displayName: 12 }])(
    'ignores malformed optional metadata (%j) while preserving the dashboard',
    async (value) => {
      const { data } = await metadataDashboard(
        {
          'System.Title': 'Ticket valide',
          'System.WorkItemType': value,
          'System.AssignedTo': value,
          'System.IterationPath': value,
          'System.AreaPath': value,
          'System.Tags': value,
          'System.CreatedDate': value,
          'System.ChangedDate': value,
        },
        {
          description: value,
          createdBy: value,
          creationDate: value,
          closedDate: value,
          mergeStatus: value,
          reviewers: value,
        },
      );
      const ticket = data.tickets[0];
      expect(ticket.title).toBe('Ticket valide');
      for (const key of [
        'workItemType',
        'assignedTo',
        'iterationPath',
        'areaPath',
        'tags',
        'createdDate',
        'changedDate',
      ] as const)
        expect(ticket[key]).toBeUndefined();
      const pr = data.pullRequests[0];
      expect(pr.title).toBe('PR');
      for (const key of [
        'description',
        'createdBy',
        'creationDate',
        'closedDate',
        'mergeStatus',
      ] as const)
        expect(pr[key]).toBeUndefined();
      expect(pr.reviewers).toEqual(Array.isArray(value) ? [] : undefined);
    },
  );
  it.each([
    '',
    'today',
    '2026-02-30T12:00:00Z',
    '2026-10-13',
    '2026-10-13T12:00:00',
    '2026-10-13T25:00:00Z',
    '2026-10-13T12:00:00+99:99',
  ])('does not invent a date from an invalid timestamp (%s)', async (date) => {
    const { data } = await metadataDashboard(
      { 'System.CreatedDate': date, 'System.ChangedDate': date },
      { creationDate: date, closedDate: date },
    );
    expect(data.tickets[0].createdDate).toBeUndefined();
    expect(data.tickets[0].changedDate).toBeUndefined();
    expect(data.pullRequests[0].creationDate).toBeUndefined();
    expect(data.pullRequests[0].closedDate).toBeUndefined();
  });
  it('bounds metadata and filters malformed reviewer entries without turning votes into approvals', async () => {
    const { data } = await metadataDashboard(
      {
        'System.WorkItemType': 'x'.repeat(1001),
        'System.AssignedTo': { displayName: 'x'.repeat(1001) },
        'System.Tags': ['x'.repeat(201), ...Array.from({ length: 70 }, (_, i) => `tag-${i}`)].join(
          ';',
        ),
      },
      {
        description: 'x'.repeat(100001),
        createdBy: { displayName: 'x'.repeat(1001) },
        reviewers: [
          null,
          false,
          'bad',
          [],
          {},
          { id: 'bad', displayName: 'bad', vote: '10' },
          { id: 'bad', displayName: 'bad', vote: 1.5 },
          { id: 'bad', displayName: 'bad', vote: 32768 },
          { id: 42, displayName: 'bad', vote: 10 },
          { id: 'bad', displayName: {}, vote: 10 },
          ...Array.from({ length: 120 }, (_, i) => ({
            id: i === 0 ? 'x'.repeat(257) : `reviewer-${i}`,
            displayName: 'x'.repeat(1001),
            vote: [-10, -5, 0, 5, 10][i % 5],
            isRequired: 'true',
          })),
        ],
      },
    );
    expect(data.tickets[0].workItemType).toHaveLength(1000);
    expect(data.tickets[0].assignedTo).toHaveLength(1000);
    expect(data.tickets[0].tags).toHaveLength(50);
    expect(data.tickets[0].tags?.[0]).toHaveLength(200);
    expect(data.pullRequests[0].description).toHaveLength(100000);
    expect(data.pullRequests[0].createdBy).toHaveLength(1000);
    expect(data.pullRequests[0].reviewers).toHaveLength(90);
    expect(data.pullRequests[0].reviewers?.[0].id).toHaveLength(256);
    expect(data.pullRequests[0].reviewers?.[0].displayName).toHaveLength(1000);
    expect(data.pullRequests[0].reviewers?.[0].vote).toBe(-10);
    expect(data.pullRequests[0].reviewers?.[0]).not.toHaveProperty('isRequired');
    expect(data.pullRequests[0]).not.toHaveProperty('canMerge');
  });
  it('follows comments continuation tokens and exposes bounded truncation', async () => {
    let count = 0;
    const api = new AzureDevOps(config, secrets(), async (url) => {
      count++;
      if (count > 1) expect(String(url)).toContain('continuationToken=next');
      return reply({
        comments: [{ id: count, text: 'comment', createdBy: { displayName: 'Matt' } }],
        continuationToken: 'next',
      });
    });
    await api.authenticate('secret');
    const result = await api.comments(42);
    expect(count).toBe(4);
    expect(result.comments).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });
  it('creates only draft PR with explicit fields and optional ticket association', async () => {
    let body: Record<string, unknown> = {};
    const api = new AzureDevOps(config, secrets(), async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return reply({ pullRequestId: 7, title: 'Title', status: 'active', isDraft: true });
    });
    await api.authenticate('secret');
    const pr = await api.createPullRequest({
      branch: 'feature/a',
      target: 'main',
      title: 'Title',
      description: 'Review me',
      ticketId: 42,
    });
    expect(body).toEqual({
      sourceRefName: 'refs/heads/feature/a',
      targetRefName: 'refs/heads/main',
      title: 'Title',
      description: 'Review me',
      isDraft: true,
      workItemRefs: [{ id: '42' }],
    });
    expect(pr.url).toContain('/pullrequest/7');
    expect(pr.isDraft).toBe(true);
    expect(body).not.toHaveProperty('autoCompleteSetBy');
  });
  it('does not return error response bodies, auth tokens or redirects to UI', async () => {
    const api = new AzureDevOps(config, secrets(), async () =>
      reply({ message: 'private-pat' }, 401),
    );
    await api.authenticate('private-pat');
    await expect(api.dashboard()).rejects.toThrow('refuse');
    await api.disconnect();
    await expect(api.dashboard()).rejects.toThrow('Connecte');
  });
  it('rejects oversized streaming responses before parsing', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8_000_001));
      },
      cancel() {
        cancelled = true;
      },
    });
    const api = new AzureDevOps(config, secrets(), async () => new Response(stream));
    await api.authenticate('secret');
    await expect(api.dashboard()).rejects.toThrow('volumineuse');
    expect(cancelled).toBe(true);
  });
  it('turns untrusted HTML into readable inert text', () => {
    expect(
      devOpsPlainText(
        '<div>Bonjour &amp; merci<br><b>Critère</b></div><ul><li>Valider &#233;</li></ul><script>alert(1)</script><img src=x onerror=alert(2)>',
      ),
    ).toBe('Bonjour & merci\nCritère\n\n• Valider é');
    expect(devOpsPlainText('&lt;img src=x onerror=alert(1)&gt;')).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
