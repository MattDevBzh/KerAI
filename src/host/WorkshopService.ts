import { mkdir, readFile, readdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parse } from 'yaml';
import { configurationSteps } from '../shared/subplans';
import { validateWorkflow } from '../core/workflow';
import { AgentRegistry, files, safePath, clearCatalogueCache } from '../core/registry';
import { workshopManifestSchema } from '../core/workshopSchemas';
import type { WorkshopChange, WorkshopHistory, WorkshopPreview } from '../shared/workshop';
import { KitService } from './KitService';
import { WorkspaceLease } from './WorkspaceLease';
import {
  WORKSHOP_LIMITS,
  assertWorkshopPath,
  bytesOf,
  decodeWorkshopArchive,
  digest,
  encodeWorkshopArchive,
  installedContent,
  localLinks,
  portableContent,
  resolveWorkshopReference,
  textOf,
  validateWorkshopFiles,
  type WorkshopFiles,
  type WorkshopManifest,
} from './WorkshopArchive';

interface Capture {
  raw: WorkshopFiles;
  portable: WorkshopFiles;
  modes: Record<string, number>;
}
interface Baseline extends Capture {
  manifest: WorkshopManifest;
  workspace: string;
}
interface Edit {
  path: string;
  before?: string;
  after?: string;
  mode: number;
}
interface Journal extends WorkshopHistory {
  workspace: string;
  edits: Edit[];
  restoring?: boolean;
}
interface Plan {
  preview: WorkshopPreview;
  key: string;
  edits: Edit[];
  journal?: Journal;
}
const fileMap = z.record(z.string(), z.string().max(Math.ceil(WORKSHOP_LIMITS.file / 3) * 4));
const baselineSchema = z
  .object({
    manifest: workshopManifestSchema,
    workspace: z.string(),
    raw: fileMap,
    portable: fileMap,
    modes: z.record(z.string(), z.number().int().min(0).max(0o777)),
  })
  .strict();
const journalSchema = z
  .object({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    files: z.number().int().nonnegative(),
    state: z.enum(['pending', 'applied', 'restored']),
    workspace: z.string(),
    restoring: z.boolean().optional(),
    edits: z
      .array(
        z
          .object({
            path: z.string(),
            before: z.string().optional(),
            after: z.string().optional(),
            mode: z.number().int().min(0).max(0o777),
          })
          .strict(),
      )
      .max(WORKSHOP_LIMITS.files),
  })
  .strict();
const signature = (capture: Capture) =>
  digest(
    JSON.stringify(
      Object.keys(capture.raw)
        .sort()
        .map((path) => [path, digest(bytesOf(capture.raw[path])), capture.modes[path]]),
    ),
  );
const uuid = (id: string) => z.string().uuid().parse(id);
const newFileMode = process.platform === 'win32' ? 0o666 : 0o600;

const guide = `# Réviser un atelier KerAI

Cet export contient tout le catalogue fourni, personnel et propre au projet : agents, skills, équipes/parcours et ressources. Les versions masquées par une personnalisation sont conservées. Priorité : projet > personnel > fourni.

## Travail demandé à l’IA externe

Relire l’ensemble : contradictions, doublons, consignes vagues, responsabilités, compétences manquantes et dépendances. Proposer des améliorations utiles sans inventer les capacités du moteur. Justifier chaque changement dans REVISION.md et proposer des missions représentatives pour comparer le comportement avant/après. La compatibilité structurelle ne prouve pas une amélioration de qualité.

Modifier directement les fichiers Markdown, YAML et ressources. Ne pas réencoder leur contenu. Conserver les identifiants et les dossiers, sauf changement explicite de toutes leurs références. Pour ajouter un profil, utiliser personnel/agents/<id>.agent.md, personnel/skills/<id>/SKILL.md ou personnel/feature-studio/workflows/<id>.yaml. Des ajouts propres au projet sont possibles dans projet/.github/agents, projet/.github/skills et projet/.feature-studio/workflows.

Les fichiers fourni/ sont les versions livrées avec KerAI. Une modification créera une copie personnelle ; si une personnalisation personnel/ existe déjà, modifier celle-ci. Les fichiers fournis ne peuvent pas être supprimés. Pour retirer un fichier personnel/projet, le retirer du ZIP ET ajouter son chemin exact dans la liste deleted de atelier.json. Une omission seule est refusée. Supprimer une personnalisation peut rendre la version fournie de nouveau active.

Ne pas changer format, schemaVersion, exportId ni createdAt dans atelier.json. Renvoyer un ZIP contenant atelier.json, les trois dossiers, cet inventaire et REVISION.md. Le réimport doit se faire depuis le projet et le compte qui ont produit l’export, même après redémarrage de KerAI.

## Contrats KerAI

Un agent est un fichier .agent.md avec un en-tête YAML et des instructions Markdown non vides. Champs : name, description, tools (liste), skills (identifiants), model (une chaîne), reasoning, policy (read-only/workspace-write/tests), nickname, avatar (identifiant existant), emptyContextByDefault, discussionAgent, roastLevel. Garder les propriétés inconnues. Ne pas inventer de nom d’outil ou de modèle : s’appuyer sur les profils présents. Les permissions réelles restent contrôlées par KerAI.

Un skill est un dossier avec SKILL.md (en-tête name/description et instructions non vides), ses scripts, références et licences. Les scripts sont des ressources passives : importer ne les exécute jamais. Conserver les liens relatifs et tous leurs fichiers cibles.

Une équipe/parcours possède id, name, description, icon et steps. Chaque étape garde un id unique, agentId, policy, skills, artifact, maxAttempts et dependsOn. Dépendances existantes et sans cycle ; conserver les sous-plans, critères qualité, interventions facultatives et demandes de validation. Copier une structure existante pour tout ajout. Aucun serveur MCP actif, hook ni secret ne doit être ajouté. Les associations MCP locales des étapes conservant leur identifiant sont préservées au réimport.

Les outils, connexions, réglages machine, historiques de sessions, code du projet et secrets stockés par l’application ne font pas partie de cet export. Les instructions et ressources peuvent néanmoins contenir des informations métier : vérifier leur contenu avant de le transmettre. La détection de formats de secrets connus n’est pas exhaustive.

## Réimport

KerAI compare l’export d’origine, la version révisée et l’atelier actuel. Une modification locale concurrente bloque son remplacement. Le contenu exact de l’aperçu est appliqué après votre choix ; aucune IA n’est appelée. Une sauvegarde locale des fichiers remplacés permet la restauration depuis l’historique, sans écraser des modifications ultérieures.
`;

export class WorkshopService {
  private previews = new Map<string, Plan>();
  readonly workspaceKey: string;
  readonly storageRoot: string;
  constructor(readonly registry: AgentRegistry) {
    this.workspaceKey = digest(`${resolve(registry.workspacePath)}\n${resolve(registry.userPath)}`);
    this.storageRoot = join(registry.userPath, 'feature-studio/workshop', this.workspaceKey);
  }
  private destination(path: string) {
    assertWorkshopPath(path);
    if (path.startsWith('fourni/')) throw Error('Les profils fournis restent intacts.');
    return path.startsWith('projet/')
      ? { root: this.registry.workspacePath, fragment: path.slice('projet/'.length) }
      : { root: this.registry.userPath, fragment: path.slice('personnel/'.length) };
  }
  private async readTarget(path: string): Promise<{ content?: string; mode: number }> {
    const { root, fragment } = this.destination(path);
    const target = await safePath(root, fragment);
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.nlink > 1 || stat.size > WORKSHOP_LIMITS.file)
        throw Error(`Fichier non régulier ou trop volumineux : ${path}`);
      return { content: (await readFile(target)).toString('base64'), mode: stat.mode & 0o777 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 0o600 };
      throw error;
    }
  }
  private async privatePath(fragment: string) {
    return safePath(
      this.registry.userPath,
      relative(this.registry.userPath, join(this.storageRoot, fragment)),
    );
  }
  private async savePrivate(fragment: string, value: unknown) {
    const target = await this.privatePath(fragment);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await this.privatePath(fragment);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
      await file.close();
      await this.privatePath(fragment);
      await rename(temporary, target);
    } finally {
      await file.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }
  private async readPrivate(fragment: string) {
    const target = await this.privatePath(fragment),
      stat = await lstat(target);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > WORKSHOP_LIMITS.total * 4)
      throw Error('Sauvegarde d’atelier invalide.');
    return JSON.parse(await readFile(target, 'utf8'));
  }
  private async capture(): Promise<Capture> {
    const suppressed = await this.suppressedFiles();
    const raw: WorkshopFiles = Object.create(null),
      portable: WorkshopFiles = Object.create(null),
      modes: Record<string, number> = Object.create(null);
    const kits = new KitService(this.registry);
    for (const name of ['copilot', 'devops', 'documentation', 'presentation', 'code-audit']) {
      const bundle = await kits.preset(name);
      for (const file of bundle.files) {
        const path = `fourni/${file.path}`;
        if (suppressed(path, file.base64)) continue;
        if (raw[path] && raw[path] !== file.base64)
          throw Error(`Versions fournies incompatibles : ${path}`);
        raw[path] = portable[path] = file.base64;
        modes[path] = 0o600;
      }
    }
    for (const [root, prefix, folders] of [
      [
        this.registry.userPath,
        'personnel',
        [
          'agents',
          'skills',
          'feature-studio/workflows',
          'feature-studio/kit',
          'feature-studio/devops',
        ],
      ],
      [
        this.registry.workspacePath,
        'projet',
        [
          '.github/agents',
          '.github/skills',
          '.feature-studio/workflows',
          '.github/feature-studio/kit',
          '.github/feature-studio/devops',
        ],
      ],
    ] as const) {
      for (const folder of folders) {
        for (const fragment of await files(root, folder)) {
          // Locks are operational metadata, including after an interrupted import.
          // Apply reserves the files and rechecks every revision before writing.
          if (fragment.endsWith('.feature-studio.lock')) continue;
          if (folder.endsWith('agents') && !fragment.endsWith('.agent.md')) continue;
          if (folder.endsWith('workflows') && !/\.ya?ml$/.test(fragment)) continue;
          const path = `${prefix}/${fragment.replaceAll('\\', '/')}`;
          assertWorkshopPath(path);
          const current = await this.readTarget(path);
          if (current.content === undefined)
            throw Error(`Le fichier a changé pendant la lecture : ${path}`);
          raw[path] = current.content;
          portable[path] = portableContent(path, bytesOf(current.content)).toString('base64');
          if (suppressed(path, portable[path])) {
            delete raw[path];
            delete portable[path];
            continue;
          }
          modes[path] = current.mode;
        }
      }
    }
    return { raw, portable, modes };
  }
  private async suppressedFiles() {
    const agents = await this.registry.removedIds('agent'),
      skills = await this.registry.removedIds('skill'),
      workflows = await this.registry.removedIds('workflow');
    return (path: string, content: string) => {
      const agent = /\/agents\/([^/]+)\.agent\.md$/.exec(path);
      const skill = /\/skills\/([^/]+)\//.exec(path);
      const workflow = /\/workflows\/([^/]+)\.ya?ml$/.exec(path);
      return Boolean(
        (agent && agents.has(agent[1])) ||
          (skill && skills.has(skill[1])) ||
          (workflow &&
            (workflows.has(workflow[1]) ||
              configurationSteps(
                validateWorkflow(parse(bytesOf(content).toString('utf8'), { uniqueKeys: true }))
                  .steps,
              ).some((step) => agents.has(step.agentId)))),
      );
    };
  }
  removedAgentIds(token: string): string[] {
    const plan = this.previews.get(uuid(token));
    if (!plan) throw Error('Aperçu expiré.');
    return [
      ...new Set(
        plan.edits
          .filter((edit) => edit.after === undefined)
          .flatMap((edit) => {
            const match = /\/agents\/([^/]+)\.agent\.md$/.exec(edit.path);
            return match ? [match[1]] : [];
          }),
      ),
    ];
  }
  async exportArchive(): Promise<Buffer> {
    const capture = await this.capture();
    validateWorkshopFiles(capture.portable);
    const manifest: WorkshopManifest = {
      format: 'kerai-workshop',
      schemaVersion: 1,
      exportId: randomUUID(),
      createdAt: new Date().toISOString(),
      deleted: [],
    };
    const inventory =
      '# Inventaire complet de l’atelier\n\nPriorité : projet > personnel > fourni. Les trois portées sont conservées séparément.\n\n' +
      Object.keys(capture.portable)
        .sort()
        .map((path) => `- \`${path}\` (${bytesOf(capture.portable[path]).length} octets)`)
        .join('\n') +
      '\n';
    const archive = encodeWorkshopArchive(manifest, capture.portable, guide, inventory);
    await this.savePrivate(`exports/${manifest.exportId}.json`, {
      ...capture,
      manifest,
      workspace: this.workspaceKey,
    } satisfies Baseline);
    return archive;
  }
  async readArchive(path: string) {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink > 1 ||
      stat.size > WORKSHOP_LIMITS.zip
    )
      throw Error('Choisis une archive ZIP régulière de moins de 40 Mio.');
    return this.previewImport(await readFile(path));
  }
  private describe(edit: Edit, status?: WorkshopChange['status'], reason?: string): WorkshopChange {
    const before =
      edit.before === undefined
        ? undefined
        : textOf(portableContent(edit.path, bytesOf(edit.before)).toString('base64'));
    const after =
      edit.after === undefined
        ? undefined
        : textOf(portableContent(edit.path, bytesOf(edit.after)).toString('base64'));
    return {
      path: edit.path,
      status:
        status ??
        (edit.before === undefined ? 'added' : edit.after === undefined ? 'deleted' : 'modified'),
      before,
      after,
      binary:
        (edit.before !== undefined && before === undefined) ||
        (edit.after !== undefined && after === undefined),
      beforeBytes: edit.before === undefined ? 0 : bytesOf(edit.before).length,
      afterBytes: edit.after === undefined ? 0 : bytesOf(edit.after).length,
      reason,
    };
  }
  private remember(
    plan: Omit<Plan, 'preview'> & { preview: Omit<WorkshopPreview, 'token'> },
  ): WorkshopPreview {
    const token = randomUUID(),
      preview = { ...plan.preview, token };
    this.previews.set(token, { ...plan, preview });
    while (this.previews.size > 4) this.previews.delete(this.previews.keys().next().value!);
    return structuredClone(preview);
  }
  async previewImport(archive: Buffer): Promise<WorkshopPreview> {
    const incoming = decodeWorkshopArchive(archive);
    let baseline: Baseline;
    try {
      baseline = baselineSchema.parse(
        await this.readPrivate(`exports/${uuid(incoming.manifest.exportId)}.json`),
      );
    } catch {
      throw Error(
        'Export d’origine introuvable. Réimporte depuis le projet et le compte ayant créé cette archive, ou effectue un nouvel export.',
      );
    }
    if (
      baseline.workspace !== this.workspaceKey ||
      baseline.manifest.createdAt !== incoming.manifest.createdAt
    )
      throw Error('Identité de l’export modifiée.');
    const removed = new Set(incoming.manifest.deleted);
    if (removed.size !== incoming.manifest.deleted.length)
      throw Error('Suppression dupliquée dans atelier.json.');
    for (const path of Object.keys(baseline.portable))
      if (!Object.hasOwn(incoming.files, path) && !removed.has(path))
        throw Error(`Fichier manquant sans suppression explicite : ${path}`);
    for (const path of removed)
      if (
        !Object.hasOwn(baseline.portable, path) ||
        Object.hasOwn(incoming.files, path) ||
        path.startsWith('fourni/')
      )
        throw Error(`Suppression invalide : ${path}`);
    if ((await this.history()).some((record) => record.state === 'pending'))
      throw Error('Restaure d’abord l’import interrompu depuis l’historique.');
    const current = await this.capture();
    const suppressed = await this.suppressedFiles();
    const proposed = new Map<string, Edit>(),
      changes: WorkshopChange[] = [];
    const stage = { ...current.portable };
    for (const source of new Set([...Object.keys(incoming.files), ...removed])) {
      const next = incoming.files[source],
        previous = baseline.portable[source];
      if (next === previous) continue;
      if (next !== undefined && previous === undefined && suppressed(source, next))
        throw Error(
          `Ce profil a été supprimé du catalogue : ${source}. Recrée-le explicitement dans l’atelier avant un nouvel export.`,
        );
      if (source.startsWith('fourni/') && previous === undefined)
        throw Error('Ajouter les nouveaux profils dans personnel/ ou projet/.');
      const path = source.replace(/^fourni\//, 'personnel/');
      const before = current.raw[path];
      const after = next === undefined ? undefined : installedContent(path, next, before);
      if (before === after) continue;
      const edit: Edit = { path, before, after, mode: current.modes[path] ?? newFileMode };
      let reason: string | undefined;
      if (source.startsWith('fourni/') && baseline.raw[path] !== undefined)
        reason = 'Une personnalisation existe déjà. Modifier sa version personnel/ dans l’archive.';
      else if (
        current.raw[source] !== baseline.raw[source] ||
        (source !== path && current.raw[path] !== baseline.raw[path])
      )
        reason =
          'Ce fichier a changé localement depuis l’export. Refaire l’export pour comparer les versions.';
      if (proposed.has(path)) reason = 'Deux versions de l’archive modifient la même destination.';
      if (reason) {
        changes.push(this.describe(edit, 'conflict', reason));
        continue;
      }
      proposed.set(path, edit);
      if (next === undefined) delete stage[path];
      else stage[path] = next;
    }
    for (const [path, content] of Object.entries(stage))
      for (const target of localLinks(path, content))
        if (removed.has(target)) throw Error(`Suppression encore référencée : ${path} → ${target}`);
    // A customized supplied profile needs its relative resources at its new location.
    // Copy only the linked resources that are not already installed, recursively.
    for (const edit of proposed.values()) {
      if (edit.after === undefined) continue;
      for (const target of localLinks(edit.path, stage[edit.path])) {
        if (Object.hasOwn(stage, target)) continue;
        const origin = resolveWorkshopReference(stage, target);
        if (!origin) continue; // validation below reports the exact missing reference
        assertWorkshopPath(target);
        if (target.startsWith('fourni/')) continue;
        const sources = origin.endsWith('/SKILL.md')
          ? Object.keys(stage).filter((path) =>
              path.startsWith(origin.slice(0, -'SKILL.md'.length)),
            )
          : [origin];
        for (const resource of sources) {
          const destination = target.endsWith('/SKILL.md')
            ? target.slice(0, -'SKILL.md'.length) +
              resource.slice(origin.slice(0, -'SKILL.md'.length).length)
            : target;
          if (Object.hasOwn(stage, destination)) continue;
          assertWorkshopPath(destination);
          stage[destination] = stage[resource];
          proposed.set(destination, {
            path: destination,
            after: stage[resource],
            mode: newFileMode,
          });
        }
      }
    }
    validateWorkshopFiles(stage);
    changes.push(...[...proposed.values()].map((edit) => this.describe(edit)));
    changes.sort((a, b) => a.path.localeCompare(b.path));
    return this.remember({
      key: signature(current),
      edits: [...proposed.values()],
      preview: {
        kind: 'import',
        changes,
        report: incoming.report,
        canApply: proposed.size > 0 && !changes.some((change) => change.status === 'conflict'),
      },
    });
  }
  async history(): Promise<WorkshopHistory[]> {
    const folder = await this.privatePath('history');
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const result: WorkshopHistory[] = [];
    for (const name of names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const record = await this.readJournal(name.slice(0, -5));
      result.push({
        id: record.id,
        createdAt: record.createdAt,
        files: record.files,
        state: record.state,
      });
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private async readJournal(id: string): Promise<Journal> {
    const record = journalSchema.parse(await this.readPrivate(`history/${uuid(id)}.json`));
    if (record.workspace !== this.workspaceKey || record.id !== id)
      throw Error('Sauvegarde issue d’un autre atelier.');
    for (const edit of record.edits) {
      this.destination(edit.path);
      for (const value of [edit.before, edit.after])
        if (value !== undefined && bytesOf(value).toString('base64') !== value)
          throw Error('Sauvegarde illisible.');
    }
    return record;
  }
  async previewRestore(id: string): Promise<WorkshopPreview> {
    const journal = await this.readJournal(id);
    if (journal.state === 'restored') throw Error('Cet import est déjà restauré.');
    const current = await this.capture(),
      edits: Edit[] = [],
      changes: WorkshopChange[] = [];
    const suppressed = await this.suppressedFiles();
    const stage = { ...current.portable };
    for (const original of journal.edits) {
      const before = current.raw[original.path];
      if (
        before === original.before &&
        (before === undefined || current.modes[original.path] === original.mode)
      )
        continue;
      const edit: Edit = {
        path: original.path,
        before,
        after: original.before,
        mode: original.mode,
      };
      if (edit.after !== undefined && suppressed(edit.path, edit.after))
        changes.push(
          this.describe(
            edit,
            'conflict',
            'Ce profil a été supprimé définitivement du catalogue depuis cet import.',
          ),
        );
      else if (
        before !== original.after ||
        (before !== undefined && current.modes[original.path] !== original.mode)
      )
        changes.push(
          this.describe(
            edit,
            'conflict',
            'Modification postérieure à l’import : ce fichier sera préservé.',
          ),
        );
      else {
        edits.push(edit);
        changes.push(this.describe(edit));
        if (edit.after === undefined) delete stage[edit.path];
        else stage[edit.path] = portableContent(edit.path, bytesOf(edit.after)).toString('base64');
      }
    }
    if (!changes.some((change) => change.status === 'conflict')) validateWorkshopFiles(stage);
    return this.remember({
      key: signature(current),
      edits,
      journal,
      preview: {
        kind: 'restore',
        changes,
        report: '',
        canApply: !changes.some((change) => change.status === 'conflict'),
      },
    });
  }
  private async lockFile(path: string): Promise<() => Promise<void>> {
    const { root, fragment } = this.destination(path);
    const target = await safePath(root, fragment);
    await mkdir(dirname(target), { recursive: true });
    const lockPath = await safePath(root, `${fragment}.feature-studio.lock`);
    const token = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const lock = await open(lockPath, 'wx', 0o600);
        await lock.writeFile(JSON.stringify({ kind: 'workshop', token, pid: process.pid }));
        await lock.close();
        return async () => {
          if (JSON.parse(await readFile(lockPath, 'utf8')).token === token) await unlink(lockPath);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const owner = JSON.parse(await readFile(lockPath, 'utf8'));
          if (owner.kind === 'workshop' && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
            try {
              process.kill(owner.pid, 0);
            } catch (failure) {
              if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
                await unlink(lockPath);
                continue;
              }
            }
          }
        } catch {
          /* Existing registry editors use an empty lock; never remove it. */
        }
        throw Error(`Une autre fenêtre enregistre ${path}. Réessaie après sa sauvegarde.`);
      }
    }
    throw Error('Impossible de réserver les fichiers de l’atelier.');
  }
  private async writeEdit(edit: Edit) {
    const { root, fragment } = this.destination(edit.path);
    const target = await safePath(root, fragment);
    if ((await this.readTarget(edit.path)).content !== edit.before)
      throw Error(`Le fichier a changé depuis l’aperçu : ${edit.path}`);
    if (edit.after === undefined) {
      await unlink(target);
      return;
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', edit.mode);
    try {
      await file.writeFile(bytesOf(edit.after));
      await file.chmod(edit.mode);
      await file.sync();
      await file.close();
      await safePath(root, fragment);
      if ((await this.readTarget(edit.path)).content !== edit.before)
        throw Error(`Le fichier a changé pendant l’application : ${edit.path}`);
      await rename(temporary, target);
    } finally {
      await file.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }
  async apply(token: string): Promise<string> {
    const plan = this.previews.get(uuid(token));
    if (!plan || !plan.preview.canApply)
      throw Error('Aperçu expiré ou changements non applicables. Prépare un nouvel aperçu.');
    const lease = new WorkspaceLease(`${resolve(this.registry.userPath)}/workshop-import`);
    await lease.acquire();
    const release: (() => Promise<void>)[] = [];
    try {
      if (signature(await this.capture()) !== plan.key)
        throw Error('L’atelier a changé depuis l’aperçu. Compare de nouveau avant d’appliquer.');
      if (plan.journal) {
        const latest = await this.readJournal(plan.journal.id);
        if (JSON.stringify(latest) !== JSON.stringify(plan.journal))
          throw Error('L’historique a changé. Prépare un nouvel aperçu.');
      }
      for (const edit of [...plan.edits].sort((a, b) => a.path.localeCompare(b.path)))
        release.push(await this.lockFile(edit.path));
      for (const edit of plan.edits)
        if ((await this.readTarget(edit.path)).content !== edit.before)
          throw Error(`Le fichier a changé depuis l’aperçu : ${edit.path}`);
      const journal: Journal = plan.journal ?? {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        files: plan.edits.length,
        state: 'pending',
        workspace: this.workspaceKey,
        edits: structuredClone(plan.edits),
      };
      if (plan.journal) {
        journal.restoring = true;
        journal.state = 'pending';
      }
      await this.savePrivate(`history/${journal.id}.json`, journal);
      const completed: Edit[] = [];
      try {
        for (const edit of plan.edits) {
          await this.writeEdit(edit);
          completed.push(edit);
        }
        for (const edit of plan.edits) {
          const actual = await this.readTarget(edit.path);
          if (
            actual.content !== edit.after ||
            (actual.content !== undefined && actual.mode !== edit.mode)
          )
            throw Error(`Le fichier a changé pendant l’application : ${edit.path}`);
        }
        validateWorkshopFiles((await this.capture()).portable);
        journal.state = plan.journal ? 'restored' : 'applied';
        delete journal.restoring;
        await this.savePrivate(`history/${journal.id}.json`, journal);
      } catch (error) {
        let recovered = true;
        for (const edit of completed.reverse()) {
          try {
            await this.writeEdit({ ...edit, before: edit.after, after: edit.before });
          } catch {
            recovered = false;
          }
        }
        journal.state = recovered && !plan.journal ? 'restored' : 'pending';
        await this.savePrivate(`history/${journal.id}.json`, journal);
        throw Error(
          `${error instanceof Error ? error.message : String(error)} ${recovered ? 'Les fichiers appliqués ont été remis dans leur état précédent.' : 'Restauration incomplète : consulte l’historique. Les modifications concurrentes sont préservées.'}`,
        );
      }
      this.previews.delete(token);
      clearCatalogueCache();
      return plan.journal
        ? 'Atelier restauré dans son état précédant cet import.'
        : `${plan.edits.length} fichier(s) appliqué(s). La sauvegarde est disponible dans l’historique.`;
    } finally {
      for (const unlock of release.reverse()) await unlock().catch(() => undefined);
      await lease.release();
    }
  }
}
