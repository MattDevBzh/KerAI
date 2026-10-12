import type { Tool } from '@github/copilot-sdk';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RunInput, RunCallbacks, RunEvent } from '../shared/types';
import { PolicyEngine, isSensitivePath, sha256 } from './PolicyEngine';
import { runProcess, redact } from './process';

export async function gitInfo(root: string): Promise<{ branch: string; dirty: Set<string> }> {
  const branch = await runProcess('git', ['symbolic-ref', '--short', 'HEAD'], root, {
    timeoutMs: 5000,
  }).catch(() => undefined);
  const status = await runProcess(
    'git',
    ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
    root,
    { timeoutMs: 10000 },
  );
  if (status.code !== 0) return { branch: 'sans Git', dirty: new Set() };
  const records = status.stdout.split('\0');
  const dirty = new Set<string>();
  for (let index = 0; index < records.length; index++) {
    const entry = records[index];
    if (entry.length < 4) continue;
    dirty.add(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      index++;
      if (records[index]) dirty.add(records[index]);
    }
  }
  return { branch: branch?.code === 0 ? branch.stdout.trim() : 'HEAD détachée', dirty };
}

export class ToolHost {
  readonly changedFiles = new Set<string>();
  readonly fileHashes: Record<string, string> = {};
  private policy!: PolicyEngine;
  private writes: Promise<unknown> = Promise.resolve();
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
    for (const step of this.input.feature.steps)
      for (const attempt of step.attempts) Object.assign(owned, attempt.fileHashes ?? {});
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
                await runProcess(
                  'git',
                  ['diff', '--name-only', '-z', 'HEAD', '--'],
                  this.input.workspacePath,
                  { signal: this.signal, timeoutMs: 10000 },
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
            'HEAD',
            '--',
            ...safeNames.map((name) => `:(literal)${name}`),
          ];
          const result = await runProcess('git', args, this.input.workspacePath, {
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
            this.emit(
              'info',
              `Test ${command.name} : ${command.command} ${command.args.join(' ')}`,
            );
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
            this.emit(
              result.code === 0 ? 'info' : 'error',
              `Test ${command.name} terminé : code ${result.code}.`,
            );
            return result;
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
