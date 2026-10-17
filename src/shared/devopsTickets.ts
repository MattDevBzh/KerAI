import type { DevOpsConfig, DevOpsLink, DevOpsTicket } from './devops';
import { devOpsPlainText } from './devopsText';

export interface TicketFilters {
  query: string;
  types: string[];
  states: string[];
  assignment: 'me' | 'unassigned' | 'all' | 'identity';
  identity: string;
  tags: string[];
  areaPath: string;
  iterationPath: string;
}
export const defaultTicketFilters: TicketFilters = {
  query: '',
  types: [],
  states: [],
  assignment: 'me',
  identity: '',
  tags: [],
  areaPath: '',
  iterationPath: '',
};
export const ticketProjectKey = (config: Pick<DevOpsConfig, 'organization' | 'project'>) =>
  `${config.organization}/${config.project}`.toLowerCase();
export const ticketLinkProjectKey = (link: DevOpsLink) =>
  link.ticketProjectKey ?? link.projectKey.split('/').slice(0, 2).join('/');
export interface TicketMetadata {
  types: { name: string; states: string[] }[];
  areas: string[];
  iterations: string[];
  fields: { referenceName: string; name: string }[];
  notices: string[];
}
export interface TicketSearch {
  filters: TicketFilters;
  tickets: DevOpsTicket[];
  searchedAt?: string;
  hasMore: boolean;
  limitReached: boolean;
  omitted: number;
  error?: string;
}
export interface TicketTarget {
  id: string;
  name: string;
  path: string;
  branch: string;
  canIsolate: boolean;
  isolationReason?: string;
  dirtyCount?: number;
  branches: { name: string; ref: string; commit: string }[];
}
export interface TicketPreparation {
  ticketId: number;
  sourceProjectKey: string;
  snapshotId: string;
  targets: TicketTarget[];
}
export interface TicketDevelopmentPlan {
  requestId: string;
  sourceProjectKey: string;
  snapshotId: string;
  targetProjectId: string;
  title: string;
  isolated: boolean;
  baseRef?: string;
  baseCommit?: string;
  branchName?: string;
  commentIds: number[];
  instructions: string;
}
/** Immutable source actually supplied to the agents, retained when the editable need changes. */
export interface TicketSourceSnapshot {
  provider: 'azure-devops';
  projectKey: string;
  repositoryKey: string;
  ticketId: number;
  revision: number;
  url: string;
  title: string;
  fetchedAt: string;
  importedAt: string;
  snapshotId: string;
  targetProjectId: string;
  commentIds: number[];
  context: string;
}
export function ticketBranchName(ticket: Pick<DevOpsTicket, 'id' | 'title'>): string {
  const slug = ticket.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 45);
  return `codex/ticket-${ticket.id}${slug ? `-${slug}` : ''}`;
}
export const TICKET_CONTEXT_LIMIT = 180000;
export function ticketContext(
  ticket: DevOpsTicket,
  commentIds: number[],
  instructions: string,
): string {
  const comments = ticket.comments.filter((comment) => commentIds.includes(comment.id));
  const content = [
    `Ticket Azure DevOps #${ticket.id} — ${ticket.title}`,
    `Source : ${ticket.url}\nRévision : ${ticket.revision ?? 'inconnue'}\nCopie consultée le : ${ticket.fetchedAt ?? 'date inconnue'}`,
    `Type : ${ticket.workItemType || 'Non renseigné'}\nÉtat : ${ticket.state || 'Non renseigné'}\nAssignation : ${ticket.assignedTo || 'Non assigné'}\nZone : ${ticket.areaPath || 'Non renseignée'}\nItération : ${ticket.iterationPath || 'Non renseignée'}\nTags : ${ticket.tags?.join(', ') || 'Aucun'}`,
    `Description\n${devOpsPlainText(ticket.description) || 'Non renseignée.'}`,
    `Critères d’acceptation\n${devOpsPlainText(ticket.acceptanceCriteria) || 'Non renseignés.'}`,
    ...(ticket.extraFields ?? []).map(
      (field) => `${field.name} (${field.referenceName})\n${devOpsPlainText(field.value)}`,
    ),
    `Commentaires sélectionnés (${comments.length}/${ticket.comments.length} chargés)\n${comments.map((comment) => `#${comment.id} · ${comment.author || 'Auteur inconnu'} · ${comment.createdDate || 'Date inconnue'}${comment.modifiedDate && comment.modifiedDate !== comment.createdDate ? ` · modifié ${comment.modifiedDate}` : ''}\n${devOpsPlainText(comment.text)}`).join('\n\n') || 'Aucun commentaire importé.'}`,
    ...(ticket.commentsError ? [`Commentaires indisponibles : ${ticket.commentsError}`] : []),
    ...(ticket.commentsTruncated
      ? ['Commentaires partiels : chargement limité à 200 commentaires et à 250 000 caractères.']
      : []),
    ...(ticket.detailNotices ?? []).map((notice) => `Limite de la copie : ${notice}`),
    `Liens de référence (le contenu des pièces jointes et des pages liées n’est pas importé)\n${(ticket.relations ?? []).map((relation) => `${relation.name} : ${relation.url || relation.reference || 'lien non disponible'}`).join('\n') || 'Aucun lien.'}`,
  ].join('\n\n');
  const suffix = instructions.trim() ? `\n\nConsignes complémentaires\n${instructions.trim()}` : '';
  const max = TICKET_CONTEXT_LIMIT - suffix.length - 150;
  return (
    (content.length > max
      ? content.slice(0, max) +
        '\n\n[Copie tronquée à la limite de contexte ; consulter le ticket source pour la suite.]'
      : content) + suffix
  );
}
