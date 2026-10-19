import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { z } from 'zod';
import { readPrivate, writePrivate } from './SessionFiles';
import { WorkspaceLease } from './WorkspaceLease';
import type { QuestState } from '../shared/quests';
import {
  emptyRewardSelection,
  rewardById,
  unlockedRewards,
  type RewardId,
  type RewardSelection,
  type RewardState,
} from '../shared/rewards';

const schema = z
  .object({
    version: z.literal(1),
    title: z.enum(['architecte', 'dresseur']).nullable(),
    celebration: z.literal('eiffel').nullable(),
    mascot: z.literal('kitten').nullable(),
  })
  .strict();
const writes = new Map<string, Promise<unknown>>();
/** Cosmetic preferences only. Unlocks always come from the verified quest ledger. */
export class RewardService extends EventEmitter {
  private selection = emptyRewardSelection();
  private ready = false;
  private error?: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    private readonly progression: () => QuestState,
  ) {
    super();
  }
  snapshot(): RewardState {
    const progression = this.progression();
    const unlocked = unlockedRewards(progression);
    const selection = { ...this.selection };
    for (const slot of ['title', 'celebration', 'mascot'] as const)
      if (selection[slot] && !unlocked.includes(selection[slot]!)) selection[slot] = null;
    return { ready: this.ready, unlocked, selection, error: this.error ?? progression.error };
  }
  publish() {
    this.emit('state', this.snapshot());
  }
  assertUnlocked(id: RewardId) {
    const state = this.snapshot();
    if (state.error) throw new Error(state.error);
    if (!state.ready) throw new Error('Les récompenses sont encore en cours de lecture.');
    if (!state.unlocked.includes(id))
      throw new Error('Cette récompense n’est pas encore débloquée.');
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const key = join(this.directory, 'rewards.json');
    const result = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    writes.set(key, result);
    this.pending = result;
    void result
      .finally(() => {
        if (writes.get(key) === result) writes.delete(key);
      })
      .catch(() => undefined);
    return result;
  }
  private async read(): Promise<RewardSelection> {
    try {
      const { version: _, ...selection } = schema.parse(
        JSON.parse(await readPrivate(this.directory, 'rewards.json', 4096)),
      );
      return selection;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRewardSelection();
      throw error;
    }
  }
  initialize(): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.selection = await this.read();
        this.ready = true;
        this.error = undefined;
      } catch {
        this.ready = false;
        this.error =
          'Les préférences de récompenses sont illisibles. Le fichier est conservé ; réessaie après sa récupération.';
      }
      this.publish();
    });
  }
  set(id: RewardId, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      this.assertUnlocked(id);
      const kind = rewardById.get(id)!.kind;
      if (kind === 'theme')
        throw new Error('Les thèmes utilisent les réglages personnels de VS Code.');
      const lease = new WorkspaceLease(join(this.directory, 'rewards.json'));
      await lease.acquire();
      try {
        const next = await this.read();
        // One selected title, celebration and mascot; changing one never clears another slot.
        const candidate = {
          version: 1,
          ...next,
          [kind]: enabled ? id : next[kind] === id ? null : next[kind],
        };
        const { version: _, ...selection } = schema.parse(candidate);
        await writePrivate(this.directory, 'rewards.json', JSON.stringify(candidate) + '\n');
        this.selection = selection;
        this.error = undefined;
        this.publish();
      } finally {
        await lease.release();
      }
    });
  }
  async flush() {
    await this.pending.catch(() => undefined);
  }
}
