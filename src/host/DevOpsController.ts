import { pullRequestDiff } from './DevOpsDelivery';
import { ticketFiltersSchema, ticketSourceSnapshotSchema } from '../core/devopsTicketSchemas';
import {
  defaultTicketFilters,
  ticketProjectKey,
  ticketLinkProjectKey,
  ticketContext,
  type TicketFilters,
  type TicketDevelopmentPlan,
  type TicketSourceSnapshot,
  type TicketTarget,
} from '../shared/devopsTickets';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { devOpsConfigSchema, devOpsMessageSchema } from '../core/devopsSchemas';
import type {
  DevOpsClientMessage,
  DevOpsState,
  DevOpsTicket,
  DeliveryChatEntry,
  DevOpsLink,
} from '../shared/devops';
import { AzureDevOps, detectAzureRemote, projectKey, type SecretStore } from './AzureDevOps';
import { DeliveryService } from './DeliveryService';
const linkSchema = z
  .object({
    featureId: z.string().max(150),
    ticketProjectKey: z.string().max(500).optional(),
    targetProjectId: z.string().max(500).optional(),
    ticketId: z.number().int().positive().optional(),
    ticketUrl: z.string().url().optional(),
    projectKey: z.string().max(700),
    pullRequestIds: z.array(z.number().int().positive()).max(200),
    pullRequestUrls: z
      .record(
        z.string(),
        z
          .string()
          .url()
          .regex(/^https:\/\/dev\.azure\.com\//),
      )
      .optional(),
  })
  .strict();
const storedSchema = z
  .object({
    version: z.literal(1),
    ticketFiltersByProject: z.record(z.string().max(500), ticketFiltersSchema).optional(),
    config: devOpsConfigSchema.optional(),
    links: z.array(linkSchema).max(2000),
    history: z
      .array(
        z.object({
          id: z.string(),
          role: z.enum(['user', 'assistant']),
          text: z.string().max(10000),
          at: z.string(),
        }),
      )
      .max(200),
  })
  .strict();
export interface DevOpsControllerOptions {
  assertReadable?: () => void;
  root: string;
  storageDirectory: string;
  secrets: SecretStore;
  publish: (state: DevOpsState) => void;
  confirm: (title: string, detail: string) => Promise<boolean>;
  requestToken: () => Promise<string | undefined>;
  /** Must reject untrusted/read-only windows and running agents/workspace operations. */
  guard: () => void;
  /** Must reserve the shared StudioService workspace operation before awaiting work. */
  withMutation: <T>(label: string, work: () => Promise<T>) => Promise<T>;
  getAgentInstructions: () => Promise<string>;
  createFeature: (
    ticket: DevOpsTicket,
    plan: TicketDevelopmentPlan,
    source: TicketSourceSnapshot,
    target: TicketTarget,
  ) => Promise<string>;
  ticketTargets?: () => Promise<TicketTarget[]>;
  ensureFeatureSaved?: (id: string) => Promise<void>;
  openFeature?: (id: string) => Promise<void>;
  features: () => Array<{ id: string; title: string; ticketSource?: TicketSourceSnapshot }>;
  delivery?: DeliveryService;
  http?: typeof fetch;
}
export class DevOpsController {
  private state: DevOpsState = {
    authenticated: false,
    busy: false,
    notices: [],
    tickets: [],
    pullRequests: [],
    links: [],
    history: [],
  };
  private ticketFiltersByProject: Record<string, TicketFilters> = {};
  private ticketCursor?: number;
  private delivery: DeliveryService;
  private disposed = false;
  private operation?: Promise<void>;
  private initialization?: Promise<void>;
  private finishOperation?: () => void;
  constructor(private options: DevOpsControllerOptions) {
    this.delivery = options.delivery ?? new DeliveryService(options.root);
  }
  getState(): DevOpsState {
    this.syncTicketLinks();
    return structuredClone(this.state);
  }
  private publish() {
    if (!this.disposed) this.options.publish(this.getState());
  }
  async dispose() {
    this.disposed = true;
    await Promise.all([this.operation, this.initialization]);
  }
  private file() {
    return path.join(this.options.storageDirectory, 'devops.json');
  }
  private async save() {
    await mkdir(this.options.storageDirectory, { recursive: true, mode: 0o700 });
    try {
      if ((await lstat(this.file())).isSymbolicLink())
        throw new Error('Stockage Azure DevOps symbolique refusé.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = this.file() + '.' + randomUUID() + '.tmp';
    await writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        ticketFiltersByProject: this.ticketFiltersByProject,
        config: this.state.config,
        links: this.state.links,
        history: this.state.history,
      }),
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temporary, this.file());
  }
  private chat(role: DeliveryChatEntry['role'], text: string) {
    this.state.history.push({
      id: randomUUID(),
      role,
      text: text.slice(0, 10000),
      at: new Date().toISOString(),
    });
    this.state.history = this.state.history.slice(-200);
  }
  private api() {
    if (!this.state.config)
      throw new Error('Configure l’organisation, le projet et le dépôt Azure DevOps dans ce menu.');
    return new AzureDevOps(this.state.config, this.options.secrets, this.options.http);
  }
  inspector(signal?: AbortSignal) {
    if (this.disposed) throw new Error('La connexion Azure DevOps est fermée.');
    return this.api().inspector(signal);
  }
  async dashboardRead(module: import('../shared/dashboard').DashboardModule, signal?: AbortSignal) {
    this.options.assertReadable?.();
    if (this.disposed) throw new Error('Connexion fermée.');
    if (!this.state.config) throw new Error('Configure Azure DevOps dans ce projet.');
    if (!this.state.authenticated)
      throw new Error('Connecte ton compte Azure DevOps dans ce projet.');
    const api = this.api();
    if (module.kind === 'tickets') {
      const result = await api.searchTickets(
        ticketFiltersSchema.parse(module.filters.tickets),
        undefined,
        signal,
      );
      return { tickets: result.tickets, prs: [], partial: result.hasMore || result.omitted > 0 };
    }
    const result = await api.dashboardPullRequests(module.filters.status, signal),
      f = module.filters;
    const contains = (value: string | undefined, query: string) =>
      (value ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase());
    return {
      tickets: [],
      partial: result.partial,
      prs: result.pullRequests.filter(
        (pr) =>
          contains(`${pr.id} ${pr.title}`, f.query) &&
          contains(pr.createdBy, f.author) &&
          (!f.reviewer || pr.reviewers?.some((r) => contains(r.displayName, f.reviewer))) &&
          (f.draft === 'all' || Boolean(pr.isDraft) === (f.draft === 'yes')),
      ),
    };
  }
  initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Le menu de livraison est fermé.'));
    if (this.initialization) return this.initialization;
    if (this.operation)
      return Promise.reject(new Error('Une opération de livraison est en cours.'));
    this.initialization = this.initializeState().finally(() => {
      this.initialization = undefined;
    });
    return this.initialization;
  }
  private async initializeState() {
    try {
      let prunedLinks = false;
      try {
        const stored = storedSchema.parse(JSON.parse(await readFile(this.file(), 'utf8')));
        this.state.config = stored.config;
        this.ticketFiltersByProject = stored.ticketFiltersByProject ?? {};
        this.restoreTicketFilters();
        this.state.links = stored.links.filter(
          (link) =>
            link.targetProjectId ||
            this.options.features().some((feature) => feature.id === link.featureId),
        );
        prunedLinks = this.state.links.length !== stored.links.length;
        this.state.history = stored.history;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          this.state.notices.push(
            'Configuration sauvegardée illisible : configure à nouveau Azure DevOps.',
          );
      }
      this.options.guard();
      if (prunedLinks) await this.save();
      this.state.snapshot = await this.delivery.inspect();
      if (!this.state.config && this.state.snapshot.remoteUrl) {
        const detected = detectAzureRemote(this.state.snapshot.remoteUrl);
        if (detected) {
          this.state.config = { ...detected, remote: 'origin' };
          await this.save();
        }
      }
      if (this.state.config) this.state.authenticated = await this.api().hasCredential();
    } catch (error) {
      this.state.error = (error as Error).message;
    }
    this.publish();
  }
  private ticket(id: number) {
    const ticket =
      this.state.ticketDetail?.id === id
        ? this.state.ticketDetail
        : (this.state.ticketSearch?.tickets.find((t) => t.id === id) ??
          this.state.tickets.find((t) => t.id === id));
    if (!ticket) throw new Error('Actualise les tickets avant cette action.');
    return ticket;
  }
  private restoreTicketFilters() {
    this.state.ticketFilters = structuredClone(
      this.state.config
        ? (this.ticketFiltersByProject[ticketProjectKey(this.state.config)] ?? defaultTicketFilters)
        : defaultTicketFilters,
    );
  }
  private assertTicketScope(key?: string) {
    if (!this.state.config || (key && key !== ticketProjectKey(this.state.config)))
      throw new Error('Le projet Azure DevOps a changé. Rouvre le ticket dans le projet voulu.');
  }
  private syncTicketLinks() {
    // The session is the durable source of truth, including after a link-save/response failure.
    // Cross-project entries can load after this controller; never prune them during initialization.
    for (const feature of this.options.features()) {
      const source = feature.ticketSource;
      if (
        !source ||
        this.state.links.some(
          (link) =>
            link.featureId === feature.id &&
            link.ticketId === source.ticketId &&
            ticketLinkProjectKey(link) === source.projectKey,
        )
      )
        continue;
      this.state.links.push({
        featureId: feature.id,
        ticketId: source.ticketId,
        ticketUrl: source.url,
        projectKey: source.repositoryKey,
        ticketProjectKey: source.projectKey,
        targetProjectId: source.targetProjectId,
        pullRequestIds: [],
      });
    }
  }
  private existingTicketFeature(ticketId: number) {
    this.syncTicketLinks();
    const key = ticketProjectKey(this.state.config!);
    return this.state.links.find(
      (link) =>
        link.ticketId === ticketId &&
        ticketLinkProjectKey(link) === key &&
        this.options.features().some((feature) => feature.id === link.featureId),
    );
  }
  private async searchTickets(filters: TicketFilters, more = false) {
    this.assertTicketScope();
    if (
      more &&
      (!this.state.ticketSearch?.hasMore ||
        this.state.ticketSearch.limitReached ||
        JSON.stringify(filters) !== JSON.stringify(this.state.ticketSearch.filters))
    )
      throw new Error('Cette page de résultats a changé. Relance la recherche.');
    const previous = more ? this.state.ticketSearch! : undefined;
    if (!more) {
      this.state.ticketFilters = structuredClone(filters);
      this.ticketFiltersByProject[ticketProjectKey(this.state.config!)] = structuredClone(filters);
      this.state.ticketSearch = {
        filters: structuredClone(filters),
        tickets: [],
        hasMore: false,
        limitReached: false,
        omitted: 0,
      };
      this.ticketCursor = undefined;
      await this.save();
    }
    try {
      if (!this.state.ticketMetadata) this.state.ticketMetadata = await this.api().ticketMetadata();
      const page = await this.api().searchTickets(filters, more ? this.ticketCursor : undefined);
      const tickets = [...(previous?.tickets ?? []), ...page.tickets];
      const unique = [...new Map(tickets.map((ticket) => [ticket.id, ticket])).values()];
      this.ticketCursor = page.nextBeforeId;
      this.state.ticketSearch = {
        filters: structuredClone(filters),
        tickets: unique,
        searchedAt: new Date().toISOString(),
        hasMore: page.hasMore,
        limitReached: unique.length >= 1000,
        omitted: (previous?.omitted ?? 0) + page.omitted,
      };
    } catch (error) {
      this.state.ticketSearch!.error = (error as Error).message;
      throw error;
    }
  }
  private async loadTicket(id: number) {
    this.ticket(id);
    this.state.ticketDetailError = undefined;
    try {
      const ticket = await this.api().ticketDetail(id, this.state.ticketMetadata);
      this.state.ticketDetail = ticket;
      const old = this.state.tickets.findIndex((item) => item.id === id);
      if (old >= 0) this.state.tickets[old] = ticket;
      return ticket;
    } catch (error) {
      if (this.state.ticketDetail?.id === id) this.state.ticketDetail = undefined;
      this.state.ticketDetailError = { ticketId: id, message: (error as Error).message };
      throw error;
    }
  }
  async removeDeletedFeature(featureId: string): Promise<void> {
    this.state.links = this.state.links.filter((link) => link.featureId !== featureId);
    if (this.state.preview?.featureId === featureId) this.state.preview = undefined;
    await this.save();
    this.options.publish(this.state);
  }
  private featureLink(featureId: string, ticketId?: number): DevOpsLink {
    if (!this.options.features().some((f) => f.id === featureId))
      throw new Error('Feature inconnue.');
    if (!this.state.config) throw new Error('Configure Azure DevOps avant de lier une feature.');
    const ticket = ticketId === undefined ? undefined : this.ticket(ticketId);
    const key = projectKey(this.state.config);
    let link = this.state.links.find(
      (l) => l.featureId === featureId && l.ticketId === ticketId && l.projectKey === key,
    );
    if (!link) {
      link = { featureId, ticketId, ticketUrl: ticket?.url, projectKey: key, pullRequestIds: [] };
      this.state.links.push(link);
    }
    return link;
  }
  private async link(featureId: string, ticketId: number) {
    const link = this.featureLink(featureId, ticketId);
    await this.save();
    return link;
  }
  private pullRequest(id: number) {
    const pr = this.state.pullRequests.find((p) => p.id === id);
    if (!pr) throw new Error('Actualise les PR avant cette action.');
    return pr;
  }
  private pullRequestLink(id: number, featureId: string, ticketId?: number) {
    if (!this.state.config) throw new Error('Configure Azure DevOps avant de modifier un lien.');
    const key = projectKey(this.state.config);
    const link = this.state.links.find(
      (l) =>
        l.projectKey === key &&
        l.featureId === featureId &&
        l.ticketId === ticketId &&
        l.pullRequestIds.includes(id),
    );
    if (!link) throw new Error('Ce lien PR a changé. Actualise le tableau.');
    return link;
  }
  private removePullRequestLink(link: DevOpsLink, id: number) {
    link.pullRequestIds = link.pullRequestIds.filter((prId) => prId !== id);
    if (link.pullRequestUrls) delete link.pullRequestUrls[String(id)];
    // Keep an independent ticket association, and all other PR associations.
    if (link.ticketId === undefined && !link.pullRequestIds.length)
      this.state.links = this.state.links.filter((l) => l !== link);
  }
  private associatePullRequest(
    id: number,
    featureId: string,
    ticketId?: number,
    replaces?: { featureId: string; ticketId?: number },
  ) {
    const pr = this.pullRequest(id);
    const previous = replaces
      ? this.pullRequestLink(id, replaces.featureId, replaces.ticketId)
      : undefined;
    const link = this.featureLink(featureId, ticketId);
    if (!link.pullRequestIds.includes(id)) link.pullRequestIds.push(id);
    link.pullRequestUrls = { ...link.pullRequestUrls, [id]: pr.url };
    if (previous && previous !== link) this.removePullRequestLink(previous, id);
  }
  private async refresh() {
    const data = await this.api().dashboard();
    this.state.account = data.account;
    this.state.authenticated = true;
    this.state.tickets = data.tickets;
    this.state.pullRequests = data.pullRequests;
    this.state.truncated = data.truncated;
    this.state.refreshedAt = new Date().toISOString();
  }
  private clearDashboard() {
    this.state.tickets = [];
    this.state.pullRequests = [];
    this.state.account = undefined;
    this.state.refreshedAt = undefined;
    this.state.truncated = undefined;
    this.state.ticketSearch = undefined;
    this.state.ticketMetadata = undefined;
    this.state.ticketDetail = undefined;
    this.state.ticketDetailError = undefined;
    this.state.ticketPreparation = undefined;
    this.state.ticketCreateResult = undefined;
    this.ticketCursor = undefined;
    this.restoreTicketFilters();
  }
  async handle(input: DevOpsClientMessage): Promise<void> {
    if (this.disposed) throw new Error('Le menu de livraison est fermé.');
    const message = devOpsMessageSchema.parse(input);
    try {
      if (this.state.busy || this.initialization)
        throw new Error('Attends la fin de l’opération de livraison en cours.');
      this.options.guard();
    } catch (error) {
      if (message.type !== 'devopsCreateFeature') throw error;
      this.state.ticketCreateResult = {
        requestId: message.plan.requestId,
        error: (error as Error).message,
      };
      this.state.error = (error as Error).message;
      this.publish();
      return;
    }
    this.operation = new Promise<void>((resolve) => {
      this.finishOperation = resolve;
    });
    this.state.busy = true;
    this.state.error = undefined;
    this.publish();
    let openFeatureId: string | undefined;
    try {
      switch (message.type) {
        case 'devopsConfigure':
          this.state.config = message.config;
          this.state.preview = undefined;
          this.clearDashboard();
          this.state.authenticated = await this.api().hasCredential();
          await this.save();
          this.chat(
            'assistant',
            'Configuration enregistrée. Connecte ton compte puis actualise les tickets et les PR.',
          );
          break;
        case 'devopsAuthenticate': {
          const token = await this.options.requestToken();
          if (token) {
            await this.api().authenticate(token);
            this.state.authenticated = true;
            this.clearDashboard();
            this.publish();
            await this.refresh();
          }
          break;
        }
        case 'devopsDisconnect':
          await this.api().disconnect();
          this.state.authenticated = false;
          this.clearDashboard();
          this.state.preview = undefined;
          break;
        case 'devopsRefresh':
          await this.refresh();
          break;
        case 'deliveryInspect':
          this.state.snapshot = await this.delivery.inspect(this.state.config?.remote ?? 'origin');
          this.state.preview = undefined;
          break;
        case 'devopsSearchTickets':
          this.assertTicketScope(message.sourceProjectKey);
          await this.searchTickets(message.filters, message.more);
          break;
        case 'devopsLoadTicket':
          await this.loadTicket(message.ticketId);
          break;
        case 'devopsPrepareTicket': {
          this.assertTicketScope(message.sourceProjectKey);
          const existing = this.existingTicketFeature(message.ticketId);
          if (existing) {
            openFeatureId = existing.featureId;
            break;
          }
          this.state.ticketPreparation = undefined;
          const ticket = await this.loadTicket(message.ticketId);
          const targets = (await this.options.ticketTargets?.()) ?? [];
          if (!targets.length)
            throw new Error('Ajoute un projet local avant de préparer ce ticket.');
          this.state.ticketPreparation = {
            ticketId: ticket.id,
            sourceProjectKey: ticketProjectKey(this.state.config!),
            snapshotId: ticket.snapshotId!,
            targets,
          };
          break;
        }
        case 'devopsLinkFeature':
          await this.link(message.featureId, message.ticketId);
          break;
        case 'devopsLinkPullRequest':
          this.associatePullRequest(
            message.pullRequestId,
            message.featureId,
            message.ticketId,
            message.replaces,
          );
          break;
        case 'devopsUnlinkPullRequest':
          this.pullRequest(message.pullRequestId);
          this.removePullRequestLink(
            this.pullRequestLink(message.pullRequestId, message.featureId, message.ticketId),
            message.pullRequestId,
          );
          break;
        case 'devopsCreateFeature': {
          this.assertTicketScope(message.plan.sourceProjectKey);
          const existing = this.existingTicketFeature(message.ticketId);
          if (existing) {
            this.state.ticketCreateResult = {
              requestId: message.plan.requestId,
              featureId: existing.featureId,
            };
            openFeatureId = existing.featureId;
            break;
          }
          const preparation = this.state.ticketPreparation,
            ticket = this.state.ticketDetail;
          const plan = message.plan;
          if (
            !preparation ||
            preparation.ticketId !== message.ticketId ||
            preparation.snapshotId !== plan.snapshotId ||
            !ticket?.detailsLoaded ||
            ticket.id !== message.ticketId ||
            ticket.snapshotId !== plan.snapshotId
          )
            throw new Error(
              'La copie du ticket a changé. Rouvre sa préparation avant de créer la session.',
            );
          const target = preparation.targets.find((item) => item.id === plan.targetProjectId);
          if (!target) throw new Error('Choisis un dépôt local proposé dans la préparation.');
          if (
            plan.isolated &&
            (!target.canIsolate ||
              !plan.branchName ||
              !target.branches.some(
                (branch) => branch.ref === plan.baseRef && branch.commit === plan.baseCommit,
              ))
          )
            throw new Error(
              'La branche de départ ou le worktree n’est pas disponible. Rouvre la préparation.',
            );
          if (
            plan.commentIds.some((id) => !ticket.comments.some((comment) => comment.id === id)) ||
            new Set(plan.commentIds).size !== plan.commentIds.length
          )
            throw new Error('La sélection de commentaires a changé. Rouvre la préparation.');
          const source = ticketSourceSnapshotSchema.parse({
            provider: 'azure-devops',
            projectKey: ticketProjectKey(this.state.config!),
            repositoryKey: projectKey(this.state.config!),
            ticketId: ticket.id,
            revision: ticket.revision,
            url: ticket.url,
            title: ticket.title,
            fetchedAt: ticket.fetchedAt,
            importedAt: new Date().toISOString(),
            snapshotId: ticket.snapshotId,
            targetProjectId: target.id,
            commentIds: plan.commentIds,
            context: ticketContext(ticket, plan.commentIds, plan.instructions),
          });
          const featureId = await this.options.createFeature(
            structuredClone(ticket),
            plan,
            source,
            target,
          );
          const link = this.featureLink(featureId, ticket.id);
          link.ticketProjectKey = source.projectKey;
          link.targetProjectId = target.id;
          this.state.ticketCreateResult = { requestId: plan.requestId, featureId };
          openFeatureId = featureId;
          break;
        }
        case 'deliveryChat': {
          this.chat('user', message.text);
          const text = message.text.toLowerCase();
          if (/push|publ|envoi/.test(text))
            this.chat(
              'assistant',
              'Pour publier : vérifie la branche et le remote, puis « Préparer le push ». Je demanderai une confirmation séparée.',
            );
          else if (/pull|\bpr\b/.test(text))
            this.chat(
              'assistant',
              'Pour créer une PR Azure DevOps : pousse la branche, indique la branche cible, le titre et la description puis prépare l’aperçu. La PR sera un brouillon.',
            );
          else if (/titre|commit|livr/.test(text))
            this.chat(
              'assistant',
              'Sélectionne explicitement les fichiers ci-dessous et décris ton intention. Je propose un titre selon le profil fs-delivery. Les changements déjà indexés dans les autres fichiers restent hors du commit.',
            );
          else
            this.chat(
              'assistant',
              'Je peux préparer un commit, publier ta branche et créer une PR Azure DevOps. Tout se fait par opérations Git déterministes, sans appel IA. Utilise la sélection et les formulaires ci-dessous ; une demande en conversation ne déclenche jamais une publication.',
            );
          break;
        }
        case 'deliveryPreviewCommit': {
          const result = await this.delivery.previewCommit(
            message.paths,
            await this.options.getAgentInstructions(),
            message.title,
            message.intent,
          );
          this.state.snapshot = result.snapshot;
          this.state.preview = result.preview;
          this.chat(
            'assistant',
            `Titre proposé : ${result.preview.title}\n${message.paths.length} fichier(s) sélectionné(s). Vérifie l’aperçu puis confirme le commit. Chaque fichier sélectionné sera pris entièrement dans son état de travail actuel, y compris ses modifications non indexées.`,
          );
          break;
        }
        case 'deliveryPreviewPush': {
          const result = await this.delivery.previewPush(message.remote);
          this.state.snapshot = result.snapshot;
          this.state.preview = result.preview;
          this.chat(
            'assistant',
            `Push préparé : ${result.snapshot.branch} vers ${result.snapshot.remoteUrl}. Seul le commit ${result.snapshot.head.slice(0, 12)} sera envoyé à cette branche, sans force.`,
          );
          break;
        }
        case 'deliveryPreviewPr': {
          await this.delivery.validateBranch(message.target);
          const snapshot = await this.delivery.inspect(this.state.config?.remote ?? 'origin');
          if (snapshot.branch === message.target)
            throw new Error('Les branches source et cible doivent être différentes.');
          if (message.ticketId) {
            // Durable session links remain usable after a restart, even outside assigned tickets.
            const known =
              this.state.ticketDetail?.id === message.ticketId ||
              this.state.ticketSearch?.tickets.some((ticket) => ticket.id === message.ticketId) ||
              this.state.tickets.some((ticket) => ticket.id === message.ticketId);
            if (!known) {
              const linked = this.state.links.some(
                (link) =>
                  link.featureId === message.featureId &&
                  link.ticketId === message.ticketId &&
                  link.projectKey === projectKey(this.state.config!),
              );
              if (!linked) throw new Error('Actualise les tickets avant cette action.');
              this.state.ticketDetail = await this.api().ticketDetail(
                message.ticketId,
                this.state.ticketMetadata,
              );
            }
            this.ticket(message.ticketId);
          }
          if (message.featureId && !this.options.features().some((f) => f.id === message.featureId))
            throw new Error('Feature inconnue.');
          if ((await this.api().branchHead(snapshot.branch)) !== snapshot.head)
            throw new Error(
              'Pousse le commit courant vers le dépôt Azure DevOps configuré avant de créer la PR.',
            );
          const targetHead = await this.api().branchHead(message.target);
          if (!targetHead) throw new Error('Branche cible absente du dépôt configuré.');
          const comparison = await pullRequestDiff(this.delivery, targetHead, snapshot.head);
          this.state.snapshot = snapshot;
          this.state.preview = {
            kind: 'pr',
            targetHead,
            ...comparison,
            fingerprint: snapshot.fingerprint,
            branch: snapshot.branch,
            head: snapshot.head,
            paths: [],
            title: message.title,
            description: message.description,
            target: message.target,
            ticketId: message.ticketId,
            featureId: message.featureId,
          };
          break;
        }
        case 'deliveryCommit':
        case 'deliveryExecute': {
          const previous = this.state.preview;
          if (
            message.type === 'deliveryExecute' &&
            (!previous ||
              previous.kind !== message.kind ||
              previous.fingerprint !== message.fingerprint)
          )
            throw new Error('Aperçu périmé. Prépare un nouvel aperçu.');
          await this.options.withMutation(
            `Livraison : ${message.type === 'deliveryCommit' ? 'commit' : message.kind}`,
            async () => {
              let preview = previous;
              if (message.type === 'deliveryCommit') {
                const result = await this.delivery.previewCommit(
                  message.paths,
                  await this.options.getAgentInstructions(),
                  message.title,
                );
                if (result.snapshot.fingerprint !== message.fingerprint)
                  throw new Error(
                    'Le dépôt a changé. Actualise les fichiers avant de valider le commit.',
                  );
                this.state.snapshot = result.snapshot;
                this.state.preview = preview = result.preview;
                this.publish();
              }
              if (!preview) throw new Error('Aperçu de livraison manquant.');
              const detail = [
                `Branche : ${preview.branch}`,
                `Commit : ${preview.head}`,
                `Titre : ${preview.title}`,
                preview.remote
                  ? `Remote : ${preview.remote} (${this.state.snapshot?.remoteUrl})`
                  : '',
                preview.target
                  ? `Cible : ${preview.target}${preview.targetHead ? ` · ${preview.targetHead}` : ''}`
                  : '',
                preview.kind === 'pr' ? `Azure DevOps : ${projectKey(this.state.config!)}` : '',
                preview.description ?? '',
                preview.paths.length
                  ? `Fichiers complets sélectionnés :\n${preview.paths.join('\n')}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n');
              if (
                !(await this.options.confirm(
                  preview.kind === 'commit'
                    ? 'Créer ce commit local ?'
                    : preview.kind === 'push'
                      ? 'Publier cette branche ?'
                      : 'Créer cette PR brouillon Azure DevOps ?',
                  detail,
                ))
              )
                return;
              if (preview.kind === 'commit') {
                const sha = await this.delivery.commit(preview);
                this.chat(
                  'assistant',
                  `Commit créé : ${sha}. Les autres fichiers indexés ont été conservés. Veux-tu pousser cette branche ? Utilise « Préparer le push ».`,
                );
              } else if (preview.kind === 'push') {
                await this.delivery.push(preview);
                this.chat(
                  'assistant',
                  `Branche ${preview.branch} publiée vers ${preview.remote}. Veux-tu créer une PR Azure DevOps ? Renseigne la cible puis « Préparer la PR brouillon ».`,
                );
              } else {
                const snapshot = await this.delivery.inspect(this.state.config?.remote ?? 'origin');
                if (snapshot.fingerprint !== preview.fingerprint)
                  throw new Error('Le dépôt a changé. Prépare un nouvel aperçu.');
                if ((await this.api().branchHead(preview.branch)) !== preview.head)
                  throw new Error('La branche distante a changé. Prépare un nouvel aperçu.');
                if (
                  !preview.targetHead ||
                  (await this.api().branchHead(preview.target!)) !== preview.targetHead
                )
                  throw new Error(
                    'La branche cible a changé depuis la comparaison. Prépare un nouvel aperçu et relis le diff avant de créer la PR.',
                  );
                const pr = await this.api().createPullRequest({
                  branch: preview.branch,
                  target: preview.target!,
                  title: preview.title,
                  description: preview.description ?? '',
                  ticketId: preview.ticketId,
                });
                this.state.pullRequests.unshift(pr);
                if (preview.featureId)
                  this.associatePullRequest(pr.id, preview.featureId, preview.ticketId);
                this.chat('assistant', `PR brouillon #${pr.id} créée : ${pr.url}`);
              }
              this.state.preview = undefined;
              await this.save();
              this.state.snapshot = await this.delivery.inspect(
                this.state.config?.remote ?? 'origin',
              );
            },
          );
          break;
        }
      }
      if (openFeatureId) await this.options.ensureFeatureSaved?.(openFeatureId);
      await this.save();
      if (openFeatureId) await this.options.openFeature?.(openFeatureId);
    } catch (error) {
      if (message.type === 'devopsCreateFeature')
        this.state.ticketCreateResult = {
          requestId: message.plan.requestId,
          error: (error as Error).message,
        };
      this.state.error = (error as Error).message;
      this.state.preview = undefined;
    } finally {
      this.state.busy = false;
      this.finishOperation?.();
      this.finishOperation = undefined;
      this.operation = undefined;
      this.publish();
    }
  }
}
