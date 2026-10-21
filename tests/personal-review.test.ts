import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { PersonalReviewTools, resolvePersonalReviewReport } from '../src/host/PersonalReviewTools';
import { sha256 } from '../src/host/PolicyEngine';
import type { RunInput } from '../src/shared/types';

const roots: string[] = [];
let workerRoot: string;
let worker: string;
beforeAll(async () => {
  workerRoot = await mkdtemp(path.join(tmpdir(), 'studio-review-worker-'));
  worker = path.join(workerRoot, 'remote-review-worker.cjs');
  await build({
    entryPoints: ['src/host/remoteReviewWorker.mjs'],
    outfile: worker,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
  });
});
afterAll(async () => {
  if (workerRoot) await rm(workerRoot, { recursive: true, force: true });
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-remote-'));
  roots.push(root);
  const personal = path.join(root, 'personal'),
    repo = path.join(root, 'project');
  await mkdir(personal);
  await mkdir(repo);
  git(repo, 'init', '-b', 'develop');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(repo, 'service.ts'), 'export const value = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');
  git(repo, 'checkout', '-b', 'feature/review');
  await writeFile(path.join(repo, 'service.ts'), 'export const value = 2;\n');
  await writeFile(
    path.join(repo, 'Contexte accentué.ts'),
    Array.from({ length: 250 }, (_, i) => `// Ligne ${i + 1}`).join('\n') + '\n',
  );
  await writeFile(path.join(repo, '.env'), 'TOKEN_PRIVATE=never-echo-this\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'change');
  const source = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', 'develop');
  await writeFile(path.join(repo, 'service.ts'), 'local dirty\n');
  await writeFile(path.join(repo, 'untracked'), 'untouched\n');
  const url = 'https://remote-review.example.invalid/repo';
  const cache = path.join(
    personal,
    'remote-review',
    'feature-studio',
    'cache',
    sha256(url) + '.git',
  );
  await mkdir(path.dirname(cache), { recursive: true });
  git(root, 'init', '--bare', cache);
  // Trusted fixture config rewrites this HTTPS URL locally: no network or credentials needed.
  git(cache, 'config', `url.${repo.replaceAll('\\', '/')}.insteadOf`, url);
  const input = {
    agent: { tools: ['read', 'studio_remote_review', 'studio_write_review_report'] },
    step: { policy: 'read-only' },
  } as unknown as RunInput;
  const host = new PersonalReviewTools(
    personal,
    worker,
    input,
    { onEvent() {}, onSession() {} },
    new AbortController().signal,
  );
  return { root, personal, repo, url, source, host, input };
}

describe('personal resources and remote review tools', () => {
  it('reads only passive personal documents, including Windows-style and absolute paths', async () => {
    const f = await setup();
    await mkdir(path.join(f.personal, 'agents', 'template'), { recursive: true });
    const target = path.join(f.personal, 'agents', 'template', 'review.md');
    await writeFile(target, '# Template partagé\n');
    expect((await f.host.readResource({ path: 'agents\\template\\review.md' })).content).toContain(
      'Template partagé',
    );
    expect((await f.host.readResource({ path: target })).sha256).toBe(
      sha256('# Template partagé\n'),
    );
    for (const name of [
      '../project/service.ts',
      'agents/template/../../../project/service.ts',
      'config.json',
      'skills/tool/run.mjs',
      path.join(f.repo, 'service.ts'),
    ])
      await expect(f.host.readResource({ path: name })).rejects.toThrow();
    const linkPath = path.join(f.personal, 'agents', 'template', 'hard.md');
    await link(target, linkPath);
    await expect(f.host.readResource({ path: linkPath })).rejects.toThrow('physique');
  });
  it('reviews pinned remote commits and writes only its personal report; the dirty project is unchanged', async () => {
    const f = await setup(),
      before = git(f.repo, 'status', '--porcelain=v1');
    const prepared = await f.host.remote({
      operation: 'prepare',
      repo: f.url,
      source: 'origin/feature/review',
      base: 'origin/develop',
    });
    expect(prepared.sourceSha).toBe(f.source);
    const files = await f.host.remote({ operation: 'files', session: prepared.id, limit: 1 });
    expect(files.excludedCount).toBe(1);
    expect(files.nextOffset).toBe(1);
    const contents = await f.host.remote({
      operation: 'read',
      session: prepared.id,
      path: 'service.ts',
    });
    expect(contents.lines[0].text).toContain('value = 2');
    const lines = await f.host.remote({
      operation: 'read',
      session: prepared.id,
      path: 'Contexte accentué.ts',
      start: 201,
      count: 10,
    });
    expect(lines.lines[0]).toEqual({ line: 201, text: '// Ligne 201' });
    const diff = await f.host.remote({
      operation: 'diff',
      session: prepared.id,
      path: 'service.ts',
    });
    expect(JSON.stringify(diff)).toContain('+export const value = 2;');
    await expect(
      f.host.remote({ operation: 'read', session: prepared.id, path: '.env' }),
    ).rejects.toThrow();
    await expect(
      f.host.remote({ operation: 'search', session: prepared.id, path: '.env', query: 'TOKEN' }),
    ).rejects.toThrow();
    await expect(
      f.host.remote({ operation: 'read', session: prepared.id, path: '../service.ts' }),
    ).rejects.toThrow();
    const search = await f.host.remote({
      operation: 'search',
      session: prepared.id,
      path: 'service.ts',
      query: 'value',
    });
    expect(search.lines.length).toBe(1);
    const saved = await f.host.writeReport({
      session: prepared.id,
      content: '# Rapport\n0 point à revoir\n',
    });
    expect(saved.reportPath.startsWith(f.personal + path.sep)).toBe(true);
    expect(saved.reportUri).toBe(`feature-studio-review:${prepared.id}`);
    expect(await resolvePersonalReviewReport(f.personal, prepared.id)).toBe(saved.reportPath);
    await expect(resolvePersonalReviewReport(f.personal, '../escape')).rejects.toThrow();
    expect(await readFile(saved.reportPath, 'utf8')).toContain('0 point à revoir');
    expect(git(f.repo, 'branch', '--show-current')).toBe('develop');
    expect(git(f.repo, 'status', '--porcelain=v1')).toBe(before);
    expect(await readFile(path.join(f.repo, 'service.ts'), 'utf8')).toBe('local dirty\n');
    expect((await f.host.remote({ operation: 'verify', session: prepared.id })).moved).toBe(false);
    await writeFile(saved.reportPath, 'Human edit');
    await expect(
      f.host.writeReport({ session: prepared.id, content: 'overwrite' }),
    ).rejects.toThrow('modifié');
    expect(await readFile(saved.reportPath, 'utf8')).toBe('Human edit');
    await expect(
      f.host.writeReport({ session: '11111111-1111-4111-8111-111111111111', content: 'other' }),
    ).rejects.toThrow();
    expect(await readdir(f.repo)).not.toContain('RELECTURE_DISTANTE.md');
  });
  it('restricts commands to explicit capabilities and never offers shell or workspace writes', async () => {
    const f = await setup();
    expect(f.host.createTools().map((t) => t.name)).toEqual([
      'studio_read_personal_resource',
      'studio_remote_review',
      'studio_write_review_report',
    ]);
    f.input.agent.tools = ['read', 'execute', 'edit'];
    expect(f.host.createTools().map((t) => t.name)).toEqual(['studio_read_personal_resource']);
    f.input.mode = 'discussion';
    expect(f.host.createTools()).toEqual([]);
  });
  it('rejects file URLs, credentials, extra arguments and unowned sessions', async () => {
    const f = await setup();
    for (const repo of [
      'file:///tmp/project',
      'https://user:token@example.invalid/repo',
      'https://example.invalid/repo?token=abc',
      'ext::whoami',
    ])
      await expect(
        f.host.remote({ operation: 'prepare', repo, source: 'feature/review', base: 'develop' }),
      ).rejects.toThrow();
    const tool = f.host.createTools().find((t) => t.name === 'studio_remote_review')!;
    expect((tool.parameters as any).type).toBe('object');
    const res: any = await tool.handler!(
      {
        operation: 'prepare',
        repo: f.url,
        source: 'feature/review',
        base: 'develop',
        command: 'whoami',
      },
      {} as any,
    );
    expect(res.resultType).toBe('failure');
    await expect(
      f.host.remote({ operation: 'info', session: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toThrow('tentative courante');
  });
  it.skipIf(process.platform === 'win32')(
    'rejects personal resources and cache symlink escapes',
    async () => {
      const f = await setup();
      await mkdir(path.join(f.personal, 'agents'));
      await symlink(f.repo, path.join(f.personal, 'agents', 'outside'));
      await expect(f.host.readResource({ path: 'agents/outside/anything.md' })).rejects.toThrow(
        'symbolique',
      );
      const blocked = path.join(f.root, 'linked-personal');
      await mkdir(path.join(blocked, 'remote-review'), { recursive: true });
      await symlink(f.repo, path.join(blocked, 'remote-review', 'feature-studio'));
      const host = new PersonalReviewTools(
        blocked,
        worker,
        f.input,
        { onEvent() {}, onSession() {} },
        new AbortController().signal,
      );
      await expect(
        host.remote({
          operation: 'prepare',
          repo: f.url,
          source: 'feature/review',
          base: 'develop',
        }),
      ).rejects.toThrow('symbolique');
    },
  );
});
