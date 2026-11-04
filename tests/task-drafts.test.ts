import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TaskDraftStore } from '../src/host/TaskDraftStore';
import type { TaskDraft } from '../src/shared/taskDrafts';
it('retains separate drafts on disk and rejects stale edits and deletes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kerai-drafts-'));
  try {
    const store = new TaskDraftStore(directory);
    const draft: TaskDraft = {
      id: randomUUID(),
      revision: 0,
      title: 'API',
      description: 'Conserver les routes',
      starter: 'bugfix',
      projectIds: ['a'],
      isolated: true,
      permissionMode: 'manual',
      images: [],
      updatedAt: new Date().toISOString(),
    };
    const [saved] = await store.change(draft.id, 0, draft);
    const other = { ...draft, id: randomUUID(), title: 'Autre tâche' };
    await store.change(other.id, 0, other);
    expect(await new TaskDraftStore(directory).list()).toHaveLength(2);
    await expect(store.change(draft.id, 0, draft)).rejects.toThrow('autre fenêtre');
    await expect(store.change(draft.id, 0)).rejects.toThrow('autre fenêtre');
    expect((await store.list()).find((d) => d.id === saved.id)).toEqual(saved);
    await store.change(saved.id, saved.revision);
    expect(await store.list()).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
