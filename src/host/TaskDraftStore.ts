import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { taskDraftSchema } from '../core/taskDrafts';
import type { TaskDraft } from '../shared/taskDrafts';
import { WorkspaceLease } from './WorkspaceLease';
/** Drafts own no repository/worktree lease. Revision checks protect other windows. */
export class TaskDraftStore {
  constructor(private readonly directory: string) {}
  async list(): Promise<TaskDraft[]> {
    try {
      return taskDraftSchema
        .array()
        .max(100)
        .parse(JSON.parse(await readFile(join(this.directory, 'drafts.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async change(id: string, revision: number, draft?: TaskDraft): Promise<TaskDraft[]> {
    if (draft && draft.id !== id) throw Error('Identité du brouillon incohérente.');
    const lock = new WorkspaceLease(this.directory);
    await lock.acquire();
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      const drafts = await this.list(),
        current = drafts.find((d) => d.id === id);
      if ((current?.revision ?? 0) !== revision)
        throw Error(
          'Ce brouillon a changé dans une autre fenêtre. Recharge-le avant de modifier sa version enregistrée.',
        );
      const next = drafts.filter((d) => d.id !== id);
      if (draft)
        next.unshift(
          taskDraftSchema.parse({
            ...draft,
            revision: revision + 1,
            updatedAt: new Date().toISOString(),
          }),
        );
      if (next.length > 100)
        throw Error('Cent brouillons sont déjà conservés. Termine ou abandonne un brouillon.');
      await mkdir(this.directory, { recursive: true });
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, join(this.directory, 'drafts.json'));
      return next;
    } finally {
      await rm(temporary, { force: true });
      await lock.release();
    }
  }
}
