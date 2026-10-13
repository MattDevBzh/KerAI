import { z } from 'zod';
import path from 'node:path';
import { gitRead } from './gitRead';
import { PolicyEngine, sha256 } from './PolicyEngine';
import { redact } from './process';
import { textPage } from './textFiles';

const fingerprint = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .optional();
export const gitComparisonSchema = z.object({
  baseRef: z.string().min(1).max(512).optional(),
  comparison: z.enum(['merge-base', 'direct']).default('merge-base'),
  includeLocal: z.boolean().optional(),
});
export const gitPageSchema = z.object({
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(250).default(100),
  expectedSha256: fingerprint,
});
export const gitChangesSchema = gitComparisonSchema.extend(gitPageSchema.shape);
export const gitDiffSchema = gitComparisonSchema.extend({
  path: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  expectedSha256: fingerprint,
});
type Comparison = z.infer<typeof gitComparisonSchema>;

/** Read-only branch comparisons. Every Git revision is resolved to a commit before diffing. */
export class GitReview {
  constructor(
    private root: string,
    private policy: PolicyEngine,
    private signal: AbortSignal,
  ) {}

  private async read(args: string[], maxBytes = 4_000_000) {
    const result = await gitRead(this.root, args, {
      signal: this.signal,
      timeoutMs: 30_000,
      maxBytes,
      rawOutput: true,
    });
    if (result.code !== 0) throw new Error(`Lecture Git impossible : ${result.stderr.trim()}`);
    if (result.truncated)
      throw new Error(
        'Résultat Git trop volumineux. Utiliser studio_git_changes puis studio_git_diff avec un chemin de fichier. Aucune portion tronquée n’a été retenue.',
      );
    return result.stdout;
  }

  private checkPage(offset: number, expected: string | undefined, actual: string) {
    if (offset > 0 && !expected)
      throw new Error(
        'Pour poursuivre la lecture, fournir expectedSha256 reçu à la première page.',
      );
    if (expected && expected !== actual)
      throw new Error('La comparaison Git a changé. Recommencer à la première page.');
  }

  private async current() {
    const headSha = (await this.read(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    const branch = await gitRead(this.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      signal: this.signal,
      rawOutput: true,
    });
    if (branch.truncated || (branch.code !== 0 && branch.code !== 1))
      throw new Error('Branche courante indisponible.');
    return { headSha, branch: branch.code === 0 ? branch.stdout.trim() : 'HEAD détachée' };
  }

  async branches(args: z.infer<typeof gitPageSchema>) {
    const current = await this.current();
    const output = await this.read([
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)%00%(objectname)%00%(symref)',
      'refs/heads/',
      'refs/remotes/',
    ]);
    const branches = output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, sha, symbolic] = line.split('\0');
        return { ref, name: ref.replace(/^refs\/(heads|remotes)\//, ''), sha, symbolic };
      })
      .filter((entry) => !entry.symbolic)
      .map(({ ref, name, sha }) => ({ ref, name, sha }));
    const hash = sha256(JSON.stringify({ ...current, branches }));
    this.checkPage(args.offset, args.expectedSha256, hash);
    return {
      ...current,
      branches: branches.slice(args.offset, args.offset + args.limit),
      total: branches.length,
      sha256: hash,
      nextOffset: args.offset + args.limit < branches.length ? args.offset + args.limit : undefined,
      note: 'Branches locales et références distantes déjà présentes. Aucun fetch automatique.',
    };
  }

  private async resolveBranch(name: string) {
    if (name.startsWith('-') || name.includes('\0') || /[\r\n]/.test(name))
      throw new Error('Nom de branche invalide.');
    const refs = name.startsWith('refs/') ? [name] : [`refs/heads/${name}`, `refs/remotes/${name}`];
    const matches: { ref: string; sha: string }[] = [];
    for (const ref of refs) {
      if (!/^refs\/(heads|remotes)\/.+/.test(ref))
        throw new Error('Une branche locale ou distante est requise.');
      await this.read(['check-ref-format', ref]);
      const result = await gitRead(
        this.root,
        ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
        {
          signal: this.signal,
          rawOutput: true,
        },
      );
      if (result.code === 0 && !result.truncated && /^[a-f0-9]{40,64}\s*$/.test(result.stdout))
        matches.push({ ref, sha: result.stdout.trim() });
    }
    if (!matches.length)
      throw new Error(
        `Branche introuvable : ${name}. Consulter studio_git_branches ; actualiser les références distantes avec Git si nécessaire.`,
      );
    if (matches.length > 1)
      throw new Error('Nom ambigu : préciser refs/heads/... ou refs/remotes/... .');
    return matches[0];
  }

  private async snapshot(args: Comparison) {
    const current = await this.current();
    const base = args.baseRef ? await this.resolveBranch(args.baseRef) : undefined;
    let effectiveBaseSha = base?.sha ?? current.headSha;
    if (base && args.comparison === 'merge-base') {
      const result = await gitRead(this.root, ['merge-base', '--all', base.sha, current.headSha], {
        signal: this.signal,
        rawOutput: true,
      });
      if (result.code === 1 && !result.stdout.trim())
        throw new Error(
          'Aucun ancêtre commun disponible. Vérifier l’historique (notamment un clone superficiel) ou choisir explicitement comparison: direct.',
        );
      if (result.code !== 0 || result.truncated)
        throw new Error(`Ancêtre commun indisponible : ${result.stderr}`);
      const bases = result.stdout.trim().split(/\s+/);
      if (bases.length !== 1 || !bases[0])
        throw new Error('Ancêtre commun non unique. Choisir explicitement comparison: direct.');
      effectiveBaseSha = bases[0];
    }
    return {
      ...current,
      baseRef: base?.ref ?? 'HEAD',
      baseSha: base?.sha ?? current.headSha,
      effectiveBaseSha,
      comparison: base ? args.comparison : 'working-tree',
      includeLocal: args.includeLocal ?? !base,
    };
  }

  private diffArgs(snapshot: Awaited<ReturnType<GitReview['snapshot']>>) {
    return [
      '-c',
      'core.quotePath=false',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--no-color',
      '--relative',
      '--ignore-submodules=all',
      snapshot.effectiveBaseSha,
      ...(snapshot.includeLocal ? [] : [snapshot.headSha]),
    ];
  }

  private async inventory(args: Comparison) {
    const snapshot = await this.snapshot(args);
    const output = await this.read([...this.diffArgs(snapshot), '--name-status', '-z', '--', '.']);
    const records = output.split('\0').filter(Boolean);
    const candidates: { path: string; status: string }[] = [];
    for (let i = 0; i < records.length; i += 2) {
      if (!records[i + 1]) throw new Error('Liste de fichiers Git incomplète.');
      candidates.push({ path: records[i + 1], status: records[i] });
    }
    if (snapshot.includeLocal) {
      const untracked = await this.read([
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        '.',
      ]);
      candidates.push(
        ...untracked
          .split('\0')
          .filter(Boolean)
          .map((file) => ({ path: file, status: '?' })),
      );
    }
    const files: typeof candidates = [];
    let excludedCount = 0;
    for (const entry of candidates) {
      this.signal.throwIfAborted();
      try {
        await this.policy.resolve(entry.path);
        files.push(entry);
      } catch {
        excludedCount++;
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path) || a.status.localeCompare(b.status));
    return { snapshot, files, excludedCount };
  }

  async changes(args: z.infer<typeof gitChangesSchema>) {
    const result = await this.inventory(args);
    const hash = sha256(JSON.stringify(result));
    this.checkPage(args.offset, args.expectedSha256, hash);
    return {
      ...result,
      files: result.files.slice(args.offset, args.offset + args.limit),
      total: result.files.length,
      sha256: hash,
      nextOffset:
        args.offset + args.limit < result.files.length ? args.offset + args.limit : undefined,
      note: 'Renommages présentés comme suppression et ajout. ? = fichier non suivi, à lire avec studio_read_file. Sous-modules exclus.',
    };
  }

  async diff(args: z.infer<typeof gitDiffSchema>) {
    if (args.path !== undefined) await this.policy.resolve(args.path);
    const result = await this.inventory(args);
    const relative = args.path === undefined ? undefined : path.posix.normalize(args.path);
    if (relative === '.')
      throw new Error('Indiquer un fichier, ou omettre path pour le diff global.');
    const tracked = result.files.filter(
      (file) => file.status !== '?' && (relative === undefined || file.path === relative),
    );
    if (tracked.length > 100 || tracked.reduce((sum, file) => sum + file.path.length, 0) > 12_000)
      throw new Error(
        'Trop de fichiers pour un diff global. Utiliser studio_git_changes puis lire chaque fichier avec studio_git_diff(path).',
      );
    const output = tracked.length
      ? await this.read(
          [
            ...this.diffArgs(result.snapshot),
            '--unified=3',
            '--',
            ...tracked.map((file) => `:(literal)${file.path}`),
          ],
          16_000_000,
        )
      : '';
    const hash = sha256(
      JSON.stringify({ snapshot: result.snapshot, path: relative }) + '\n' + output,
    );
    if (result.snapshot.includeLocal) {
      const after = await this.current();
      if (after.headSha !== result.snapshot.headSha || after.branch !== result.snapshot.branch)
        throw new Error(
          'La branche courante a changé pendant la lecture. Recommencer la comparaison.',
        );
    }
    this.checkPage((args.startLine ?? 1) - 1, args.expectedSha256, hash);
    // Redact the complete text before splitting pages, so a secret spanning a boundary cannot leak.
    const {
      content,
      from: _from,
      to: _to,
      ...page
    } = textPage(redact(output), args.startLine, args.endLine);
    return {
      snapshot: result.snapshot,
      path: relative,
      diff: content,
      ...page,
      sha256: hash,
      excludedCount: result.excludedCount,
      untrackedCount: result.files.filter((file) => file.status === '?').length,
      note: 'startLine/endLine désignent les lignes du diff, pas du fichier source. Poursuivre avec nextStartLine et expectedSha256. Les fichiers non suivis se listent avec studio_git_changes puis se lisent avec studio_read_file. Sous-modules exclus.',
    };
  }
}
