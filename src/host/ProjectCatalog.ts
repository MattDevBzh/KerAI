import { mkdir, readFile, realpath, stat, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { StudioProject } from '../shared/projects';
import { WorkspaceLease } from './WorkspaceLease';

const projectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    path: z.string().min(1).max(4000),
    hidden: z.boolean().optional(),
    storagePath: z.string().optional(),
  })
  .strict();
const catalogSchema = z
  .object({
    version: z.literal(1),
    projects: z.array(projectSchema),
    selectedProjectIds: z.array(z.string().uuid()),
  })
  .strict();
type Catalog = z.infer<typeof catalogSchema>;
export type StoredProject = Catalog['projects'][number];

/** User-owned catalog. Project content, agents and workflows are never moved. */
export class ProjectCatalog {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  state: Catalog = { version: 1, projects: [], selectedProjectIds: [] };
  constructor(readonly directory: string) {
    this.file = path.join(directory, 'projects.json');
  }
  async load(): Promise<Catalog> {
    try {
      this.state = catalogSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return structuredClone(this.state);
  }
  private change<T>(action: (state: Catalog) => Promise<T> | T): Promise<T> {
    const work = this.queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const lease = new WorkspaceLease(this.file);
        await lease.acquire();
        try {
          await this.load();
          const next = structuredClone(this.state),
            result = await action(next);
          catalogSchema.parse(next);
          const temporary = `${this.file}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {
              mode: 0o600,
              flag: 'wx',
            });
            await rename(temporary, this.file);
          } finally {
            await unlink(temporary).catch(() => undefined);
          }
          this.state = next;
          return result;
        } finally {
          await lease.release();
        }
      });
    this.queue = work;
    return work;
  }
  async add(
    paths: string[],
    legacy?: { root: string; storagePath: string },
  ): Promise<StudioProject[]> {
    const roots = await Promise.all(
      paths.map(async (root) => {
        if (!path.isAbsolute(root)) throw new Error('Un chemin absolu de dossier est requis.');
        const canonical = await realpath(root);
        const info = await stat(canonical);
        if (!info.isDirectory()) throw new Error('Choisis un dossier de projet.');
        return { root: canonical, info };
      }),
    );
    return this.change(async (state) => {
      const added: StoredProject[] = [];
      for (const { root, info } of roots) {
        let entry = state.projects.find((project) => project.path === root);
        if (!entry)
          for (const candidate of state.projects) {
            const known = await stat(candidate.path).catch(() => undefined);
            if (known && info.ino !== 0 && known.dev === info.dev && known.ino === info.ino) {
              entry = candidate;
              break;
            }
          }
        if (!entry) {
          entry = {
            id: randomUUID(),
            name: path.basename(root) || root,
            path: root,
            ...(legacy?.root === root ? { storagePath: legacy.storagePath } : {}),
          };
          state.projects.push(entry);
        }
        entry.hidden = false;
        added.push(entry);
      }
      if (!state.selectedProjectIds.length && added.length)
        state.selectedProjectIds = [added[0].id];
      return structuredClone(added);
    });
  }
  select(ids: string[]): Promise<void> {
    return this.change((state) => {
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !state.projects.some((project) => project.id === id && !project.hidden))
      )
        throw new Error('La sélection contient un projet absent ou masqué.');
      state.selectedProjectIds = [...ids];
    });
  }
  update(id: string, patch: { name?: string; hidden?: boolean }): Promise<void> {
    return this.change((state) => {
      const entry = state.projects.find((project) => project.id === id);
      if (!entry) throw new Error('Projet inconnu.');
      Object.assign(entry, patch);
      if (entry.hidden)
        state.selectedProjectIds = state.selectedProjectIds.filter((value) => value !== id);
    });
  }
  resolve(ids: string[]): StoredProject[] {
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new Error('Sélectionne au moins un projet.');
    const selected = ids.map((id) => {
      const project = this.state.projects.find((item) => item.id === id && !item.hidden);
      if (!project) throw new Error('Un projet sélectionné est absent ou masqué.');
      return structuredClone(project);
    });
    assertDistinctProjects(selected);
    return selected;
  }
  storage(project: StoredProject): string {
    return project.storagePath ?? path.join(this.directory, 'sessions', project.id);
  }
}

export function assertDistinctProjects(selected: StudioProject[]): void {
  if (new Set(selected.map((project) => project.id)).size !== selected.length)
    throw new Error('Identifiants de projets dupliqués.');
  for (let i = 0; i < selected.length; i++)
    for (let j = i + 1; j < selected.length; j++) {
      const nested = (parent: string, child: string) => {
        const relative = path.relative(parent, child);
        return (
          !relative ||
          (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
        );
      };
      if (nested(selected[i].path, selected[j].path) || nested(selected[j].path, selected[i].path))
        throw new Error(
          'Sélectionne des dossiers distincts : un projet ne doit pas contenir un autre projet sélectionné.',
        );
    }
}
