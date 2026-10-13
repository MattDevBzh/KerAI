import { randomUUID } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import ignore, { type Ignore } from 'ignore';
import { PolicyEngine, isSensitivePath, sha256 } from './PolicyEngine';
import { canonicalCaseless } from './UnicodeCaseFold';
import { gitRead } from './gitRead';
import { MAX_TEXT_BYTES, lineOffsets, readTextFile } from './textFiles';

export const listFilesSchema = z.object({
  path: z.string().default('.'),
  limit: z.number().int().min(1).max(500).default(200),
  cursor: z.string().max(100).optional(),
});
export const searchFilesSchema = z.object({
  query: z.string().min(1).max(200),
  path: z.string().default('.'),
  startLine: z.number().int().positive().default(1),
  cursor: z.string().max(100).optional(),
});
const BUILD_DIRECTORIES = new Set(['dist', 'build', 'coverage', '.next', '.vscode-test']);
const INVENTORY_FILES = 100_000;
const INVENTORY_DIRECTORIES = 20_000;
const INVENTORY_BYTES = 16 * 1024 * 1024;
const SEARCH_BYTES = 16 * 1024 * 1024;
const SEARCH_FILES = 400;
const OUTPUT_BYTES = 64_000;
const CURSOR_TTL = 30 * 60 * 1000;
type Entry = { path: string; size: number; signature: string };
type Inventory = {
  files: Entry[];
  snapshot: string;
  source: 'git' | 'filesystem';
  excludedCount: number;
  single: boolean;
};
type IgnoreLayer = { directory: string; rules: Ignore };
type Continuation = {
  key: string;
  snapshot: string;
  file: number;
  line: number;
  skipped: number;
  at: number;
};

/** Read-only inventory and literal search. Opaque cursors belong to this run only. */
export class WorkspaceExplorer {
  private cursors = new Map<string, Continuation>();
  constructor(
    private workspace: string,
    private policy: PolicyEngine,
    private signal: AbortSignal,
  ) {}

  private excluded(name: string) {
    return (
      isSensitivePath(name) ||
      name.split('/').some((part) => BUILD_DIRECTORIES.has(canonicalCaseless(part)))
    );
  }
  private async signature(absolute: string) {
    const stat = await lstat(absolute, { bigint: true });
    return {
      stat,
      signature: `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
    };
  }
  private ignored(name: string, directory: boolean, layers: IgnoreLayer[]) {
    let ignored = false;
    for (const layer of layers) {
      const local = path.posix.relative(layer.directory, name);
      if (!local || local.startsWith('../')) continue;
      const result = layer.rules.test(local + (directory ? '/' : ''));
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }
  private async loadIgnore(
    directory: string,
    identities: string[],
    budget: { ignoreBytes: number },
  ): Promise<IgnoreLayer | undefined> {
    const relative = directory === '.' ? '.gitignore' : `${directory}/.gitignore`;
    const absolute = await this.policy.resolve(relative);
    let before;
    try {
      before = await this.signature(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!before.stat.isFile() || before.stat.size > 64_000n)
      throw new Error('.gitignore non régulier ou supérieur à 64 000 octets.');
    budget.ignoreBytes += Number(before.stat.size);
    if (budget.ignoreBytes > MAX_TEXT_BYTES)
      throw new Error('Budget cumulé .gitignore limité à 4 Mio ; cible un sous-dossier.');
    const content = await readTextFile(absolute, this.signal);
    if ((await this.signature(absolute)).signature !== before.signature)
      throw new Error('Les règles .gitignore ont changé pendant l’inventaire.');
    identities.push(`${relative}:${sha256(content.bytes)}`);
    if (identities.length > INVENTORY_DIRECTORIES) throw new Error('Trop de fichiers .gitignore.');
    return { directory, rules: ignore({ ignorecase: false }).add(content.text) };
  }
  private async inventory(relative: string): Promise<Inventory> {
    this.signal.throwIfAborted();
    const absolute = await this.policy.resolve(relative);
    const initial = await this.signature(absolute);
    const normalized = path.posix.normalize(relative);
    const ignoreBudget = { ignoreBytes: 0 };
    if (this.excluded(normalized))
      throw new Error('Dossier de dépendances ou de compilation exclu.');
    if (initial.stat.isFile()) {
      const probe = await gitRead(this.workspace, ['rev-parse', '--is-inside-work-tree'], {
        signal: this.signal,
        timeoutMs: 5000,
        rawOutput: true,
      });
      const identities: string[] = [];
      let source: Inventory['source'] = 'filesystem';
      if (probe.code === 0 && probe.stdout.trim() === 'true') {
        const listed = await gitRead(
          this.workspace,
          ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', normalized],
          { signal: this.signal, timeoutMs: 5000, maxBytes: INVENTORY_BYTES, rawOutput: true },
        );
        if (listed.code || listed.truncated)
          throw new Error('Inventaire Git indisponible ou trop volumineux.');
        if (!listed.stdout.split('\0').includes(normalized))
          throw new Error('Fichier exclu par les règles Git.');
        source = 'git';
      } else if (probe.code === 128 || probe.code === 0) {
        const layers: IgnoreLayer[] = [];
        const components = normalized.split('/');
        let directory = '.';
        for (let index = 0; index < components.length; index++) {
          const layer = await this.loadIgnore(directory, identities, ignoreBudget);
          if (layer) layers.push(layer);
          const name = directory === '.' ? components[index] : `${directory}/${components[index]}`;
          if (this.ignored(name, index < components.length - 1, layers))
            throw new Error('Fichier exclu par .gitignore.');
          directory = name;
        }
      } else throw new Error('Impossible de déterminer le périmètre Git.');
      return {
        files: [
          { path: normalized, size: Number(initial.stat.size), signature: initial.signature },
        ],
        snapshot: sha256(JSON.stringify([normalized, initial.signature, identities])),
        source,
        excludedCount: 0,
        single: true,
      };
    }
    if (!initial.stat.isDirectory()) throw new Error('Chemin non régulier.');
    const probe = await gitRead(this.workspace, ['rev-parse', '--is-inside-work-tree'], {
      signal: this.signal,
      timeoutMs: 5000,
      rawOutput: true,
    });
    let candidates: Set<string> | undefined;
    let directories: Set<string> | undefined;
    let gitIdentity = '';
    if (probe.code === 0 && probe.stdout.trim() === 'true') {
      const result = await gitRead(
        this.workspace,
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', normalized],
        { signal: this.signal, timeoutMs: 30_000, rawOutput: true, maxBytes: INVENTORY_BYTES },
      );
      if (result.code || result.truncated)
        throw new Error(
          'Inventaire Git indisponible ou trop volumineux ; aucun résultat partiel. Cible un sous-dossier.',
        );
      const names = [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
      if (names.length > INVENTORY_FILES)
        throw new Error(
          'Inventaire limité à 100 000 fichiers ; cible un sous-dossier. Aucune continuation partielle.',
        );
      gitIdentity = sha256(result.stdout);
      candidates = new Set(names.filter((name) => !this.excluded(name)));
      directories = new Set([normalized]);
      for (const name of candidates) {
        let dir = path.posix.dirname(name);
        while (dir !== '.' && dir !== normalized) {
          directories.add(dir);
          if (directories.size > INVENTORY_DIRECTORIES)
            throw new Error(
              'Inventaire limité à 20 000 dossiers ; cible un sous-dossier. Aucune continuation partielle.',
            );
          dir = path.posix.dirname(dir);
        }
      }
    } else if (probe.code !== 128 && probe.code !== 0) {
      throw new Error('Impossible de déterminer le périmètre Git.');
    }
    const files: Entry[] = [];
    const identities: string[] = [];
    let inventoryBytes = 0;
    let excludedCount = 0;
    // The Git hash includes all candidates (including excluded names) without disclosing them.
    // Validate each directory once; entries use exact names from readdir and lstat, never aliases.
    const ancestorLayers: IgnoreLayer[] = [];
    if (!candidates && normalized !== '.') {
      let ancestor = '.';
      for (const component of normalized.split('/')) {
        const layer = await this.loadIgnore(ancestor, identities, ignoreBudget);
        if (layer) ancestorLayers.push(layer);
        ancestor = ancestor === '.' ? component : `${ancestor}/${component}`;
        if (this.ignored(ancestor, true, ancestorLayers))
          throw new Error('Dossier exclu par .gitignore.');
      }
    }
    const pending = [{ directory: normalized, layers: ancestorLayers }];
    let visited = 0,
      entries = 0;
    while (pending.length) {
      this.signal.throwIfAborted();
      if (++visited > INVENTORY_DIRECTORIES)
        throw new Error(
          'Inventaire limité à 20 000 dossiers ; cible un sous-dossier. Aucune continuation partielle.',
        );
      const { directory: dir, layers: inheritedLayers } = pending.pop()!;
      const layers = [...inheritedLayers];
      const full = await this.policy.resolve(dir);
      const before = await this.signature(full);
      if (!before.stat.isDirectory())
        throw new Error('Le dépôt a changé pendant son inventaire. Recommence.');
      identities.push(`${dir}:${before.signature}`);
      inventoryBytes += Buffer.byteLength(dir) + before.signature.length;
      if (inventoryBytes > 32 * 1024 * 1024)
        throw new Error(
          'Empreinte d’inventaire limitée à 32 Mio ; cible un sous-dossier. Aucune continuation partielle.',
        );
      if (!candidates) {
        const layer = await this.loadIgnore(dir, identities, ignoreBudget);
        if (layer) layers.push(layer);
      }
      for (const entry of await readdir(full, { withFileTypes: true })) {
        this.signal.throwIfAborted();
        if (++entries > 200_000)
          throw new Error(
            'Inventaire limité à 200 000 entrées ; cible un sous-dossier. Aucune continuation partielle.',
          );
        const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
        if (
          this.excluded(rel) ||
          entry.isSymbolicLink() ||
          rel.includes('\\') ||
          (!candidates && this.ignored(rel, entry.isDirectory(), layers))
        ) {
          excludedCount++;
          continue;
        }
        if (entry.isDirectory()) {
          if (!directories || directories.has(rel)) pending.push({ directory: rel, layers });
        } else if (entry.isFile() && (!candidates || candidates.has(rel))) {
          const current = await this.signature(path.join(full, entry.name));
          if (!current.stat.isFile())
            throw new Error('Le dépôt a changé pendant son inventaire. Recommence.');
          inventoryBytes += Buffer.byteLength(rel) + current.signature.length;
          if (inventoryBytes > 32 * 1024 * 1024)
            throw new Error(
              'Empreinte d’inventaire limitée à 32 Mio ; cible un sous-dossier. Aucune continuation partielle.',
            );
          files.push({ path: rel, size: Number(current.stat.size), signature: current.signature });
          if (files.length > INVENTORY_FILES)
            throw new Error(
              'Inventaire limité à 100 000 fichiers ; cible un sous-dossier. Aucune continuation partielle.',
            );
        }
      }
      if ((await this.signature(full)).signature !== before.signature)
        throw new Error('Le dépôt a changé pendant son inventaire. Recommence.');
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    identities.sort();
    return {
      files,
      snapshot: sha256(JSON.stringify([gitIdentity, identities, files])),
      source: candidates ? 'git' : 'filesystem',
      excludedCount,
      single: false,
    };
  }

  private resume(cursor: string | undefined, key: string, inventory: Inventory): Continuation {
    if (!cursor)
      return { key, snapshot: inventory.snapshot, file: 0, line: 0, skipped: 0, at: Date.now() };
    const state = this.cursors.get(cursor);
    if (!state || Date.now() - state.at > CURSOR_TTL)
      throw new Error('Curseur inconnu ou expiré ; recommence sans cursor.');
    if (state.key !== key)
      throw new Error('Ce curseur appartient à une autre recherche ou à un autre chemin.');
    if (state.snapshot !== inventory.snapshot)
      throw new Error('Le dépôt a changé depuis la page précédente ; recommence sans cursor.');
    return { ...state };
  }
  private next(state: Continuation) {
    for (const [key, value] of this.cursors)
      if (Date.now() - value.at > CURSOR_TTL) this.cursors.delete(key);
    if (this.cursors.size >= 128) this.cursors.delete(this.cursors.keys().next().value!);
    const cursor = randomUUID();
    this.cursors.set(cursor, { ...state, at: Date.now() });
    return cursor;
  }
  private metadata(inventory: Inventory) {
    return {
      totalFiles: inventory.files.length,
      inventorySource: inventory.source,
      ignoreRules:
        inventory.source === 'git'
          ? 'git: tracked files plus untracked files respecting Git ignore rules'
          : 'filesystem: hierarchical .gitignore rules via ignore; no Git index/global excludes',
      excludedCount: inventory.excludedCount,
      excludedCountScope:
        'excluded entries encountered in visited directories; ignored/pruned descendants are not counted',
      snapshot: inventory.snapshot,
      inventoryLimits: {
        files: INVENTORY_FILES,
        directories: INVENTORY_DIRECTORIES,
        gitBytes: INVENTORY_BYTES,
        entries: 200_000,
        ignoreFileBytes: 64_000,
        ignoreTotalBytes: MAX_TEXT_BYTES,
        fingerprintBytes: 32 * 1024 * 1024,
      },
    };
  }
  async list(args: z.infer<typeof listFilesSchema>) {
    const dir = path.posix.normalize(args.path);
    const inventory = await this.inventory(args.path);
    const state = this.resume(args.cursor, `list:${dir}`, inventory);
    const files: string[] = [];
    let bytes = 0;
    while (state.file < inventory.files.length && files.length < args.limit) {
      this.signal.throwIfAborted();
      const file = inventory.files[state.file].path;
      const length = Buffer.byteLength(JSON.stringify(file)) + 1;
      if (bytes + length > OUTPUT_BYTES) break;
      files.push(file);
      bytes += length;
      state.file++;
    }
    if (!files.length && state.file < inventory.files.length)
      throw new Error('Un chemin dépasse le budget de réponse.');
    const cursor = state.file < inventory.files.length ? this.next(state) : undefined;
    return {
      files,
      ...this.metadata(inventory),
      returnedCount: files.length,
      limit: args.limit,
      outputByteLimit: OUTPUT_BYTES,
      truncated: Boolean(cursor),
      ...(cursor ? { next: { path: dir, cursor }, cursor } : {}),
    };
  }
  async search(args: z.infer<typeof searchFilesSchema>) {
    const dir = path.posix.normalize(args.path);
    const inventory = await this.inventory(args.path);
    if (!inventory.single && args.startLine !== 1)
      throw new Error('startLine nécessite un chemin de fichier.');
    const state = this.resume(args.cursor, JSON.stringify(['search', dir, args.query]), inventory);
    if (!args.cursor) state.line = args.startLine - 1;
    else if (inventory.single && args.startLine !== state.line + 1)
      throw new Error('startLine ne correspond pas au curseur.');
    const matches: {
      path: string;
      line: number;
      column: number;
      excerptStartColumn: number;
      text: string;
    }[] = [];
    const skipped: { path: string; reason: string }[] = [];
    let scannedBytes = 0,
      scannedFiles = 0,
      outputBytes = 0,
      skippedCount = 0;
    let stopReason: 'matches' | 'bytes' | 'files' | 'output' | undefined;
    while (state.file < inventory.files.length) {
      this.signal.throwIfAborted();
      const file = inventory.files[state.file];
      if (scannedFiles >= SEARCH_FILES) {
        stopReason = 'files';
        break;
      }
      if (file.size <= MAX_TEXT_BYTES && scannedBytes + file.size > SEARCH_BYTES) {
        stopReason = 'bytes';
        break;
      }
      const absolute = await this.policy.resolve(file.path);
      if ((await this.signature(absolute)).signature !== file.signature)
        throw new Error('Un fichier a changé pendant la recherche ; recommence sans cursor.');
      let content;
      scannedFiles++;
      try {
        if (file.size > MAX_TEXT_BYTES)
          throw new Error('Fichier trop volumineux : limite de 4 Mio.');
        scannedBytes += file.size;
        content = await readTextFile(absolute, this.signal);
      } catch (error) {
        this.signal.throwIfAborted();
        if (inventory.single) throw error;
        skippedCount++;
        state.skipped++;
        if (skipped.length < 20)
          skipped.push({ path: file.path, reason: (error as Error).message });
        state.file++;
        state.line = 0;
        continue;
      }
      if ((await this.signature(absolute)).signature !== file.signature)
        throw new Error('Un fichier a changé pendant la recherche ; recommence sans cursor.');
      const offsets = lineOffsets(content.text);
      while (state.line < offsets.length) {
        if (state.line % 1000 === 0) this.signal.throwIfAborted();
        const i = state.line;
        const line = content.text
          .slice(offsets[i], offsets[i + 1] ?? content.text.length)
          .replace(/\r?\n$/, '');
        const column = line.indexOf(args.query);
        if (column < 0) {
          state.line++;
          continue;
        }
        const start = Math.max(0, column - 100);
        const match = {
          path: file.path,
          line: i + 1,
          column: column + 1,
          excerptStartColumn: start + 1,
          text: line.slice(start, start + 400),
        };
        const bytes = Buffer.byteLength(JSON.stringify(match));
        if (outputBytes + bytes > OUTPUT_BYTES) {
          stopReason = 'output';
          break;
        }
        matches.push(match);
        outputBytes += bytes;
        state.line++;
        if (matches.length === 100) {
          stopReason = 'matches';
          break;
        }
      }
      if (state.line >= offsets.length) {
        state.file++;
        state.line = 0;
      }
      if (stopReason) break;
    }
    if ((await this.inventory(args.path)).snapshot !== inventory.snapshot)
      throw new Error('Le dépôt a changé pendant la recherche ; recommence sans cursor.');
    const cursor = state.file < inventory.files.length ? this.next(state) : undefined;
    return {
      matches,
      ...this.metadata(inventory),
      limit: 100,
      scannedFiles,
      scannedBytes,
      budgets: {
        files: SEARCH_FILES,
        bytes: SEARCH_BYTES,
        outputBytes: OUTPUT_BYTES,
        fileBytes: MAX_TEXT_BYTES,
      },
      skipped,
      skippedCount,
      skippedExampleLimit: 20,
      skippedExamplesTruncated: skippedCount > skipped.length,
      totalSkippedCount: state.skipped,
      truncated: Boolean(cursor),
      stopReason: cursor ? stopReason : undefined,
      ...(cursor
        ? { next: { path: dir, startLine: inventory.single ? state.line + 1 : 1, cursor }, cursor }
        : {}),
    };
  }
}
