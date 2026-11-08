import { lstat, readFile, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { AgentRegistry, files, safePath, clearCatalogueCache } from '../core/registry';
import { catalogueDeleteTargetSchema } from '../core/catalogueDeletionSchemas';
import { validateWorkflow } from '../core/workflow';
import { configurationSteps } from '../shared/subplans';
import {
  agentDeletionBlockers,
  type CatalogueDeleteTarget,
  type CatalogueDeletePreview,
} from '../shared/catalogueDeletion';
import type { Feature } from '../shared/types';
import { KitService } from './KitService';
import { kitNodes } from '../shared/kits';
import { WorkspaceLease } from './WorkspaceLease';
import { digest } from './WorkshopArchive';

export interface DeletionContext {
  registries: AgentRegistry[];
  features: Feature[];
}
interface FileRemoval {
  root: string;
  fragment: string;
  content: Buffer;
  mode: number;
}
interface RemovalPlan {
  target: CatalogueDeleteTarget;
  preview: Omit<CatalogueDeletePreview, 'token'>;
  files: FileRemoval[];
  markers: { kind: 'agent' | 'skill' | 'workflow' | 'kit'; id: string }[];
  key: string;
}

export class CatalogueDeletionService {
  private previews = new Map<string, RemovalPlan>();
  constructor(
    readonly registry: AgentRegistry,
    private context: () => Promise<DeletionContext>,
  ) {}

  async assertAgentsUnused(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const blockers = agentDeletionBlockers((await this.context()).features, ids);
    if (blockers.length)
      throw Error(
        `Suppression impossible : agent utilisé dans une session non terminée (${blockers.join(', ')}).`,
      );
  }
  async withProtectedAgents<T>(
    ids: string[],
    reservedWorkspace: string,
    action: () => Promise<T>,
  ): Promise<T> {
    if (!ids.length) return action();
    const context = await this.context(),
      leases: WorkspaceLease[] = [];
    try {
      for (const root of [
        ...new Set(context.registries.map((registry) => resolve(registry.workspacePath))),
      ].sort()) {
        if (root === resolve(reservedWorkspace)) continue;
        const lease = new WorkspaceLease(root);
        await lease.acquire();
        leases.push(lease);
      }
      await this.assertAgentsUnused(ids);
      return await action();
    } finally {
      for (const lease of leases.reverse()) await lease.release();
    }
  }
  private async prepare(input: CatalogueDeleteTarget): Promise<RemovalPlan> {
    const target = catalogueDeleteTargetSchema.parse(input);
    const context = await this.context();
    const registries = [
      ...new Map(
        [this.registry, ...context.registries].map((registry) => [
          resolve(registry.workspacePath),
          registry,
        ]),
      ).values(),
    ];
    const data = await Promise.all(registries.map((registry) => registry.load()));
    const agents = new Set<string>(),
      skills = new Set<string>(),
      workflows = new Set<string>(),
      shared = new Set<string>();
    const markers: RemovalPlan['markers'] = [];
    let protectedAgents: string[], label: string, kitFile: string | undefined;
    if (target.kind === 'agent') {
      const agent = data.flatMap((entry) => entry.agents).find((agent) => agent.id === target.id);
      if (!agent) throw Error('Agent absent du catalogue.');
      label = agent.nickname || agent.name;
      agents.add(agent.id);
      protectedAgents = [agent.id];
    } else {
      const catalog = await new KitService(this.registry).catalog();
      const kit = catalog.find(
        (kit) => kit.source === target.source && (kit.storageId ?? kit.metadata.id) === target.id,
      );
      if (!kit || kit.error) throw Error('Kit absent ou illisible. Aucun profil ne sera supprimé.');
      label = kit.metadata.name;
      protectedAgents = kit.nodes.filter((node) => node.kind === 'agent').map((node) => node.id);
      const others = new Set(
        catalog
          .filter((other) => other !== kit)
          .flatMap((other) => other.nodes.map((node) => node.ref)),
      );
      for (const node of kit.nodes) {
        if (others.has(node.ref)) {
          shared.add(node.name);
          continue;
        }
        (node.kind === 'agent' ? agents : node.kind === 'skill' ? skills : workflows).add(node.id);
      }
      markers.push({ kind: 'kit', id: `${target.source}-${target.id}` });
      if (target.source === 'saved') kitFile = `feature-studio/kits/${target.id}.fskit.json`;
    }
    const blockers = agentDeletionBlockers(context.features, protectedAgents);
    // Teams that depend on a deleted agent are explicitly included in the preview.
    const workflowFiles: { registry: AgentRegistry; root: string; fragment: string; id: string }[] =
      [];
    for (let index = 0; index < registries.length; index++) {
      const registry = registries[index];
      for (const workflow of data[index].workflows)
        if (configurationSteps(workflow.steps).some((step) => agents.has(step.agentId)))
          workflows.add(workflow.id);
      for (const [root, folder] of [
        [registry.userPath, 'feature-studio/workflows'],
        [registry.workspacePath, '.feature-studio/workflows'],
      ]) {
        for (const fragment of await files(root, folder)) {
          if (!/\.ya?ml$/.test(fragment)) continue;
          const workflow = validateWorkflow(
            parse(await readFile(await safePath(root, fragment), 'utf8'), { uniqueKeys: true }),
          );
          if (configurationSteps(workflow.steps).some((step) => agents.has(step.agentId)))
            workflows.add(workflow.id);
          workflowFiles.push({ registry, root, fragment, id: workflow.id });
        }
      }
    }
    let retained = true;
    while (retained) {
      retained = false;
      for (const node of data.flatMap((entry) => kitNodes(entry))) {
        if (
          (node.kind === 'agent' ? agents : node.kind === 'skill' ? skills : workflows).has(node.id)
        )
          continue;
        for (const dependency of node.dependencies) {
          const [kind, id] = dependency.split(':');
          if (kind === 'skill' && skills.delete(id)) {
            shared.add(id);
            retained = true;
          }
        }
      }
    }
    const planned = new Map<string, FileRemoval>();
    let total = 0;
    const add = async (root: string, fragment: string) => {
      const path = await safePath(root, fragment);
      if (planned.has(path)) return;
      let stat;
      try {
        stat = await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      if (
        !stat.isFile() ||
        stat.nlink > 1 ||
        stat.size > 4 * 1024 * 1024 ||
        (total += stat.size) > 32 * 1024 * 1024 ||
        planned.size >= 2048
      )
        throw Error('Fichier non régulier ou suppression trop volumineuse.');
      planned.set(path, { root, fragment, content: await readFile(path), mode: stat.mode & 0o777 });
    };
    for (let index = 0; index < registries.length; index++) {
      const registry = registries[index];
      // Include shadowed or invalid editable copies identified by their stable file name.
      for (const [root, prefix] of [
        [registry.userPath, ''],
        [registry.workspacePath, '.github/'],
      ]) {
        for (const fragment of await files(root, `${prefix}agents`))
          if (fragment.endsWith('.agent.md') && agents.has(basename(fragment, '.agent.md')))
            await add(root, fragment);
        for (const skill of skills)
          for (const fragment of await files(root, `${prefix}skills/${skill}`))
            await add(root, fragment);
      }
      for (const agent of data[index].agents.filter((agent) => agents.has(agent.id)))
        for (const version of agent.versions ?? [agent])
          if (version.source !== 'bundled') {
            const root = version.source === 'user' ? registry.userPath : registry.workspacePath;
            await add(root, relative(root, version.path));
          }
      for (const skill of data[index].skills.filter((skill) => skills.has(skill.id)))
        for (const version of skill.versions ?? [skill])
          if (version.source !== 'bundled') {
            const root = version.source === 'user' ? registry.userPath : registry.workspacePath;
            for (const fragment of await files(root, relative(root, dirname(version.path))))
              await add(root, fragment);
          }
    }
    for (const file of workflowFiles)
      if (workflows.has(file.id)) await add(file.root, file.fragment);
    if (kitFile) await add(this.registry.userPath, kitFile);
    for (const [kind, ids] of [
      ['agent', agents],
      ['skill', skills],
      ['workflow', workflows],
    ] as const)
      for (const id of ids) markers.push({ kind, id });
    const preview = {
      label,
      agents: [...agents].sort(),
      skills: [...skills].sort(),
      workflows: [...workflows].sort(),
      shared: [...shared].sort(),
      blockers,
      files: planned.size,
      canDelete: !blockers.length,
    };
    const key = digest(
      JSON.stringify({
        target,
        preview,
        files: [...planned].map(([path, file]) => [path, digest(file.content), file.mode]).sort(),
        markers,
      }),
    );
    return { target, preview, files: [...planned.values()], markers, key };
  }
  async preview(target: CatalogueDeleteTarget): Promise<CatalogueDeletePreview> {
    const plan = await this.prepare(target),
      token = randomUUID();
    this.previews.set(token, plan);
    while (this.previews.size > 8) this.previews.delete(this.previews.keys().next().value!);
    return { ...plan.preview, token };
  }
  async apply(token: string, reservedWorkspace?: string): Promise<string> {
    const original = this.previews.get(token);
    if (!original || !original.preview.canDelete)
      throw Error('Suppression bloquée ou aperçu expiré.');
    const context = await this.context();
    const leases: WorkspaceLease[] = [],
      locks: { path: string; close: () => Promise<void> }[] = [];
    try {
      for (const root of [
        ...new Set([
          `${resolve(this.registry.userPath)}/workshop-import`,
          ...context.registries.map((registry) => resolve(registry.workspacePath)),
        ]),
      ].sort()) {
        if (root === reservedWorkspace) continue;
        const lease = new WorkspaceLease(root);
        await lease.acquire();
        leases.push(lease);
      }
      const plan = await this.prepare(original.target);
      if (!plan.preview.canDelete)
        throw Error(
          `Suppression impossible : sessions non terminées (${plan.preview.blockers.join(', ')}).`,
        );
      if (plan.key !== original.key)
        throw Error('Le catalogue a changé. Prépare un nouvel aperçu avant de supprimer.');
      for (const file of plan.files) {
        const path = await safePath(file.root, `${file.fragment}.feature-studio.lock`);
        const lock = await open(path, 'wx', 0o600);
        locks.push({ path, close: () => lock.close() });
      }
      for (const file of plan.files)
        if (!(await readFile(await safePath(file.root, file.fragment))).equals(file.content))
          throw Error('Un fichier a changé depuis l’aperçu.');
      const target = original.target;
      await this.assertAgentsUnused(
        target.kind === 'agent'
          ? [target.id]
          : ((await new KitService(this.registry).catalog())
              .find(
                (kit) =>
                  kit.source === target.source && (kit.storageId ?? kit.metadata.id) === target.id,
              )
              ?.nodes.filter((node) => node.kind === 'agent')
              .map((node) => node.id) ?? []),
      );
      const removed: FileRemoval[] = [],
        createdMarkers: string[] = [];
      try {
        for (const marker of plan.markers) {
          const path = await safePath(
            this.registry.userPath,
            `feature-studio/removed-${marker.kind}s/${marker.id}.json`,
          );
          await mkdir(dirname(path), { recursive: true });
          await safePath(this.registry.userPath, relative(this.registry.userPath, path));
          try {
            await writeFile(
              path,
              JSON.stringify({ id: marker.id, removedAt: new Date().toISOString() }),
              { flag: 'wx', mode: 0o600 },
            );
            createdMarkers.push(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          }
        }
        for (const file of plan.files) {
          const path = await safePath(file.root, file.fragment);
          if (!(await readFile(path)).equals(file.content))
            throw Error('Un fichier a changé pendant la suppression.');
          await unlink(path);
          removed.push(file);
        }
      } catch (error) {
        let incomplete = false;
        for (const file of removed.reverse())
          try {
            await writeFile(await safePath(file.root, file.fragment), file.content, {
              flag: 'wx',
              mode: file.mode,
            });
          } catch {
            incomplete = true;
          }
        if (!incomplete) for (const path of createdMarkers) await unlink(path);
        throw Error(
          `${(error as Error).message}${incomplete ? ' Remise en état incomplète ; les fichiers concurrents ont été préservés.' : ' Les fichiers supprimés ont été remis en place.'}`,
        );
      }
      this.previews.delete(token);
      clearCatalogueCache();
      return `« ${plan.preview.label} » supprimé de l’atelier. Les sessions terminées conservent leur historique.`;
    } finally {
      for (const lock of locks.reverse()) {
        await lock.close();
        await unlink(lock.path).catch(() => undefined);
      }
      for (const lease of leases.reverse()) await lease.release();
    }
  }
}
