import { ticketFiltersSchema } from '../core/devopsTicketSchemas';
import type { TicketFilters } from '../shared/devopsTickets';

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
/** Field names and operators are fixed here. The webview never supplies WIQL. */
export function ticketQuery(input: TicketFilters, beforeId?: number): string {
  const filters = ticketFiltersSchema.parse(input);
  if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId < 1))
    throw new Error('Curseur de recherche invalide.');
  const clauses = ['[System.TeamProject] = @project'];
  if (filters.query) {
    const number = /^#?(\d+)$/.exec(filters.query);
    if (number) {
      const id = Number(number[1]);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('Numéro de ticket invalide.');
      clauses.push(`[System.Id] = ${id}`);
    } else clauses.push(`[System.Title] CONTAINS ${literal(filters.query)}`);
  }
  for (const [field, values] of [
    ['System.WorkItemType', filters.types],
    ['System.State', filters.states],
  ] as const)
    if (values.length) clauses.push(`[${field}] IN (${values.map(literal).join(', ')})`);
  if (filters.assignment === 'me') clauses.push('[System.AssignedTo] = @Me');
  if (filters.assignment === 'unassigned') clauses.push("[System.AssignedTo] = ''");
  if (filters.assignment === 'identity')
    clauses.push(`[System.AssignedTo] = ${literal(filters.identity)}`);
  for (const tag of filters.tags) clauses.push(`[System.Tags] CONTAINS ${literal(tag)}`);
  if (filters.areaPath) clauses.push(`[System.AreaPath] UNDER ${literal(filters.areaPath)}`);
  if (filters.iterationPath)
    clauses.push(`[System.IterationPath] UNDER ${literal(filters.iterationPath)}`);
  if (beforeId !== undefined) clauses.push(`[System.Id] < ${beforeId}`);
  return `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [System.Id] DESC`;
}
