import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitReview, gitChangesSchema, gitDiffSchema, gitPageSchema } from '../src/host/GitReview';
import { PolicyEngine } from '../src/host/PolicyEngine';
import { runProcess } from '../src/host/process';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'studio-git-review-'));
  roots.push(root);
  const git = async (...args: string[]) => {
    const result = await runProcess('git', ['-c', 'commit.gpgSign=false', ...args], root);
    if (result.code) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  await git('init', '-b', 'develop');
  await git('config', 'user.name', 'Tests');
  await git('config', 'user.email', 'tests@example.invalid');
  await writeFile(join(root, 'code.ts'), 'base\n');
  await git('add', '.');
  await git('commit', '-m', 'base');
  const baseSha = await git('rev-parse', 'HEAD');
  await git('checkout', '-b', 'feature');
  const reviewAt = (directory = root) =>
    new GitReview(
      directory,
      new PolicyEngine(directory, 'read-only', []),
      new AbortController().signal,
    );
  return { root, git, baseSha, review: reviewAt(), reviewAt };
}
const diff = (review: GitReview, args: unknown = {}) => review.diff(gitDiffSchema.parse(args));
const changes = (review: GitReview, args: unknown = {}) =>
  review.changes(gitChangesSchema.parse(args));
const branches = (review: GitReview, args: unknown = {}) =>
  review.branches(gitPageSchema.parse(args));

describe('branch review tools', () => {
  it('compares diverged local and origin branches from the merge base, or directly by explicit choice', async () => {
    const { root, git, baseSha, review } = await fixture();
    await writeFile(join(root, 'code.ts'), 'feature commit\n');
    await git('add', '.');
    await git('commit', '-m', 'feature');
    const headSha = await git('rev-parse', 'HEAD');
    await git('checkout', 'develop');
    await writeFile(join(root, 'develop-only.ts'), 'develop advance\n');
    await git('add', '.');
    await git('commit', '-m', 'advance');
    const developSha = await git('rev-parse', 'HEAD');
    await git('update-ref', 'refs/remotes/origin/develop', developSha);
    await git('checkout', 'feature');
    const index = await readFile(join(root, '.git', 'index'));
    const local = await diff(review, { baseRef: 'develop' });
    const remote = await diff(review, { baseRef: 'origin/develop' });
    expect(local.diff).toBe(remote.diff);
    expect(remote.diff).toContain('+feature commit');
    expect(remote.diff).not.toContain('develop-only');
    expect(remote.snapshot).toMatchObject({
      baseRef: 'refs/remotes/origin/develop',
      baseSha: developSha,
      headSha,
      effectiveBaseSha: baseSha,
      includeLocal: false,
      branch: 'feature',
    });
    const direct = await diff(review, { baseRef: 'origin/develop', comparison: 'direct' });
    expect(direct.diff).toContain('-develop advance');
    expect(direct.snapshot.effectiveBaseSha).toBe(developSha);
    expect(await readFile(join(root, '.git', 'index'))).toEqual(index);
    expect(await git('branch', '--show-current')).toBe('feature');
  });

  it('keeps local changes opt-in for branch review and includes staged, unstaged and untracked inventory', async () => {
    const { root, git, review } = await fixture();
    await writeFile(join(root, 'code.ts'), 'staged\n');
    await git('add', 'code.ts');
    await writeFile(join(root, 'code.ts'), 'working tree\n');
    await writeFile(join(root, 'new file.ts'), 'untracked\n');
    expect((await diff(review, { baseRef: 'develop' })).diff).toBe('');
    const combined = await diff(review, { baseRef: 'develop', includeLocal: true });
    expect(combined.diff).toContain('+working tree');
    expect(combined.untrackedCount).toBe(1);
    const files = await changes(review, { baseRef: 'develop', includeLocal: true });
    expect(files.files).toEqual([
      { path: 'code.ts', status: 'M' },
      { path: 'new file.ts', status: '?' },
    ]);
    expect((await diff(review)).diff).toBe(combined.diff);
    expect((await diff(review)).snapshot.comparison).toBe('working-tree');
  });

  it('paginates a diff larger than the former 256k limit without losing its beginning or UTF-8 text', async () => {
    const { root, review } = await fixture();
    const text = Array.from(
      { length: 7000 },
      (_, i) => `line ${i}: éè 🤖 ${'x'.repeat(35)}\n`,
    ).join('');
    await writeFile(join(root, 'code.ts'), text);
    const first = await diff(review, { path: 'code.ts', endLine: 2000 });
    expect(first.diff).toContain('diff --git');
    let assembled = first.diff;
    let next = first.nextStartLine;
    while (next !== undefined) {
      const page = await diff(review, {
        path: 'code.ts',
        startLine: next,
        endLine: next + 1999,
        expectedSha256: first.sha256,
      });
      assembled += page.diff;
      next = page.nextStartLine;
    }
    expect(assembled).toContain('+line 6999:');
    expect(assembled).not.toContain('\uFFFD');
    expect(assembled.split('\n').filter((line) => line.startsWith('+line '))).toHaveLength(7000);
    await expect(diff(review, { path: 'code.ts', startLine: 2 })).rejects.toThrow(/expectedSha256/);
    await writeFile(join(root, 'code.ts'), text + 'changed\n');
    await expect(
      diff(review, { path: 'code.ts', startLine: 2, expectedSha256: first.sha256 }),
    ).rejects.toThrow(/a changé/);
  });

  it('paginates branch and file inventories and rejects changed inventories', async () => {
    const { root, git, baseSha, review } = await fixture();
    await git('update-ref', 'refs/remotes/origin/develop', baseSha);
    const first = await branches(review, { limit: 1 });
    expect(first.total).toBe(3);
    const second = await branches(review, {
      offset: first.nextOffset,
      limit: 1,
      expectedSha256: first.sha256,
    });
    expect(second.branches[0].ref).not.toBe(first.branches[0].ref);
    await git('branch', 'another');
    await expect(branches(review, { offset: 1, expectedSha256: first.sha256 })).rejects.toThrow(
      /a changé/,
    );
    await writeFile(join(root, 'code.ts'), 'changed\n');
    await writeFile(join(root, 'new.ts'), 'new\n');
    const files = await changes(review, { limit: 1 });
    expect(files.total).toBe(2);
    expect((await changes(review, { offset: 1, expectedSha256: files.sha256 })).files[0].path).toBe(
      'new.ts',
    );
    await writeFile(join(root, 'other.ts'), 'other\n');
    await expect(changes(review, { offset: 1, expectedSha256: files.sha256 })).rejects.toThrow(
      /a changé/,
    );
  });

  it('rejects missing, ambiguous, option-like and revision-expression bases without falling back to HEAD', async () => {
    const { git, baseSha, review } = await fixture();
    for (const baseRef of [
      'missing',
      '--output=outside',
      'develop..feature',
      'develop~1',
      'refs/tags/develop',
      'develop\n',
    ])
      await expect(diff(review, { baseRef })).rejects.toThrow();
    await git('branch', 'origin/develop');
    await git('update-ref', 'refs/remotes/origin/develop', baseSha);
    await expect(diff(review, { baseRef: 'origin/develop' })).rejects.toThrow(/ambigu/);
    expect((await diff(review, { baseRef: 'refs/remotes/origin/develop' })).diff).toBe('');
    expect((await diff(review, { baseRef: 'refs/heads/origin/develop' })).diff).toBe('');
  });

  it('excludes tracked secrets even for historical deletions and reports renames as addition/deletion', async () => {
    const { root, git, review } = await fixture();
    await writeFile(join(root, '.env'), 'PRIVATE_VALUE\n');
    await git('add', '.');
    await git('commit', '-m', 'secret fixture');
    await git('branch', '-f', 'develop', 'HEAD');
    await git('mv', 'code.ts', 'renamed code.ts');
    await git('rm', '.env');
    await git('commit', '-m', 'rename and delete');
    const files = await changes(review, { baseRef: 'develop' });
    expect(files.excludedCount).toBe(1);
    expect(files.files).toEqual([
      { path: 'code.ts', status: 'D' },
      { path: 'renamed code.ts', status: 'A' },
    ]);
    expect((await diff(review, { baseRef: 'develop' })).diff).not.toContain('PRIVATE_VALUE');
    for (const path of ['.env', '../outside', 'C:/Users/file.ts', 'src\\file.ts'])
      await expect(diff(review, { baseRef: 'develop', path })).rejects.toThrow();
    // A directory path cannot bypass the inventory's per-file filtering.
    await expect(diff(review, { baseRef: 'develop', path: '.' })).rejects.toThrow(/fichier/);
  });

  it('scopes nested workspaces and reports a detached HEAD accurately', async () => {
    const { root, git, reviewAt } = await fixture();
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app', 'nested.ts'), 'nested\n');
    await writeFile(join(root, 'outside.ts'), 'outside\n');
    await git('add', '.');
    await git('commit', '-m', 'nested');
    await git('checkout', '--detach');
    const nested = reviewAt(join(root, 'app'));
    const result = await diff(nested, { baseRef: 'develop', path: 'nested.ts' });
    expect(result.snapshot.branch).toBe('HEAD détachée');
    expect(result.diff).toContain('+nested');
    expect(result.diff).not.toContain('outside');
    await writeFile(join(root, 'app', 'local.ts'), 'local\n');
    expect(
      (await changes(nested, { baseRef: 'develop', includeLocal: true })).files.map(
        (file) => file.path,
      ),
    ).toEqual(['local.ts', 'nested.ts']);
  });

  it('fails an unrelated merge-base comparison and allows an explicit direct comparison', async () => {
    const { git, review } = await fixture();
    await git('checkout', '--orphan', 'unrelated');
    await git('commit', '-m', 'unrelated root');
    await expect(diff(review, { baseRef: 'develop' })).rejects.toThrow(/Aucun ancêtre commun/);
    expect(
      (await diff(review, { baseRef: 'develop', comparison: 'direct' })).snapshot.comparison,
    ).toBe('direct');
  });
});

it('compares two selected branches without reading the current checkout as source', async () => {
  const { root, git, review, baseSha } = await fixture();
  await writeFile(join(root, 'code.ts'), 'selected source\n');
  await git('add', '.');
  await git('commit', '-m', 'source');
  const sourceSha = await git('rev-parse', 'HEAD');
  await git('checkout', 'develop');
  await writeFile(join(root, 'code.ts'), 'unrelated local work\n');
  const result = await diff(review, {
    sourceRef: 'refs/heads/feature',
    baseRef: 'refs/heads/develop',
    includeLocal: false,
  });
  expect(result.diff).toContain('+selected source');
  expect(result.diff).not.toContain('unrelated');
  expect(result.snapshot).toMatchObject({
    headSha: sourceSha,
    effectiveBaseSha: baseSha,
    sourceRef: 'refs/heads/feature',
  });
  expect(await review.readFile({ ref: sourceSha, path: 'code.ts' })).toMatchObject({
    content: 'selected source\n',
  });
  expect(await readFile(join(root, 'code.ts'), 'utf8')).toBe('unrelated local work\n');
  expect(await git('branch', '--show-current')).toBe('develop');
  await expect(
    diff(review, { sourceRef: 'feature', baseRef: 'develop', includeLocal: true }),
  ).rejects.toThrow('exclut');
});
