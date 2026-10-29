import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  CheckpointComparison,
  Feature,
  FeatureCheckpoint,
  FeatureWorktree,
} from '../shared/types';
import { isSensitivePath, sha256 } from './PolicyEngine';
import { redact } from './process';
import { runWorkspaceGit, type WorkspaceGitResult } from './workspaceGit';

export const CHECKPOINT_LIMITS = {
  fileBytes: 4 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  files: 10000,
  inventoryFiles: 250000,
  excludedPaths: 200,
  manifestBytes: 64 * 1024 * 1024,
} as const;
const featureId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/);
const checkpointId = z.string().uuid();
const privateFileSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().min(0).max(CHECKPOINT_LIMITS.fileBytes),
    mode: z.number().int().min(0).max(0o777),
    binary: z.boolean(),
    git: z
      .object({
        oid: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
        crlf: z.literal(true).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const checkpointSchema = z
  .object({
    id: checkpointId,
    label: z.string().min(1).max(200),
    kind: z.enum(['before-run', 'after-run', 'manual', 'recovery']),
    createdAt: z.string(),
    branch: z.string().max(1000),
    head: z.union([z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), z.literal('')]),
    stepId: z.string().min(1).max(500).optional(),
    attemptId: featureId.optional(),
    fileCount: z.number().int().min(0).max(CHECKPOINT_LIMITS.inventoryFiles),
    totalBytes: z.number().int().nonnegative(),
    storedFileCount: z.number().int().min(0).max(CHECKPOINT_LIMITS.files).optional(),
    storedBytes: z.number().int().min(0).max(CHECKPOINT_LIMITS.totalBytes).optional(),
    excludedCount: z.number().int().nonnegative(),
    excludedPaths: z.array(z.string().max(2000)).max(CHECKPOINT_LIMITS.excludedPaths),
  })
  .strict();
function privateDictionary<T>(valueSchema: z.ZodType<T>): z.ZodType<Record<string, T>> {
  return z.unknown().transform((value, context) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      context.addIssue({ code: 'custom', message: 'Inventaire privé invalide.' });
      return z.NEVER;
    }
    const result: Record<string, T> = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
      if (!key || key.length > 4000) {
        context.addIssue({ code: 'custom', message: 'Chemin d’inventaire invalide.' });
        return z.NEVER;
      }
      const parsed = valueSchema.safeParse(entry);
      if (!parsed.success) {
        context.addIssue({ code: 'custom', message: 'Entrée d’inventaire invalide.', path: [key] });
        return z.NEVER;
      }
      result[key] = parsed.data;
    }
    return result;
  });
}
const manifestSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    featureId,
    root: z.string().min(1),
    checkpoint: checkpointSchema,
    files: privateDictionary(privateFileSchema),
    exclusions: privateDictionary(z.string().max(2000)),
  })
  .strict();
type StoredFile = z.infer<typeof privateFileSchema>;
type Manifest = z.infer<typeof manifestSchema>;
interface Snapshot {
  root: string;
  branch: string;
  head: string;
  files: Record<string, StoredFile>;
  contents: Map<string, Buffer>;
  exclusions: Record<string, string>;
  excludedCount: number;
  excludedPaths: string[];
}
type GitResult = WorkspaceGitResult;
const ignoredDirectories = new Set([
  '.github',
  '.vscode',
  'dist',
  'build',
  'coverage',
  '.next',
  '.vscode-test',
]);
const absent = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
const within = (root: string, target: string): boolean =>
  target === root || target.startsWith(root + path.sep);
const blocked = (name: string): boolean =>
  isSensitivePath(name.toLowerCase()) ||
  name
    .toLowerCase()
    .split('/')
    .some((part) => ignoredDirectories.has(part) || part === '.ds_store');
function filePath(name: string): string {
  if (
    !name ||
    name.length > 2000 ||
    name.includes('\0') ||
    name.includes('\\') ||
    path.posix.isAbsolute(name) ||
    /^[a-z]:/i.test(name) ||
    name.split('/').some((part) => part === '..' || part === '.' || !part)
  )
    throw new Error('Chemin de checkpoint invalide.');
  return name;
}
function binary(content: Buffer): boolean {
  return content.includes(0) || !Buffer.from(content.toString('utf8'), 'utf8').equals(content);
}
function machineText(content: Buffer): string {
  const result = content.toString('utf8');
  if (!Buffer.from(result, 'utf8').equals(content))
    throw new Error('Git a renvoyé un chemin non UTF-8.');
  return result;
}

export class WorkspaceRestoreError extends Error {
  constructor(
    message: string,
    readonly recovery: FeatureCheckpoint,
    readonly restoredFiles: string[],
  ) {
    super(
      `${message} Sauvegarde de récupération : ${recovery.id}. Fichiers restaurés : ${restoredFiles.length}.`,
    );
    this.name = 'WorkspaceRestoreError';
  }
}

/** Source index is never staged/reset/stashed. Checkpoints are private immutable content-addressed files. */
export class FeatureWorkspace {
  /** Delete owned manifests, then collect blobs only after validating every retained manifest. */
  async purgeSession(ownerId: string, ids: string[]): Promise<void> {
    featureId.parse(ownerId);
    const requested = new Set(ids.map((id) => checkpointId.parse(id)));
    return this.serial(async () => {
      const root = await this.privateRoot();
      const owned: Manifest[] = [];
      const reachable = new Set<string>();
      for (const name of await readdir(path.join(root, 'manifests')).catch((error) => {
        if (absent(error)) return [];
        throw error;
      })) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name))
          throw new Error('Manifeste privé inattendu ; collecte suspendue.');
        const manifest = manifestSchema.parse(
          JSON.parse(
            (
              await this.readLimited(
                await this.privatePath(`manifests/${name}`),
                CHECKPOINT_LIMITS.manifestBytes,
              )
            ).toString('utf8'),
          ),
        );
        if (`${manifest.checkpoint.id}.json` !== name)
          throw new Error('Identifiant de manifeste privé incohérent ; collecte suspendue.');
        if (manifest.featureId === ownerId) owned.push(manifest);
        else {
          if (requested.has(manifest.checkpoint.id))
            throw new Error('Point de restauration appartenant à une autre session.');
          for (const file of Object.values(manifest.files)) if (!file.git) reachable.add(file.hash);
        }
      }
      // Capture may have committed a manifest before its reference reached the session index.
      for (const manifest of owned) {
        await unlink(await this.privatePath(`manifests/${manifest.checkpoint.id}.json`));
        if (manifest.version === 2 && manifest.checkpoint.head)
          await this.updateCheckpointRef(await this.source(), [
            '-d',
            this.checkpointRef(ownerId, manifest.checkpoint.id),
            manifest.checkpoint.head,
          ]);
      }
      for (const name of await readdir(path.join(root, 'objects')).catch((error) => {
        if (absent(error)) return [];
        throw error;
      }))
        if (/^[a-f0-9]{64}$/.test(name) && !reachable.has(name))
          await unlink(await this.privatePath(`objects/${name}`));
    });
  }
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly sourceRoot: string,
    readonly storageDirectory: string,
  ) {}

  executionPath(feature: Feature): string {
    return feature.worktree?.path ?? this.sourceRoot;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.queue.catch(() => undefined).then(work);
    this.queue = pending;
    return pending;
  }
  private async source(): Promise<string> {
    const root = await realpath(this.sourceRoot);
    if (!(await lstat(root)).isDirectory())
      throw new Error('La racine source doit être un dossier.');
    return root;
  }
  private expectedPath(root: string, id: string): string {
    featureId.parse(id);
    return path.join(
      path.dirname(root),
      `${path.basename(root)}-feature-studio-${sha256(id).slice(0, 16)}`,
    );
  }

  /** Buffers are intentional: log redaction and UTF-8 chunk decoding must never alter Git machine data. */
  private rawGit(root: string, args: string[], extraConfig: string[] = []): Promise<GitResult> {
    return runWorkspaceGit(root, args, extraConfig, CHECKPOINT_LIMITS.manifestBytes);
  }
  private async git(root: string, args: string[], extraConfig: string[] = []): Promise<GitResult> {
    // Even status may invoke clean/process filters. Neutralize all configured external filters first.
    const filters = await this.rawGit(root, [
      'config',
      '--null',
      '--name-only',
      '--get-regexp',
      '^filter\\..*\\.(smudge|clean|process|required)$',
    ]);
    if (filters.code !== 0 && filters.code !== 1)
      throw new Error('Impossible de vérifier les filtres Git.');
    const names = new Set(
      machineText(filters.stdout)
        .split('\0')
        .filter(Boolean)
        .map((key) => key.replace(/\.(smudge|clean|process|required)$/, '')),
    );
    const overrides: string[] = [];
    for (const name of names)
      overrides.push(
        `${name}.smudge=`,
        `${name}.clean=`,
        `${name}.process=`,
        `${name}.required=false`,
      );
    return this.rawGit(root, args, [...extraConfig, ...overrides]);
  }
  private async checkedGit(root: string, args: string[], config: string[] = []): Promise<Buffer> {
    const result = await this.git(root, args, config);
    if (result.code !== 0)
      throw new Error(`Git : ${redact(machineText(result.stderr).trim()).slice(0, 2000)}`);
    return result.stdout;
  }
  private async topLevel(root: string): Promise<string | undefined> {
    const probe = await this.git(root, ['rev-parse', '--show-toplevel']);
    if (probe.code) return undefined;
    return realpath(machineText(probe.stdout).trim());
  }
  private async common(root: string): Promise<string> {
    return realpath(
      machineText(
        await this.checkedGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      ).trim(),
    );
  }
  private async identity(
    root: string,
    allowUnborn = false,
  ): Promise<{ branch: string; head: string }> {
    const commit = await this.git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
    if (commit.code !== 0 && !allowUnborn) throw new Error('Un commit HEAD est nécessaire.');
    const head = commit.code ? '' : machineText(commit.stdout).trim();
    const symbolic = await this.git(root, ['symbolic-ref', '--short', 'HEAD']);
    return { head, branch: symbolic.code ? 'HEAD détachée' : machineText(symbolic.stdout).trim() };
  }
  async inspectRepository(): Promise<{
    root: string;
    head: string;
    branch: string;
    dirtyCount: number;
  }> {
    const root = await this.source(),
      top = await this.topLevel(root);
    if (!top)
      throw new Error('Un dépôt Git avec un commit HEAD est nécessaire pour créer un worktree.');
    if (top !== root)
      throw new Error(
        'Ouvre la racine du dépôt Git ; un sous-dossier ne peut pas créer une isolation.',
      );
    const identity = await this.identity(root);
    const records = machineText(
      await this.checkedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    ).split('\0');
    let dirtyCount = 0;
    for (let index = 0; index < records.length; index++)
      if (records[index]) {
        dirtyCount++;
        if (/[RC]/.test(records[index].slice(0, 2))) index++;
      }
    return { root, ...identity, dirtyCount };
  }
  private async privateRoot(executionRoot?: string): Promise<string> {
    const configured = path.resolve(this.storageDirectory);
    try {
      if ((await lstat(configured)).isSymbolicLink())
        throw new Error('Stockage privé symbolique refusé.');
    } catch (error) {
      if (!absent(error)) throw error;
    }
    const source = await this.source();
    let ancestor = configured;
    const remaining: string[] = [];
    let prospective: string;
    for (;;) {
      try {
        prospective = path.join(await realpath(ancestor), ...remaining.reverse());
        break;
      } catch (error) {
        if (!absent(error)) throw error;
        remaining.push(path.basename(ancestor));
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
    if (within(source, prospective!) || (executionRoot && within(executionRoot, prospective!)))
      throw new Error('Les checkpoints doivent être stockés hors du checkout.');
    await mkdir(configured, { recursive: true, mode: 0o700 });
    const root = await realpath(configured);
    if (within(source, root) || (executionRoot && within(executionRoot, root)))
      throw new Error('Les checkpoints doivent être stockés hors du checkout.');
    return root;
  }
  private async privatePath(fragment: string, executionRoot?: string): Promise<string> {
    const root = await this.privateRoot(executionRoot),
      target = path.resolve(root, fragment);
    if (!within(root, target)) throw new Error('Chemin privé hors stockage.');
    let current = root;
    for (const part of path.relative(root, target).split(path.sep)) {
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
          throw new Error('Lien symbolique ou physique dans le stockage privé refusé.');
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
    return target;
  }
  async branchChoices(): Promise<{ name: string; ref: string; commit: string }[]> {
    const repository = await this.inspectRepository();
    const raw = machineText(
      await this.checkedGit(repository.root, [
        'for-each-ref',
        '--format=%(refname)%09%(objectname)',
        'refs/heads/',
        'refs/remotes/',
      ]),
    );
    const branches = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, 2000)
      .map((line) => {
        const [ref, commit] = line.split('\t');
        return { ref, commit, name: ref.replace(/^refs\/(heads|remotes)\//, '') };
      })
      .filter((branch) => /^[a-f0-9]{40,64}$/.test(branch.commit) && !branch.ref.endsWith('/HEAD'));
    if (!branches.some((branch) => branch.ref === `refs/heads/${repository.branch}`))
      branches.unshift({ name: repository.branch, ref: 'HEAD', commit: repository.head });
    return branches;
  }
  async createWorktree(
    feature: Feature,
    choice?: { baseRef: string; baseCommit: string; branchName: string },
  ): Promise<FeatureWorktree> {
    return this.serial(async () => {
      if (feature.worktree) {
        await this.validate(feature);
        return structuredClone(feature.worktree);
      }
      const repository = await this.inspectRepository(),
        target = this.expectedPath(repository.root, feature.id);
      try {
        await lstat(target);
        throw new Error('Le dossier prévu pour ce worktree existe déjà.');
      } catch (error) {
        if (!absent(error)) throw error;
      }
      const slug =
        feature.title
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'feature';
      const branch =
        choice?.branchName ?? `codex/feature-studio-${slug}-${featureId.parse(feature.id)}`;
      let baseCommit = repository.head,
        baseBranch = repository.branch;
      if (choice) {
        if (
          !choice.branchName ||
          choice.branchName.length > 200 ||
          choice.branchName.startsWith('-') ||
          /[\x00-\x20]/.test(choice.branchName)
        )
          throw new Error('Nom de branche invalide.');
        await this.checkedGit(repository.root, ['check-ref-format', '--branch', choice.branchName]);
        if (!/^[a-f0-9]{40,64}$/.test(choice.baseCommit))
          throw new Error('Commit de départ invalide.');
        const selected = (await this.branchChoices()).find((item) => item.ref === choice.baseRef);
        if (!selected || selected.commit !== choice.baseCommit)
          throw new Error(
            'La branche de départ a changé depuis la préparation. Rouvre le ticket pour actualiser son aperçu.',
          );
        baseCommit = machineText(
          await this.checkedGit(repository.root, [
            'rev-parse',
            '--verify',
            '--end-of-options',
            `${selected.ref}^{commit}`,
          ]),
        ).trim();
        if (baseCommit !== choice.baseCommit)
          throw new Error('La branche de départ a changé. Actualise la préparation.');
        baseBranch = selected.name;
      }
      const hooks = await this.privatePath('empty-hooks', target);
      await mkdir(hooks, { recursive: true, mode: 0o700 });
      if ((await readdir(hooks)).length)
        throw new Error('Le dossier de hooks neutralisés doit rester vide.');
      const config = [
        `core.hooksPath=${hooks}`,
        'core.sparseCheckout=false',
        'core.sparseCheckoutCone=false',
      ];
      const filters = await this.git(repository.root, [
        'config',
        '--null',
        '--name-only',
        '--get-regexp',
        '^filter\\..*\\.(smudge|clean|process|required)$',
      ]);
      if (filters.code !== 0 && filters.code !== 1)
        throw new Error('Impossible de vérifier les filtres Git de checkout.');
      const names = new Set(
        machineText(filters.stdout)
          .split('\0')
          .filter(Boolean)
          .map((key) => key.replace(/\.(smudge|clean|process|required)$/, '')),
      );
      for (const name of names)
        config.push(
          `${name}.smudge=`,
          `${name}.clean=`,
          `${name}.process=`,
          `${name}.required=false`,
        );
      try {
        await this.checkedGit(
          repository.root,
          ['worktree', 'add', '-b', branch, '--', target, baseCommit],
          config,
        );
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ` +
            `Worktree demandé : ${target}. Branche demandée : ${branch}. ` +
            'Si Git a été interrompu, vérifie ces éléments avant de réessayer.',
        );
      }
      const worktree: FeatureWorktree = {
        path: await realpath(target),
        branch,
        baseBranch,
        baseCommit,
        createdAt: new Date().toISOString(),
      };
      await this.validate({ ...feature, branch, worktree });
      return worktree;
    });
  }
  async validate(feature: Feature): Promise<string> {
    featureId.parse(feature.id);
    const source = await this.source(),
      sourceTop = await this.topLevel(source);
    if (!feature.worktree) {
      if (!sourceTop && (feature.branch === 'sans Git' || !feature.branch)) return source;
      if (!sourceTop) throw new Error('La racine source Git ne correspond plus au workspace.');
      const current = await this.identity(source, true);
      if (current.branch !== feature.branch)
        throw new Error(`La feature est liée à la branche ${feature.branch}.`);
      return source;
    }
    if (!sourceTop || sourceTop !== source)
      throw new Error('Le dépôt source n’est plus disponible.');
    const expected = this.expectedPath(source, feature.worktree.ownerFeatureId ?? feature.id),
      configured = path.resolve(feature.worktree.path);
    if (configured !== expected)
      throw new Error('Ce chemin de worktree n’appartient pas à cette feature.');
    if ((await lstat(configured)).isSymbolicLink()) throw new Error('Worktree symbolique refusé.');
    const root = await realpath(configured),
      top = await this.topLevel(root);
    if (
      root !== expected ||
      top !== root ||
      (await this.common(root)) !== (await this.common(source))
    )
      throw new Error('Ce worktree n’appartient pas au dépôt source.');
    const records = machineText(
      await this.checkedGit(source, ['worktree', 'list', '--porcelain', '-z']),
    ).split('\0');
    let registered = false;
    for (const record of records)
      if (record.startsWith('worktree ')) {
        try {
          if ((await realpath(record.slice(9))) === root) registered = true;
        } catch {
          /* unrelated missing worktree */
        }
      }
    if (!registered) throw new Error('Le worktree n’est plus enregistré dans le dépôt.');
    const current = await this.identity(root);
    if (current.branch !== feature.branch || current.branch !== feature.worktree.branch)
      throw new Error('La branche du worktree a changé.');
    return root;
  }
  private async safeFile(root: string, name: string): Promise<string> {
    filePath(name);
    if (blocked(name)) throw new Error(`Chemin protégé : ${name}.`);
    const target = path.resolve(root, name);
    if (!within(root, target)) throw new Error('Chemin hors checkout.');
    let current = root;
    for (const part of name.split('/')) {
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error(`Lien symbolique refusé : ${name}.`);
        if (stat.isFile() && stat.nlink > 1) throw new Error(`Lien physique refusé : ${name}.`);
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
    return target;
  }
  private async readLimited(file: string, limit: number, expected?: Stats): Promise<Buffer> {
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.nlink > 1 ||
        stat.size > limit ||
        (expected &&
          (stat.ino !== expected.ino ||
            stat.dev !== expected.dev ||
            stat.size !== expected.size ||
            stat.mtimeMs !== expected.mtimeMs ||
            stat.mode !== expected.mode))
      )
        throw new Error('Fichier non régulier, trop volumineux ou modifié pendant la lecture.');
      // One extra byte detects growth without letting readFile allocate an unbounded buffer.
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      if (
        length !== stat.size ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.mode !== stat.mode ||
        after.nlink > 1
      )
        throw new Error('Le fichier a changé pendant la lecture.');
      return buffer.subarray(0, length);
    } finally {
      await handle.close();
    }
  }
  private async candidates(root: string, git: boolean): Promise<string[]> {
    if (git)
      return [
        ...new Set(
          machineText(
            await this.checkedGit(root, [
              'ls-files',
              '--cached',
              '--others',
              '--exclude-standard',
              '-z',
            ]),
          )
            .split('\0')
            .filter(Boolean),
        ),
      ].sort();
    const names: string[] = [];
    const walk = async (directory: string, prefix = '', depth = 0): Promise<void> => {
      if (depth > 40) throw new Error('Arborescence trop profonde pour un checkpoint.');
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (names.length >= CHECKPOINT_LIMITS.files)
          throw new Error('Trop de fichiers pour un checkpoint.');
        if (entry.isDirectory() && !blocked(name))
          await walk(path.join(directory, entry.name), name + '/', depth + 1);
        else names.push(name);
      }
    };
    await walk(root);
    return names.sort();
  }
  private async snapshot(feature: Feature): Promise<Snapshot> {
    const root = await this.validate(feature),
      git = !!(await this.topLevel(root)),
      identity = git ? await this.identity(root, true) : { branch: 'sans Git', head: '' };
    const files: Record<string, StoredFile> = Object.create(null),
      exclusions: Record<string, string> = Object.create(null),
      contents = new Map<string, Buffer>(),
      excludedPaths: string[] = [];
    let excludedCount = 0,
      totalBytes = 0;
    const exclude = (name: string, reason: string) => {
      if (Object.hasOwn(exclusions, name)) return;
      excludedCount++;
      exclusions[name] = reason.slice(0, 2000);
      if (excludedPaths.length < CHECKPOINT_LIMITS.excludedPaths)
        excludedPaths.push(`${name} : ${reason}`.slice(0, 2000));
    };
    const candidates = await this.candidates(root, git);
    const committed = new Map<string, string>();
    if (identity.head) {
      const tree = machineText(await this.checkedGit(root, ['ls-tree', '-r', '-z', identity.head]));
      for (const record of tree.split('\0')) {
        if (!record) continue;
        const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/.exec(record);
        if (match) committed.set(match[3], match[2]);
      }
    }
    const ignored = git
      ? [
          ...new Set(
            machineText(
              await this.checkedGit(root, [
                'ls-files',
                '--others',
                '--ignored',
                '--exclude-standard',
                '--directory',
                '-z',
              ]),
            )
              .split('\0')
              .filter(Boolean)
              .map((name) => filePath(name.replace(/\/+$/, ''))),
          ),
        ].sort()
      : [];
    if (candidates.length + ignored.length > CHECKPOINT_LIMITS.inventoryFiles)
      throw new Error(
        `Inventaire du point de restauration trop volumineux : plus de ${CHECKPOINT_LIMITS.inventoryFiles} entrées.`,
      );
    // Ignored directories are compact prefixes; their contents are never traversed or read.
    for (const name of ignored) exclude(name, 'Ignoré par Git (fichier ou préfixe de dossier).');
    for (const name of candidates) {
      let target: string;
      try {
        target = await this.safeFile(root, name);
      } catch (error) {
        exclude(name, (error as Error).message);
        continue;
      }
      let before;
      try {
        before = await lstat(target);
      } catch (error) {
        if (absent(error)) continue;
        throw error;
      }
      if (!before.isFile()) {
        exclude(name, 'pas un fichier régulier');
        continue;
      }
      if (before.size > CHECKPOINT_LIMITS.fileBytes) {
        exclude(name, `plus de ${CHECKPOINT_LIMITS.fileBytes} octets`);
        continue;
      }
      const content = await this.readLimited(target, CHECKPOINT_LIMITS.fileBytes, before);
      await this.safeFile(root, name);
      const current = await lstat(target);
      if (
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        current.mtimeMs !== before.mtimeMs ||
        current.mode !== before.mode
      )
        throw new Error(`Le fichier ${name} a été remplacé pendant le checkpoint.`);
      const base = committed.get(name);
      const gitContent = base ? this.reusableGitContent(content, base) : undefined;
      if (!gitContent) {
        totalBytes += content.length;
        if (totalBytes > CHECKPOINT_LIMITS.totalBytes)
          throw new Error(
            'Point de restauration refusé : plus de 64 Mio de contenus nouveaux ou modifiés à sauvegarder hors de Git. Aucun checkpoint incomplet n’a été créé.',
          );
        if (contents.size >= CHECKPOINT_LIMITS.files)
          throw new Error(
            `Point de restauration refusé : plus de ${CHECKPOINT_LIMITS.files} fichiers à sauvegarder hors de Git. Les fichiers réutilisés depuis le commit ne comptent pas dans cette limite.`,
          );
        contents.set(name, content);
      }
      files[name] = {
        hash: sha256(content),
        size: content.length,
        mode: before.mode & 0o777,
        binary: binary(content),
        ...(gitContent ? { git: gitContent } : {}),
      };
    }
    return { root, ...identity, files, contents, exclusions, excludedCount, excludedPaths };
  }
  private checkpointRef(ownerId: string, id: string): string {
    return `refs/feature-studio/checkpoints/${featureId.parse(ownerId)}/${checkpointId.parse(id)}`;
  }
  private async updateCheckpointRef(root: string, args: string[]): Promise<void> {
    const hooks = await this.privatePath('empty-hooks', root);
    await mkdir(hooks, { recursive: true, mode: 0o700 });
    if ((await readdir(hooks)).length)
      throw new Error('Le dossier de hooks neutralisés doit rester vide.');
    await this.checkedGit(root, ['update-ref', ...args], [`core.hooksPath=${hooks}`]);
  }
  /** Reuse immutable Git bytes only after proving that they reconstruct the exact checkout bytes. */
  private reusableGitContent(content: Buffer, oid: string): StoredFile['git'] {
    const objectId = (bytes: Buffer) =>
      createHash(oid.length === 64 ? 'sha256' : 'sha1')
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest('hex');
    if (objectId(content) === oid) return { oid };
    if (!binary(content)) {
      const lf = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'));
      if (objectId(lf) === oid && this.withCrlf(lf).equals(content)) return { oid, crlf: true };
    }
    // Custom filters/encodings and mixed line endings remain byte-exact private objects.
    return undefined;
  }
  private withCrlf(content: Buffer): Buffer {
    return Buffer.from(content.toString('utf8').replace(/\n/g, '\r\n'));
  }
  private async immutableWrite(destination: string, content: Buffer): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${randomUUID()}.tmp`,
      handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await this.readLimited(destination, content.length)).equals(content))
        throw new Error('Objet privé immuable existant différent : stockage altéré.');
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  private async captureSnapshot(
    feature: Feature,
    snapshot: Snapshot,
    input: { kind: FeatureCheckpoint['kind']; label: string; stepId?: string; attemptId?: string },
  ): Promise<FeatureCheckpoint> {
    const checkpoint = checkpointSchema.parse({
      id: randomUUID(),
      label: input.label,
      kind: input.kind,
      createdAt: new Date().toISOString(),
      branch: snapshot.branch,
      head: snapshot.head,
      ...(input.stepId ? { stepId: input.stepId } : {}),
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      fileCount: Object.keys(snapshot.files).length,
      totalBytes: Object.values(snapshot.files).reduce((sum, file) => sum + file.size, 0),
      storedFileCount: snapshot.contents.size,
      storedBytes: [...snapshot.contents.values()].reduce(
        (sum, content) => sum + content.length,
        0,
      ),
      excludedCount: snapshot.excludedCount,
      excludedPaths: snapshot.excludedPaths,
    });
    for (const [name, content] of snapshot.contents)
      await this.immutableWrite(
        await this.privatePath(`objects/${snapshot.files[name].hash}`, snapshot.root),
        content,
      );
    const manifest: Manifest = {
      version: 2,
      featureId: feature.id,
      root: snapshot.root,
      checkpoint,
      files: snapshot.files,
      exclusions: snapshot.exclusions,
    };
    const encoded = Buffer.from(JSON.stringify(manifest));
    if (encoded.length > CHECKPOINT_LIMITS.manifestBytes)
      throw new Error('Manifeste trop volumineux.');
    const destination = await this.privatePath(`manifests/${checkpoint.id}.json`, snapshot.root);
    const ref = this.checkpointRef(feature.id, checkpoint.id);
    // A private ref keeps the original commit reachable even after commits, resets and Git GC.
    if (snapshot.head)
      await this.updateCheckpointRef(snapshot.root, [
        ref,
        snapshot.head,
        '0'.repeat(snapshot.head.length),
      ]);
    try {
      await this.immutableWrite(destination, encoded);
    } catch (error) {
      if (snapshot.head)
        await this.updateCheckpointRef(snapshot.root, ['-d', ref, snapshot.head]).catch(
          () => undefined,
        );
      throw error;
    }
    return checkpoint;
  }
  capture(
    feature: Feature,
    input: { kind: FeatureCheckpoint['kind']; label: string; stepId?: string; attemptId?: string },
  ): Promise<FeatureCheckpoint> {
    return this.serial(async () =>
      this.captureSnapshot(feature, await this.snapshot(feature), input),
    );
  }
  private async manifest(feature: Feature, id: string, root: string): Promise<Manifest> {
    checkpointId.parse(id);
    if (!feature.checkpoints?.some((checkpoint) => checkpoint.id === id))
      throw new Error('Ce checkpoint n’appartient pas à cette feature.');
    const file = await this.privatePath(`manifests/${id}.json`, root),
      stat = await lstat(file);
    if (!stat.isFile() || stat.size > CHECKPOINT_LIMITS.manifestBytes)
      throw new Error('Manifeste invalide ou trop volumineux.');
    const manifest = manifestSchema.parse(
      JSON.parse(
        (await this.readLimited(file, CHECKPOINT_LIMITS.manifestBytes, stat)).toString('utf8'),
      ),
    );
    if (
      manifest.featureId !== feature.id ||
      manifest.root !== root ||
      manifest.checkpoint.id !== id
    )
      throw new Error('Le checkpoint appartient à une autre feature ou racine.');
    const values = Object.values(manifest.files);
    if (
      values.length !== manifest.checkpoint.fileCount ||
      values.reduce((sum, value) => sum + value.size, 0) !== manifest.checkpoint.totalBytes
    )
      throw new Error('Manifeste incohérent.');
    if (
      Object.keys(manifest.exclusions).length !== manifest.checkpoint.excludedCount ||
      Object.keys(manifest.exclusions).length > CHECKPOINT_LIMITS.inventoryFiles
    )
      throw new Error('Inventaire des exclusions incohérent.');
    const stored = values.filter((file) => !file.git);
    if (
      (manifest.version === 1 && values.some((file) => file.git)) ||
      (values.some((file) => file.git) && !manifest.checkpoint.head) ||
      stored.length > CHECKPOINT_LIMITS.files ||
      stored.reduce((sum, file) => sum + file.size, 0) > CHECKPOINT_LIMITS.totalBytes ||
      (manifest.version === 2 &&
        (manifest.checkpoint.storedFileCount !== stored.length ||
          manifest.checkpoint.storedBytes !== stored.reduce((sum, file) => sum + file.size, 0)))
    )
      throw new Error('Inventaire des contenus sauvegardés incohérent.');
    for (const name of Object.keys(manifest.files)) {
      filePath(name);
      if (blocked(name)) throw new Error('Un manifeste référence un fichier protégé.');
    }
    return manifest;
  }
  private fingerprint(
    feature: Feature,
    checkpoint: Manifest,
    target: Snapshot | Manifest,
    targetId?: string,
  ): string {
    return sha256(
      JSON.stringify({
        featureId: feature.id,
        root: target.root,
        checkpoint: checkpoint.checkpoint.id,
        checkpointFiles: Object.keys(checkpoint.files)
          .sort()
          .map((name) => [name, checkpoint.files[name]]),
        checkpointExclusions: checkpoint.exclusions,
        targetCheckpointId: targetId,
        branch: 'checkpoint' in target ? target.checkpoint.branch : target.branch,
        head: 'checkpoint' in target ? target.checkpoint.head : target.head,
        files: Object.keys(target.files)
          .sort()
          .map((name) => [name, target.files[name]]),
        excluded: target.exclusions,
      }),
    );
  }
  private async comparison(
    feature: Feature,
    id: string,
    targetId?: string,
  ): Promise<CheckpointComparison> {
    const root = await this.validate(feature),
      before = await this.manifest(feature, id, root),
      after = targetId
        ? await this.manifest(feature, targetId, root)
        : await this.snapshot(feature);
    const files: CheckpointComparison['files'] = [];
    for (const name of [
      ...new Set([...Object.keys(before.files), ...Object.keys(after.files)]),
    ].sort()) {
      const left = before.files[name],
        right = after.files[name];
      if (left?.hash === right?.hash && left?.mode === right?.mode) continue;
      let restorable = true,
        reason: string | undefined;
      const exclusion =
        Object.entries(before.exclusions).find(
          ([excluded]) => excluded === name || name.startsWith(excluded + '/'),
        ) ??
        Object.entries(after.exclusions).find(
          ([excluded]) => excluded === name || name.startsWith(excluded + '/'),
        );
      if (exclusion) {
        restorable = false;
        reason = `Chemin exclu d’un checkpoint : ${exclusion[1]}`;
      }
      if (!targetId) {
        try {
          const file = await this.safeFile(root, name);
          try {
            const stat = await lstat(file);
            if (!stat.isFile() || stat.size > CHECKPOINT_LIMITS.fileBytes)
              throw new Error('Fichier actuel non restaurable ou trop volumineux.');
          } catch (error) {
            if (!absent(error)) throw error;
          }
        } catch (error) {
          restorable = false;
          reason = (error as Error).message;
        }
      }
      files.push({
        path: name,
        status: !left ? 'added' : !right ? 'deleted' : 'modified',
        ...(left ? { beforeHash: left.hash } : {}),
        ...(right ? { afterHash: right.hash } : {}),
        binary: !!(left?.binary || right?.binary),
        restorable,
        ...(reason ? { reason } : {}),
      });
    }
    return {
      featureId: feature.id,
      checkpointId: id,
      ...(targetId ? { targetCheckpointId: targetId } : {}),
      fingerprint: this.fingerprint(feature, before, after, targetId),
      files,
    };
  }
  compare(feature: Feature, id: string, targetId?: string): Promise<CheckpointComparison> {
    return this.serial(() => this.comparison(feature, id, targetId));
  }
  private async blob(file: StoredFile, root: string): Promise<Buffer> {
    if (file.git) {
      const size = Number(
        machineText(await this.checkedGit(root, ['cat-file', '-s', file.git.oid])).trim(),
      );
      if (!Number.isSafeInteger(size) || size < 0 || size > CHECKPOINT_LIMITS.fileBytes)
        throw new Error('Objet Git du point de restauration invalide ou trop volumineux.');
      const raw = await this.checkedGit(root, ['cat-file', 'blob', file.git.oid]);
      const content = file.git.crlf ? this.withCrlf(raw) : raw;
      if (content.length !== file.size || sha256(content) !== file.hash)
        throw new Error('Empreinte de l’objet Git du point de restauration invalide.');
      return content;
    }
    const target = await this.privatePath(`objects/${file.hash}`, root),
      stat = await lstat(target);
    if (!stat.isFile() || stat.size !== file.size || stat.size > CHECKPOINT_LIMITS.fileBytes)
      throw new Error('Objet de checkpoint invalide.');
    const content = await this.readLimited(target, CHECKPOINT_LIMITS.fileBytes, stat);
    if (sha256(content) !== file.hash) throw new Error('Empreinte de checkpoint invalide.');
    return content;
  }
  async readFile(feature: Feature, id: string, name: string): Promise<Buffer | undefined> {
    filePath(name);
    if (blocked(name)) throw new Error('Fichier protégé.');
    const root = await this.validate(feature),
      manifest = await this.manifest(feature, id, root),
      file = manifest.files[name];
    return file ? this.blob(file, root) : undefined;
  }
  private async assertState(
    root: string,
    name: string,
    expected: StoredFile | undefined,
  ): Promise<string> {
    const destination = await this.safeFile(root, name);
    let actual: StoredFile | undefined;
    try {
      const stat = await lstat(destination);
      if (!stat.isFile() || stat.size > CHECKPOINT_LIMITS.fileBytes)
        throw new Error('Fichier actuel non régulier ou trop volumineux.');
      const content = await this.readLimited(destination, CHECKPOINT_LIMITS.fileBytes, stat);
      actual = {
        hash: sha256(content),
        size: content.length,
        mode: stat.mode & 0o777,
        binary: binary(content),
      };
    } catch (error) {
      if (!absent(error)) throw error;
    }
    if (
      actual?.hash !== expected?.hash ||
      actual?.size !== expected?.size ||
      actual?.mode !== expected?.mode ||
      actual?.binary !== expected?.binary
    )
      throw new Error(`Modification concurrente détectée : ${name}.`);
    return destination;
  }
  restore(
    feature: Feature,
    id: string,
    paths: string[],
    expectedFingerprint: string,
    onRecovery: (checkpoint: FeatureCheckpoint) => Promise<void>,
  ): Promise<{ recovery: FeatureCheckpoint; restoredFiles: string[] }> {
    return this.serial(async () => {
      if (
        !paths.length ||
        paths.length > 200 ||
        new Set(paths.map((name) => name.toLowerCase())).size !== paths.length
      )
        throw new Error('Sélection de restauration vide, dupliquée ou trop volumineuse.');
      for (const name of paths) filePath(name);
      const comparison = await this.comparison(feature, id);
      if (comparison.fingerprint !== expectedFingerprint)
        throw new Error('Aperçu de restauration obsolète : le workspace a changé.');
      for (const name of paths)
        if (!comparison.files.some((file) => file.path === name && file.restorable))
          throw new Error(`Fichier absent du diff ou non restaurable : ${name}.`);
      const current = await this.snapshot(feature),
        target = await this.manifest(feature, id, current.root),
        contents = new Map<string, Buffer>();
      for (const name of paths) {
        await this.safeFile(current.root, name);
        const file = target.files[name];
        if (file) contents.set(name, await this.blob(file, current.root));
      }
      const recovery = await this.captureSnapshot(feature, current, {
        kind: 'recovery',
        label: `Avant restauration · ${target.checkpoint.label}`.slice(0, 200),
      });
      // Host must durably attach this checkpoint before ANY checkout write or deletion.
      await onRecovery(structuredClone(recovery));
      if ((await this.comparison(feature, id)).fingerprint !== expectedFingerprint)
        throw new WorkspaceRestoreError(
          'Le workspace a changé après la sauvegarde. Aucun fichier restauré.',
          recovery,
          [],
        );
      const restoredFiles: string[] = [];
      try {
        for (const name of paths) {
          const desired = target.files[name],
            expected = current.files[name],
            destination = await this.assertState(current.root, name, expected);
          if (!desired) {
            await this.assertState(current.root, name, expected);
            await unlink(destination);
          } else {
            await mkdir(path.dirname(destination), { recursive: true });
            await this.safeFile(current.root, name);
            const temporary = path.join(
                path.dirname(destination),
                `.${path.basename(destination)}.feature-studio-${randomUUID()}.tmp`,
              ),
              handle = await open(temporary, 'wx', 0o600);
            try {
              await handle.writeFile(contents.get(name)!);
              await handle.sync();
            } finally {
              await handle.close();
            }
            try {
              await chmod(temporary, desired.mode);
              await this.assertState(current.root, name, expected);
              await rename(temporary, destination);
            } finally {
              await unlink(temporary).catch(() => undefined);
            }
          }
          restoredFiles.push(name);
        }
      } catch (error) {
        throw new WorkspaceRestoreError((error as Error).message, recovery, restoredFiles);
      }
      return { recovery, restoredFiles };
    });
  }
}
