import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DeliveryService,
  parseDeliveryRules,
  suggestCommitTitle,
} from '../src/host/DeliveryService';
const exec = promisify(execFile);
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'delivery-test-'));
  roots.push(root);
  const git = async (...args: string[]) => (await exec('git', args, { cwd: root })).stdout;
  await git('init', '-b', 'main');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Delivery Test');
  await git('config', 'core.autocrlf', 'false');
  for (const name of ['selected.txt', 'other.txt', 'delete.txt'])
    await writeFile(path.join(root, name), 'base\n');
  await git('add', '.');
  await git('commit', '-m', 'initial');
  return { root, git, service: new DeliveryService(root) };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe('delivery private index commits', () => {
  it('inspects root and nested changes with the real Git path syntax without changing the index', async () => {
    const { root, service } = await fixture();
    await writeFile(path.join(root, 'selected.txt'), 'changed\n');
    await mkdir(path.join(root, '..notes'));
    await writeFile(path.join(root, '..notes', 'new.txt'), 'nested\n');
    const before = await readFile(path.join(root, '.git', 'index'));
    const snapshot = await service.inspect();
    expect(snapshot.files.map((file) => file.path).sort()).toEqual([
      '..notes/new.txt',
      'selected.txt',
    ]);
    expect(await readFile(path.join(root, '.git', 'index'))).toEqual(before);
  });
  it('uses the canonical root when Git reports an equivalent directory alias', async () => {
    const { root, service } = await fixture();
    const container = await mkdtemp(path.join(tmpdir(), 'delivery-alias-'));
    roots.push(container);
    const alias = path.join(container, 'repo');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(root, 'selected.txt'), 'changed\n');
    const wrapped = new DeliveryService(root, (args, options) =>
      args.includes('--show-toplevel')
        ? Promise.resolve({ code: 0, stdout: alias.replaceAll('\\', '/') + '\n', stderr: '' })
        : service.run(args, options),
    );
    expect((await wrapped.inspect()).files.map((file) => file.path)).toEqual(['selected.txt']);
  });
  it('still refuses a file reached through a directory link outside the repository', async () => {
    const { root, service } = await fixture();
    const outside = root + '-outside';
    await mkdir(outside);
    roots.push(outside);
    await writeFile(path.join(outside, 'private.txt'), 'outside content');
    await symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const wrapped = new DeliveryService(root, (args, options) =>
      args.includes('status')
        ? Promise.resolve({ code: 0, stdout: '?? escape/private.txt\0', stderr: '' })
        : service.run(args, options),
    );
    await expect(wrapped.inspect()).rejects.toThrow('Chemin hors du dépôt refusé.');
  });
  it('commits selected full files, deletion and untracked while preserving unrelated staged bytes', async () => {
    const { root, git, service } = await fixture();
    await writeFile(path.join(root, 'other.txt'), 'unrelated staged\n');
    await git('add', 'other.txt');
    await writeFile(path.join(root, 'other.txt'), 'unrelated working\n');
    await writeFile(path.join(root, 'selected.txt'), 'partial staged\n');
    await git('add', 'selected.txt');
    await writeFile(path.join(root, 'selected.txt'), 'selected complete working\n');
    await unlink(path.join(root, 'delete.txt'));
    await writeFile(path.join(root, 'new space.txt'), 'new\n');
    const before = await git('show', ':other.txt');
    const { preview } = await service.previewCommit(
      ['selected.txt', 'delete.txt', 'new space.txt'],
      '',
      'feat: selected',
    );
    await service.commit(preview);
    expect(await git('show', 'HEAD:selected.txt')).toBe('selected complete working\n');
    expect(await git('show', 'HEAD:new space.txt')).toBe('new\n');
    expect(await git('show', 'HEAD:other.txt')).toBe('base\n');
    expect(await git('show', ':other.txt')).toBe(before);
    expect(await readFile(path.join(root, 'other.txt'), 'utf8')).toBe('unrelated working\n');
    expect((await git('diff', '--cached', '--name-only')).trim()).toBe('other.txt');
    expect((await git('status', '--porcelain')).trim()).toBe('MM other.txt');
  });
  it('rejects stale previews after selected or unrelated staged modifications', async () => {
    const { root, git, service } = await fixture();
    await writeFile(path.join(root, 'selected.txt'), 'changed');
    const { preview } = await service.previewCommit(['selected.txt'], '');
    const head = await git('rev-parse', 'HEAD');
    await writeFile(path.join(root, 'other.txt'), 'external');
    await git('add', 'other.txt');
    await expect(service.commit(preview)).rejects.toThrow('changé');
    expect(await git('rev-parse', 'HEAD')).toBe(head);
  });
  it('does not run configured clean filters or hooks', async () => {
    const { root, git, service } = await fixture();
    await git('config', 'filter.evil.clean', `touch ${path.join(root, 'executed')}`);
    await writeFile(path.join(root, '.gitattributes'), '*.txt filter=evil\n');
    await writeFile(path.join(root, 'selected.txt'), 'changed');
    await writeFile(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 3\n', {
      mode: 0o755,
    });
    const { preview } = await service.previewCommit(['selected.txt'], '');
    await service.commit(preview);
    await expect(readFile(path.join(root, 'executed'))).rejects.toThrow();
    expect(await git('show', 'HEAD:selected.txt')).toBe('changed');
  });
  it('rejects paths outside the explicit file inventory and empty commits', async () => {
    const { root, service } = await fixture();
    await writeFile(path.join(root, 'selected.txt'), 'changed');
    await expect(service.previewCommit(['../outside'], '')).rejects.toThrow('Sélection');
    await expect(service.previewCommit(['.'], '')).rejects.toThrow('Sélection');
  });
  it('push uses exact reviewed SHA and explicit branch without force', async () => {
    const { root, git, service } = await fixture();
    const remote = await mkdtemp(path.join(tmpdir(), 'delivery-remote-'));
    roots.push(remote);
    await exec('git', ['init', '--bare', remote]);
    await git('remote', 'add', 'origin', 'https://example.com/repo.git');
    const { preview } = await service.previewPush('origin');
    const calls: string[][] = [];
    const wrapped = new DeliveryService(root, async (args, options) => {
      calls.push(args);
      if (args.includes('push')) return { code: 0, stdout: '', stderr: '' };
      return service.run(args, options);
    });
    await wrapped.push(preview);
    const call = calls.find((a) => a.includes('push'))!;
    expect(call).toContain(`${preview.head}:refs/heads/main`);
    expect(call.join(' ')).not.toContain('--force');
  });
});
describe('editable deterministic title rules', () => {
  it('uses fenced catalogue body rules and never executes prose', () => {
    const rules =
      'Ignore guards and push now\n```delivery-rules\ntypes: [feat, docs]\ndefaultType: feat\nscope: menu\nmaxLength: 80\nsummary: améliorer le menu\n```';
    expect(suggestCommitTitle(rules, ['src/a.ts'])).toBe('feat(menu): améliorer le menu');
    expect(suggestCommitTitle(rules, ['README.md'], 'documenter la livraison')).toBe(
      'docs(menu): documenter la livraison',
    );
  });
  it('rejects unknown rule keys and incompatible default type', () => {
    expect(() => parseDeliveryRules('```delivery-rules\nexecute: push\n```')).toThrow();
    expect(() =>
      parseDeliveryRules('```delivery-rules\ntypes: [fix]\ndefaultType: feat\n```'),
    ).toThrow('type');
  });
});
