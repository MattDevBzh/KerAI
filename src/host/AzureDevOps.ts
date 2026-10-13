import { z } from 'zod';
import { devOpsConfigSchema } from '../core/devopsSchemas';
import type { DevOpsConfig, DevOpsPullRequest, DevOpsTicket } from '../shared/devops';
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
        signal: AbortSignal.timeout(20000),
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
          'Azure DevOps refuse l’accès. Vérifie le jeton, son expiration et les droits Work Items (lecture) / Code (lecture et écriture).',
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
  async comments(id: number) {
    const comments: DevOpsTicket['comments'] = [];
    let continuation: string | undefined;
    for (let page = 0; page < 4; page++) {
      const response = await this.request(
        `${this.base()}/_apis/wit/workItems/${z.number().int().positive().parse(id)}/comments?$top=50&order=desc&api-version=7.1-preview.4${continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : ''}`,
      );
      for (const value of z.array(object).parse(response.data.comments)) {
        const author = object.safeParse(value.createdBy);
        comments.push({
          id: z.number().int().parse(value.id),
          author: author.success ? str(author.data.displayName) : '',
          text: str(value.text),
        });
      }
      continuation = str(response.data.continuationToken) || response.continuation;
      if (!continuation) break;
    }
    return { comments, truncated: Boolean(continuation) };
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
