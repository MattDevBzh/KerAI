import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../src/host/process';
import { gitInfo } from '../src/host/ToolHost';
import { gitRead } from '../src/host/gitRead';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('Git reads used by the feature host', () => {
  it('preserves raw UTF-8 data across chunks while keeping diagnostic logs redacted', async () => {
    const lines: string[] = [];
    const result = await runProcess(
      process.execPath,
      [
        '-e',
        `const b=Buffer.from('é secret=example\\0');process.stdout.write(b.subarray(0,1));setTimeout(()=>{process.stdout.write(b.subarray(1));process.stderr.write('password=example\\n');},20);`,
      ],
      tmpdir(),
      { rawOutput: true, onLine: (line) => lines.push(line) },
    );
    expect(result.stdout).toBe('é secret=example\0');
    expect(result.stderr).not.toContain('password=example');
    expect(lines.join('')).not.toContain('secret=example');
  });
  it('does not run configured filters, follow inherited GIT_DIR, mutate the index or lose nested dirty paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-git-read-'));
    roots.push(root);
    async function git(...args: string[]) {
      const result = await runProcess(
        'git',
        ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args],
        root,
      );
      expect(result.code, result.stderr).toBe(0);
      return result.stdout;
    }
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Tests');
    await git('config', 'user.email', 'tests@example.invalid');
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app', 'secret=example.txt'), 'initial\n');
    await writeFile(join(root, '.gitattributes'), '*.txt filter=side-effect\n');
    await git('add', '.');
    await git('commit', '-m', 'fixture');
    await writeFile(join(root, 'app', 'secret=example.txt'), 'human change\n');
    await git('config', 'filter.side-effect.clean', 'touch filter-ran; cat');
    await git('config', 'filter.side-effect.required', 'true');
    const index = await readFile(join(root, '.git', 'index'));
    vi.stubEnv('GIT_DIR', join(root, 'nonexistent'));
    vi.stubEnv('GIT_WORK_TREE', join(root, 'nonexistent'));
    const info = await gitInfo(join(root, 'app'));
    expect(info.branch).toBe('main');
    expect([...info.dirty]).toEqual(['secret=example.txt']);
    const diff = await gitRead(
      join(root, 'app'),
      ['diff', '--no-ext-diff', '--no-textconv', '--relative', 'HEAD'],
      { rawOutput: true },
    );
    expect(diff.stdout).toContain('human change');
    expect(await readFile(join(root, '.git', 'index'))).toEqual(index);
    await expect(readFile(join(root, 'filter-ran'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'app', 'filter-ran'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
