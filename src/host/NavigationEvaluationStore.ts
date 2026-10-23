import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Feature } from '../shared/types';
import type {
  NavigationCampaign,
  NavigationEvaluationCommand,
  NavigationEvaluationEntry,
  NavigationEvaluationSnapshot,
} from '../shared/navigationEvaluation';
import {
  evaluationAttempts,
  evaluationRefKey,
  navigationEvaluationReport,
} from '../shared/navigationEvaluation';
import {
  navigationCampaignSchema,
  navigationEvaluationCommandSchema,
  navigationEvaluationInputSchema,
  navigationEvaluationReceiptSchema,
} from '../core/navigationEvaluationSchemas';
export class NavigationEvaluationStore {
  private campaigns: NavigationCampaign[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: { storageRoot: string; features: () => Feature[] }) {}
  private get file() {
    return path.join(this.options.storageRoot, 'evaluation.json');
  }
  async initialize() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.campaigns) || data.campaigns.length > 100)
        throw new Error('Journal de campagne invalide.');
      // Stored receipts are host-owned projections; definitions and inputs remain schema checked.
      this.campaigns = data.campaigns.map((campaign: NavigationCampaign) => {
        const { entries, createdAt, updatedAt, ...definition } = campaign;
        navigationCampaignSchema.parse(definition);
        if (!Array.isArray(entries) || entries.length > 5000)
          throw new Error('Journal trop volumineux.');
        for (const entry of entries) {
          const { receipts, savedAt, ...input } = entry;
          navigationEvaluationInputSchema.parse(input);
          if (!Array.isArray(receipts) || receipts.length > 100 || typeof savedAt !== 'string')
            throw new Error('Reçu invalide.');
          receipts.forEach((receipt) => navigationEvaluationReceiptSchema.parse(receipt));
        }
        return campaign;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  snapshot(): NavigationEvaluationSnapshot {
    return {
      campaigns: structuredClone(this.campaigns),
      reports: Object.fromEntries(
        this.campaigns.map((campaign) => [campaign.id, navigationEvaluationReport(campaign)]),
      ),
    };
  }
  async handle(
    raw: NavigationEvaluationCommand,
  ): Promise<{ message?: string; exportText?: string; exportName?: string }> {
    const command = navigationEvaluationCommandSchema.parse(raw);
    if (command.action === 'evaluationLoad') {
      await this.queue.catch(() => undefined);
      return {};
    }
    if (command.action === 'evaluationExport') {
      await this.queue.catch(() => undefined);
      const campaign = this.campaigns.find((c) => c.id === command.campaignId);
      if (!campaign) throw new Error('Campagne inconnue.');
      return { exportText: this.export(campaign), exportName: 'navigation-evaluation.json' };
    }
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        const backup = structuredClone(this.campaigns);
        try {
          const now = new Date().toISOString();
          if (command.action === 'evaluationSaveCampaign') {
            if (
              this.campaigns.length >= 100 &&
              !this.campaigns.some((c) => c.id === command.campaign.id)
            )
              throw new Error('Limite de 100 campagnes atteinte.');
            const old = this.campaigns.find((c) => c.id === command.campaign.id);
            if (
              old?.entries.some(
                (row) =>
                  row.repetition > command.campaign.repetitions ||
                  (['analysis', 'development', 'verification'].includes(row.phase) &&
                    !command.campaign.phases.includes(row.phase as 'analysis')) ||
                  (row.ticketId &&
                    !command.campaign.tickets.some((ticket) => ticket.id === row.ticketId)),
              )
            )
              throw new Error(
                'La modification retirerait un ticket, une phase ou une répétition déjà mesuré.',
              );
            const campaign = {
              ...command.campaign,
              entries: old?.entries ?? [],
              createdAt: old?.createdAt ?? now,
              updatedAt: now,
            };
            this.campaigns = [...this.campaigns.filter((c) => c.id !== campaign.id), campaign];
          } else {
            const campaign = this.campaigns.find((c) => c.id === command.campaignId);
            if (!campaign) throw new Error('Campagne inconnue.');
            if (command.action === 'evaluationDeleteEntry')
              campaign.entries = campaign.entries.filter((row) => row.id !== command.entryId);
            else {
              const entry = command.entry;
              if (
                campaign.entries.length >= 5000 &&
                !campaign.entries.some((row) => row.id === entry.id)
              )
                throw new Error('Limite de 5 000 entrées atteinte.');
              if (
                entry.repetition > campaign.repetitions ||
                (entry.ticketId && !campaign.tickets.some((ticket) => ticket.id === entry.ticketId))
              )
                throw new Error('Ticket ou répétition hors campagne.');
              const keys = entry.attemptRefs.map(evaluationRefKey);
              if (
                new Set(keys).size !== keys.length ||
                campaign.entries.some(
                  (row) =>
                    row.id !== entry.id &&
                    row.attemptRefs.some((ref) => keys.includes(evaluationRefKey(ref))),
                )
              )
                throw new Error(
                  'Tentative déjà comptée dans cette campagne. Utilisez une entrée non ventilée pour un appel mixte.',
                );
              const attempts = evaluationAttempts(this.options.features());
              const existing = campaign.entries.find((row) => row.id === entry.id);
              const receipts = entry.attemptRefs.map((ref) => {
                const frozen = existing?.receipts.find(
                  (receipt) => evaluationRefKey(receipt.ref) === evaluationRefKey(ref),
                );
                if (frozen) return structuredClone(frozen);
                const source = attempts.find(
                  (row) => evaluationRefKey(row.ref) === evaluationRefKey(ref),
                );
                if (!source)
                  throw new Error('Tentative introuvable. Conservez sa mesure comme inconnue.');
                if (source.status === 'running')
                  throw new Error('Attendez la fin de la tentative pour figer son usage.');
                return {
                  ref,
                  status: source.status,
                  model: source.model,
                  usage: source.usage ? structuredClone(source.usage) : undefined,
                };
              });
              const row: NavigationEvaluationEntry = { ...entry, receipts, savedAt: now };
              campaign.entries = [...campaign.entries.filter((row) => row.id !== entry.id), row];
            }
            campaign.updatedAt = now;
          }
          await mkdir(this.options.storageRoot, { recursive: true, mode: 0o700 });
          const temp = path.join(this.options.storageRoot, `evaluation-${randomUUID()}.tmp`);
          await writeFile(temp, JSON.stringify({ version: 1, campaigns: this.campaigns }), {
            flag: 'wx',
            mode: 0o600,
          });
          await rename(temp, this.file);
          return { message: 'Journal de campagne enregistré.' };
        } catch (error) {
          this.campaigns = backup;
          throw error;
        }
      });
    this.queue = task;
    return task;
  }
  private export(campaign: NavigationCampaign) {
    const opaque = (value: string) =>
      createHash('sha256').update(`${campaign.id}:${value}`).digest('hex').slice(0, 20);
    const report = navigationEvaluationReport(campaign);
    return JSON.stringify(
      {
        version: 1,
        campaignId: opaque(campaign.id),
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        repetitions: campaign.repetitions,
        phases: campaign.phases,
        ticketIds: campaign.tickets.map((ticket) => opaque(ticket.id)),
        entries: campaign.entries.map(
          ({ configuration, observations, attemptRefs, receipts, ticketId, ...entry }) => ({
            ...entry,
            id: opaque(entry.id),
            ticketId: ticketId ? opaque(ticketId) : undefined,
            configurationHashes: Object.fromEntries(
              Object.entries(configuration).map(([key, value]) => [
                key,
                value ? opaque(value) : null,
              ]),
            ),
            attemptRefs: attemptRefs.map((ref) => opaque(evaluationRefKey(ref))),
            receipts: receipts.map((receipt) => ({
              attemptId: opaque(evaluationRefKey(receipt.ref)),
              status: receipt.status,
              modelHash: receipt.model ? opaque(receipt.model) : null,
              usage: receipt.usage
                ? {
                    source: receipt.usage.source,
                    inputTokens: receipt.usage.inputTokens,
                    outputTokens: receipt.usage.outputTokens,
                    cacheReadTokens: receipt.usage.cacheReadTokens,
                    cacheWriteTokens: receipt.usage.cacheWriteTokens,
                    durationMs: receipt.usage.durationMs,
                    cost: receipt.usage.cost,
                    unit: receipt.usage.unit,
                    incompleteTokens: receipt.usage.incompleteTokens,
                    incompleteCost: receipt.usage.incompleteCost,
                    byModel: receipt.usage.byModel
                      ? Object.fromEntries(
                          Object.entries(receipt.usage.byModel).map(([model, usage]) => [
                            opaque(model),
                            {
                              inputTokens: usage.inputTokens,
                              outputTokens: usage.outputTokens,
                              cost: usage.cost,
                              incompleteTokens: usage.incompleteTokens,
                              incompleteCost: usage.incompleteCost,
                            },
                          ]),
                        )
                      : undefined,
                  }
                : undefined,
            })),
          }),
        ),
        report: {
          ...report,
          comparisons: report.comparisons.map((pair) => ({
            ...pair,
            ticketId: opaque(pair.ticketId),
          })),
        },
        limitations: [
          'Temps déclarés manuellement, valeurs manquantes conservées inconnues.',
          'Reçus fournisseur figés depuis les tentatives, sans événement comptable supplémentaire.',
          'Médianes sur les seules paires admissibles ; échecs conservés dans les totaux.',
          'Aucun nom de projet, chemin, URL, prompt, capture ou donnée métier inclus.',
        ],
      },
      null,
      2,
    );
  }
}
