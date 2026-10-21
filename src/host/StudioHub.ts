import { EventEmitter } from 'node:events';
import type { StudioState } from '../shared/types';
import type { ProjectCatalog, StoredProject } from './ProjectCatalog';
import type { StudioService } from './StudioService';
import type { DevOpsController } from './DevOpsController';

export interface HubEntry {
  project?: StoredProject;
  service: StudioService;
  devops: DevOpsController;
}

/** One visible cockpit; each primary project retains its settings and existing session store. */
export class StudioHub extends EventEmitter {
  readonly entries = new Map<string, HubEntry>();
  private loading = new Map<string, Promise<HubEntry>>();
  private activeId = 'empty';
  private errors: string[] = [];
  private disposing?: Promise<void>;
  constructor(
    readonly catalog: ProjectCatalog,
    private create: (project?: StoredProject) => Promise<HubEntry>,
    private dedicated: boolean,
    private windows: boolean,
  ) {
    super();
  }
  async entry(id?: string): Promise<HubEntry> {
    if (this.disposing) await this.disposing;
    const key = id ?? this.catalog.state.selectedProjectIds[0] ?? 'empty';
    const existing = this.entries.get(key);
    if (existing) return existing;
    const inProgress = this.loading.get(key);
    if (inProgress) return inProgress;
    const project =
      key === 'empty'
        ? undefined
        : this.catalog.state.projects.find((project) => project.id === key);
    if (key !== 'empty' && !project) throw new Error('Projet inconnu.');
    const work = (async () => {
      if (project) {
        const { realpath } = await import('node:fs/promises');
        if ((await realpath(project.path)) !== project.path)
          throw new Error('Le dossier enregistré a changé.');
      }
      return this.create(project);
    })()
      .then((entry) => {
        this.entries.set(key, entry);
        entry.service.globalGuard = () => {
          if (
            [...this.entries.values()].some(
              (other) =>
                other !== entry &&
                (other.service.state.workspaceOperation ||
                  other.service.state.features.some(
                    (feature) => feature.autopilot?.status === 'running',
                  )),
            )
          )
            throw new Error('Attends la fin de l’opération en cours dans le cockpit.');
        };
        entry.service.projectDevOpsKey = (id) => this.entries.get(id)?.service.devopsProjectKey?.();
        entry.service.projectSettings = (id) => this.entries.get(id)?.service.state.settings;
        entry.service.projectResolver = (id) =>
          this.catalog.state.projects.find((project) => project.id === id);
        entry.service.projectInspector = (id, signal) => {
          const target = this.entries.get(id);
          if (!target) throw new Error('Projet Azure DevOps indisponible.');
          target.service.assertTrusted();
          return target.devops.inspector(signal);
        };
        entry.service.on('state', () => this.publish());
        return entry;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, work);
    return work;
  }
  async initialize(): Promise<void> {
    await this.catalog.load();
    this.errors = [];
    for (const project of this.catalog.state.projects) {
      try {
        await this.entry(project.id);
      } catch (error) {
        this.errors.push(`${project.name} : ${(error as Error).message}`);
      }
    }
    const selected = this.catalog.state.selectedProjectIds[0];
    if (this.activeId === 'empty' || !this.entries.has(this.activeId))
      this.activeId =
        selected && this.entries.has(selected)
          ? selected
          : (this.entries.keys().next().value ?? 'empty');
    await this.entry(this.activeId);
  }
  async activateProject(id: string): Promise<HubEntry> {
    const entry = await this.entry(id);
    this.activeId = id;
    this.publish();
    return entry;
  }
  async current(): Promise<HubEntry> {
    return this.entry(this.activeId);
  }
  async activateFeature(id: string): Promise<HubEntry> {
    const found = [...this.entries].find(([, entry]) =>
      entry.service.state.features.some((feature) => feature.id === id),
    );
    if (!found) throw new Error('Session inconnue dans les projets enregistrés.');
    this.activeId = found[0];
    this.publish();
    return found[1];
  }
  featureEntry(id: string): HubEntry {
    const matches = [...this.entries.values()].filter((entry) =>
      entry.service.state.features.some((feature) => feature.id === id),
    );
    if (matches.length !== 1)
      throw new Error('Session inconnue ou ambiguë dans les projets enregistrés.');
    return matches[0];
  }
  async select(ids: string[]): Promise<HubEntry> {
    const projects = ids.length ? this.catalog.resolve(ids) : [];
    for (const project of projects) await this.entry(project.id);
    await this.catalog.select(ids);
    this.activeId = ids[0] ?? 'empty';
    const entry = await this.entry(this.activeId);
    this.publish();
    return entry;
  }
  snapshot(): StudioState | undefined {
    const entry = this.entries.get(this.activeId);
    if (!entry) return undefined;
    const state = entry.service.snapshot();
    if (entry.project)
      state.workspace.name =
        this.catalog.state.projects.find((project) => project.id === entry.project!.id)?.name ??
        entry.project.name;
    state.features = [...this.entries.values()].flatMap((item) =>
      item.service.snapshot().features.map((feature) => ({
        ...feature,
        // Older sessions retain the original project store and execution roots.
        ...(feature.projects?.length || !item.project
          ? {}
          : {
              projects: [
                {
                  id: item.project.id,
                  name: item.project.name,
                  path: item.project.path,
                  branch: feature.branch,
                },
              ],
            }),
      })),
    );
    state.humanRequests = [...this.entries.values()].flatMap(
      (item) => item.service.state.humanRequests ?? [],
    );
    state.workspaceOperation = [...this.entries.values()]
      .map((item) => item.service.state.workspaceOperation)
      .find(Boolean);
    state.projectCatalog = {
      projects: this.catalog.state.projects.map(
        ({ storagePath: _storagePath, ...project }) => project,
      ),
      selectedProjectIds: [...this.catalog.state.selectedProjectIds],
      dedicated: this.dedicated,
      windows: this.windows,
      activeProjectId: entry.project?.id,
      errors: this.errors,
    };
    return state;
  }
  publish(): void {
    const state = this.snapshot();
    if (state) this.emit('state', state);
  }
  async refreshProfiles(): Promise<void> {
    for (const entry of this.entries.values()) await entry.service.refresh();
  }
  async dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposing = (async () => {
      await Promise.allSettled([...this.loading.values()]);
      for (const entry of this.entries.values()) {
        await entry.devops.dispose();
        await entry.service.dispose();
      }
      this.entries.clear();
    })().finally(() => {
      this.disposing = undefined;
    });
    return this.disposing;
  }
}
