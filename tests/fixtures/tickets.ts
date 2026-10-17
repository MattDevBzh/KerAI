import type { Page } from '@playwright/test';
import type { ClientMessage, DevOpsState, DevOpsTicket } from '../../src/shared/types';
import {
  defaultTicketFilters,
  type TicketPreparation,
  type TicketTarget,
} from '../../src/shared/devopsTickets';
import { demoState } from '../../webview/demo';

export const ticketTargets: TicketTarget[] = [
  {
    id: 'cockpit',
    name: 'Feature Studio',
    path: '/projets/FeatureStudio',
    branch: 'main',
    canIsolate: true,
    dirtyCount: 3,
    branches: [
      { name: 'main', ref: 'refs/heads/main', commit: 'a'.repeat(40) },
      { name: 'release/1.11', ref: 'refs/heads/release/1.11', commit: 'b'.repeat(40) },
    ],
  },
  {
    id: 'portal',
    name: 'Portail client',
    path: '/projets/PortailClient',
    branch: 'develop',
    canIsolate: true,
    dirtyCount: 0,
    branches: [{ name: 'develop', ref: 'refs/heads/develop', commit: 'c'.repeat(40) }],
  },
];
export const ticketDetailFixture: DevOpsTicket = {
  id: 1042,
  title: 'Préparer une session à partir d’un ticket',
  state: 'Prêt à développer',
  workItemType: 'User Story',
  assignedTo: 'Matt',
  url: 'https://dev.azure.com/atelier/Studio/_workitems/edit/1042',
  areaPath: 'Studio\\Cockpit',
  iterationPath: 'Studio\\Sprint 24',
  tags: ['UX', 'navigation'],
  changedDate: '2026-10-17T08:45:00Z',
  createdDate: '2026-10-14T11:00:00Z',
  revision: 8,
  fetchedAt: '2026-10-17T09:05:00Z',
  snapshotId: '22222222-2222-4222-8222-222222222222',
  detailsLoaded: true,
  description:
    '<p>Depuis la liste des tickets, préparer une nouvelle session avec un contexte clair et un dépôt de travail explicite.</p><p>Le choix de l’équipe et le lancement restent entre les mains de l’utilisateur.</p><img src=x onerror="window.ticketInjected=true"><script>window.ticketInjected=true</script>',
  acceptanceCriteria:
    '<ul><li>Rechercher parmi tous les types de tickets du projet.</li><li>Choisir le dépôt et le mode de travail avant la création.</li><li>Relire le contexte exact transmis aux agents.</li><li>Retrouver la session existante sans créer de doublon.</li></ul>',
  extraFields: [
    { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priorité', value: '2' },
    {
      referenceName: 'Custom.CustomerValue',
      name: 'Valeur utilisateur',
      value: 'Réduire le temps de préparation et conserver la décision métier.',
    },
  ],
  commentsLoaded: true,
  comments: [
    {
      id: 71,
      author: 'Camille',
      createdDate: '2026-10-16T14:30:00Z',
      text: '<p>Décision : les commentaires sont sélectionnables. Aucun agent ne démarre avant le choix de l’équipe.</p>',
    },
    {
      id: 69,
      author: 'Alex',
      createdDate: '2026-10-15T08:00:00Z',
      modifiedDate: '2026-10-15T09:00:00Z',
      text: '<p>Ancienne piste : démarrer automatiquement avec l’équipe habituelle. Cette piste est abandonnée.</p>',
    },
  ],
  relations: [
    {
      kind: 'ticket',
      name: 'Parent · #990 — Intégration Azure DevOps',
      url: 'https://dev.azure.com/atelier/Studio/_workitems/edit/990',
    },
    {
      kind: 'pr',
      name: 'PR #84 — Contrats de préparation',
      url: 'https://dev.azure.com/atelier/Studio/_git/cockpit/pullrequest/84',
    },
    {
      kind: 'attachment',
      name: 'parcours-ticket.png',
      url: 'https://dev.azure.com/atelier/Studio/_apis/wit/attachments/fixture',
    },
  ],
  detailNotices: [],
};
export const ticketRows: DevOpsTicket[] = [
  ticketDetailFixture,
  {
    id: 1038,
    title: 'Conserver le focus après la fermeture du détail',
    state: 'À qualifier',
    workItemType: 'Bug',
    assignedTo: 'Camille',
    tags: ['accessibilité'],
    url: 'https://dev.azure.com/atelier/Studio/_workitems/edit/1038',
    changedDate: '2026-10-16T15:10:00Z',
    description: '',
    acceptanceCriteria: '',
    comments: [],
  },
  {
    id: 1031,
    title: 'Ajouter le filtre sur les équipes transverses',
    state: 'Nouveau',
    workItemType: 'Demande métier',
    tags: ['triage'],
    url: 'https://dev.azure.com/atelier/Studio/_workitems/edit/1031',
    changedDate: '2026-10-16T10:15:00Z',
    description: '',
    acceptanceCriteria: '',
    comments: [],
  },
  {
    id: 1024,
    title: 'Relier les sessions existantes aux tickets du projet',
    state: 'En cours',
    workItemType: 'Task',
    assignedTo: 'Matt',
    tags: ['intégration'],
    url: 'https://dev.azure.com/atelier/Studio/_workitems/edit/1024',
    changedDate: '2026-10-15T09:00:00Z',
    description: '',
    acceptanceCriteria: '',
    comments: [],
  },
  {
    id: 1018,
    title: 'Rendre lisibles les critères d’acceptation des bugs',
    state: 'Prêt à développer',
    workItemType: 'Bug',
    assignedTo: 'Alex',
    tags: ['qualité'],
    url: 'https://dev.azure.com/atelier/Studio/_workitems/edit/1018',
    changedDate: '2026-10-14T14:30:00Z',
    description: '',
    acceptanceCriteria: '',
    comments: [],
  },
];
export const ticketPreparationFixture: TicketPreparation = {
  ticketId: 1042,
  sourceProjectKey: 'atelier/studio',
  snapshotId: ticketDetailFixture.snapshotId!,
  targets: ticketTargets,
};
export const ticketsState: DevOpsState = {
  config: { organization: 'atelier', project: 'Studio', repository: 'cockpit', remote: 'origin' },
  authenticated: true,
  account: 'Matt',
  busy: false,
  notices: [],
  history: [],
  tickets: ticketRows,
  pullRequests: [],
  links: [
    {
      featureId: demoState.features[0].id,
      ticketId: 1024,
      projectKey: 'atelier/studio/cockpit',
      ticketProjectKey: 'atelier/studio',
      targetProjectId: 'cockpit',
      pullRequestIds: [],
    },
  ],
  ticketFilters: { ...defaultTicketFilters, assignment: 'all' },
  ticketSearch: {
    filters: { ...defaultTicketFilters, assignment: 'all' },
    tickets: ticketRows,
    searchedAt: '2026-10-17T09:00:00Z',
    hasMore: true,
    limitReached: false,
    omitted: 0,
  },
  ticketMetadata: {
    types: [
      { name: 'User Story', states: ['Nouveau', 'Prêt à développer', 'En cours'] },
      { name: 'Bug', states: ['À qualifier', 'Prêt à développer'] },
      { name: 'Task', states: ['Nouveau', 'En cours'] },
      { name: 'Demande métier', states: ['Nouveau', 'À qualifier'] },
    ],
    areas: ['Studio', 'Studio\\Cockpit'],
    iterations: ['Studio', 'Studio\\Sprint 24'],
    fields: [],
    notices: [],
  },
};
/** Read-only browser host fixture; no Azure, Git, agent or credential calls. Reusable for screenshots. */
export async function installTicketsHost(page: Page, initial = ticketsState) {
  await page.addInitScript(
    ({ devops, state, detail, targets }) => {
      const messages: ClientMessage[] = [];
      const all = structuredClone(devops.tickets);
      const publish = () =>
        window.postMessage({ type: 'devopsState', state: structuredClone(devops) }, '*');
      Object.assign(window, {
        ticketsMessages: messages,
        ticketsState: devops,
        acquireVsCodeApi: () => ({
          getState: () => ({ view: 'devops-tickets' }),
          setState() {},
          postMessage(message: ClientMessage) {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                publish();
              }, 0);
            if (message.type === 'devopsSearchTickets') {
              devops.ticketFilters = message.filters;
              const filters = message.filters;
              const query = filters.query.toLowerCase();
              const filtered = all.filter(
                (ticket) =>
                  (!query ||
                    ticket.title.toLowerCase().includes(query) ||
                    String(ticket.id) === query.replace('#', '')) &&
                  (!filters.types.length || filters.types.includes(ticket.workItemType ?? '')) &&
                  (!filters.states.length || filters.states.includes(ticket.state)) &&
                  (filters.assignment === 'all' ||
                    (filters.assignment === 'me'
                      ? ticket.assignedTo === 'Matt'
                      : filters.assignment === 'unassigned'
                        ? !ticket.assignedTo
                        : ticket.assignedTo === filters.identity)) &&
                  filters.tags.every((tag) => ticket.tags?.includes(tag)),
              );
              devops.ticketSearch = {
                filters,
                tickets: message.more
                  ? [
                      ...(devops.ticketSearch?.tickets ?? []),
                      { ...all[2], id: 888, title: 'Demande retrouvée sur la page suivante' },
                    ]
                  : filtered,
                hasMore: false,
                limitReached: false,
                omitted: 0,
                searchedAt: '2026-10-17T09:01:00Z',
              };
              publish();
            }
            if (message.type === 'devopsLoadTicket' || message.type === 'devopsPrepareTicket') {
              const row = all.find((ticket) => ticket.id === message.ticketId)!;
              devops.ticketDetail = {
                ...structuredClone(detail),
                ...structuredClone(row),
                detailsLoaded: true,
                comments: structuredClone(detail.comments),
                commentsLoaded: true,
                revision: 8,
                snapshotId: detail.snapshotId,
                fetchedAt: detail.fetchedAt,
              };
              if (message.type === 'devopsPrepareTicket')
                devops.ticketPreparation = {
                  ticketId: row.id,
                  sourceProjectKey: 'atelier/studio',
                  snapshotId: detail.snapshotId!,
                  targets,
                };
              publish();
            }
            if (message.type === 'devopsCreateFeature') {
              devops.ticketCreateResult = {
                requestId: message.plan.requestId,
                featureId: state.features[0].id,
              };
              publish();
              window.postMessage(
                { type: 'navigate', view: 'dashboard', featureId: state.features[0].id },
                '*',
              );
            }
          },
        }),
      });
    },
    {
      devops: structuredClone(initial),
      state: structuredClone(demoState),
      detail: ticketDetailFixture,
      targets: ticketTargets,
    },
  );
  await page.goto('/');
}
