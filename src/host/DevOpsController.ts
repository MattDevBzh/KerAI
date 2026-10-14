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
  createFeature: (ticket: DevOpsTicket) => Promise<string>;
  features: () => Array<{ id: string; title: string }>;
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
  private delivery: DeliveryService;
  private disposed = false;
  private operation?: Promise<void>;
  private initialization?: Promise<void>;
  private finishOperation?: () => void;
  constructor(private options: DevOpsControllerOptions) {
    this.delivery = options.delivery ?? new DeliveryService(options.root);
  }
  getState(): DevOpsState {
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
      try {
        const stored = storedSchema.parse(JSON.parse(await readFile(this.file(), 'utf8')));
        this.state.config = stored.config;
        this.state.links = stored.links.filter((link) =>
          this.options.features().some((feature) => feature.id === link.featureId),
        );
        this.state.history = stored.history;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          this.state.notices.push(
            'Configuration sauvegardée illisible : configure à nouveau Azure DevOps.',
          );
      }
      this.options.guard();
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
    const ticket = this.state.tickets.find((t) => t.id === id);
    if (!ticket) throw new Error('Actualise les tickets avant cette action.');
    return ticket;
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
  }
  async handle(input: DevOpsClientMessage): Promise<void> {
    if (this.disposed) throw new Error('Le menu de livraison est fermé.');
    const message = devOpsMessageSchema.parse(input);
    if (this.state.busy || this.initialization)
      throw new Error('Attends la fin de l’opération de livraison en cours.');
    this.options.guard();
    this.operation = new Promise<void>((resolve) => {
      this.finishOperation = resolve;
    });
    this.state.busy = true;
    this.state.error = undefined;
    this.publish();
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
        case 'devopsLoadTicket': {
          const ticket = this.ticket(message.ticketId),
            result = await this.api().comments(ticket.id);
          ticket.comments = result.comments;
          ticket.commentsLoaded = true;
          ticket.commentsTruncated = result.truncated;
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
          const ticket = this.ticket(message.ticketId);
          const key = projectKey(this.state.config!);
          const existing = this.state.links.find(
            (l) =>
              l.ticketId === ticket.id &&
              l.projectKey === key &&
              this.options.features().some((f) => f.id === l.featureId),
          );
          if (existing) {
            this.chat(
              'assistant',
              `Ce ticket est déjà lié à une feature. Utilise « Ouvrir la feature » sur sa carte.`,
            );
            break;
          }
          const featureId = await this.options.createFeature(structuredClone(ticket));
          await this.link(featureId, ticket.id);
          this.chat(
            'assistant',
            `Feature créée depuis le ticket #${ticket.id}. Tu peux l’ouvrir depuis le tableau Azure DevOps.`,
          );
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
          if (message.ticketId) this.ticket(message.ticketId);
          if (message.featureId && !this.options.features().some((f) => f.id === message.featureId))
            throw new Error('Feature inconnue.');
          if ((await this.api().branchHead(snapshot.branch)) !== snapshot.head)
            throw new Error(
              'Pousse le commit courant vers le dépôt Azure DevOps configuré avant de créer la PR.',
            );
          if (!(await this.api().branchHead(message.target)))
            throw new Error('Branche cible absente du dépôt configuré.');
          this.state.snapshot = snapshot;
          this.state.preview = {
            kind: 'pr',
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
                preview.target ? `Cible : ${preview.target}` : '',
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
      await this.save();
    } catch (error) {
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
