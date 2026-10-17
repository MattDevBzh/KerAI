import { describe, expect, it } from 'vitest';
import { AzureDevOps, type SecretStore } from '../src/host/AzureDevOps';
import { ticketQuery } from '../src/host/TicketQuery';
import { defaultTicketFilters, ticketContext } from '../src/shared/devopsTickets';
const config = { organization: 'org', project: 'Project', repository: 'repo', remote: 'origin' };
const secrets: SecretStore = {
  get: async () => 'fixture-token',
  store: async () => {},
  delete: async () => {},
};
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const detail = {
  id: 17,
  rev: 4,
  fields: {
    'System.TeamProject': 'Project',
    'System.Title': 'Bug',
    'System.WorkItemType': 'Défaut maison',
    'System.Description': '<p>Un détail</p>',
    'Microsoft.VSTS.TCM.ReproSteps': '<p>1. Ouvrir</p>',
    'Custom.Risk': 'À vérifier',
  },
};

describe('Azure project ticket queries and bounded source details', () => {
  it('escapes literal input, validates IDs, and combines only host-owned fields', () => {
    const query = ticketQuery(
      {
        ...defaultTicketFilters,
        query: "l'équipe' OR 1=1",
        assignment: 'identity',
        identity: "O'Neil",
        types: ['Défaut maison'],
        states: ['À qualifier'],
        tags: ['UX', 'keyboard'],
        areaPath: 'Project\\Web',
        iterationPath: 'Project\\Sprint 7',
      },
      301,
    );
    expect(query).toContain("[System.Title] CONTAINS 'l''équipe'' OR 1=1'");
    expect(query).toContain("[System.AssignedTo] = 'O''Neil'");
    expect(query).toContain("[System.WorkItemType] IN ('Défaut maison')");
    expect(query).toContain("[System.Tags] CONTAINS 'UX' AND [System.Tags] CONTAINS 'keyboard'");
    expect(query).toContain('[System.Id] < 301 ORDER BY [System.Id] DESC');
    expect(
      ticketQuery({ ...defaultTicketFilters, query: '#456', assignment: 'unassigned' }),
    ).toContain("[System.Id] = 456 AND [System.AssignedTo] = ''");
    expect(() => ticketQuery({ ...defaultTicketFilters, query: '#99999999999999999' })).toThrow(
      'Numéro',
    );
    expect(() => ticketQuery({ ...defaultTicketFilters, assignment: 'identity' })).toThrow();
    expect(() => ticketQuery({ ...defaultTicketFilters, tags: ['bad\nquery'] })).toThrow();
    expect(() => ticketQuery(defaultTicketFilters, -1)).toThrow('Curseur');
  });
  it('reads later pages of the entire project including custom types and unassigned work', async () => {
    const queries: string[] = [];
    const api = new AzureDevOps(config, secrets, async (url, init) => {
      if (String(url).includes('wiql')) {
        const query = JSON.parse(String(init?.body)).query as string;
        queries.push(query);
        return reply({
          workItems: query.includes('[System.Id] <')
            ? [{ id: 220 }]
            : Array.from({ length: 51 }, (_, index) => ({ id: 350 - index })),
        });
      }
      const ids = JSON.parse(String(init?.body)).ids as number[];
      return reply({
        value: ids.map((id) => ({
          id,
          fields: {
            'System.TeamProject': 'Project',
            'System.Title': `Ticket ${id}`,
            'System.WorkItemType': 'Demande personnalisée',
            'System.State': 'À trier',
          },
        })),
      });
    });
    const filters = { ...defaultTicketFilters, assignment: 'all' as const };
    const first = await api.searchTickets(filters);
    expect(first.tickets).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.nextBeforeId).toBe(301);
    const second = await api.searchTickets(filters, first.nextBeforeId);
    expect(second.tickets[0]).toMatchObject({
      id: 220,
      workItemType: 'Demande personnalisée',
      assignedTo: undefined,
    });
    expect(second.hasMore).toBe(false);
    expect(queries[1]).toContain('[System.Id] < 301');
    expect(queries.join('')).not.toContain('@Me');
  });
  it('keeps pagination progress when Azure omits unreadable IDs', async () => {
    const api = new AzureDevOps(config, secrets, async (url) =>
      String(url).includes('wiql')
        ? reply({ workItems: [{ id: 80 }, { id: 79 }, { id: 78 }] })
        : reply({ value: [{ id: 79, fields: { 'System.TeamProject': 'Project' } }] }),
    );
    expect(await api.searchTickets(defaultTicketFilters)).toMatchObject({
      nextBeforeId: 78,
      omitted: 2,
    });
  });
  it('loads custom type states, project paths and field labels, marking partial metadata', async () => {
    const api = new AzureDevOps(config, secrets, async (url) => {
      const path = String(url);
      if (path.includes('workitemtypes'))
        return reply({
          value: [
            { name: 'Incident maison', transitions: { '': [], Ouvert: [], 'En analyse': [] } },
          ],
        });
      if (path.includes('areas?'))
        return reply({ name: 'Project', children: [{ name: 'Produit', hasChildren: true }] });
      if (path.includes('iterations?')) return reply({}, 403);
      return reply({ value: [{ referenceName: 'Custom.Risk', name: 'Risque métier' }] });
    });
    const metadata = await api.ticketMetadata();
    expect(metadata.types).toEqual([{ name: 'Incident maison', states: ['Ouvert', 'En analyse'] }]);
    expect(metadata.areas).toEqual(['Project', 'Project\\Produit']);
    expect(metadata.fields[0].name).toBe('Risque métier');
    expect(metadata.notices).toHaveLength(2);
  });
  it('retains safe cross-project links and useful fields while blocking unsafe URL schemes', async () => {
    const api = new AzureDevOps(config, secrets, async (url) =>
      String(url).includes('/comments?')
        ? reply({
            comments: [
              {
                id: 1,
                text: '<p>Décision</p>',
                createdBy: { displayName: 'Alex' },
                createdDate: '2026-10-17T08:00:00Z',
                modifiedDate: '2026-10-17T09:00:00Z',
              },
            ],
          })
        : reply({
            ...detail,
            relations: [
              {
                rel: 'System.LinkTypes.Hierarchy-Reverse',
                url: 'https://dev.azure.com/other-org/Other/_apis/wit/workitems/99',
              },
              {
                rel: 'AttachedFile',
                url: 'https://dev.azure.com/org/Project/_apis/wit/attachments/abc',
                attributes: { name: 'capture.png' },
              },
              { rel: 'Hyperlink', url: 'javascript:alert(1)', attributes: { name: 'Unsafe' } },
              {
                rel: 'System.LinkTypes.Hierarchy-Reverse',
                url: 'javascript://dev.azure.com/_apis/wit/workitems/1',
              },
              {
                rel: 'System.LinkTypes.Hierarchy-Reverse',
                url: 'http://dev.azure.com/org/project/_apis/wit/workitems/1',
              },
              {
                rel: 'System.LinkTypes.Hierarchy-Reverse',
                url: 'https://user:pass@dev.azure.com/org/project/_apis/wit/workitems/1',
              },
            ],
          }),
    );
    const ticket = await api.ticketDetail(17, {
      types: [],
      areas: [],
      iterations: [],
      notices: [],
      fields: [{ referenceName: 'Custom.Risk', name: 'Risque métier' }],
    });
    expect(ticket.extraFields).toContainEqual({
      referenceName: 'Custom.Risk',
      name: 'Risque métier',
      value: 'À vérifier',
    });
    expect(ticket.relations?.[0].url).toBe(
      'https://dev.azure.com/other-org/Other/_workitems/edit/99',
    );
    expect(ticket.relations?.[1].kind).toBe('attachment');
    for (const relation of ticket.relations!.slice(2)) expect(relation.url).toBeUndefined();
    expect(ticket.comments[0]).toMatchObject({
      author: 'Alex',
      createdDate: '2026-10-17T08:00:00Z',
      modifiedDate: '2026-10-17T09:00:00Z',
    });
    const context = ticketContext(ticket, [1], 'Priorité à la fiabilité.');
    expect(context).toContain('1. Ouvrir');
    expect(context).toContain('Décision');
    expect(context).toContain('le contenu des pièces jointes');
    expect(context).not.toContain('<p>');
  });
  it('distinguishes unavailable comments from zero comments and retains pages already read', async () => {
    let calls = 0;
    const api = new AzureDevOps(config, secrets, async (url) => {
      if (!String(url).includes('/comments?')) return reply(detail);
      calls++;
      return calls === 1
        ? reply({ comments: [{ id: 8, text: 'Déjà lu' }], continuationToken: 'next' })
        : reply({}, 403);
    });
    const ticket = await api.ticketDetail(17);
    expect(ticket.comments).toHaveLength(1);
    expect(ticket.commentsError).toContain('refuse');
    expect(ticket.commentsLoaded).toBe(false);
    expect(ticket.commentsTruncated).toBe(true);
    expect(ticket.detailsLoaded).toBe(true);
  });
  it('resolves project GUIDs before comparing work item ownership and rejects foreign projects', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const api = new AzureDevOps({ ...config, project: id }, secrets, async (url) => {
      if (String(url).includes('/projects/')) return reply({ id, name: 'Project' });
      if (String(url).includes('/comments?')) return reply({ comments: [] });
      return reply(detail);
    });
    expect((await api.ticketDetail(17)).revision).toBe(4);
    const foreign = new AzureDevOps(config, secrets, async () =>
      reply({ ...detail, fields: { ...detail.fields, 'System.TeamProject': 'Elsewhere' } }),
    );
    await expect(foreign.ticketDetail(17)).rejects.toThrow('autre projet');
  });
  it('bounds imported content and keeps the user instructions after explicit truncation', async () => {
    const ticket = {
      id: 3,
      title: 'Bounded',
      state: 'New',
      url: 'https://dev.azure.com/org/Project/_workitems/edit/3',
      description: 'd'.repeat(100000),
      acceptanceCriteria: 'c'.repeat(100000),
      comments: [],
    };
    const context = ticketContext(ticket, [], 'Ne pas perdre cette consigne.');
    expect(context.length).toBeLessThanOrEqual(180000);
    expect(context).toContain('Copie tronquée');
    expect(context).toMatch(/Ne pas perdre cette consigne\.$/);
  });
});
