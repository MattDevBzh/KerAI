import { randomUUID } from 'node:crypto';
import { ticketQuery } from './TicketQuery';
import type { TicketFilters, TicketMetadata } from '../shared/devopsTickets';
import { z } from 'zod';
import { devOpsConfigSchema } from '../core/devopsSchemas';
import type { DevOpsConfig, DevOpsPullRequest, DevOpsTicket } from '../shared/devops';
import { DevOpsInspector } from './DevOpsInspector';
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
const object = z.record(z.string(), z.unknown());
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 100000) : '');
const optionalStr = (value: unknown, maxLength = 1000): string | undefined =>
  typeof value === 'string' ? value.slice(0, maxLength).trim() || undefined : undefined;
const dateTime = z.iso.datetime({ offset: true });
const optionalDate = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= 40 && dateTime.safeParse(value).success
    ? value
    : undefined;
const identityName = (value: unknown): string | undefined => {
  const identity = object.safeParse(value);
  return identity.success ? optionalStr(identity.data.displayName) : undefined;
};
const ticketTags = (value: unknown): string[] | undefined => {
  if (typeof value !== 'string') return;
  return [
    ...new Set(
      value
        .slice(0, 100000)
        .split(';')
        .map((tag) => optionalStr(tag, 200)),
    ),
  ]
    .filter((tag): tag is string => tag !== undefined)
    .slice(0, 50);
};
const prReviewers = (value: unknown): DevOpsPullRequest['reviewers'] => {
  if (!Array.isArray(value)) return;
  const reviewers: NonNullable<DevOpsPullRequest['reviewers']> = [];
  for (const raw of value.slice(0, 100)) {
    const parsed = object.safeParse(raw);
    if (!parsed.success) continue;
    const { data } = parsed;
    const id = optionalStr(data.id, 256);
    const displayName = optionalStr(data.displayName);
    const vote = data.vote;
    if (
      !id ||
      !displayName ||
      typeof vote !== 'number' ||
      !Number.isInteger(vote) ||
      vote < -32768 ||
      vote > 32767
    )
      continue;
    reviewers.push({
      id,
      displayName,
      vote,
      ...(typeof data.isRequired === 'boolean' ? { isRequired: data.isRequired } : {}),
    });
  }
  return reviewers;
};
export function detectAzureRemote(remote: string): Omit<DevOpsConfig, 'remote'> | undefined {
  try {
    let parts: string[];
    if (remote.startsWith('git@ssh.dev.azure.com:v3/'))
      parts = remote.slice('git@ssh.dev.azure.com:v3/'.length).split('/');
    else {
      const u = new URL(remote);
      if (u.password) return;
      if (u.hostname === 'dev.azure.com')
        parts = u.pathname
          .split('/')
          .filter(Boolean)
          .filter((p) => p !== '_git');
      else if (u.hostname.endsWith('.visualstudio.com'))
        parts = [
          u.hostname.slice(0, -17),
          ...u.pathname
            .split('/')
            .filter(Boolean)
            .filter((p) => p !== '_git'),
        ];
      else return;
    }
    if (parts.length === 4 && parts[1] === 'DefaultCollection') parts.splice(1, 1);
    if (parts.length !== 3) return;
    const [organization, project, repository] = parts.map(decodeURIComponent);
    return devOpsConfigSchema.omit({ remote: true }).parse({ organization, project, repository });
  } catch {
    return;
  }
}
export const projectKey = (c: DevOpsConfig) =>
  `${c.organization}/${c.project}/${c.repository}`.toLowerCase();
export class AzureDevOps {
  private projectName?: string;
  constructor(
    readonly config: DevOpsConfig,
    private secrets: SecretStore,
    private http: typeof fetch = fetch,
  ) {
    devOpsConfigSchema.parse(config);
  }
  private key() {
    return `featureStudio.azureDevOps.${this.config.organization.toLowerCase()}`;
  }
  async hasCredential() {
    return Boolean(await this.secrets.get(this.key()));
  }
  async authenticate(token: string) {
    if (!token.trim() || token.length > 2000 || /[\r\n]/.test(token))
      throw new Error('Jeton invalide.');
    await this.secrets.store(this.key(), token.trim());
  }
  async disconnect() {
    await this.secrets.delete(this.key());
  }
  private base() {
    return `https://dev.azure.com/${encodeURIComponent(this.config.organization)}/${encodeURIComponent(this.config.project)}`;
  }
  private repo() {
    return `${this.base()}/_apis/git/repositories/${encodeURIComponent(this.config.repository)}`;
  }
  private async request(
    url: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<{ data: Record<string, unknown>; continuation?: string }> {
    const token = await this.secrets.get(this.key());
    if (!token) throw new Error('Connecte Azure DevOps avec un jeton personnel depuis le menu.');
    let response: Response;
    try {
      response = await this.http(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(':' + token).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new Error(
        'Azure DevOps est inaccessible ou le délai de 20 secondes a expiré. Réessaie.',
      );
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error(
          'Azure DevOps refuse l’accès. Vérifie le jeton, son expiration et les droits de lecture du service demandé (Code, Build, Test Management ou Work Items). L’écriture Code est nécessaire uniquement pour créer une PR.',
        );
      if (response.status === 404)
        throw new Error(
          'Organisation, projet ou dépôt Azure DevOps introuvable. Vérifie la configuration.',
        );
      if (response.status === 429)
        throw new Error('Azure DevOps limite les requêtes. Réessaie plus tard.');
      throw new Error(`Azure DevOps : erreur HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!reader) throw new Error('Réponse Azure DevOps vide.');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8_000_000) {
        await reader.cancel();
        throw new Error('Réponse Azure DevOps trop volumineuse.');
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    try {
      return {
        data: object.parse(JSON.parse(raw)),
        continuation: response.headers.get('x-ms-continuationtoken') ?? undefined,
      };
    } catch {
      throw new Error('Réponse Azure DevOps invalide.');
    }
  }
  /** Read-only API exposed to agents and the standalone inspection script. */
  inspector(signal?: AbortSignal): DevOpsInspector {
    return new DevOpsInspector(this.config, (route, query) =>
      this.request(
        `${this.base()}/_apis/${route}?${new URLSearchParams({ ...query, 'api-version': '7.1' })}`,
        undefined,
        signal,
      ),
    );
  }
  async dashboard(): Promise<{
    account: string;
    tickets: DevOpsTicket[];
    pullRequests: DevOpsPullRequest[];
    truncated: boolean;
  }> {
    const connection = await this.request(
      `https://dev.azure.com/${encodeURIComponent(this.config.organization)}/_apis/connectionData?api-version=7.1-preview.1`,
    );
    const user = object.parse(connection.data.authenticatedUser);
    const userId = z.string().uuid().parse(user.id);
    const result = await this.request(`${this.base()}/_apis/wit/wiql?$top=201&api-version=7.1`, {
      query:
        'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC',
    });
    const ids = z
      .array(z.object({ id: z.number().int().positive() }))
      .parse(result.data.workItems)
      .map((i) => i.id);
    const tickets: DevOpsTicket[] = [];
    if (ids.length) {
      const batch = await this.request(`${this.base()}/_apis/wit/workitemsbatch?api-version=7.1`, {
        ids: ids.slice(0, 200),
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
      for (const item of z.array(object).parse(batch.data.value)) {
        const fields = object.parse(item.fields);
        const id = z.number().int().positive().parse(item.id);
        tickets.push({
          id,
          title: str(fields['System.Title']),
          state: str(fields['System.State']),
          workItemType: optionalStr(fields['System.WorkItemType']),
          assignedTo:
            identityName(fields['System.AssignedTo']) || optionalStr(fields['System.AssignedTo']),
          iterationPath: optionalStr(fields['System.IterationPath']),
          areaPath: optionalStr(fields['System.AreaPath']),
          tags: ticketTags(fields['System.Tags']),
          createdDate: optionalDate(fields['System.CreatedDate']),
          changedDate: optionalDate(fields['System.ChangedDate']),
          description: str(fields['System.Description']),
          acceptanceCriteria: str(fields['Microsoft.VSTS.Common.AcceptanceCriteria']),
          url: `${this.base()}/_workitems/edit/${id}`,
          comments: [],
        });
      }
    }
    const pullRequests: DevOpsPullRequest[] = [];
    let truncated = ids.length > 200;
    for (let skip = 0; skip < 200; skip += 50) {
      const page = await this.request(
        `${this.repo()}/pullrequests?searchCriteria.creatorId=${userId}&searchCriteria.status=all&$top=50&$skip=${skip}&api-version=7.1`,
      );
      const items = z.array(object).parse(page.data.value);
      pullRequests.push(...items.map((i) => this.pr(i)));
      if (items.length < 50) break;
      if (skip === 150) truncated = true;
    }
    return {
      account:
        str(user.providerDisplayName) ||
        str(user.customDisplayName) ||
        'Compte Azure DevOps connecté',
      tickets,
      pullRequests,
      truncated,
    };
  }
  private async resolveProjectName(signal?: AbortSignal) {
    if (this.projectName || !z.string().uuid().safeParse(this.config.project).success) return;
    const result = await this.request(
      `https://dev.azure.com/${encodeURIComponent(this.config.organization)}/_apis/projects/${encodeURIComponent(this.config.project)}?api-version=7.1`,
      undefined,
      signal,
    );
    if (
      str(result.data.id).toLowerCase() !== this.config.project.toLowerCase() ||
      !optionalStr(result.data.name)
    )
      throw new Error('Identité du projet Azure DevOps incohérente.');
    this.projectName = str(result.data.name);
  }
  async dashboardPullRequests(status: string, signal?: AbortSignal) {
    const pullRequests: DevOpsPullRequest[] = [];
    let partial = false;
    for (let skip = 0; skip < 200; skip += 50) {
      const query = new URLSearchParams({
        'searchCriteria.status': ['active', 'completed', 'abandoned'].includes(status)
          ? status
          : 'all',
        $top: '50',
        $skip: String(skip),
        'api-version': '7.1',
      });
      const result = await this.request(`${this.repo()}/pullrequests?${query}`, undefined, signal);
      const items = z.array(object).parse(result.data.value);
      pullRequests.push(...items.map((item) => this.pr(item)));
      if (items.length < 50) break;
      if (skip === 150) partial = true;
    }
    return { pullRequests, partial };
  }
  async searchTickets(filters: TicketFilters, beforeId?: number, signal?: AbortSignal) {
    await this.resolveProjectName(signal);
    const result = await this.request(
      `${this.base()}/_apis/wit/wiql?$top=51&api-version=7.1`,
      {
        query: ticketQuery(filters, beforeId),
      },
      signal,
    );
    const all = z
      .array(z.object({ id: z.number().int().positive() }))
      .parse(result.data.workItems)
      .map((item) => item.id);
    const ids = [...new Set(all)]
      .filter((id) => beforeId === undefined || id < beforeId)
      .sort((a, b) => b - a)
      .slice(0, 50);
    if (!ids.length) return { tickets: [], hasMore: false, omitted: 0, nextBeforeId: undefined };
    const batch = await this.request(
      `${this.base()}/_apis/wit/workitemsbatch?api-version=7.1`,
      {
        ids,
        fields: [
          'System.Id',
          'System.Title',
          'System.State',
          'System.WorkItemType',
          'System.TeamProject',
          'System.AssignedTo',
          'System.ChangedDate',
          'System.AreaPath',
          'System.IterationPath',
          'System.Tags',
        ],
        errorPolicy: 'Omit',
      },
      signal,
    );
    const tickets = z
      .array(object)
      .parse(batch.data.value)
      .filter((item) => ids.includes(Number(item.id)))
      .map((item) => this.ticketSummary(item))
      .sort((a, b) => b.id - a.id);
    return {
      tickets,
      hasMore: all.length > 50,
      nextBeforeId: ids.at(-1),
      omitted: ids.length - tickets.length,
    };
  }
  private ticketSummary(item: Record<string, unknown>): DevOpsTicket {
    const fields = object.parse(item.fields);
    const project = optionalStr(fields['System.TeamProject']);
    if (
      project &&
      project.toLowerCase() !== (this.projectName ?? this.config.project).toLowerCase()
    )
      throw new Error('Le ticket reçu appartient à un autre projet Azure DevOps.');
    const id = z.number().int().positive().parse(item.id);
    return {
      id,
      title: str(fields['System.Title']),
      state: str(fields['System.State']),
      workItemType: optionalStr(fields['System.WorkItemType']),
      assignedTo:
        identityName(fields['System.AssignedTo']) || optionalStr(fields['System.AssignedTo']),
      areaPath: optionalStr(fields['System.AreaPath']),
      iterationPath: optionalStr(fields['System.IterationPath']),
      tags: ticketTags(fields['System.Tags']),
      createdDate: optionalDate(fields['System.CreatedDate']),
      changedDate: optionalDate(fields['System.ChangedDate']),
      description: str(fields['System.Description']),
      acceptanceCriteria: str(fields['Microsoft.VSTS.Common.AcceptanceCriteria']),
      url: `${this.base()}/_workitems/edit/${id}`,
      comments: [],
    };
  }
  async ticketMetadata(): Promise<TicketMetadata> {
    const metadata: TicketMetadata = {
      types: [],
      areas: [],
      iterations: [],
      fields: [],
      notices: [],
    };
    const results = await Promise.allSettled([
      this.request(`${this.base()}/_apis/wit/workitemtypes?api-version=7.1`),
      this.request(`${this.base()}/_apis/wit/classificationnodes/areas?$depth=12&api-version=7.1`),
      this.request(
        `${this.base()}/_apis/wit/classificationnodes/iterations?$depth=12&api-version=7.1`,
      ),
      this.request(`${this.base()}/_apis/wit/fields?api-version=7.1`),
    ]);
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (result.status === 'rejected') {
        metadata.notices.push(
          `${['Types et états', 'Zones', 'Itérations', 'Libellés des champs'][index]} indisponibles : ${(result.reason as Error).message}`,
        );
        continue;
      }
      try {
        if (index === 0) {
          const types = z.array(object).parse(result.value.data.value);
          metadata.types = types
            .slice(0, 100)
            .map((type) => {
              const states = Array.isArray(type.states)
                ? type.states.flatMap((state) => {
                    const value = object.safeParse(state);
                    return value.success && optionalStr(value.data.name)
                      ? [str(value.data.name)]
                      : [];
                  })
                : [];
              const transitions = object.safeParse(type.transitions);
              if (transitions.success)
                states.push(...Object.keys(transitions.data).filter(Boolean));
              return { name: str(type.name), states: [...new Set(states)].slice(0, 100) };
            })
            .filter((type) => type.name);
          if (types.length > 100)
            metadata.notices.push('Les 100 premiers types du projet sont proposés.');
        } else if (index === 3) {
          metadata.fields = z
            .array(object)
            .parse(result.value.data.value)
            .slice(0, 2000)
            .map((field) => ({
              name: str(field.name),
              referenceName: str(field.referenceName),
            }));
        } else {
          const paths = index === 1 ? metadata.areas : metadata.iterations;
          const visit = (node: Record<string, unknown>, parent: string, depth: number) => {
            if (paths.length >= 1000) return;
            const name = optionalStr(node.name, 500);
            if (!name) return;
            const current = parent ? `${parent}\\${name}` : name;
            paths.push(current);
            const children = Array.isArray(node.children) ? node.children : [];
            if (node.hasChildren && !children.length)
              metadata.notices.push(
                `Arborescence partielle sous ${current}. Saisis le chemin complet si nécessaire.`,
              );
            if (depth < 12)
              for (const child of children) {
                const parsed = object.safeParse(child);
                if (parsed.success) visit(parsed.data, current, depth + 1);
              }
          };
          visit(result.value.data, '', 0);
          if (paths.length >= 1000) metadata.notices.push('Arborescence limitée à 1 000 chemins.');
        }
      } catch {
        metadata.notices.push(
          `${['Types et états', 'Zones', 'Itérations', 'Libellés des champs'][index]} : réponse invalide.`,
        );
      }
    }
    return metadata;
  }
  async ticketDetail(id: number, metadata?: TicketMetadata): Promise<DevOpsTicket> {
    z.number().int().positive().parse(id);
    await this.resolveProjectName();
    const response = await this.request(
      `${this.base()}/_apis/wit/workitems/${id}?$expand=all&api-version=7.1`,
    );
    const ticket = this.ticketSummary(response.data);
    if (ticket.id !== id) throw new Error('Azure DevOps a renvoyé un autre ticket.');
    const fields = object.parse(response.data.fields);
    // IDs are organization-wide: require project ownership before importing a detail.
    if (
      str(fields['System.TeamProject']).toLowerCase() !==
      (this.projectName ?? this.config.project).toLowerCase()
    )
      throw new Error('Le ticket appartient à un autre projet Azure DevOps.');
    ticket.revision = z.number().int().positive().parse(response.data.rev);
    ticket.fetchedAt = new Date().toISOString();
    ticket.snapshotId = randomUUID();
    ticket.detailsLoaded = true;
    ticket.detailNotices = [];
    const excluded = new Set([
      'System.Id',
      'System.Title',
      'System.State',
      'System.TeamProject',
      'System.WorkItemType',
      'System.AssignedTo',
      'System.AreaPath',
      'System.IterationPath',
      'System.Tags',
      'System.CreatedDate',
      'System.ChangedDate',
      'System.Description',
      'Microsoft.VSTS.Common.AcceptanceCriteria',
      'System.History',
      'System.Rev',
      'System.Watermark',
      'System.AuthorizedDate',
      'System.RevisedDate',
      'System.PersonId',
      'System.NodeName',
      'System.AreaId',
      'System.IterationId',
    ]);
    let budget = 120000;
    ticket.extraFields = [];
    for (const [referenceName, raw] of Object.entries(fields)) {
      if (excluded.has(referenceName) || raw === null || raw === '') continue;
      const value =
        typeof raw === 'string'
          ? raw
          : (identityName(raw) ??
            (typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : ''));
      if (!value) continue;
      if (budget <= 0 || ticket.extraFields.length >= 100) {
        ticket.detailNotices.push('Champs supplémentaires partiels (limite de taille).');
        break;
      }
      const bounded = value.slice(0, Math.min(budget, 30000));
      budget -= bounded.length;
      if (bounded.length < value.length)
        ticket.detailNotices.push(`Champ ${referenceName} tronqué.`);
      ticket.extraFields.push({
        referenceName,
        name:
          metadata?.fields.find((field) => field.referenceName === referenceName)?.name ||
          referenceName,
        value: bounded,
      });
    }
    for (const key of ['System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria'])
      if (typeof fields[key] === 'string' && (fields[key] as string).length > 100000)
        ticket.detailNotices.push(`Champ ${key} tronqué à 100 000 caractères.`);
    ticket.relations = [];
    const relations = Array.isArray(response.data.relations) ? response.data.relations : [];
    if (relations.length > 200) ticket.detailNotices.push('Les 200 premiers liens sont affichés.');
    for (const raw of relations.slice(0, 200)) {
      const relation = object.safeParse(raw);
      if (!relation.success) continue;
      const attributes = object.safeParse(relation.data.attributes);
      const rel = str(relation.data.rel),
        url = str(relation.data.url);
      const name = (attributes.success && optionalStr(attributes.data.name)) || rel;
      let safeUrl: string | undefined,
        kind: 'ticket' | 'pr' | 'attachment' | 'link' =
          rel === 'AttachedFile' ? 'attachment' : 'link';
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password)
          safeUrl = parsed.toString();
        const relatedId = /\/_apis\/wit\/workitems\/(\d+)$/i.exec(parsed.pathname);
        if (safeUrl && relatedId && parsed.hostname === 'dev.azure.com') {
          kind = 'ticket';
          parsed.pathname = parsed.pathname.replace(
            /\/_apis\/wit\/workitems\/\d+$/i,
            `/_workitems/edit/${relatedId[1]}`,
          );
          safeUrl = parsed.toString();
        }
        if (url.startsWith('vstfs:///Git/PullRequestId/')) {
          const parts = decodeURIComponent(url.slice('vstfs:///Git/PullRequestId/'.length)).split(
            '/',
          );
          if (
            parts.length === 3 &&
            parts.slice(0, 2).every((part) => /^[a-f0-9-]{36}$/i.test(part)) &&
            /^\d+$/.test(parts[2])
          ) {
            kind = 'pr';
            safeUrl = `https://dev.azure.com/${encodeURIComponent(this.config.organization)}/${parts[0]}/_git/${parts[1]}/pullrequest/${parts[2]}`;
          }
        }
      } catch {
        /* Unsupported relation remains inert text. */
      }
      ticket.relations.push({
        name:
          kind === 'ticket'
            ? rel.endsWith('Hierarchy-Reverse')
              ? 'Parent'
              : rel.endsWith('Hierarchy-Forward')
                ? 'Enfant'
                : name
            : name,
        kind,
        url: safeUrl,
        ...(!safeUrl ? { reference: url.slice(0, 2000) } : {}),
      });
    }
    try {
      const result = await this.comments(id);
      ticket.comments = result.comments;
      ticket.commentsLoaded = !result.error;
      ticket.commentsTruncated = result.truncated;
      ticket.commentsError = result.error;
    } catch (error) {
      ticket.commentsError = (error as Error).message;
    }
    return ticket;
  }
  async comments(id: number) {
    const comments: DevOpsTicket['comments'] = [];
    let continuation: string | undefined,
      size = 0,
      limited = false;
    for (let page = 0; page < 4; page++) {
      try {
        const response = await this.request(
          `${this.base()}/_apis/wit/workItems/${z.number().int().positive().parse(id)}/comments?$top=50&order=desc&api-version=7.1-preview.4${continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : ''}`,
        );
        const values = z.array(object).parse(response.data.comments);
        if (values.length > 50) limited = true;
        for (const value of values.slice(0, 50)) {
          const author = object.safeParse(value.createdBy);
          const remaining = Math.max(0, 250000 - size);
          if (!remaining) {
            limited = true;
            break;
          }
          const text = str(value.text).slice(0, remaining);
          size += text.length;
          if (
            text.length < str(value.text).length ||
            (typeof value.text === 'string' && value.text.length > 100000)
          )
            limited = true;
          const comment = {
            id: z.number().int().positive().parse(value.id),
            author: author.success ? str(author.data.displayName) : '',
            text,
            createdDate: optionalDate(value.createdDate),
            modifiedDate: optionalDate(value.modifiedDate),
          };
          if (!comments.some((item) => item.id === comment.id)) comments.push(comment);
        }
        continuation = str(response.data.continuationToken) || response.continuation;
        if (!continuation || limited) break;
      } catch (error) {
        return { comments, truncated: true, error: (error as Error).message };
      }
    }
    return { comments, truncated: limited || Boolean(continuation) };
  }
  private pr(item: Record<string, unknown>): DevOpsPullRequest {
    const id = z.number().int().positive().parse(item.pullRequestId);
    return {
      id,
      title: str(item.title),
      status: str(item.status),
      isDraft: item.isDraft === true,
      sourceBranch: str(item.sourceRefName),
      targetBranch: str(item.targetRefName),
      description: optionalStr(item.description, 100000),
      creationDate: optionalDate(item.creationDate),
      closedDate: optionalDate(item.closedDate),
      createdBy: identityName(item.createdBy),
      reviewers: prReviewers(item.reviewers),
      mergeStatus: optionalStr(item.mergeStatus),
      url: `${this.base()}/_git/${encodeURIComponent(this.config.repository)}/pullrequest/${id}`,
    };
  }
  async branchHead(branch: string): Promise<string | undefined> {
    const result = await this.request(
      `${this.repo()}/refs?filter=${encodeURIComponent('heads/' + branch)}&$top=100&api-version=7.1`,
    );
    return z
      .array(z.object({ name: z.string(), objectId: z.string() }))
      .parse(result.data.value)
      .find((r) => r.name === `refs/heads/${branch}`)?.objectId;
  }
  async createPullRequest(input: {
    branch: string;
    target: string;
    title: string;
    description: string;
    ticketId?: number;
  }) {
    const response = await this.request(`${this.repo()}/pullrequests?api-version=7.1`, {
      sourceRefName: `refs/heads/${input.branch}`,
      targetRefName: `refs/heads/${input.target}`,
      title: input.title,
      description: input.description,
      isDraft: true,
      ...(input.ticketId ? { workItemRefs: [{ id: String(input.ticketId) }] } : {}),
    });
    return this.pr(response.data);
  }
}
