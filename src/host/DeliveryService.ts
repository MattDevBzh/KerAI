import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdtemp,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { deliveryRulesSchema } from '../core/devopsSchemas';
import type { DeliverySnapshot, DeliveryPreview } from '../shared/devops';
export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type GitRunner = (
  args: string[],
  options?: { env?: Record<string, string>; input?: string },
) => Promise<GitResult>;
const digest = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
const safePath = (p: string) =>
  p.length <= 4000 &&
  !p.includes('\0') &&
  !p.includes('\\') &&
  !path.isAbsolute(p) &&
  !p.split('/').some((s) => !s || s === '..' || s === '.' || s.toLowerCase() === '.git');
export function parseDeliveryRules(instructions: string) {
  const block = /```delivery-rules\s*\n([\s\S]*?)```/.exec(instructions);
  const rules = deliveryRulesSchema.parse(block ? parse(block[1], { uniqueKeys: true }) : {});
  if (!rules.types.includes(rules.defaultType))
    throw new Error('Le type par défaut doit appartenir à types dans delivery-rules.');
  return rules;
}
export function suggestCommitTitle(instructions: string, paths: string[], intent = '') {
  const rules = parseDeliveryRules(instructions);
  let type = rules.defaultType;
  if (paths.every((p) => /\.(md|txt)$/.test(p)) && rules.types.includes('docs')) type = 'docs';
  else if (paths.every((p) => /test|spec/.test(p)) && rules.types.includes('test')) type = 'test';
  const summary = (intent.trim() || rules.summary)
    .replace(/[\r\n\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ');
  return `${type}${rules.scope ? `(${rules.scope})` : ''}: ${summary}`.slice(0, rules.maxLength);
}
export class DeliveryService {
  readonly run: GitRunner;
  constructor(
    readonly root: string,
    runner?: GitRunner,
  ) {
    this.run =
      runner ??
      ((args, options = {}) =>
        new Promise((resolve, reject) => {
          const env = { ...process.env };
          for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
          Object.assign(
            env,
            { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' },
            options.env,
          );
          const child = spawn(
            'git',
            [
              '--no-pager',
              '-c',
              'core.fsmonitor=false',
              '-c',
              'core.hooksPath=/dev/null',
              '-c',
              'commit.gpgSign=false',
              ...args,
            ],
            { cwd: this.root, shell: false, env },
          );
          let stdout = '',
            stderr = '',
            size = 0;
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, 30000);
          for (const [stream, key] of [
            [child.stdout, 'out'],
            [child.stderr, 'err'],
          ] as const)
            stream.on('data', (b: Buffer) => {
              size += b.length;
              if (size > 16_000_000) child.kill('SIGKILL');
              else if (key === 'out') stdout += b.toString('utf8');
              else stderr += b.toString('utf8');
            });
          child.on('error', () => {
            clearTimeout(timer);
            reject(new Error('Git ne peut pas être exécuté.'));
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut || size > 16_000_000 || code === null)
              reject(new Error('Opération Git interrompue (délai ou volume).'));
            else resolve({ code, stdout, stderr });
          });
          child.stdin.end(options.input);
        }));
  }
  private async git(args: string[], options?: { env?: Record<string, string>; input?: string }) {
    const result = await this.run(args, options);
    if (result.code)
      throw new Error(
        `Git refuse ${args[0]} (code ${result.code}). Consulte Git dans le terminal pour le diagnostic ; aucune sortie susceptible de contenir un secret n’est transmise.`,
      );
    return result.stdout;
  }
  private async filters() {
    const result = await this.run([
      'config',
      '--null',
      '--name-only',
      '--get-regexp',
      '^filter\\..*\\.(smudge|clean|process|required)$',
    ]);
    if (result.code !== 0 && result.code !== 1)
      throw new Error('Impossible de vérifier les filtres Git.');
    return [
      ...new Set(
        result.stdout
          .split('\0')
          .filter(Boolean)
          .map((s) => s.replace(/\.(smudge|clean|process|required)$/, '')),
      ),
    ].flatMap((s) => [
      '-c',
      `${s}.smudge=`,
      '-c',
      `${s}.clean=`,
      '-c',
      `${s}.process=`,
      '-c',
      `${s}.required=false`,
    ]);
  }
  private async indexPath() {
    return (await this.git(['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim();
  }
  async inspect(remote = 'origin'): Promise<DeliverySnapshot> {
    const filters = await this.filters();
    // Git uses forward slashes on Windows; compare canonical filesystem paths
    // throughout, including when Git or the workspace is reached through an alias.
    const top = await realpath((await this.git(['rev-parse', '--show-toplevel'])).trim());
    if (top !== (await realpath(this.root))) throw new Error('Ouvre la racine du dépôt Git.');
    const branchResult = await this.run(['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (branchResult.code)
      throw new Error('HEAD détachée : choisis une branche dans Git avant la livraison.');
    const branch = branchResult.stdout.trim();
    const head = (await this.git(['rev-parse', '--verify', 'HEAD'])).trim();
    const status = await this.git([
      ...filters,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
    ]);
    const records = status.split('\0').filter(Boolean);
    if (records.length > 2000)
      throw new Error('Plus de 2 000 fichiers modifiés : réduis le périmètre avant la livraison.');
    const files: DeliverySnapshot['files'] = [];
    const contentHashes: string[] = [];
    const untrackedContents: string[] = [];
    let bytes = 0;
    for (const record of records) {
      const file = record.slice(3);
      if (!safePath(file)) throw new Error('Chemin Git non pris en charge.');
      const staged = record[0],
        unstaged = record[1];
      let blocked: string | undefined;
      if (staged === 'U' || unstaged === 'U' || ['AA', 'DD'].includes(record.slice(0, 2)))
        blocked = 'Conflit Git à résoudre.';
      const absolute = path.join(this.root, file);
      try {
        const stat = await lstat(absolute);
        if (stat.isDirectory()) blocked = 'Sous-module ou dossier : livraison manuelle nécessaire.';
        else if (stat.isSymbolicLink()) {
          contentHashes.push(file + ':symlink:' + digest(await readlink(absolute)));
        } else if (stat.isFile()) {
          bytes += stat.size;
          if (stat.size > 8_000_000 || bytes > 64_000_000)
            throw new Error(
              'Fichiers trop volumineux pour un aperçu vérifiable (8 Mo/fichier, 64 Mo au total).',
            );
          const resolved = await realpath(path.dirname(absolute));
          const relative = path.relative(top, resolved);
          if (
            relative === '..' ||
            relative.startsWith('..' + path.sep) ||
            path.isAbsolute(relative)
          )
            throw new Error('Chemin hors du dépôt refusé.');
          const contents = await readFile(absolute);
          contentHashes.push(file + ':' + digest(contents) + ':' + stat.mode);
          if (staged === '?' && unstaged === '?' && untrackedContents.join('').length < 100000)
            untrackedContents.push(
              `--- ${file} (nouveau) ---\n` +
                (contents.includes(0)
                  ? '[contenu binaire]'
                  : contents.toString('utf8').slice(0, 100000)),
            );
        } else blocked = 'Fichier spécial non pris en charge.';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        contentHashes.push(file + ':deleted');
      }
      files.push({
        path: file,
        staged,
        unstaged,
        untracked: staged === '?' && unstaged === '?',
        blocked,
      });
    }
    const index = await readFile(await this.indexPath());
    const remoteResult = await this.run(['remote', 'get-url', '--push', remote]);
    const remoteUrl = remoteResult.code ? undefined : remoteResult.stdout.trim();
    const publicRemote = remoteUrl?.replace(/(https?:\/\/)[^/@]+@/, '$1');
    const diff = await this.git([
      ...filters,
      'diff',
      'HEAD',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--',
      ...files.filter((f) => !f.blocked && !f.untracked).map((f) => f.path),
    ]);
    const stagedDiff = await this.git([
      ...filters,
      'diff',
      '--cached',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
    ]);
    const unstagedDiff = await this.git([
      ...filters,
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
    ]);
    const untrackedDiff = untrackedContents.join('\n');
    return {
      branch,
      head,
      files,
      remote,
      remoteUrl: publicRemote,
      diff: diff.slice(0, 100000),
      stagedDiff: stagedDiff.slice(0, 100000),
      unstagedDiff: unstagedDiff.slice(0, 100000),
      untrackedDiff: untrackedDiff.slice(0, 100000),
      diffTruncated: [diff, stagedDiff, unstagedDiff, untrackedDiff].some((v) => v.length > 100000),
      fingerprint: digest(
        JSON.stringify({ branch, head, status, index: digest(index), contentHashes, remoteUrl }),
      ),
    };
  }
  async previewCommit(paths: string[], instructions: string, title?: string, intent?: string) {
    const snapshot = await this.inspect();
    if (!paths.length || new Set(paths).size !== paths.length)
      throw new Error('Sélectionne au moins un fichier, sans doublon.');
    for (const name of paths) {
      const file = snapshot.files.find((f) => f.path === name);
      if (!file || file.blocked || !safePath(name))
        throw new Error(`Sélection non livrable : ${name}`);
    }
    const rules = parseDeliveryRules(instructions);
    const proposed = title ?? suggestCommitTitle(instructions, paths, intent);
    if (!new RegExp(`^(${rules.types.join('|')})(\\([a-zA-Z0-9_-]+\\))?: .+`).test(proposed))
      throw new Error(
        'Le titre doit utiliser un type conventionnel autorisé dans le profil fs-delivery.',
      );
    if (!proposed.trim() || /[\r\n\x00-\x1f]/.test(proposed) || proposed.length > rules.maxLength)
      throw new Error(`Titre invalide : une ligne, ${rules.maxLength} caractères maximum.`);
    return {
      snapshot,
      preview: {
        kind: 'commit',
        fingerprint: snapshot.fingerprint,
        branch: snapshot.branch,
        head: snapshot.head,
        paths,
        title: proposed,
      } satisfies DeliveryPreview,
    };
  }
  async commit(preview: DeliveryPreview) {
    if (preview.kind !== 'commit') throw new Error('Aperçu de commit requis.');
    const filters = await this.filters();
    if ((await this.inspect()).fingerprint !== preview.fingerprint)
      throw new Error('Le dépôt a changé. Recrée l’aperçu avant de confirmer.');
    const indexPath = await this.indexPath();
    const stat = await lstat(indexPath);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Index Git non régulier refusé.');
    const folder = await mkdtemp(path.join(tmpdir(), 'feature-studio-delivery-'));
    const privateIndex = path.join(folder, 'commit-index'),
      reconciledIndex = path.join(folder, 'preserved-index');
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    let headUpdated = false;
    try {
      await copyFile(indexPath, reconciledIndex);
      await this.git([...filters, 'read-tree', preview.head], {
        env: { GIT_INDEX_FILE: privateIndex },
      });
      await this.git([...filters, 'add', '-A', '--', ...preview.paths], {
        env: { GIT_INDEX_FILE: privateIndex },
      });
      await this.git([...filters, 'add', '-A', '--', ...preview.paths], {
        env: { GIT_INDEX_FILE: reconciledIndex },
      });
      const tree = (
        await this.git([...filters, 'write-tree'], { env: { GIT_INDEX_FILE: privateIndex } })
      ).trim();
      const previousTree = (
        await this.git([...filters, 'rev-parse', `${preview.head}^{tree}`])
      ).trim();
      if (tree === previousTree)
        throw new Error('La sélection ne produit aucun changement par rapport à HEAD.');
      const commit = (
        await this.git([...filters, 'commit-tree', tree, '-p', preview.head, '-m', preview.title])
      ).trim();
      lock = await open(indexPath + '.lock', 'wx', 0o600);
      if ((await this.inspect()).fingerprint !== preview.fingerprint)
        throw new Error('Le dépôt a changé pendant la préparation. Recrée l’aperçu.');
      await this.git([
        ...filters,
        'update-ref',
        '-m',
        `Feature Studio: ${preview.title}`,
        `refs/heads/${preview.branch}`,
        commit,
        preview.head,
      ]);
      headUpdated = true;
      await lock.writeFile(await readFile(reconciledIndex));
      await lock.close();
      lock = undefined;
      await rename(indexPath + '.lock', indexPath);
      return commit;
    } catch (error) {
      if (headUpdated)
        throw new Error(
          'Le commit a été créé mais la mise à jour de l’index a échoué. Ne relance pas : inspecte Git et son fichier index.lock.',
        );
      throw error;
    } finally {
      if (lock) {
        await lock.close();
        if (!headUpdated) await rm(indexPath + '.lock', { force: true });
      }
      await rm(folder, { recursive: true, force: true });
    }
  }
  async previewPush(remote: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(remote)) throw new Error('Remote invalide.');
    const snapshot = await this.inspect(remote);
    if (!snapshot.remoteUrl) throw new Error('Remote Git absent.');
    const urls = (await this.git(['remote', 'get-url', '--push', '--all', remote]))
      .trim()
      .split('\n');
    if (urls.length !== 1)
      throw new Error('Plusieurs destinations de push : choisis un remote unique.');
    if (!/^(https:\/\/|ssh:\/\/|git@)/.test(urls[0]))
      throw new Error('Seuls les remotes HTTPS ou SSH sont acceptés.');
    return {
      snapshot,
      preview: {
        kind: 'push',
        fingerprint: snapshot.fingerprint,
        branch: snapshot.branch,
        head: snapshot.head,
        paths: [],
        title: `Publier ${snapshot.branch}`,
        remote,
      } satisfies DeliveryPreview,
    };
  }
  async push(preview: DeliveryPreview) {
    if (preview.kind !== 'push' || !preview.remote) throw new Error('Aperçu de push requis.');
    if ((await this.inspect(preview.remote)).fingerprint !== preview.fingerprint)
      throw new Error('Le dépôt ou le remote a changé. Recrée l’aperçu.');
    await this.git([
      '-c',
      'push.followTags=false',
      'push',
      '--no-verify',
      '--recurse-submodules=no',
      '--',
      preview.remote,
      `${preview.head}:refs/heads/${preview.branch}`,
    ]);
  }
  async validateBranch(branch: string) {
    await this.git(['check-ref-format', `refs/heads/${branch}`]);
  }
}
