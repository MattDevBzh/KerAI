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
    expect(calls.find((c) => c.url.includes('wiql'))?.init?.body).toContain('@Me');
    expect(JSON.stringify(data)).not.toContain('private-pat');
    for (const call of calls) {
      expect(call.url).not.toContain('private-pat');
      expect(call.init?.redirect).toBe('error');
      expect(call.init?.signal).toBeDefined();
    }
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
