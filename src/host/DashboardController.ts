import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dashboardConfigSchema } from '../core/dashboardSchemas';
import {
  defaultDashboardConfig,
  type DashboardConfig,
  type DashboardData,
  type DashboardModule,
  type DashboardState,
} from '../shared/dashboard';
import type { DevOpsController } from './DevOpsController';

interface Source {
  id: string;
  name: string;
  devops: DevOpsController;
}
/** One timer and one persisted layout shared by the cockpit and its auxiliary window. */
export class DashboardController {
  private state: DashboardState = { revision: 0, config: defaultDashboardConfig(), data: {} };
  private timer?: ReturnType<typeof setTimeout>;
  private visible = new Set<string>();
  private pending?: Promise<void>;
  private cancellation?: AbortController;
  private writes: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private initialized = false;
  private disposed = false;
  constructor(
    private directory: string,
    private sources: () => Source[],
    private publish: (state: DashboardState) => void,
  ) {}
  snapshot() {
    return structuredClone(this.state);
  }
  async initialize() {
    if (this.initialized) return;
    try {
      const stored = JSON.parse(
        await readFile(path.join(this.directory, 'dashboard.json'), 'utf8'),
      );
      this.state.config = dashboardConfigSchema.parse(stored.config);
      this.state.revision =
        Number.isSafeInteger(stored.revision) && stored.revision >= 0 ? stored.revision : 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.state.error =
          'Disposition sauvegardée illisible. La disposition par défaut est affichée ; elle remplacera la sauvegarde uniquement après une modification.';
    }
    this.initialized = true;
    this.emit();
  }
  private emit() {
    if (!this.disposed) this.publish(this.snapshot());
  }
  save(config: DashboardConfig, revision: number): Promise<void> {
    const work = this.writes
      .catch(() => undefined)
      .then(async () => {
        const parsed = dashboardConfigSchema.parse(config);
        if (revision !== this.state.revision)
          throw new Error(
            'Le dashboard a été modifié dans l’autre fenêtre. Les réglages actualisés sont affichés ; réessaie ta modification.',
          );
        const next = { config: parsed, revision: revision + 1 };
        await mkdir(this.directory, { recursive: true });
        const file = path.join(this.directory, 'dashboard.json'),
          temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {
            flag: 'wx',
            mode: 0o600,
          });
          await rename(temporary, file);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
        this.generation++;
        this.cancellation?.abort();
        this.state = { ...next, data: {} };
        this.emit();
        this.schedule();
        if (this.visible.size) void this.refresh();
      });
    this.writes = work;
    return work;
  }
  setVisible(surface: string, visible: boolean) {
    const wasVisible = this.visible.size > 0;
    if (visible) this.visible.add(surface);
    else this.visible.delete(surface);
    if (wasVisible && !this.visible.size) {
      this.generation++;
      this.cancellation?.abort();
    }
    this.schedule();
    if (visible && (!wasVisible || !Object.keys(this.state.data).length)) void this.refresh();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.disposed && this.visible.size && this.state.config.refreshSeconds)
      this.timer = setTimeout(() => void this.refresh(), this.state.config.refreshSeconds * 1000);
  }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    const generation = this.generation,
      config = structuredClone(this.state.config);
    this.cancellation = new AbortController();
    this.pending = this.load(config, generation, this.cancellation.signal).finally(() => {
      this.pending = undefined;
      this.schedule();
      if (generation !== this.generation && this.visible.size) void this.refresh();
    });
    return this.pending;
  }
  private async load(config: DashboardConfig, generation: number, signal: AbortSignal) {
    const cache = new Map<
      string,
      Promise<Awaited<ReturnType<DevOpsController['dashboardRead']>>>
    >();
    for (const module of config.modules.filter((m) => m.kind === 'tickets' || m.kind === 'prs')) {
      if (this.disposed || generation !== this.generation) return;
      const previous = this.state.data[module.id];
      this.state.data[module.id] = {
        ...(previous ?? { tickets: [], prs: [], errors: [], partial: false }),
        loading: true,
      };
      this.emit();
      const data: DashboardData = {
        tickets: [],
        prs: [],
        errors: [],
        partial: false,
        loading: false,
      };
      const sources = this.sources().filter(
        (s) =>
          (!config.projectIds.length || config.projectIds.includes(s.id)) &&
          (!module.filters.projectIds.length || module.filters.projectIds.includes(s.id)),
      );
      if (!sources.length)
        data.errors.push(
          'Aucun projet disponible pour ces filtres. Ajoute un projet dans Sessions.',
        );
      for (const source of sources) {
        if (this.disposed || generation !== this.generation) return;
        const key = JSON.stringify([source.id, module.kind, module.filters]);
        try {
          let request = cache.get(key);
          if (!request) {
            request = source.devops.dashboardRead(module, signal);
            cache.set(key, request);
          }
          const result = await request;
          data.tickets.push(
            ...result.tickets.map((item) => ({
              projectId: source.id,
              projectName: source.name,
              item,
            })),
          );
          data.prs.push(
            ...result.prs.map((item) => ({ projectId: source.id, projectName: source.name, item })),
          );
          data.partial ||= result.partial;
        } catch (error) {
          data.errors.push(`${source.name} : ${(error as Error).message}`);
        }
      }
      if (this.disposed || generation !== this.generation) return;
      // Retain previous values only on a total failure, with their original freshness and an explicit error.
      if (data.errors.length === sources.length && sources.length && previous?.updatedAt) {
        data.tickets = previous.tickets;
        data.prs = previous.prs;
        data.updatedAt = previous.updatedAt;
        data.partial = true;
      } else if (sources.length) data.updatedAt = new Date().toISOString();
      data.tickets.sort((a, b) =>
        (b.item.changedDate ?? '').localeCompare(a.item.changedDate ?? ''),
      );
      data.prs.sort((a, b) => (b.item.creationDate ?? '').localeCompare(a.item.creationDate ?? ''));
      this.state.data[module.id] = data;
      this.emit();
    }
  }
  async dispose() {
    this.disposed = true;
    this.generation++;
    this.cancellation?.abort();
    clearTimeout(this.timer);
    this.visible.clear();
    await this.writes.catch(() => undefined);
  }
}
