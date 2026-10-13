import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../src/host/process';
import { readHeadFile } from '../src/host/GitFileContent';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function git(root: string, ...args: string[]) {
  const result = await runProcess('git', args, root, { rawOutput: true });
  if (result.code) throw new Error(result.stderr);
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'studio-head-'));
  roots.push(root);
  await git(root, 'init');
  await git(root, 'config', 'user.email', 'test@example.invalid');
  await git(root, 'config', 'user.name', 'Test');
  return root;
}
describe('complete Git HEAD diff content', () => {
  it('reads all 330 kB from a nested workspace with spaces and colon filenames', async () => {
    const root = await fixture();
    const workspace = join(root, 'nested workspace');
    await mkdir(workspace);
    const file = join(workspace, 'code: original.ts');
    const content = 'START\n' + 'a'.repeat(330000) + '\nEND\n';
    await writeFile(file, content);
    await git(root, 'add', '--', 'nested workspace/code: original.ts');
    await git(root, 'commit', '-m', 'Original');
    await writeFile(file, 'Local changes');
    expect(await readHeadFile(workspace, file)).toBe(content);
    await expect(readHeadFile(workspace, file, 256000)).rejects.toThrow(/volumineux/);
    await expect(readHeadFile(workspace, join(workspace, 'new.ts'))).resolves.toBeUndefined();
  });
  it('distinguishes unborn HEAD from Git errors instead of silently showing blank content', async () => {
    const root = await fixture();
    await expect(readHeadFile(root, join(root, 'new.ts'))).resolves.toBeUndefined();
    const outside = await mkdtemp(join(tmpdir(), 'studio-no-git-'));
    roots.push(outside);
    await expect(readHeadFile(outside, join(outside, 'file.ts'))).rejects.toThrow(/Git/);
  });
  it('rejects an unreadable tracked HEAD object instead of displaying a blank baseline', async () => {
    const root = await fixture();
    const file = join(root, 'tracked.ts');
    await writeFile(file, 'Historical bytes');
    await git(root, 'add', '--', 'tracked.ts');
    await git(root, 'commit', '-m', 'Historical');
    const object = await runProcess('git', ['rev-parse', 'HEAD:tracked.ts'], root, {
      rawOutput: true,
    });
    const hash = object.stdout.trim();
    await rm(join(root, '.git/objects', hash.slice(0, 2), hash.slice(2)));
    await expect(readHeadFile(root, file)).rejects.toThrow(/Taille/);
  });
});
