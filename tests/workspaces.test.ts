import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Feature, FeatureCheckpoint } from '../src/shared/types';
import {
  CHECKPOINT_LIMITS,
  FeatureWorkspace,
  WorkspaceRestoreError,
} from '../src/host/FeatureWorkspace';

// Full capture/restore scenarios start many real Git processes on the Windows runner.
if (process.platform === 'win32') vi.setConfig({ testTimeout: 60_000 });

const execute = promisify(execFile),
  roots: string[] = [];
const restoreRace = vi.hoisted(() => ({
  afterTempSync: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (
        typeof args[0] === 'string' &&
        args[0].includes('.feature-studio-') &&
        restoreRace.afterTempSync
      ) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          await sync();
          await restoreRace.afterTempSync?.();
        };
      }
      return handle;
    },
  };
});
async function git(root: string, ...args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  const result = await execute(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
    { cwd: root, env },
  );
  return result.stdout;
}
function feature(): Feature {
  return {
    id: randomUUID(),
    title: 'Une idée à isoler',
    description: '',
    workflowId: 'single',
    workflowName: 'Single',
    createdAt: 'now',
    updatedAt: 'now',
    branch: 'main',
    status: 'draft',
    activeStepId: 'session',
    steps: [
      {
        id: 'session',
        name: 'Session',
        description: '',
        agentId: 'agent',
        policy: 'workspace-write',
        skills: [],
        maxAttempts: 5,
        artifact: 'session.md',
        dependsOn: [],
        status: 'pending',
        attempts: [],
      },
    ],
    checkpoints: [],
  };
}
async function fixture(commit = true) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'feature-workspaces-')));
  roots.push(root);
  const source = path.join(root, 'repo'),
    storage = path.join(root, 'private');
  await mkdir(source);
  await git(source, 'init', '-b', 'main');
  await git(source, 'config', 'user.name', 'Fixture');
  await git(source, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(source, 'tracked.txt'), 'Committed\n');
  if (commit) {
    await git(source, 'add', '.');
    await git(source, 'commit', '-m', 'Fixture');
  }
  const manager = new FeatureWorkspace(source, storage),
    item = feature();
  return { root, source, storage, manager, feature: item };
}
async function isolate(f: Awaited<ReturnType<typeof fixture>>) {
  f.feature.worktree = await f.manager.createWorktree(f.feature);
  f.feature.branch = f.feature.worktree.branch;
  return f.feature.worktree.path;
}
async function capture(f: Awaited<ReturnType<typeof fixture>>, label = 'Checkpoint') {
  const checkpoint = await f.manager.capture(f.feature, { kind: 'manual', label });
  f.feature.checkpoints!.push(checkpoint);
  return checkpoint;
}
const recovery =
  (item: Feature, saved: FeatureCheckpoint[]) => async (checkpoint: FeatureCheckpoint) => {
    saved.push(checkpoint);
    item.checkpoints!.push(checkpoint);
  };
afterEach(async () => {
  restoreRace.afterTempSync = undefined;
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('physical Git isolation', () => {
  it('starts from HEAD without importing staged, unstaged or untracked source edits, preserving the source index', async () => {
    const f = await fixture();
    await writeFile(path.join(f.source, 'tracked.txt'), 'Staged source\n');
    await git(f.source, 'add', 'tracked.txt');
    await writeFile(path.join(f.source, 'tracked.txt'), 'Unstaged source\n');
    await writeFile(path.join(f.source, 'human.txt'), 'Human untracked');
    const indexBefore = await readFile(path.join(f.source, '.git/index')),
      statusBefore = await git(f.source, 'status', '--porcelain=v1');
    const inspected = await f.manager.inspectRepository();
    expect(inspected.dirtyCount).toBe(2);
    const worktree = await isolate(f);
    expect(path.dirname(worktree)).toBe(path.dirname(f.source));
    expect(await readFile(path.join(worktree, 'tracked.txt'), 'utf8')).toBe('Committed\n');
    await expect(readFile(path.join(worktree, 'human.txt'))).rejects.toThrow();
    expect(f.feature.worktree!.baseCommit).toBe(inspected.head);
    expect(f.feature.branch).toMatch(/^codex\/feature-studio-une-idee-a-isoler-/);
    expect(await f.manager.validate(f.feature)).toBe(worktree);
    expect(f.manager.executionPath(f.feature)).toBe(worktree);
    expect(await readFile(path.join(f.source, '.git/index'))).toEqual(indexBefore);
    expect(await git(f.source, 'status', '--porcelain=v1')).toBe(statusBefore);
    expect(await readFile(path.join(f.source, 'tracked.txt'), 'utf8')).toBe('Unstaged source\n');
    expect(await f.manager.createWorktree(f.feature)).toEqual(f.feature.worktree);
  });
  it('creates the requested branch from a different existing base and preserves dirty source/index', async () => {
    const f = await fixture();
    await git(f.source, 'branch', 'release');
    await writeFile(path.join(f.source, 'tracked.txt'), 'New main commit\n');
    await git(f.source, 'add', '.');
    await git(f.source, 'commit', '-m', 'Main advanced');
    await writeFile(path.join(f.source, 'tracked.txt'), 'Staged user edit\n');
    await git(f.source, 'add', '.');
    await writeFile(path.join(f.source, 'tracked.txt'), 'Unstaged user edit\n');
    await writeFile(path.join(f.source, 'untracked.txt'), 'Keep me');
    const index = await readFile(path.join(f.source, '.git/index'));
    const status = await git(f.source, 'status', '--porcelain=v1');
    const base = (await f.manager.branchChoices()).find((branch) => branch.name === 'release')!;
    const worktree = await f.manager.createWorktree(f.feature, {
      baseRef: base.ref,
      baseCommit: base.commit,
      branchName: 'codex/ticket-42',
    });
    expect(worktree).toMatchObject({
      branch: 'codex/ticket-42',
      baseBranch: 'release',
      baseCommit: base.commit,
    });
    expect(await readFile(path.join(worktree.path, 'tracked.txt'), 'utf8')).toBe('Committed\n');
    expect(await readFile(path.join(f.source, '.git/index'))).toEqual(index);
    expect(await git(f.source, 'status', '--porcelain=v1')).toBe(status);
    expect((await git(f.source, 'branch', '--show-current')).trim()).toBe('main');
  });
  it('rejects a moved base reference and invalid branch names before creating a worktree', async () => {
    const f = await fixture();
    const base = (await f.manager.branchChoices())[0];
    await writeFile(path.join(f.source, 'tracked.txt'), 'Next commit\n');
    await git(f.source, 'add', '.');
    await git(f.source, 'commit', '-m', 'Move base');
    await expect(
      f.manager.createWorktree(f.feature, {
        baseRef: base.ref,
        baseCommit: base.commit,
        branchName: 'codex/ticket-42',
      }),
    ).rejects.toThrow('changé');
    await expect(
      f.manager.createWorktree(f.feature, {
        baseRef: base.ref,
        baseCommit: base.commit,
        branchName: '--help',
      }),
    ).rejects.toThrow('invalide');
    expect(
      (await git(f.source, 'worktree', 'list', '--porcelain')).match(/worktree /g),
    ).toHaveLength(1);
  });
  it('rejects creation for non-Git, unborn repositories and subfolders, but supports legacy checkpoints', async () => {
    const f = await fixture(false);
    await expect(f.manager.inspectRepository()).rejects.toThrow(/HEAD/);
    await expect(f.manager.createWorktree(f.feature)).rejects.toThrow(/HEAD/);
    expect(await f.manager.validate(f.feature)).toBe(f.source);
    const checkpoint = await capture(f);
    expect(checkpoint.head).toBe('');
    const committed = await fixture();
    const subfolder = path.join(committed.source, 'subfolder');
    await mkdir(subfolder);
    await writeFile(path.join(subfolder, 'nested.txt'), 'Nested legacy');
    const nested = new FeatureWorkspace(subfolder, path.join(committed.root, 'nested-private'));
    await expect(nested.inspectRepository()).rejects.toThrow(/sous-dossier/);
    expect(await nested.validate(committed.feature)).toBe(subfolder);
    const nestedCheckpoint = await nested.capture(committed.feature, {
      kind: 'manual',
      label: 'Nested',
    });
    committed.feature.checkpoints!.push(nestedCheckpoint);
    expect(
      (await nested.readFile(committed.feature, nestedCheckpoint.id, 'nested.txt'))!.toString(),
    ).toBe('Nested legacy');
    const nongit = path.join(f.root, 'no-git');
    await mkdir(nongit);
    await writeFile(path.join(nongit, 'plain.txt'), 'Legacy');
    const legacy = new FeatureWorkspace(nongit, path.join(f.root, 'legacy-private'));
    f.feature.branch = 'sans Git';
    await expect(legacy.inspectRepository()).rejects.toThrow(/dépôt Git/);
    expect(await legacy.validate(f.feature)).toBe(nongit);
    const plain = await legacy.capture(f.feature, { kind: 'manual', label: 'Plain' });
    f.feature.checkpoints!.push(plain);
    expect(plain.head).toBe('');
    expect((await legacy.readFile(f.feature, plain.id, 'plain.txt'))!.toString()).toBe('Legacy');
  });
  it('neutralizes checkout hooks and filters, while cleaning Git environment overrides', async () => {
    const f = await fixture();
    const marker = path.join(f.root, 'hook-ran');
    await writeFile(
      path.join(f.source, '.git/hooks/post-checkout'),
      `#!/bin/sh\nprintf fired > '${marker}'\n`,
    );
    await chmod(path.join(f.source, '.git/hooks/post-checkout'), 0o755);
    await writeFile(path.join(f.source, '.gitattributes'), 'tracked.txt filter=fixture\n');
    await git(f.source, 'add', '.gitattributes');
    await git(f.source, 'commit', '-m', 'Filter declaration');
    await git(
      f.source,
      'config',
      'filter.fixture.smudge',
      `sh -c 'printf filter > "${marker}"; cat'`,
    );
    await git(f.source, 'config', 'filter.fixture.required', 'true');
    const foreign = await fixture();
    vi.stubEnv('GIT_DIR', path.join(foreign.source, '.git'));
    vi.stubEnv('GIT_WORK_TREE', foreign.source);
    vi.stubEnv('GIT_INDEX_FILE', path.join(foreign.root, 'poison-index'));
    const worktree = await isolate(f);
    expect(await readFile(path.join(worktree, 'tracked.txt'), 'utf8')).toBe('Committed\n');
    await expect(readFile(marker)).rejects.toThrow();
    await expect(readFile(path.join(foreign.root, 'poison-index'))).rejects.toThrow();
  });
  it('rejects foreign worktrees, changed branches and symbolic roots without automatic removal', async () => {
    const f = await fixture(),
      worktree = await isolate(f),
      foreign = await fixture();
    await expect(
      f.manager.validate({
        ...f.feature,
        worktree: { ...f.feature.worktree!, path: foreign.source },
      }),
    ).rejects.toThrow(/chemin/);
    await git(worktree, 'checkout', '-b', 'wrong-branch');
    await expect(f.manager.validate(f.feature)).rejects.toThrow(/branche/);
    await git(worktree, 'checkout', f.feature.branch);
    const alternative = path.join(f.root, 'saved-worktree');
    await renameDirectory(worktree, alternative);
    await symlink(alternative, worktree);
    await expect(f.manager.validate(f.feature)).rejects.toThrow(/symbolique/);
    expect((await lstat(alternative)).isDirectory()).toBe(true);
    await rm(worktree);
    await git(f.root, 'clone', '--no-local', foreign.source, worktree);
    await expect(f.manager.validate(f.feature)).rejects.toThrow(/dépôt source/);
  });
});
async function renameDirectory(from: string, to: string) {
  const { rename } = await import('node:fs/promises');
  await rename(from, to);
}

describe('immutable private checkpoints and comparisons', () => {
  it('deduplicates content and compares additions, deletions, binary, empty files and unusual filenames', async () => {
    const f = await fixture(),
      root = await isolate(f);
    await writeFile(path.join(root, 'empty.txt'), '');
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    await writeFile(path.join(root, 'password=notes.txt'), 'Raw filename survives');
    await writeFile(path.join(root, 'unicode-é.txt'), 'Accents');
    await writeFile(path.join(root, '__proto__'), 'A regular filename');
    const before = await capture(f, 'Before');
    const objectsBefore = await readdir(path.join(f.storage, 'objects'));
    const identical = await capture(f, 'Same bytes');
    expect(await readdir(path.join(f.storage, 'objects'))).toEqual(objectsBefore);
    expect(identical.id).not.toBe(before.id);
    await writeFile(path.join(root, 'tracked.txt'), 'Changed\n');
    await rm(path.join(root, 'empty.txt'));
    await writeFile(path.join(root, 'new.txt'), 'Added');
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 3]));
    const after = await capture(f, 'After');
    const comparison = await f.manager.compare(f.feature, before.id, after.id);
    expect(comparison.files.map((file) => [file.path, file.status])).toEqual([
      ['binary.bin', 'modified'],
      ['empty.txt', 'deleted'],
      ['new.txt', 'added'],
      ['tracked.txt', 'modified'],
    ]);
    expect(comparison.files[0].binary).toBe(true);
    expect(await f.manager.readFile(f.feature, before.id, 'empty.txt')).toEqual(Buffer.alloc(0));
    expect(await f.manager.readFile(f.feature, before.id, 'new.txt')).toBeUndefined();
    expect((await f.manager.readFile(f.feature, before.id, 'password=notes.txt'))!.toString()).toBe(
      'Raw filename survives',
    );
    expect((await f.manager.readFile(f.feature, before.id, '__proto__'))!.toString()).toBe(
      'A regular filename',
    );
    expect((await f.manager.compare(f.feature, before.id)).targetCheckpointId).toBeUndefined();
  });
  it('excludes secrets, configurations, symbolic/physical links and large files, reporting exclusions', async () => {
    const f = await fixture(),
      root = await isolate(f);
    await writeFile(path.join(root, '.env'), 'SECRET');
    await mkdir(path.join(root, '.github'));
    await writeFile(path.join(root, '.github/config.json'), 'Config');
    const external = path.join(f.root, 'external');
    await writeFile(external, 'Outside');
    await symlink(external, path.join(root, 'linked.txt'));
    await link(external, path.join(root, 'physical.txt'));
    await writeFile(path.join(root, 'large.bin'), '');
    await truncate(path.join(root, 'large.bin'), CHECKPOINT_LIMITS.fileBytes + 1);
    const checkpoint = await capture(f);
    expect(checkpoint.excludedCount).toBe(5);
    expect(checkpoint.excludedPaths.join('\n')).toContain('.env');
    expect(checkpoint.excludedPaths.join('\n')).toContain('large.bin');
    expect(await f.manager.readFile(f.feature, checkpoint.id, 'linked.txt')).toBeUndefined();
    await writeFile(path.join(root, 'large.bin'), 'Now small');
    expect(
      (await f.manager.compare(f.feature, checkpoint.id)).files.find(
        (file) => file.path === 'large.bin',
      )?.restorable,
    ).toBe(false);
    await expect(f.manager.readFile(f.feature, checkpoint.id, '.env')).rejects.toThrow(/protégé/);
    await expect(f.manager.readFile(f.feature, checkpoint.id, '../external')).rejects.toThrow(
      /invalide/,
    );
  });
  it('does not invent absence for formerly excluded paths, including exclusions beyond the display limit', async () => {
    const f = await fixture(),
      root = await isolate(f),
      outside = path.join(f.root, 'outside');
    await writeFile(outside, 'Outside');
    for (let index = 0; index < CHECKPOINT_LIMITS.excludedPaths + 1; index++)
      await symlink(outside, path.join(root, `excluded-${String(index).padStart(3, '0')}.txt`));
    const before = await capture(f);
    expect(before.excludedPaths).toHaveLength(CHECKPOINT_LIMITS.excludedPaths);
    const chosen = 'excluded-200.txt';
    await rm(path.join(root, chosen));
    await writeFile(path.join(root, chosen), 'Human file replacing symlink');
    const comparison = await f.manager.compare(f.feature, before.id);
    expect(comparison.files.find((file) => file.path === chosen)).toMatchObject({
      status: 'added',
      restorable: false,
      reason: expect.stringMatching(/exclu/),
    });
    await expect(
      f.manager.restore(f.feature, before.id, [chosen], comparison.fingerprint, async () => {}),
    ).rejects.toThrow(/non restaurable/);
    expect(await readFile(path.join(root, chosen), 'utf8')).toBe('Human file replacing symlink');
  });
  it('rejects foreign membership and corrupted private contents', async () => {
    const f = await fixture();
    await isolate(f);
    const checkpoint = await capture(f),
      other = feature();
    other.branch = f.feature.branch;
    await expect(f.manager.compare(other, checkpoint.id)).rejects.toThrow();
    await expect(
      f.manager.compare({ ...f.feature, checkpoints: [] }, checkpoint.id),
    ).rejects.toThrow(/appartient/);
    const manifestPath = path.join(f.storage, 'manifests', checkpoint.id + '.json'),
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const object = path.join(f.storage, 'objects', manifest.files['tracked.txt'].hash);
    await writeFile(object, 'Corrupted\n');
    await expect(f.manager.readFile(f.feature, checkpoint.id, 'tracked.txt')).rejects.toThrow(
      /invalide/,
    );
    manifest.featureId = other.id;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(f.manager.compare(f.feature, checkpoint.id)).rejects.toThrow(/autre feature/);
  });
  it('refuses aggregate snapshots above 64MiB without partial checkpoint publication', async () => {
    const f = await fixture(),
      root = await isolate(f),
      data = Buffer.alloc(CHECKPOINT_LIMITS.fileBytes, 1);
    for (let index = 0; index < 17; index++)
      await writeFile(path.join(root, `size-${index}.bin`), data);
    await expect(capture(f)).rejects.toThrow(/checkpoint refusé/);
    expect(f.feature.checkpoints).toEqual([]);
  });
});

describe('private checkpoint storage boundary', () => {
  it('refuses storage inside the checkout without creating that directory', async () => {
    const f = await fixture(),
      inside = path.join(f.source, '.feature-studio', 'private');
    const manager = new FeatureWorkspace(f.source, inside);
    await expect(
      manager.capture(f.feature, { kind: 'manual', label: 'Unsafe location' }),
    ).rejects.toThrow(/hors du checkout/);
    await expect(lstat(path.dirname(inside))).rejects.toThrow();
  });
});

describe('Git ignored paths remain excluded from restore', () => {
  it('records ignored directories compactly and never deletes their files after the ignore rule disappears', async () => {
    const f = await fixture(),
      root = await isolate(f),
      ignore = (
        await git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude')
      ).trim();
    const original = await readFile(ignore, 'utf8');
    await writeFile(ignore, original + '\nignored-folder/\n');
    await mkdir(path.join(root, 'ignored-folder'));
    await writeFile(path.join(root, 'ignored-folder/human.txt'), 'Human ignored content');
    const before = await capture(f);
    expect(before.excludedPaths.join('\n')).toContain('ignored-folder');
    expect(before.excludedCount).toBe(1);
    const manifest = JSON.parse(
      await readFile(path.join(f.storage, 'manifests', before.id + '.json'), 'utf8'),
    );
    expect(Object.keys(manifest.exclusions)).toEqual(['ignored-folder']);
    expect(manifest.files['ignored-folder/human.txt']).toBeUndefined();
    await writeFile(ignore, original);
    const comparison = await f.manager.compare(f.feature, before.id);
    expect(comparison.files.find((file) => file.path === 'ignored-folder/human.txt')).toMatchObject(
      { status: 'added', restorable: false, reason: expect.stringMatching(/Ignoré par Git/) },
    );
    await expect(
      f.manager.restore(
        f.feature,
        before.id,
        ['ignored-folder/human.txt'],
        comparison.fingerprint,
        async () => {},
      ),
    ).rejects.toThrow(/non restaurable/);
    expect(await readFile(path.join(root, 'ignored-folder/human.txt'), 'utf8')).toBe(
      'Human ignored content',
    );
  });
  it('refuses restoration when a previously captured file becomes Git-ignored', async () => {
    const f = await fixture(),
      root = await isolate(f),
      ignore = (
        await git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude')
      ).trim();
    await writeFile(path.join(root, 'now-ignored.txt'), 'Captured');
    const before = await capture(f);
    await writeFile(ignore, (await readFile(ignore, 'utf8')) + '\nnow-ignored.txt\n');
    await writeFile(path.join(root, 'now-ignored.txt'), 'Human ignored edit');
    const comparison = await f.manager.compare(f.feature, before.id);
    expect(comparison.files.find((file) => file.path === 'now-ignored.txt')).toMatchObject({
      status: 'deleted',
      restorable: false,
    });
    await expect(
      f.manager.restore(
        f.feature,
        before.id,
        ['now-ignored.txt'],
        comparison.fingerprint,
        async () => {},
      ),
    ).rejects.toThrow(/non restaurable/);
    expect(await readFile(path.join(root, 'now-ignored.txt'), 'utf8')).toBe('Human ignored edit');
  });
  it('rejects more than 200 explicit restore paths before creating a recovery point', async () => {
    const f = await fixture();
    await isolate(f);
    const point = await capture(f),
      callback = vi.fn(async () => {});
    await expect(
      f.manager.restore(
        f.feature,
        point.id,
        Array.from({ length: 201 }, (_, index) => `path-${index}.txt`),
        'not-used',
        callback,
      ),
    ).rejects.toThrow(/trop volumineuse/);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('targeted restore with durable recovery', () => {
  it('restores exact selected file states and modes, preserving unrelated files and both Git indexes', async () => {
    const f = await fixture(),
      root = await isolate(f);
    await writeFile(path.join(root, 'empty.txt'), '');
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 255, 1]));
    await chmod(path.join(root, 'tracked.txt'), 0o755);
    // Windows does not expose POSIX executable bits; restore the mode actually captured.
    const capturedMode = (await lstat(path.join(root, 'tracked.txt'))).mode & 0o777;
    const before = await capture(f);
    const worktreeIndex = (
        await git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'index')
      ).trim(),
      indexBefore = await readFile(worktreeIndex),
      sourceIndex = await readFile(path.join(f.source, '.git/index'));
    await writeFile(path.join(root, 'tracked.txt'), 'Latest');
    await chmod(path.join(root, 'tracked.txt'), 0o644);
    await rm(path.join(root, 'empty.txt'));
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 0]));
    await writeFile(path.join(root, 'added.txt'), 'Remove only this');
    await writeFile(path.join(root, 'unrelated.txt'), 'Keep me');
    const comparison = await f.manager.compare(f.feature, before.id),
      saved: FeatureCheckpoint[] = [];
    const restored = await f.manager.restore(
      f.feature,
      before.id,
      ['tracked.txt', 'empty.txt', 'binary.bin', 'added.txt'],
      comparison.fingerprint,
      async (checkpoint) => {
        expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('Latest');
        expect(
          await readFile(path.join(f.storage, 'manifests', checkpoint.id + '.json'), 'utf8'),
        ).toContain(checkpoint.id);
        await writeFile(path.join(f.root, 'recovery-record.json'), JSON.stringify(checkpoint));
        await recovery(f.feature, saved)(checkpoint);
      },
    );
    expect(restored.restoredFiles).toEqual(['tracked.txt', 'empty.txt', 'binary.bin', 'added.txt']);
    expect(saved).toHaveLength(1);
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('Committed\n');
    expect((await lstat(path.join(root, 'tracked.txt'))).mode & 0o777).toBe(capturedMode);
    expect(await readFile(path.join(root, 'empty.txt'))).toEqual(Buffer.alloc(0));
    expect(await readFile(path.join(root, 'binary.bin'))).toEqual(Buffer.from([0, 255, 1]));
    await expect(readFile(path.join(root, 'added.txt'))).rejects.toThrow();
    expect(await readFile(path.join(root, 'unrelated.txt'), 'utf8')).toBe('Keep me');
    expect(await readFile(worktreeIndex)).toEqual(indexBefore);
    expect(await readFile(path.join(f.source, '.git/index'))).toEqual(sourceIndex);
    const undo = await f.manager.compare(f.feature, restored.recovery.id);
    await f.manager.restore(
      f.feature,
      restored.recovery.id,
      ['tracked.txt', 'empty.txt', 'binary.bin', 'added.txt'],
      undo.fingerprint,
      recovery(f.feature, saved),
    );
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('Latest');
    expect(await readFile(path.join(root, 'added.txt'), 'utf8')).toBe('Remove only this');
  });
  it('aborts before checkout changes if fingerprint is stale, callback fails or backup detects a new human edit', async () => {
    const f = await fixture(),
      root = await isolate(f),
      before = await capture(f);
    await writeFile(path.join(root, 'tracked.txt'), 'Changed');
    const preview = await f.manager.compare(f.feature, before.id);
    await writeFile(path.join(root, 'tracked.txt'), 'Changed after preview');
    const callback = vi.fn(async () => {});
    await expect(
      f.manager.restore(f.feature, before.id, ['tracked.txt'], preview.fingerprint, callback),
    ).rejects.toThrow(/obsolète/);
    expect(callback).not.toHaveBeenCalled();
    const fresh = await f.manager.compare(f.feature, before.id);
    await expect(
      f.manager.restore(f.feature, before.id, ['tracked.txt'], fresh.fingerprint, async () => {
        throw new Error('Persistence failed');
      }),
    ).rejects.toThrow(/Persistence failed/);
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('Changed after preview');
    await expect(
      f.manager.restore(
        f.feature,
        before.id,
        ['tracked.txt'],
        fresh.fingerprint,
        async (checkpoint) => {
          f.feature.checkpoints!.push(checkpoint);
          await writeFile(path.join(root, 'tracked.txt'), 'Human during backup');
        },
      ),
    ).rejects.toBeInstanceOf(WorkspaceRestoreError);
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('Human during backup');
  });
  it('refuses a symlink or hardlink appearing at the restore target', async () => {
    const f = await fixture(),
      root = await isolate(f),
      before = await capture(f),
      outside = path.join(f.root, 'outside');
    await writeFile(outside, 'Outside');
    await rm(path.join(root, 'tracked.txt'));
    await symlink(outside, path.join(root, 'tracked.txt'));
    let preview = await f.manager.compare(f.feature, before.id);
    expect(preview.files.find((file) => file.path === 'tracked.txt')?.restorable).toBe(false);
    await expect(
      f.manager.restore(f.feature, before.id, ['tracked.txt'], preview.fingerprint, async () => {}),
    ).rejects.toThrow(/non restaurable/);
    await rm(path.join(root, 'tracked.txt'));
    await link(outside, path.join(root, 'tracked.txt'));
    preview = await f.manager.compare(f.feature, before.id);
    expect(preview.files.find((file) => file.path === 'tracked.txt')?.restorable).toBe(false);
    expect(await readFile(outside, 'utf8')).toBe('Outside');
  });
  it('rechecks content after fsync of the temporary file and preserves a late human edit', async () => {
    const f = await fixture(),
      root = await isolate(f),
      before = await capture(f);
    await writeFile(path.join(root, 'tracked.txt'), 'Changed');
    const preview = await f.manager.compare(f.feature, before.id),
      saved: FeatureCheckpoint[] = [];
    restoreRace.afterTempSync = async () => {
      restoreRace.afterTempSync = undefined;
      await writeFile(path.join(root, 'tracked.txt'), 'Human edit after temp sync');
    };
    await expect(
      f.manager.restore(
        f.feature,
        before.id,
        ['tracked.txt'],
        preview.fingerprint,
        recovery(f.feature, saved),
      ),
    ).rejects.toThrow(/concurrente/);
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe(
      'Human edit after temp sync',
    );
    expect(saved).toHaveLength(1);
    expect((await readdir(root)).some((file) => file.endsWith('.tmp'))).toBe(false);
  });
});
