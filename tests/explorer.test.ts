import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, link, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkspaceExplorer,
  listFilesSchema,
  searchFilesSchema,
} from '../src/host/WorkspaceExplorer';
import { PolicyEngine } from '../src/host/PolicyEngine';
import * as gitReader from '../src/host/gitRead';
import { runProcess } from '../src/host/process';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(gitEnabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'studio-explorer-'));
  roots.push(root);
  const git = async (...args: string[]) => {
    const result = await runProcess('git', args, root);
    if (result.code) throw new Error(result.stderr);
    return result.stdout;
  };
  if (gitEnabled) await git('init', '-b', 'main');
  const controller = new AbortController();
  const explorerAt = (directory = root) =>
    new WorkspaceExplorer(
      directory,
      new PolicyEngine(directory, 'read-only', []),
      controller.signal,
    );
  return { root, git, explorer: explorerAt(), explorerAt, controller };
}
const list = (explorer: WorkspaceExplorer, args: unknown = {}) =>
  explorer.list(listFilesSchema.parse(args));
const search = (explorer: WorkspaceExplorer, args: unknown = { query: 'needle' }) =>
  explorer.search(searchFilesSchema.parse(args));
async function allFiles(explorer: WorkspaceExplorer, args: Record<string, unknown> = {}) {
  const files: string[] = [];
  let page = await list(explorer, args);
  files.push(...page.files);
  while (page.next) {
    page = await list(explorer, { ...args, ...page.next });
    files.push(...page.files);
  }
  expect(page.truncated).toBe(false);
  return files;
}
async function allMatches(
  explorer: WorkspaceExplorer,
  args: Record<string, unknown> = { query: 'needle' },
) {
  const matches: { path: string; line: number; text: string }[] = [];
  let page = await search(explorer, args);
  matches.push(...page.matches);
  let pages = 1;
  while (page.next) {
    page = await search(explorer, { ...args, ...page.next });
    matches.push(...page.matches);
    pages++;
  }
  expect(page.truncated).toBe(false);
  return { matches, pages };
}

describe('bounded workspace exploration', () => {
  it.each([true, false])(
    'lists and searches project .azure sources while excluding credentials (Git: %s)',
    async (gitEnabled) => {
      const { root, git, explorer } = await fixture(gitEnabled);
      const sources = [
        '.azure/GitflowPipeLines/Fork-PipeLines/Forks-TAG.yml',
        '.azure/scripts/tag.ps1',
        '.azure/templates/build.yaml',
      ];
      const secrets = [
        '.azure/msal_token_cache.json',
        '.azure/azureProfile.json',
        '.azure/.env',
        '.azure/azuredevops/cli/credentialstore',
      ];
      for (const file of [...sources, ...secrets]) {
        await mkdir(join(root, file, '..'), { recursive: true });
        await writeFile(join(root, file), 'needle\n');
      }
      if (gitEnabled) await git('add', '-f', '.azure');
      expect(await allFiles(explorer)).toEqual(sources);
      expect(await allFiles(explorer, { path: '.azure' })).toEqual(sources);
      const found = await allMatches(explorer, { path: '.azure', query: 'needle' });
      expect(found.matches.map((match) => match.path)).toEqual(sources);
      for (const file of secrets)
        await expect(list(explorer, { path: file })).rejects.toThrow('sensible');
    },
  );
  it(
    'pages every file beyond 1500 and depth 15 deterministically, and searches the full inventory',
    async () => {
      const { root, explorer } = await fixture();
      await mkdir(join(root, 'source'));
      const paths = Array.from(
        { length: 1507 },
        (_, i) => `source/file-${String(i).padStart(4, '0')}.txt`,
      );
      await Promise.all(paths.map((file) => writeFile(join(root, file), 'needle\n')));
      const deep = `${Array.from({ length: 20 }, (_, i) => `d${i}`).join('/')}/deep.txt`;
      await mkdir(join(root, deep, '..'), { recursive: true });
      await writeFile(join(root, deep), 'needle\n');
      const files = await allFiles(explorer);
      expect(files).toEqual([...paths, deep].sort());
      expect(new Set(files).size).toBe(1508);
      const found = await allMatches(explorer);
      expect(found.matches.map((match) => match.path)).toEqual(files);
      expect(found.pages).toBeGreaterThan(15);
      // Windows runners need more time for the repeated scans of over 1,500 files.
    },
    process.platform === 'win32' ? 90_000 : 30_000,
  );

  it('uses Git ignores, negations and tracked ignored files and scopes a nested workspace', async () => {
    const { root, git, explorer, explorerAt } = await fixture();
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, '.gitignore'), '*.log\n!keep.log\nignored/\n');
    await writeFile(join(root, 'tracked.log'), 'needle');
    await git('add', '-f', 'tracked.log');
    await writeFile(join(root, 'hidden.log'), 'needle');
    await writeFile(join(root, 'keep.log'), 'needle');
    await writeFile(join(root, 'nested/.gitignore'), '!local.log\n');
    await writeFile(join(root, 'nested/local.log'), 'needle');
    await writeFile(join(root, 'nested/hidden.log'), 'needle');
    await mkdir(join(root, 'ignored'));
    await writeFile(join(root, 'ignored/hidden.txt'), 'needle');
    const before = await readFile(join(root, '.git/index'));
    expect(await allFiles(explorer)).toEqual([
      '.gitignore',
      'keep.log',
      'nested/.gitignore',
      'nested/local.log',
      'tracked.log',
    ]);
    expect(await allFiles(explorerAt(join(root, 'nested')))).toEqual(['.gitignore', 'local.log']);
    expect(
      (await search(explorerAt(join(root, 'nested')), { query: 'needle' })).matches.map(
        (m) => m.path,
      ),
    ).toEqual(['local.log']);
    expect((await list(explorer, { path: 'tracked.log' })).files).toEqual(['tracked.log']);
    await expect(list(explorer, { path: 'hidden.log' })).rejects.toThrow('exclu');
    expect(await readFile(join(root, '.git/index'))).toEqual(before);
  });

  it('keeps both the within-file tail and later files beyond 100 matches', async () => {
    const { root, explorer } = await fixture();
    await writeFile(join(root, 'a.txt'), 'needle\n'.repeat(205));
    await writeFile(join(root, 'b.txt'), 'needle\n'.repeat(3));
    const first = await search(explorer);
    expect(first.matches).toHaveLength(100);
    expect(first.next).toMatchObject({ path: '.', startLine: 1, cursor: expect.any(String) });
    const found = await allMatches(explorer);
    expect(found.matches).toHaveLength(208);
    expect(found.matches.slice(200).map((m) => [m.path, m.line])).toEqual([
      ['a.txt', 201],
      ['a.txt', 202],
      ['a.txt', 203],
      ['a.txt', 204],
      ['a.txt', 205],
      ['b.txt', 1],
      ['b.txt', 2],
      ['b.txt', 3],
    ]);
    const single = await search(explorer, { query: 'needle', path: 'a.txt' });
    expect(single.next).toMatchObject({ path: 'a.txt', startLine: 101 });
    const next = await search(explorer, { query: 'needle', ...single.next });
    expect(next.matches[0].line).toBe(101);
  });

  it('resumes the entire directory after byte and file budgets without losing empty files or later matches', async () => {
    const { root, explorer } = await fixture();
    const huge = `${'x'.repeat(3 * 1024 * 1024 - 8)}needle\n`;
    await Promise.all(Array.from({ length: 7 }, (_, i) => writeFile(join(root, `${i}.txt`), huge)));
    const first = await search(explorer);
    expect(first.stopReason).toBe('bytes');
    expect(first.scannedBytes).toBeLessThanOrEqual(first.budgets.bytes);
    expect((await allMatches(explorer)).matches).toHaveLength(7);
    await Promise.all(
      Array.from({ length: 405 }, (_, i) => writeFile(join(root, `a-${i}.txt`), '')),
    );
    await writeFile(join(root, 'z.txt'), 'needle');
    const absent = await search(explorer, { query: 'absent' });
    expect(absent.next).toBeDefined();
    const found = await allMatches(explorer);
    expect(found.matches.at(-1)?.path).toBe('z.txt');
  }, 30_000);

  it('resumes after the file and output budgets and rejects inventories truncated by Git', async () => {
    const { root, explorer } = await fixture();
    await mkdir(join(root, 'empty'));
    await Promise.all(
      Array.from({ length: 405 }, (_, i) => writeFile(join(root, `empty/${i}.txt`), '')),
    );
    await writeFile(join(root, 'empty/z.txt'), 'needle');
    const first = await search(explorer, { path: 'empty', query: 'needle' });
    expect(first.stopReason).toBe('files');
    expect(first.scannedFiles).toBe(400);
    expect(
      (await allMatches(explorer, { path: 'empty', query: 'needle' })).matches.map((m) => m.path),
    ).toEqual(['empty/z.txt']);
    await writeFile(join(root, 'unicode.txt'), `needle${'字'.repeat(400)}\n`.repeat(103));
    const output = await search(explorer, { path: 'unicode.txt', query: 'needle' });
    expect(output.stopReason).toBe('output');
    expect(output.matches.length).toBeLessThan(100);
    expect(
      (await allMatches(explorer, { path: 'unicode.txt', query: 'needle' })).matches,
    ).toHaveLength(103);
    const original = gitReader.gitRead;
    vi.spyOn(gitReader, 'gitRead').mockImplementation(async (cwd, args, options) => {
      const result = await original(cwd, args, options);
      return args[0] === 'ls-files' ? { ...result, truncated: true } : result;
    });
    await expect(list(explorer)).rejects.toThrow('aucun résultat partiel');
  });

  it('expires cursors and invalidates them after ignore rules change', async () => {
    const { root, explorer } = await fixture(false);
    await writeFile(join(root, 'a.txt'), 'needle\n'.repeat(101));
    const now = Date.now();
    const page = await search(explorer);
    vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60 * 1000);
    await expect(search(explorer, { query: 'needle', ...page.next })).rejects.toThrow('expiré');
    vi.restoreAllMocks();
    const fresh = await search(explorer);
    await writeFile(join(root, '.gitignore'), '# rules changed\n');
    await expect(search(explorer, { query: 'needle', ...fresh.next })).rejects.toThrow('changé');
  });

  it('rejects cursor scope changes, forged/expired cursors, and edited or added files', async () => {
    const { root, explorer, explorerAt } = await fixture();
    await writeFile(join(root, 'a.txt'), 'needle\n'.repeat(101));
    const page = await search(explorer);
    await expect(search(explorer, { query: 'other', ...page.next })).rejects.toThrow(
      'autre recherche',
    );
    await expect(
      search(explorer, { query: 'needle', ...page.next, path: 'a.txt' }),
    ).rejects.toThrow('autre recherche');
    await expect(search(explorerAt(), { query: 'needle', ...page.next })).rejects.toThrow(
      'inconnu',
    );
    await expect(list(explorer, { cursor: '123' })).rejects.toThrow('inconnu');
    await writeFile(join(root, 'a.txt'), 'needle\n'.repeat(102));
    await expect(search(explorer, { query: 'needle', ...page.next })).rejects.toThrow('changé');
    const listing = await list(explorer, { limit: 1 });
    await writeFile(join(root, 'b.txt'), '');
    const another = await list(explorer, { limit: 1 });
    await writeFile(join(root, 'c.txt'), '');
    await expect(list(explorer, { ...another.next })).rejects.toThrow('changé');
    expect(listing.next).toBeUndefined();
  });

  it('excludes secrets, case aliases of .git, symlinks, dependencies and build directories while respecting read policy for hardlinks', async () => {
    const { root, explorer } = await fixture(false);
    for (const dir of ['.GIT', 'dist', 'node_modules', 'BUILD']) {
      await mkdir(join(root, dir));
      await writeFile(join(root, dir, 'leak.txt'), 'needle');
    }
    await writeFile(join(root, '.env'), 'needle');
    await writeFile(join(root, 'safe.txt'), 'needle');
    await link(join(root, 'safe.txt'), join(root, 'hard.txt'));
    await symlink(join(root, 'safe.txt'), join(root, 'symbolic.txt'));
    expect(await allFiles(explorer)).toEqual(['hard.txt', 'safe.txt']);
    expect((await allMatches(explorer)).matches).toHaveLength(2);
    await expect(list(explorer, { path: '.GIT' })).rejects.toThrow('sensible');
    await expect(search(explorer, { path: 'symbolic.txt', query: 'needle' })).rejects.toThrow(
      'symboliques',
    );
  });

  it('applies hierarchical .gitignore rules outside Git with parent pruning and negation', async () => {
    const { root, explorer } = await fixture(false);
    await writeFile(join(root, '.gitignore'), '*.log\n!keep.log\nblocked/\nfoo/*\n!foo/kept/\n');
    await writeFile(join(root, 'keep.log'), 'needle');
    await writeFile(join(root, 'hide.log'), 'needle');
    await mkdir(join(root, 'child'));
    await writeFile(join(root, 'child/.gitignore'), '!allow.log\n');
    await writeFile(join(root, 'child/allow.log'), 'needle');
    await writeFile(join(root, 'child/hide.log'), 'needle');
    await mkdir(join(root, 'blocked'));
    await writeFile(join(root, 'blocked/.gitignore'), '!allow.log');
    await writeFile(join(root, 'blocked/allow.log'), 'needle');
    await mkdir(join(root, 'foo/kept'), { recursive: true });
    await writeFile(join(root, 'foo/kept/a.txt'), 'needle');
    const page = await list(explorer);
    expect(page.inventorySource).toBe('filesystem');
    expect(page.ignoreRules).toContain('hierarchical');
    expect(page.files).toEqual([
      '.gitignore',
      'child/.gitignore',
      'child/allow.log',
      'foo/kept/a.txt',
      'keep.log',
    ]);
    expect((await list(explorer, { path: 'child' })).files).toEqual([
      'child/.gitignore',
      'child/allow.log',
    ]);
    await expect(list(explorer, { path: 'blocked' })).rejects.toThrow('exclu');
    await expect(list(explorer, { path: 'child/hide.log' })).rejects.toThrow('exclu');
  });

  it('reports binary, invalid UTF-8 and oversized skipped files and obeys cancellation', async () => {
    const { root, explorer, controller } = await fixture();
    await writeFile(join(root, 'binary'), Buffer.from([0]));
    await writeFile(join(root, 'invalid'), Buffer.from([0xc3, 0x28]));
    await writeFile(join(root, 'oversized'), Buffer.alloc(4 * 1024 * 1024 + 1, 65));
    await writeFile(join(root, 'safe'), 'needle');
    const page = await search(explorer);
    expect(page.matches.map((m) => m.path)).toEqual(['safe']);
    expect(page.skippedCount).toBe(3);
    expect(page.skipped).toHaveLength(3);
    expect(page.truncated).toBe(false);
    expect(page.totalSkippedCount).toBe(3);
    controller.abort();
    await expect(list(explorer)).rejects.toThrow();
    await expect(search(explorer)).rejects.toThrow();
  });
});
