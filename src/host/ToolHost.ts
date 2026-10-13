import type { Tool } from '@github/copilot-sdk';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, lstat, rename, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RunInput, RunCallbacks, RunEvent, TestEvidence } from '../shared/types';
import { PolicyEngine, sha256 } from './PolicyEngine';
import { runProcess, redact } from './process';
import { gitRead } from './gitRead';
import { prepareQualityRun, collectQualityEvidence, type QualityRunContext } from './QualityRunner';
import { GitReview, gitPageSchema, gitChangesSchema, gitDiffSchema } from './GitReview';
import { MAX_TEXT_BYTES, readTextFile, textPage } from './textFiles';
import { WorkspaceExplorer, listFilesSchema, searchFilesSchema } from './WorkspaceExplorer';

export async function gitInfo(root: string): Promise<{ branch: string; dirty: Set<string> }> {
  const branch = await gitRead(root, ['symbolic-ref', '--short', 'HEAD'], {
    timeoutMs: 5000,
    rawOutput: true,
  }).catch(() => undefined);
  const status = await gitRead(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    timeoutMs: 10000,
    rawOutput: true,
    maxBytes: 4_000_000,
  });
  if (status.code !== 0) return { branch: 'sans Git', dirty: new Set() };
  if (status.truncated || branch?.truncated)
    throw new Error('État Git trop volumineux ; inspection des fichiers interrompue.');
  const records = status.stdout.split('\0');
  const prefixResult = await gitRead(root, ['rev-parse', '--show-prefix'], {
    timeoutMs: 5000,
    rawOutput: true,
  });
  if (prefixResult.code || prefixResult.truncated) throw new Error('Racine Git indisponible.');
  const prefix = prefixResult.stdout.replace(/\r?\n$/, '');
  const dirty = new Set<string>();
  const add = (file: string) => {
    if (file.startsWith(prefix)) dirty.add(file.slice(prefix.length));
  };
  for (let index = 0; index < records.length; index++) {
    const entry = records[index];
    if (entry.length < 4) continue;
    add(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      index++;
      if (records[index]) add(records[index]);
    }
  }
  return { branch: branch?.code === 0 ? branch.stdout.trim() : 'HEAD détachée', dirty };
}

export class ToolHost {
  readonly changedFiles = new Set<string>();
  readonly fileHashes: Record<string, string> = {};
  private policy!: PolicyEngine;
  private writes: Promise<unknown> = Promise.resolve();
  private observedFiles = new Set<string>();
  private readonly qualityCriterionIds: readonly string[];
  private readViews = new Map<string, { hash: string; spans: [number, number][]; full: boolean }>();
  constructor(
    private input: RunInput,
    private callbacks: RunCallbacks,
    private signal: AbortSignal,
  ) {
    this.qualityCriterionIds = Object.freeze(
      (input.feature.criteria ?? []).map((criterion) => criterion.id),
    );
  }
  private emit(kind: RunEvent['kind'], message: string): void {
    this.callbacks.onEvent({
      id: randomUUID(),
      at: new Date().toISOString(),
      kind,
      message: redact(message),
    });
  }
  async createTools(): Promise<Tool[]> {
    const info = await gitInfo(this.input.workspacePath);
    const owned: Record<string, string> = {};
    const attempts = this.input.feature.steps
      .flatMap((step) => step.attempts)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    for (const attempt of attempts) Object.assign(owned, attempt.fileHashes ?? {});
    Object.assign(owned, this.input.feature.workspaceFileHashes ?? {});
    Object.assign(owned, this.input.existingChangeGrants ?? {});
    this.policy = new PolicyEngine(
      this.input.workspacePath,
      this.input.step.policy,
      this.input.settings.testPaths,
      info.dirty,
      owned,
    );
    await this.policy.initialize();
    const tool = <T>(
      name: string,
      description: string,
      schema: z.ZodType<T>,
      handler: (args: T) => Promise<unknown>,
    ): Tool => ({
      name,
      description,
      parameters: z.toJSONSchema(schema),
      skipPermission: true,
      defer: 'never',
      handler: async (raw) => {
        try {
          if (this.signal.aborted) throw new Error('Exécution annulée.');
          const args = schema.parse(raw);
          this.emit(
            'tool',
            `${name} ${typeof raw === 'object' && raw && 'path' in raw ? String(raw.path) : ''}`.trim(),
          );
          const value = await handler(args);
          return { resultType: 'success', textResultForLlm: redact(JSON.stringify(value)) };
        } catch (error) {
          const message = redact(error instanceof Error ? error.message : String(error));
          this.emit('warning', message);
          return { resultType: 'failure', textResultForLlm: message, error: message };
        }
      },
    });
    const gitReview = new GitReview(this.input.workspacePath, this.policy, this.signal);
    const explorer = new WorkspaceExplorer(this.input.workspacePath, this.policy, this.signal);
    const tools: Tool[] = [
      tool(
        'studio_list_files',
        'List workspace files deterministically. Git includes tracked files even if ignored and untracked files respecting Git ignore rules. Excludes secrets, links and build/dependency directories. Defaults to 200 files; limit 1-500. Follow next with the same path and opaque cursor until truncated:false. Reports total count and inventory limits; oversized inventories fail explicitly. Outside Git, honors hierarchical .gitignore rules (without Git index/global excludes).',
        listFilesSchema,
        (args) => explorer.list(args),
      ),
      tool(
        'studio_read_file',
        'Read UTF-8 files up to 4 MiB. Optional 1-based inclusive startLine/endLine. Small files are returned whole; otherwise defaults to 200 lines, max 2000 lines and 64000 bytes per response. Follow nextStartLine. sha256 identifies the entire file. Read the exact block before studio_replace_text; a partial read does not permit whole-file replacement.',
        z.object({
          path: z.string(),
          startLine: z.number().int().positive().optional(),
          endLine: z.number().int().positive().optional(),
        }),
        async ({ path: relative, startLine, endLine }) => {
          const target = await this.policy.resolve(relative);
          const { bytes, text } = await readTextFile(target, this.signal);
          const { from, to, ...page } = textPage(text, startLine, endLine);
          const normalized = await this.policy.contextPath(relative);
          const hash = sha256(bytes);
          const previous = this.readViews.get(normalized);
          const view = previous?.hash === hash ? previous : { hash, spans: [], full: false };
          view.spans.push([from, to]);
          view.spans.sort((a, b) => a[0] - b[0]);
          view.spans = view.spans.reduce<[number, number][]>((merged, span) => {
            const last = merged.at(-1);
            if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
            else merged.push([...span]);
            return merged;
          }, []);
          view.full =
            view.spans.length === 1 && view.spans[0][0] === 0 && view.spans[0][1] === text.length;
          this.readViews.set(normalized, view);
          await this.policy.recordRead(normalized, bytes);
          this.observedFiles.add(normalized);
          return { path: normalized, ...page, sizeBytes: bytes.length, sha256: hash };
        },
      ),
      tool(
        'studio_search',
        'Search a literal string in UTF-8 files up to 4 MiB using the same safe Git inventory as studio_list_files. At most 100 matching lines, 400 files and 16 MiB scanned per page; 64000 output bytes. Follow next with unchanged query/path and opaque cursor, which resumes within files and across the entire directory. Changed snapshots invalidate cursors. Excerpts do not permit edits: read the exact lines first. Reports skipped files, budgets and completion. startLine is only for an initial single-file search.',
        searchFilesSchema,
        (args) => explorer.search(args),
      ),
      tool(
        'studio_git_branches',
        'List local and locally known remote branches (e.g. develop, origin/develop), with current branch and HEAD SHA. Read-only: no fetch or checkout. Follow nextOffset with expectedSha256.',
        gitPageSchema,
        (args) => gitReview.branches(args),
      ),
      tool(
        'studio_git_changes',
        'List changed files before reviewing a diff. baseRef selects an existing local or remote branch. comparison: merge-base (default, changes introduced on current branch) or direct (compare branch tips). With baseRef, committed changes only by default; includeLocal:true adds staged/unstaged changes and lists untracked files. Without baseRef: local changes vs HEAD. Reports SHA identities and exclusions. Follow nextOffset with expectedSha256.',
        gitChangesSchema,
        (args) => gitReview.changes(args),
      ),
      tool(
        'studio_git_diff',
        'Read a paginated Git diff. baseRef: local branch (develop) or remote reference (origin/develop). comparison: merge-base (default) or direct. With baseRef, committed changes only unless includeLocal:true; without baseRef, staged/unstaged changes vs HEAD. Optional single workspace-relative path with /. List files first with studio_git_changes. startLine/endLine are DIFF lines (not source lines); follow nextStartLine with expectedSha256 and the same comparison/path. No tests, fetch, checkout, external diff or text conversion.',
        gitDiffSchema,
        (args) => gitReview.diff(args),
      ),
    ];
    const canEdit = this.input.agent.tools.some((name) =>
      ['edit', 'write', 'studio_write_file', 'studio_replace_text'].includes(name),
    );
    if (this.input.step.policy !== 'read-only' && canEdit)
      tools.push(
        tool(
          'studio_write_file',
          'Create or replace a UTF-8 file. Existing file must have been read first. Preserves pre-existing user changes. Tests profile writes only test folders. No deletes.',
          z.object({ path: z.string(), content: z.string().max(256_000) }),
          async ({ path: relative, content }) => {
            const write = this.writes
              .catch(() => undefined)
              .then(async () => {
                if (this.signal.aborted) throw new Error('Exécution annulée.');
                const normalized = await this.policy.contextPath(relative, true);
                const target = await this.policy.assertWrite(normalized);
                const view = this.readViews.get(normalized);
                if (view && !view.full)
                  throw new Error(
                    'Lecture partielle : utiliser studio_replace_text ou lire le fichier entier avant son remplacement.',
                  );
                await mkdir(path.dirname(target), { recursive: true });
                await this.policy.assertWrite(normalized);
                if (this.signal.aborted) throw new Error('Exécution annulée.');
                await writeFile(target, content, {
                  encoding: 'utf8',
                  flag: 'w',
                  signal: this.signal,
                });
                const written = await this.policy.contextPath(normalized, true);
                this.changedFiles.add(written);
                this.fileHashes[written] = sha256(content);
                this.policy.recordWrite(written, content);
                this.readViews.set(written, {
                  hash: this.fileHashes[written],
                  spans: [[0, content.length]],
                  full: true,
                });
                return { written, sha256: this.fileHashes[written] };
              });
            this.writes = write;
            return await write;
          },
        ),
        tool(
          'studio_replace_text',
          'Replace one exact unique block in an existing UTF-8 file up to 4 MiB. First read the entire oldText block with studio_read_file, then supply its whole-file sha256 as expectedSha256. Literal matching (no regex), preserves all other bytes and line endings. Ambiguous, unseen, dirty or stale content is refused. Re-read before another edit. Use \\r\\n if the read content uses CRLF.',
          z.object({
            path: z.string(),
            oldText: z.string().min(1).max(64_000),
            newText: z.string().max(256_000),
            expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
          async ({ path: relative, oldText, newText, expectedSha256 }) => {
            const write = this.writes
              .catch(() => undefined)
              .then(async () => {
                this.signal.throwIfAborted();
                const normalized = await this.policy.contextPath(relative, true);
                const target = await this.policy.resolve(normalized, true);
                const current = await readTextFile(target, this.signal);
                const hash = sha256(current.bytes);
                const view = this.readViews.get(normalized);
                if (hash !== expectedSha256 || view?.hash !== hash)
                  throw new Error(
                    'Empreinte différente ou lecture absente : relis le fichier avant cette édition.',
                  );
                const at = current.text.indexOf(oldText);
                if (at < 0)
                  throw new Error(
                    'Bloc introuvable : reprendre exactement le texte lu, y compris les fins de ligne.',
                  );
                if (current.text.indexOf(oldText, at + 1) !== -1)
                  throw new Error(
                    'Bloc ambigu : ajouter du contexte pour obtenir une occurrence unique.',
                  );
                if (!view.spans.some(([start, end]) => start <= at && end >= at + oldText.length))
                  throw new Error(
                    'Bloc non lu : lire toutes les lignes concernées avant cette édition.',
                  );
                await this.policy.assertWrite(normalized);
                const content =
                  current.text.slice(0, at) + newText + current.text.slice(at + oldText.length);
                if (newText.includes('\0') || Buffer.from(content).toString('utf8') !== content)
                  throw new Error(
                    'Le remplacement doit être un texte UTF-8 valide sans octet nul.',
                  );
                if (Buffer.byteLength(content) > MAX_TEXT_BYTES)
                  throw new Error('Le résultat dépasserait la limite de 4 Mio.');
                const temporary = path.join(
                  path.dirname(target),
                  `.feature-studio-edit-${randomUUID()}.tmp`,
                );
                let temporaryCreated = false;
                try {
                  const handle = await open(temporary, 'wx', current.mode);
                  temporaryCreated = true;
                  try {
                    await handle.writeFile(content, { encoding: 'utf8', signal: this.signal });
                    await handle.chmod(current.mode & 0o777);
                  } finally {
                    await handle.close();
                  }
                  await this.policy.assertWrite(normalized);
                  if (sha256((await readTextFile(target, this.signal)).bytes) !== expectedSha256)
                    throw new Error(
                      'Le fichier a changé pendant la préparation de l’édition. Relis-le.',
                    );
                  this.signal.throwIfAborted();
                  await rename(temporary, target);
                } finally {
                  if (temporaryCreated) await rm(temporary, { force: true });
                }
                const nextHash = sha256(content);
                this.changedFiles.add(normalized);
                this.fileHashes[normalized] = nextHash;
                this.policy.recordWrite(normalized, content);
                this.readViews.set(normalized, { hash: nextHash, spans: [], full: false });
                return {
                  written: normalized,
                  replacements: 1,
                  sha256: nextHash,
                  note: 'Relire la zone avant toute autre édition.',
                };
              });
            this.writes = write;
            return await write;
          },
        ),
      );
    if (this.input.step.policy === 'tests' && this.input.settings.testCommands.length)
      tools.push(
        tool(
          'studio_run_test',
          `Execute exactly one user-approved test command by ID. Available commands: ${this.input.settings.testCommands.map((c) => `${c.id}: ${c.command} ${c.args.join(' ')}`).join('; ')}. No other arguments accepted.`,
          z.object({ id: z.string() }),
          async ({ id }) => {
            const command = this.policy.assertCommand(id, this.input.settings.testCommands);
            const run = this.writes
              .catch(() => undefined)
              .then(async () => {
                if (this.signal.aborted) throw new Error('Exécution annulée.');
                this.emit(
                  'info',
                  `Test ${command.name} : ${command.command} ${command.args.join(' ')}`,
                );
                const fileHashes = await this.evidenceHashes();
                const evidence: TestEvidence = {
                  id: randomUUID(),
                  source: 'host',
                  commandId: command.id,
                  name: command.name,
                  command: command.command,
                  args: [...command.args],
                  startedAt: new Date().toISOString(),
                  finishedAt: '',
                  exitCode: null,
                  stdout: '',
                  stderr: '',
                  truncated: false,
                  fileHashes,
                };
                let qualityContext: QualityRunContext | undefined;
                try {
                  if (command.quality) {
                    if (!this.input.qualityStoragePath)
                      throw new Error('Stockage privé des preuves visuelles indisponible.');
                    qualityContext = await prepareQualityRun({
                      workspacePath: this.input.workspacePath,
                      storagePath: this.input.qualityStoragePath,
                      featureId: this.input.feature.id,
                      attemptId: this.input.attempt.id,
                      commandId: command.id,
                      criterionIds: this.qualityCriterionIds,
                      config: command.quality,
                    });
                  }
                  const result = await runProcess(
                    command.command,
                    command.args,
                    this.input.workspacePath,
                    {
                      signal: this.signal,
                      timeoutMs: 300_000,
                      env: qualityContext?.env,
                      onLine: (line) => this.emit('info', line),
                    },
                  );
                  evidence.exitCode = result.code;
                  evidence.stdout = result.stdout.slice(-32000);
                  evidence.stderr = result.stderr.slice(-32000);
                  evidence.truncated =
                    result.truncated ||
                    result.stdout.length > 32000 ||
                    result.stderr.length > 32000;
                  const after = await this.evidenceHashes();
                  if (Object.entries(fileHashes).some(([file, hash]) => after[file] !== hash))
                    evidence.error =
                      'Des fichiers observés ont changé pendant les tests. Relance les tests sur leur version finale.';
                  evidence.finishedAt = new Date().toISOString();
                  if (qualityContext) {
                    evidence.quality = await collectQualityEvidence(qualityContext, evidence);
                    if (['invalid', 'unavailable', 'incomplete'].includes(evidence.quality.status))
                      evidence.error = `Preuve qualité ${evidence.quality.status} : ${evidence.quality.error ?? 'Parcours incomplet.'}`;
                  }
                  this.emit(
                    result.code === 0 && !evidence.error ? 'info' : 'error',
                    `Test ${command.name} terminé : code ${result.code}.`,
                  );
                  return {
                    ...result,
                    quality: evidence.quality,
                    ...(evidence.error ? { warning: evidence.error } : {}),
                  };
                } catch (error) {
                  evidence.error = redact(error instanceof Error ? error.message : String(error));
                  throw error;
                } finally {
                  evidence.finishedAt = new Date().toISOString();
                  if (qualityContext && !evidence.quality)
                    evidence.quality = await collectQualityEvidence(qualityContext, evidence);
                  this.callbacks.onEvidence?.(evidence);
                }
              });
            this.writes = run;
            return await run;
          },
        ),
      );
    const requested = new Set(this.input.agent.tools);
    const capabilities: Record<string, string[]> = {
      studio_list_files: ['read', 'search', 'studio_list_files'],
      studio_read_file: ['read', 'studio_read_file'],
      studio_search: ['search', 'studio_search'],
      studio_git_branches: ['read', 'studio_git_branches', 'studio_git_diff'],
      studio_git_changes: ['read', 'studio_git_changes', 'studio_git_diff'],
      studio_git_diff: ['read', 'studio_git_diff'],
      studio_write_file: ['edit', 'write', 'studio_write_file'],
      studio_replace_text: ['edit', 'write', 'studio_write_file', 'studio_replace_text'],
      studio_run_test: ['execute', 'studio_run_test'],
    };
    return tools.filter((tool) => capabilities[tool.name].some((name) => requested.has(name)));
  }
  private async evidenceHashes(): Promise<Record<string, string>> {
    const files = new Set([...this.observedFiles, ...Object.keys(this.fileHashes)]);
    for (const step of this.input.feature.steps)
      for (const attempt of step.attempts)
        for (const file of Object.keys(attempt.fileHashes ?? {})) files.add(file);
    const hashes: Record<string, string> = {};
    for (const file of files) {
      try {
        hashes[file] = sha256(await readFile(await this.policy.resolve(file)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        hashes[file] = '<missing>';
      }
    }
    return hashes;
  }
}
