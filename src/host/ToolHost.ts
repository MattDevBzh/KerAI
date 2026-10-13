import type { Tool } from '@github/copilot-sdk';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RunInput, RunCallbacks, RunEvent, TestEvidence } from '../shared/types';
import { PolicyEngine, isSensitivePath, sha256 } from './PolicyEngine';
import { runProcess, redact } from './process';
import { gitRead } from './gitRead';

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
  constructor(
    private input: RunInput,
    private callbacks: RunCallbacks,
    private signal: AbortSignal,
  ) {}
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
    const tools: Tool[] = [
      tool(
        'studio_list_files',
        'List workspace files, excluding secrets and build/dependency directories. Relative directory, max 1500 files.',
        z.object({ path: z.string().default('.') }),
        async ({ path: dir }) => ({ files: await this.list(dir) }),
      ),
      tool(
        'studio_read_file',
        'Read a UTF-8 workspace text file before editing. Paths relative to workspace. Files over 256KB and secrets refused.',
        z.object({ path: z.string() }),
        async ({ path: relative }) => {
          const target = await this.policy.resolve(relative);
          const stat = await lstat(target);
          if (stat.size > 256_000 || !stat.isFile())
            throw new Error('Fichier trop volumineux ou non régulier.');
          const content = await readFile(target);
          if (content.includes(0)) throw new Error('Fichier binaire non pris en charge.');
          await this.policy.recordRead(relative, content);
          this.observedFiles.add(path.posix.normalize(relative));
          return { path: relative, content: content.toString('utf8'), sha256: sha256(content) };
        },
      ),
      tool(
        'studio_search',
        'Search a literal string in workspace text files (not a regex), at most 100 matching lines.',
        z.object({ query: z.string().min(1).max(200), path: z.string().default('.') }),
        async ({ query, path: dir }) => {
          const matches: { path: string; line: number; text: string }[] = [];
          for (const file of await this.list(dir)) {
            if (this.signal.aborted) break;
            const absolute = await this.policy.resolve(file);
            const stat = await lstat(absolute);
            if (stat.size > 256_000) continue;
            const content = await readFile(absolute);
            if (content.includes(0)) continue;
            const lines = content.toString('utf8').split('\n');
            for (let i = 0; i < lines.length && matches.length < 100; i++)
              if (lines[i].includes(query))
                matches.push({ path: file, line: i + 1, text: lines[i].slice(0, 400) });
            if (matches.length >= 100) break;
          }
          return { matches, limit: 100 };
        },
      ),
      tool(
        'studio_git_diff',
        'Read Git diff including staged and unstaged changes (no external diff or text conversion). Optional single relative file.',
        z.object({ path: z.string().optional() }),
        async ({ path: relative }) => {
          if (relative) await this.policy.resolve(relative);
          const names = relative
            ? [relative]
            : (
                await gitRead(
                  this.input.workspacePath,
                  [
                    'diff',
                    '--no-ext-diff',
                    '--no-textconv',
                    '--relative',
                    '--name-only',
                    '-z',
                    'HEAD',
                    '--',
                  ],
                  { signal: this.signal, timeoutMs: 10000, rawOutput: true },
                )
              ).stdout
                .split('\0')
                .filter(Boolean);
          const safeNames = names.filter((name) => !isSensitivePath(name)).slice(0, 250);
          if (!safeNames.length)
            return {
              diff: '',
              note: 'Aucun diff suivi accessible. Les nouveaux fichiers se lisent avec studio_read_file.',
            };
          const args = [
            '-c',
            'core.pager=cat',
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--relative',
            'HEAD',
            '--',
            ...safeNames.map((name) => `:(literal)${name}`),
          ];
          const result = await gitRead(this.input.workspacePath, args, {
            signal: this.signal,
            timeoutMs: 10000,
          });
          if (result.code !== 0)
            return {
              diff: '',
              unavailable: result.stderr,
              note: 'Untracked files and repositories without HEAD require studio_read_file.',
            };
          return {
            diff: result.stdout,
            truncated: result.truncated,
            note: 'Untracked files are not in the Git diff; list/read them separately.',
          };
        },
      ),
    ];
    const canEdit = this.input.agent.tools.some((name) =>
      ['edit', 'write', 'studio_write_file'].includes(name),
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
                const normalized = path.posix.normalize(relative);
                const target = await this.policy.assertWrite(normalized);
                await mkdir(path.dirname(target), { recursive: true });
                await this.policy.assertWrite(normalized);
                if (this.signal.aborted) throw new Error('Exécution annulée.');
                await writeFile(target, content, {
                  encoding: 'utf8',
                  flag: 'w',
                  signal: this.signal,
                });
                this.changedFiles.add(normalized);
                this.fileHashes[normalized] = sha256(content);
                this.policy.recordWrite(normalized, content);
                return { written: normalized, sha256: this.fileHashes[normalized] };
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
                try {
                  const result = await runProcess(
                    command.command,
                    command.args,
                    this.input.workspacePath,
                    {
                      signal: this.signal,
                      timeoutMs: 300_000,
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
                  this.emit(
                    result.code === 0 && !evidence.error ? 'info' : 'error',
                    `Test ${command.name} terminé : code ${result.code}.`,
                  );
                  return { ...result, ...(evidence.error ? { warning: evidence.error } : {}) };
                } catch (error) {
                  evidence.error = redact(error instanceof Error ? error.message : String(error));
                  throw error;
                } finally {
                  evidence.finishedAt = new Date().toISOString();
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
      studio_git_diff: ['read', 'studio_git_diff'],
      studio_write_file: ['edit', 'write', 'studio_write_file'],
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
  private async list(relative: string): Promise<string[]> {
    const absolute = await this.policy.resolve(relative);
    const result: string[] = [];
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (depth > 15 || result.length >= 1500 || this.signal.aborted) return;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(this.input.workspacePath, full).split(path.sep).join('/');
        if (
          entry.isSymbolicLink() ||
          isSensitivePath(rel) ||
          ['dist', 'build', 'coverage', '.next', '.vscode-test'].includes(entry.name)
        )
          continue;
        if (entry.isDirectory()) await visit(full, depth + 1);
        else if (entry.isFile()) result.push(rel);
        if (result.length >= 1500) break;
      }
    };
    await visit(absolute, 0);
    return result;
  }
}
