import type { Tool } from '@github/copilot-sdk';
import { z } from 'zod';
import path from 'node:path';
import { lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { safePath } from '../core/registry';
import { isSensitivePath, sha256 } from './PolicyEngine';
import { readTextFile, textPage } from './textFiles';
import { runProcess, redact } from './process';
import type { RunInput, RunCallbacks } from '../shared/types';

const session = z.string().uuid();
const file = z.string().min(1).max(4096);
const page = {
  start: z.number().int().positive().optional(),
  count: z.number().int().min(1).max(200).optional(),
};
const inventory = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional(),
};
const side = z.enum(['source', 'base', 'merge-base']).optional();
export const remoteReviewSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('prepare'),
      repo: z.string().min(1).max(4096),
      source: z.string().min(1).max(512),
      base: z.string().min(1).max(512),
    })
    .strict(),
  z.object({ operation: z.literal('files'), session, ...inventory }).strict(),
  z
    .object({ operation: z.literal('list'), session, path: file.optional(), side, ...inventory })
    .strict(),
  z.object({ operation: z.literal('read'), session, path: file, side, ...page }).strict(),
  z.object({ operation: z.literal('diff'), session, path: file, ...page }).strict(),
  z
    .object({
      operation: z.literal('search'),
      session,
      path: file,
      query: z.string().min(1).max(2000),
      side,
      ...page,
    })
    .strict(),
  z.object({ operation: z.literal('info'), session }).strict(),
  z.object({ operation: z.literal('verify'), session }).strict(),
]);

// Keep the provider-facing schema an object; enforce operation-specific fields in the handler.
const remoteReviewToolSchema = z
  .object({
    operation: z.enum(['prepare', 'files', 'list', 'read', 'diff', 'search', 'info', 'verify']),
    repo: z.string().max(4096).optional(),
    source: z.string().max(512).optional(),
    base: z.string().max(512).optional(),
    session: session.optional(),
    path: file.optional(),
    query: z.string().max(2000).optional(),
    side,
    ...page,
    ...inventory,
  })
  .strict();

/** Personal documents are passive resources; remote execution is an explicit agent capability. */
export class PersonalReviewTools {
  private sessions = new Map<string, { reportPath: string; reportHash: string }>();
  private writes: Promise<unknown> = Promise.resolve();
  private root: string;
  constructor(
    private personalRoot: string,
    private worker: string,
    private input: RunInput,
    private callbacks: RunCallbacks,
    private signal: AbortSignal,
  ) {
    this.root = path.join(personalRoot, 'remote-review', 'feature-studio');
  }

  private tool<T>(
    name: string,
    description: string,
    schema: z.ZodType<T>,
    run: (args: T) => Promise<unknown>,
  ): Tool {
    return {
      name,
      description,
      parameters: z.toJSONSchema(schema),
      skipPermission: true,
      defer: 'never',
      handler: async (raw) => {
        try {
          this.signal.throwIfAborted();
          const args = schema.parse(raw);
          this.callbacks.onEvent({
            id: randomUUID(),
            at: new Date().toISOString(),
            kind: 'tool',
            message: name,
          });
          const result = await run(args);
          this.signal.throwIfAborted();
          return { resultType: 'success', textResultForLlm: redact(JSON.stringify(result)) };
        } catch (error) {
          const message = redact((error as Error).message);
          this.callbacks.onEvent({
            id: randomUUID(),
            at: new Date().toISOString(),
            kind: 'warning',
            message,
          });
          return { resultType: 'failure', textResultForLlm: message, error: message };
        }
      },
    };
  }

  async readResource(args: { path: string; startLine?: number; endLine?: number }) {
    let relative = args.path.replaceAll('\\', '/');
    const root = path.resolve(this.personalRoot).replaceAll('\\', '/');
    if (path.isAbsolute(args.path) || /^[a-z]:/i.test(relative)) {
      const equal = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
      if (!equal(relative).startsWith(equal(root) + '/'))
        throw Error('Ressource hors du catalogue personnel.');
      relative = relative.slice(root.length + 1);
    }
    if (
      relative.includes(':') ||
      relative.split('/').some((part) => part === '..' || part === '.') ||
      !/^(agents\/|skills\/|feature-studio\/kit\/templates\/)/.test(relative) ||
      !/\.(md|txt)$/i.test(relative) ||
      isSensitivePath(relative)
    )
      throw Error(
        'Lecture réservée aux documents Markdown/texte des agents, skills et templates personnels.',
      );
    const target = await safePath(this.personalRoot, relative);
    if ((await lstat(target)).nlink > 1) throw Error('Lien physique refusé.');
    const { bytes, text } = await readTextFile(target, this.signal);
    const { from: _from, to: _to, ...result } = textPage(text, args.startLine, args.endLine);
    return { personalRoot: this.personalRoot, path: relative, sha256: sha256(bytes), ...result };
  }

  async remote(args: z.infer<typeof remoteReviewSchema>) {
    const { operation, ...options } = args;
    // The model cannot choose a script, executable, cache root or working directory.
    await safePath(this.personalRoot, 'remote-review/feature-studio/cache');
    if (operation !== 'prepare' && !this.sessions.has('session' in args ? args.session : ''))
      throw Error(
        'Préparer cette relecture dans la tentative courante avant de consulter sa session.',
      );
    if (operation === 'prepare') {
      let url: URL;
      try {
        url = new URL(args.repo);
      } catch {
        throw Error('Utiliser une URL Git HTTPS ou ssh:// sans token.');
      }
      if (
        !['https:', 'ssh:'].includes(url.protocol) ||
        url.password ||
        (url.protocol === 'https:' && url.username) ||
        url.search ||
        url.hash
      )
        throw Error(
          'URL Git HTTPS ou SSH requise, sans identifiants ni paramètres. Utiliser la connexion Git habituelle.',
        );
      // Azure DevOps PR URLs identify the same repository; branches remain explicit.
      if (url.hostname === 'dev.azure.com' || url.hostname.endsWith('.visualstudio.com'))
        url.pathname = url.pathname.replace(/\/pullrequest\/\d+\/?$/i, '');
      (options as { repo: string }).repo = url.toString().replace(/\/$/, '');
    }
    const lease = randomUUID();
    if (operation === 'prepare') Object.assign(options, { lease });
    let result;
    try {
      result = await runProcess(
        process.execPath,
        [this.worker, this.root, operation, JSON.stringify(options)],
        path.dirname(this.worker),
        {
          signal: this.signal,
          timeoutMs: 180_000,
          maxBytes: 512_000,
          rawOutput: true,
          env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: undefined },
        },
      );
    } finally {
      if (operation === 'prepare') {
        const repo = (options as { repo: string }).repo;
        const lock = await safePath(
          this.personalRoot,
          `remote-review/feature-studio/cache/${sha256(repo)}.git.review-lock`,
        );
        try {
          const owner = JSON.parse(await readFile(lock, 'utf8'));
          if (owner.lease === lease && Number.isInteger(owner.pid)) {
            let gone = false;
            try {
              process.kill(owner.pid, 0);
            } catch (error) {
              gone = (error as NodeJS.ErrnoException).code === 'ESRCH';
            }
            if (gone) await unlink(lock);
          }
        } catch {
          /* The worker normally removes its own lock. Never remove someone else's lock. */
        }
      }
    }
    if (result.code !== 0 || result.truncated)
      throw Error(
        result.truncated
          ? 'Réponse distante trop volumineuse : réduire la page.'
          : result.stderr.trim() || 'Lecture Git distante impossible.',
      );
    const value = JSON.parse(result.stdout);
    if (operation === 'prepare') {
      const id = session.parse(value.id);
      const reportPath = await safePath(this.root, `reports/${id}/RELECTURE_DISTANTE.md`);
      if (path.resolve(value.reportPath) !== reportPath)
        throw Error('Destination du rapport invalide.');
      const reportHash = sha256(await readFile(reportPath));
      this.sessions.set(id, { reportPath, reportHash });
      value.reportSha256 = reportHash;
      value.next = { operation: 'files', session: id };
    }
    return value;
  }

  async writeReport(args: { session: string; content: string }) {
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        this.signal.throwIfAborted();
        const owned = this.sessions.get(args.session);
        if (!owned) throw Error('Rapport réservé à une session préparée dans cette tentative.');
        const target = await safePath(this.root, `reports/${args.session}/RELECTURE_DISTANTE.md`);
        const stat = await lstat(target);
        if (!stat.isFile() || stat.nlink > 1 || sha256(await readFile(target)) !== owned.reportHash)
          throw Error('Le rapport a été modifié en dehors de cette tentative ; écriture refusée.');
        const temporary = target + '.' + randomUUID() + '.tmp';
        try {
          await writeFile(temporary, args.content, {
            flag: 'wx',
            encoding: 'utf8',
            signal: this.signal,
          });
          this.signal.throwIfAborted();
          await safePath(this.root, `reports/${args.session}/RELECTURE_DISTANTE.md`);
          if (sha256(await readFile(target)) !== owned.reportHash)
            throw Error('Rapport modifié pendant son enregistrement.');
          await rename(temporary, target);
          owned.reportHash = sha256(args.content);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
        return {
          reportPath: target,
          reportUri: `feature-studio-review:${args.session}`,
          sha256: owned.reportHash,
        };
      });
    this.writes = write;
    return write;
  }

  createTools(): Tool[] {
    if (this.input.observation || this.input.mode === 'discussion') return [];
    const requested = new Set(this.input.agent.tools);
    const tools: Tool[] = [];
    if (requested.has('read') || requested.has('studio_read_personal_resource'))
      tools.push(
        this.tool(
          'studio_read_personal_resource',
          'Read passive personal agent/skill/template Markdown or text outside the project. path relative to the personal Copilot root, e.g. agents/template/pre-commit-review-template.md or skills/code-review-mattpocock/SKILL.md. Absolute paths inside that same root also accepted. No secrets, scripts, symlinks or writes. Follow nextStartLine.',
          z
            .object({
              path: file,
              startLine: z.number().int().positive().optional(),
              endLine: z.number().int().positive().optional(),
            })
            .strict(),
          (args) => this.readResource(args),
        ),
      );
    if (requested.has('studio_remote_review')) {
      tools.push(
        this.tool(
          'studio_remote_review',
          'Review pushed Git branches without checkout. prepare requires repo (HTTPS/ssh:// Git URL or Azure DevOps PR URL), source and explicit base. Creates a personal bare cache and pinned commits, returns session id and reportPath. Then files/list/read/diff/search/info/verify with session. Follow nextOffset/nextStart; read reports real file lines, diff/search pagination is output lines. search requires a single file. No workspace writes, build, tests, push or arbitrary commands. Git authentication uses the installed credential manager/SSH.',
          remoteReviewToolSchema,
          (args) => this.remote(remoteReviewSchema.parse(args)),
        ),
      );
      if (requested.has('studio_write_review_report'))
        tools.push(
          this.tool(
            'studio_write_review_report',
            'Save the French Markdown report for a remote session prepared in this attempt. Only writes its personal reportPath, even with read-only project policy. Never writes the workspace or accepts a destination path. Returns reportPath and clickable reportUri.',
            z.object({ session, content: z.string().min(1).max(256_000) }).strict(),
            (args) => this.writeReport(args),
          ),
        );
    }
    return tools;
  }
}

export async function resolvePersonalReviewReport(personalRoot: string, id: string) {
  session.parse(id);
  const target = await safePath(
    personalRoot,
    `remote-review/feature-studio/reports/${id}/RELECTURE_DISTANTE.md`,
  );
  const stat = await lstat(target);
  if (!stat.isFile() || stat.nlink > 1) throw Error('Rapport personnel non régulier.');
  return target;
}
