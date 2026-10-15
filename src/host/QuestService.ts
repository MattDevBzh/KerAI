import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { z } from 'zod';
import { digest, readPrivate, writePrivate } from './SessionFiles';
import { WorkspaceLease } from './WorkspaceLease';
import {
  emptyQuestState,
  quests,
  questById,
  questCaps,
  QUEST_METRICS,
  type QuestMetric,
  type QuestState,
  type QuestAward,
} from '../shared/quests';

export interface QuestFact {
  metric: QuestMetric;
  key: string;
}
const fileSchema = z
  .object({
    version: z.literal(1),
    seen: z.partialRecord(
      z.enum(QUEST_METRICS),
      z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(60),
    ),
    completed: z.record(
      z.string(),
      z.object({ at: z.iso.datetime(), reward: z.number().int().min(1).max(10) }).strict(),
    ),
  })
  .strict();
type Saved = z.infer<typeof fileSchema>;
const empty = (): Saved => ({ version: 1, seen: {}, completed: {} });
// One atomic ledger per installation, shared by all projects and service instances.
const writes = new Map<string, Promise<unknown>>();
export class QuestService extends EventEmitter {
  private saved: Saved = empty();
  private loaded = false;
  private error?: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {
    super();
  }
  snapshot(): QuestState {
    const state = emptyQuestState();
    state.completed = structuredClone(this.saved.completed);
    state.trophies = Object.values(state.completed).reduce(
      (total, award) => total + award.reward,
      0,
    );
    for (const metric of QUEST_METRICS) state.counts[metric] = this.saved.seen[metric]?.length ?? 0;
    if (this.error) state.error = this.error;
    return state;
  }
  publish(earned: string[] = []): void {
    this.emit('state', this.snapshot(), earned);
  }
  private async read(): Promise<Saved> {
    try {
      const data = fileSchema.parse(
        JSON.parse(await readPrivate(this.directory, 'quests.json', 256 * 1024)),
      );
      for (const [id, award] of Object.entries(data.completed)) {
        const quest = questById.get(id);
        if (
          !quest ||
          quest.reward !== award.reward ||
          (data.seen[quest.metric]?.length ?? 0) < quest.target ||
          (quest.previousId && !data.completed[quest.previousId])
        )
          throw new Error('Catalogue de quêtes incompatible.');
      }
      for (const metric of QUEST_METRICS) {
        const seen = data.seen[metric] ?? [];
        if (seen.length > questCaps[metric] || new Set(seen).size !== seen.length)
          throw new Error('Progression invalide.');
      }
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw error;
    }
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const key = join(this.directory, 'quests.json');
    const result = (writes.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(work)
      .catch(() => {
        this.error =
          'Progression indisponible. Le fichier de trophées est conservé ; aucune récompense n’est ajoutée avant sa relecture.';
        this.publish();
      });
    writes.set(key, result);
    this.pending = result;
    void result.then(() => {
      if (writes.get(key) === result) writes.delete(key);
    });
    return result;
  }
  initialize(): Promise<void> {
    return this.enqueue(async () => {
      this.saved = await this.read();
      this.loaded = true;
      this.error = undefined;
      this.publish();
    });
  }
  record(facts: readonly QuestFact[]): Promise<void> {
    if (!facts.length) return Promise.resolve();
    // Capture immutable, bounded identifiers. No paths, prompts or transcript text are stored.
    const captured = facts.map((fact) => ({ metric: fact.metric, key: digest(fact.key) }));
    return this.enqueue(async () => {
      if (!this.loaded || this.error) return;
      if (
        captured.every(
          ({ metric, key }) =>
            (this.saved.seen[metric]?.length ?? 0) >= questCaps[metric] ||
            this.saved.seen[metric]?.includes(key),
        )
      )
        return;
      const lease = new WorkspaceLease(join(this.directory, 'quests.json'));
      await lease.acquire();
      try {
        const next = await this.read();
        let changed = false;
        for (const { metric, key } of captured) {
          const seen = (next.seen[metric] ??= []);
          if (seen.length < questCaps[metric] && !seen.includes(key)) {
            seen.push(key);
            changed = true;
          }
        }
        const earned: string[] = [];
        for (const quest of quests) {
          if (next.completed[quest.id] || (quest.previousId && !next.completed[quest.previousId]))
            continue;
          if ((next.seen[quest.metric]?.length ?? 0) < quest.target) continue;
          next.completed[quest.id] = {
            at: new Date().toISOString(),
            reward: quest.reward,
          } satisfies QuestAward;
          earned.push(quest.id);
          changed = true;
        }
        if (changed)
          await writePrivate(
            this.directory,
            'quests.json',
            JSON.stringify(fileSchema.parse(next)) + '\n',
          );
        this.saved = next;
        this.publish(earned);
      } finally {
        await lease.release();
      }
    });
  }
  async flush(): Promise<void> {
    await this.pending;
  }
}
