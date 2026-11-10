import { selectPrSessionContext } from './PrSessionContext';
import { missingPrRuleReferences } from '../shared/prRuleReferences';
import { AzureDevOpsHttpError, devOpsErrorMessage } from './DevOpsErrors';
import type { PrSessionContextCatalog, PrSessionContextSnapshot } from '../shared/prSessionContext';
import { randomUUID } from 'node:crypto';
import type { DeliveryService } from './DeliveryService';
import type { PrAdministrationApi, PrAdminThread } from './PrAdministrationApi';
import { prAdministrationDiff, prHash } from './PrAdministrationDiff';
import { prAdminProposalSchema } from '../core/prAdministrationSchemas';
import {
  defaultPrAdministrationSettings,
  type PrAdministrationRecord,
  type PrAdministrationState,
  type PrAdministrationMessage,
  type PrAdministrationSettings,
  type PrAdminSnapshot,
  type PrDiffBlock,
  type PrAdminModelProposal,
  type PrAdminAction,
  type PrAnnotationReceipt,
} from '../shared/prAdministration';
import type { DeliverySession } from '../shared/pullRequestPreparation';
export interface PrAdministrationOptions {
  scope: () => { key: string; session: DeliverySession } | undefined;
  api: (signal?: AbortSignal) => PrAdministrationApi;
  delivery: () => DeliveryService;
  ensureCommit: (head: string) => Promise<void>;
  context?: () => PrSessionContextCatalog;
  generate: (input: {
    sessionContext?: PrSessionContextSnapshot;
    settings: PrAdministrationSettings;
    snapshot: PrAdminSnapshot;
    blocks: PrDiffBlock[];
    signal: AbortSignal;
  }) => Promise<{ proposal: PrAdminModelProposal; model?: string }>;
  save: () => Promise<void>;
  publish: () => void;
  mutate: <T>(label: string, work: () => Promise<T>) => Promise<T>;
  confirm: (title: string, detail: string) => Promise<boolean>;
}
const sameCode = (a: PrAdminSnapshot, b: PrAdminSnapshot) =>
  a.id === b.id &&
  a.sourceHead === b.sourceHead &&
  a.targetHead === b.targetHead &&
  a.baseHead === b.baseHead &&
  a.iteration === b.iteration &&
  a.sourceBranch === b.sourceBranch &&
  a.targetBranch === b.targetBranch &&
  a.status === b.status;
const sameSnapshot = (a: PrAdminSnapshot, b: PrAdminSnapshot) =>
  sameCode(a, b) && a.title === b.title && a.description === b.description;
const marker = (receipt: PrAnnotationReceipt) => `<!-- kerai-pr:${receipt.nonce} -->`;
const fullBody = (content: string, receipt: PrAnnotationReceipt) =>
  `${content}\n\n${marker(receipt)}`;
const rootComment = (thread: PrAdminThread) =>
  thread.comments.find((comment) => !comment.parentCommentId);
function protectedReason(
  thread: PrAdminThread | undefined,
  receipt: PrAnnotationReceipt,
  block?: PrDiffBlock,
) {
  const comment = thread && rootComment(thread);
  if (!thread || thread.isDeleted || !comment || comment.isDeleted)
    return 'Annotation supprimée ou introuvable : aucune recréation automatique.';
  if (thread.comments.length !== 1)
    return 'Un humain a repris ce fil. Intervention manuelle requise.';
  if (
    comment.author?.id !== receipt.actorId ||
    comment.content !== receipt.body ||
    thread.status !== receipt.status
  )
    return 'Le commentaire ou le statut a été modifié hors de cette intervention.';
  if (
    block &&
    (thread.threadContext?.filePath.replace(/^\//, '') !== block.path ||
      thread.threadContext?.[block.side === 'right' ? 'rightFileStart' : 'leftFileStart']?.line !==
        block.startLine)
  )
    return 'La position suivie par Azure diffère du bloc actuel. Vérifie le fil dans Azure.';
}
export class PrAdministrationService {
  records: Record<string, PrAdministrationRecord> = {};
  private state?: PrAdministrationState;
  private abort?: AbortController;
  constructor(private options: PrAdministrationOptions) {}
  reset() {
    this.state = this.options.scope()
      ? { settings: structuredClone(this.record().settings) }
      : undefined;
  }
  getState() {
    return this.state;
  }
  cancel() {
    this.abort?.abort();
  }
  private progress(message: string) {
    this.state!.progress = message;
    this.options.publish();
  }
  private scope() {
    const scope = this.options.scope();
    if (!scope) throw new Error('Ouvre la livraison depuis la session associée à la PR.');
    return scope;
  }
  private record() {
    const { key } = this.scope();
    return (this.records[key] ??= {
      settings: structuredClone(defaultPrAdministrationSettings),
      annotations: {},
    });
  }
  private async snapshot(id: number, api: PrAdministrationApi) {
    const value = await api.snapshot(id);
    if (value.status !== 'active')
      throw new Error('Cette PR n’est plus active. Aucune intervention publiée.');
    if (value.sourceBranch !== `refs/heads/${this.scope().session.branch}`)
      throw new Error('Cette PR ne porte pas sur la branche de la session sélectionnée.');
    return value;
  }
  private annotations(id: number) {
    return (this.record().annotations[String(id)] ??= []);
  }
  private async reconcile(api: PrAdministrationApi, snapshot: PrAdminSnapshot) {
    const threads = await api.threads(snapshot),
      receipts = this.annotations(snapshot.id);
    let changed = false;
    for (const receipt of receipts) {
      if (receipt.threadId) continue;
      const matches = threads.filter((thread) => {
        const comment = rootComment(thread);
        return (
          comment?.author?.id === receipt.actorId &&
          comment.content === receipt.body &&
          comment.content.includes(marker(receipt))
        );
      });
      if (matches.length === 1) {
        const thread = matches[0],
          comment = rootComment(thread)!;
        receipt.threadId = thread.id;
        receipt.commentId = comment.id;
        receipt.uncertain = false;
        changed = true;
      }
    }
    if (changed) await this.options.save();
    return threads;
  }
  async handle(message: PrAdministrationMessage) {
    this.scope();
    this.state ??= { settings: structuredClone(this.record().settings) };
    this.state.error = undefined;
    try {
      if (message.type === 'deliveryPrAdminLoadContext') {
        if (!this.options.context)
          throw new Error('Le contexte de cette session est indisponible.');
        this.state.contextCatalog = this.options.context();
        return;
      }
      if (message.type === 'deliveryPrAdminSettings') {
        this.contextSnapshot(message.settings);
        this.record().settings = structuredClone(message.settings);
        const catalog = this.state.contextCatalog;
        this.reset();
        this.state!.contextCatalog = catalog;
        await this.options.save();
        return;
      }
      if (message.type === 'deliveryPrAdminCancel') {
        this.cancel();
        return;
      }
      if (message.type === 'deliveryPrAdminPreview') {
        this.abort = new AbortController();
        this.state.generating = true;
        this.options.publish();
        try {
          await this.options.mutate('Préparation des interventions sur la PR', () =>
            this.prepare(message.pullRequestId, this.abort!.signal),
          );
        } finally {
          this.state.generating = false;
          this.state.progress = undefined;
          this.abort = undefined;
        }
      } else {
        await this.options.mutate('Publication des interventions sur la PR', () =>
          this.apply(message.previewId, message.changes),
        );
      }
    } catch (error) {
      this.state.error = devOpsErrorMessage(error);
      throw error;
    } finally {
      this.state.progress = undefined;
    }
  }
  private contextSnapshot(settings = this.record().settings) {
    if (!this.options.context) {
      if (settings.sessionContext?.length)
        throw new Error('Le contexte de cette session est indisponible.');
      return undefined;
    }
    const catalog = this.options.context();
    if (catalog.featureId !== this.scope().session.featureId)
      throw new Error('Le contexte appartient à une autre session.');
    this.state!.contextCatalog = catalog;
    return selectPrSessionContext(catalog, settings.sessionContext);
  }
  private assertContext(expected?: PrSessionContextSnapshot) {
    if (expected && this.contextSnapshot()?.fingerprint !== expected.fingerprint)
      throw new Error(
        'Le contexte de la session a changé. Prépare un nouvel aperçu avant publication.',
      );
  }
  private async prepare(id: number, signal: AbortSignal) {
    this.progress('Lecture de la PR et vérification des branches dans Azure…');
    const api = this.options.api(signal),
      snapshot = await this.snapshot(id, api),
      settings = structuredClone(this.record().settings);
    if (!settings.comments && !settings.title && !settings.description)
      throw new Error('Autorise au moins un type de proposition pour cet agent.');
    this.progress('Récupération de l’historique et comparaison des fichiers de la PR…');
    const changes = await api.changes(snapshot);
    await this.options.ensureCommit(snapshot.targetHead);
    await this.options.ensureCommit(snapshot.sourceHead);
    await this.options.ensureCommit(snapshot.baseHead);
    const { blocks, warnings } = await prAdministrationDiff(
      this.options.delivery(),
      snapshot,
      changes.changes,
    );
    if (changes.partial)
      warnings.push('Azure a limité la liste des fichiers. Le périmètre est partiel.');
    if (!blocks.length && settings.comments && !settings.title && !settings.description)
      throw new Error(
        `Aucun bloc de code ne peut être annoté dans cette PR. ${warnings.slice(0, 3).join(' ')} Active les propositions de titre ou de description, ou ajoute les commentaires dans Azure.`,
      );
    this.progress('Lecture du contexte et des commentaires existants…');
    const threads = settings.comments ? await this.reconcile(api, snapshot) : [];
    if (signal.aborted) throw new Error('Préparation arrêtée.');
    const sessionContext = this.contextSnapshot(settings);
    this.progress('L’agent prépare les interventions…');
    const generated = await this.options.generate({
      settings,
      snapshot,
      blocks,
      signal,
      sessionContext,
    });
    this.assertContext(sessionContext);
    if (signal.aborted) throw new Error('Préparation arrêtée.');
    this.progress('Vérification des propositions et de la version de la PR…');
    const proposal = prAdminProposalSchema.parse(generated.proposal);
    if (
      (proposal.comments.length && !settings.comments) ||
      (proposal.title !== undefined && !settings.title) ||
      (proposal.description !== undefined && !settings.description)
    )
      throw new Error(
        'L’agent a proposé une action non autorisée. Ajuste ses consignes puis réessaie.',
      );
    if (!sameSnapshot(snapshot, await this.snapshot(id, api)))
      throw new Error('La PR a changé pendant la rédaction. Prépare un nouvel aperçu.');
    const actions: PrAdminAction[] = [];
    for (const field of ['title', 'description'] as const) {
      const content = proposal[field];
      if (content !== undefined)
        actions.push({
          id: field,
          kind: field,
          before: snapshot[field],
          content,
          operation: content === snapshot[field] ? 'unchanged' : 'update',
        });
    }
    const keys = new Set<string>(),
      annotated = new Set<string>();
    for (const item of proposal.comments) {
      const block = blocks.find((block) => block.id === item.blockId);
      if (!block)
        throw new Error('L’agent a désigné un bloc absent du diff vérifié. Aucune publication.');
      const missingRules = missingPrRuleReferences(item.rule, [
        settings.instructions,
        settings.context,
        sessionContext?.summary ?? '',
        ...(sessionContext?.sources.map((source) => source.content) ?? []),
      ]);
      if (missingRules.length)
        throw new Error(
          `Référence(s) introuvable(s) dans les textes transmis : ${missingRules.join(', ')} (proposition « ${item.rule} »). Le résumé automatique contient seulement un extrait du compte rendu. Sélectionne toutes les parties du bilan dans « Ajouter du contexte depuis la session », ou colle le texte complet dans « Règles et contexte de la session », puis enregistre la mission. Aucune publication.`,
        );
      const key = prHash(`${block.stableKey}:${item.rule.toLocaleLowerCase()}`);
      if (keys.has(key))
        throw new Error('L’agent a proposé une annotation en double. Relance la préparation.');
      keys.add(key);
      annotated.add(block.id);
      const content = `**${item.rule || 'Contexte du changement'}**\n\n${item.explanation}${item.reference ? `\n\nRéférence : ${item.reference}` : ''}\n\n_Annotation préparée avec KerAI, relue avant publication._`;
      const receipt = this.annotations(id).find((receipt) => receipt.key === key);
      const thread = receipt && threads.find((thread) => thread.id === receipt.threadId);
      const reason = receipt
        ? receipt.uncertain && !receipt.threadId
          ? 'Une publication précédente reste incertaine. Vérifie Azure avant toute nouvelle tentative.'
          : protectedReason(thread, receipt, block)
        : undefined;
      actions.push({
        id: key,
        kind: 'comment',
        key,
        block,
        rule: item.rule,
        content,
        threadId: receipt?.threadId,
        commentId: receipt?.commentId,
        operation: reason
          ? 'protected'
          : receipt
            ? fullBody(content, receipt) === receipt.body
              ? 'unchanged'
              : 'update'
            : 'create',
        reason,
      });
    }
    if (annotated.size < blocks.length)
      warnings.push(
        `${blocks.length - annotated.size} bloc(s) sans annotation proposée. Cela ne constitue pas une vérification de conformité.`,
      );
    this.state!.preview = {
      id: randomUUID(),
      snapshot,
      featureId: this.scope().session.featureId,
      summary: proposal.summary,
      model: generated.model,
      actions,
      warnings: [...warnings, ...(sessionContext?.warnings ?? [])],
      sessionContext,
      blockCount: blocks.length,
      annotatedBlocks: annotated.size,
      threadStatus: settings.threadStatus,
      completed: [],
    };
    this.state!.result = undefined;
  }
  private async apply(previewId: string, changes: { id: string; content: string }[]) {
    const preview = this.state!.preview;
    if (
      !preview ||
      preview.id !== previewId ||
      preview.featureId !== this.scope().session.featureId
    )
      throw new Error('Aperçu périmé. Prépare à nouveau les interventions.');
    if (new Set(changes.map((change) => change.id)).size !== changes.length)
      throw new Error('Sélection en double.');
    const selected = changes
      .map((change) => {
        const action = preview.actions.find((action) => action.id === change.id);
        if (!action || action.operation === 'protected' || action.operation === 'unchanged')
          throw new Error('Cette action n’est pas autorisée dans l’aperçu.');
        const content = change.content.trim(),
          limit = action.kind === 'title' ? 200 : action.kind === 'description' ? 4000 : 6000;
        if (!content || content.length > limit || content.includes('<!-- kerai-pr:'))
          throw new Error('Texte de proposition invalide.');
        return { ...action, content };
      })
      .filter((action) => !preview.completed.includes(action.id));
    if (!selected.length) {
      this.state!.result = 'Les actions sélectionnées sont déjà publiées.';
      return;
    }
    this.assertContext(preview.sessionContext);
    const api = this.options.api();
    let current = await this.snapshot(preview.snapshot.id, api);
    if (!sameSnapshot(current, preview.snapshot))
      throw new Error(
        'La PR ou ses champs ont changé. Prépare un nouvel aperçu pour préserver les modifications.',
      );
    const detail = [
      preview.snapshot.url,
      `Session : ${this.scope().session.title}`,
      `Commit : ${current.sourceHead}`,
      `Statut des nouveaux fils : ${preview.threadStatus}`,
      ...selected.map(
        (action) =>
          `${action.kind === 'comment' ? `${action.block!.path}:${action.block!.startLine} · ${action.operation}` : action.kind}\n${action.content}`,
      ),
    ].join('\n\n');
    if (!(await this.options.confirm('Publier ces interventions sur la PR ?', detail))) return;
    this.assertContext(preview.sessionContext);
    current = await this.snapshot(current.id, api);
    if (!sameSnapshot(current, preview.snapshot))
      throw new Error('La PR a changé depuis la confirmation. Relis un nouvel aperçu.');
    const actorId = selected.some((action) => action.kind === 'comment') ? await api.actorId() : '';
    for (const action of selected) {
      this.progress(`Publication des interventions : ${preview.completed.length} déjà publiée(s)…`);
      this.assertContext(preview.sessionContext);
      current = await this.snapshot(current.id, api);
      if (!sameSnapshot(current, preview.snapshot))
        throw new Error(
          'La PR a changé pendant la publication. Les actions restantes sont arrêtées.',
        );
      if (action.kind === 'comment')
        await this.publishComment(api, current, action, preview.threadStatus, actorId);
      else {
        try {
          await api.updateField(current, action.kind, action.content);
        } catch (error) {
          const after = await this.snapshot(current.id, api).catch(() => undefined);
          if (!after || !sameCode(after, current) || after[action.kind] !== action.content)
            throw error;
        }
        const after = await this.snapshot(current.id, api);
        if (!sameCode(after, current) || after[action.kind] !== action.content)
          throw new Error(
            'La modification du champ n’a pas pu être confirmée. Vérifie Azure avant de reprendre.',
          );
        // Preserve a concurrent edit to the other field: stop subsequent writes rather than adopting it.
        const other = action.kind === 'title' ? 'description' : 'title';
        preview.snapshot = { ...current, [action.kind]: action.content };
        if (after[other] !== current[other]) {
          preview.completed.push(action.id);
          this.state!.result = `${preview.completed.length} intervention(s) publiée(s).`;
          throw new Error(
            'Un autre champ a été modifié pendant la publication. Les actions restantes sont arrêtées.',
          );
        }
      }
      preview.completed.push(action.id);
      this.state!.result = `${preview.completed.length} intervention(s) publiée(s).`;
      await this.options.save();
      this.options.publish();
    }
  }
  private async publishComment(
    api: PrAdministrationApi,
    snapshot: PrAdminSnapshot,
    action: PrAdminAction,
    status: import('../shared/prAdministration').PrThreadStatus,
    actorId: string,
  ) {
    const receipts = this.annotations(snapshot.id);
    await this.reconcile(api, snapshot);
    let receipt = receipts.find((receipt) => receipt.key === action.key);
    if (receipt?.threadId) {
      if (receipt.actorId !== actorId)
        throw new Error(
          'Le compte Azure a changé. Les annotations de l’autre compte sont conservées.',
        );
      const thread = await api.thread(snapshot, receipt.threadId),
        comment = rootComment(thread);
      const desired = fullBody(action.content, receipt);
      // A repeated PATCH is safe only while the entire thread remains untouched by a human.
      if (
        comment?.content === desired &&
        thread.comments.length === 1 &&
        !thread.isDeleted &&
        !comment.isDeleted &&
        comment.author?.id === receipt.actorId &&
        thread.status === receipt.status &&
        !protectedReason(thread, { ...receipt, body: desired }, action.block)
      ) {
        receipt.body = desired;
        await this.options.save();
        return;
      }
      const reason = protectedReason(thread, receipt, action.block);
      if (reason) throw new Error(reason);
      if (receipt.actorId !== actorId)
        throw new Error(
          'Le compte Azure a changé. Les annotations de l’autre compte sont conservées.',
        );
      try {
        await api.updateComment(snapshot, receipt.threadId, receipt.commentId!, desired);
      } catch (error) {
        const after = await api.thread(snapshot, receipt.threadId).catch(() => undefined);
        if (rootComment(after ?? thread)?.content !== desired) throw error;
      }
      const after = await api.thread(snapshot, receipt.threadId);
      if (rootComment(after)?.content !== desired)
        throw new Error(
          'La mise à jour du commentaire n’est pas confirmée. Vérifie le fil dans Azure.',
        );
      receipt.body = desired;
      await this.options.save();
      // Existing thread statuses are never reset by regeneration.
      return;
    }
    if (receipt?.uncertain)
      throw new Error(
        'Le résultat d’un ajout précédent est incertain. Vérifie la PR dans Azure ; cet ajout ne sera pas renvoyé automatiquement.',
      );
    if (action.operation === 'update')
      throw new Error(
        'L’annotation à mettre à jour n’est plus disponible. Prépare un nouvel aperçu.',
      );
    if (receipts.length >= 2000)
      throw new Error('Limite d’annotations conservées atteinte pour cette session et cette PR.');
    receipt = { key: action.key!, nonce: randomUUID(), actorId, body: '', status, uncertain: true };
    receipt.body = fullBody(action.content, receipt);
    receipts.push(receipt);
    try {
      await this.options.save(); // Durable intent must exist before the external write.
    } catch (error) {
      receipts.splice(receipts.indexOf(receipt), 1);
      throw error;
    }
    try {
      const thread = await api.createThread(snapshot, action.block!, receipt.body, status),
        comment = rootComment(thread);
      if (!comment || comment.content !== receipt.body || comment.author?.id !== actorId)
        throw new Error('L’ajout du commentaire n’a pas été confirmé.');
      receipt.threadId = thread.id;
      receipt.commentId = comment.id;
      receipt.status = thread.status;
      receipt.uncertain = false;
      await this.options.save();
    } catch (error) {
      // A definite rejection created nothing. Keep ambiguous network/server failures protected.
      if (!receipt.threadId && error instanceof AzureDevOpsHttpError && error.rejectedWrite) {
        const index = receipts.indexOf(receipt);
        receipts.splice(index, 1);
        try {
          await this.options.save();
        } catch (saveError) {
          receipts.splice(index, 0, receipt);
          throw saveError;
        }
        throw error;
      }
      await this.reconcile(api, snapshot).catch(() => undefined);
      if (!receipt.threadId) throw error;
    }
  }
}
