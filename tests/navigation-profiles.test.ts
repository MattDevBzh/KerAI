import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareBrowserProfile } from '../src/host/navigation/BrowserProfiles';

describe('local browser profiles', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'kerai-profile-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const identity: [string, string, string] = ['application', 'https://private.invalid', 'reader'];

  it('keeps the existing profile and its cookies when moving to the shorter local root', async () => {
    const storage = path.join(root, 'old', 'deep', 'storage');
    const legacy = await prepareBrowserProfile(storage, identity);
    await writeFile(path.join(legacy, 'Cookies'), 'fixture-login');
    const migrated = await prepareBrowserProfile(storage, identity, path.join(root, 'profiles'));
    expect(await readFile(path.join(migrated, 'Cookies'), 'utf8')).toBe('fixture-login');
    await expect(readFile(path.join(legacy, 'Cookies'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await prepareBrowserProfile(storage, identity, path.join(root, 'profiles'))).toBe(
      migrated,
    );
  });

  it('isolates projects, applications, origins and roles without leaking their names', async () => {
    const profiles = path.join(root, 'profiles');
    const paths = await Promise.all([
      prepareBrowserProfile(path.join(root, 'project-a'), identity, profiles),
      prepareBrowserProfile(path.join(root, 'project-b'), identity, profiles),
      prepareBrowserProfile(
        path.join(root, 'project-a'),
        ['another', identity[1], identity[2]],
        profiles,
      ),
      prepareBrowserProfile(
        path.join(root, 'project-a'),
        [identity[0], 'https://other.invalid', identity[2]],
        profiles,
      ),
      prepareBrowserProfile(
        path.join(root, 'project-a'),
        [identity[0], identity[1], 'admin'],
        profiles,
      ),
    ]);
    expect(new Set(paths).size).toBe(5);
    for (const profile of paths) {
      expect(path.dirname(profile)).toBe(profiles);
      expect(path.basename(profile)).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('preserves both profiles if the local profile already exists', async () => {
    const storage = path.join(root, 'storage');
    const local = await prepareBrowserProfile(storage, identity, path.join(root, 'profiles'));
    const legacy = await prepareBrowserProfile(storage, identity);
    await writeFile(path.join(local, 'Cookies'), 'new-login');
    await writeFile(path.join(legacy, 'Cookies'), 'old-login');
    expect(await prepareBrowserProfile(storage, identity, path.join(root, 'profiles'))).toBe(local);
    expect(await readFile(path.join(local, 'Cookies'), 'utf8')).toBe('new-login');
    expect(await readFile(path.join(legacy, 'Cookies'), 'utf8')).toBe('old-login');
  });

  it('rejects a redirected profile without changing the original', async () => {
    const storage = path.join(root, 'storage');
    const local = await prepareBrowserProfile(storage, identity, path.join(root, 'profiles'));
    await rm(local, { recursive: true });
    const target = path.join(root, 'unrelated');
    await mkdir(target);
    await writeFile(path.join(target, 'Cookies'), 'untouched');
    await symlink(target, local, 'junction');
    await expect(
      prepareBrowserProfile(storage, identity, path.join(root, 'profiles')),
    ).rejects.toThrow('sans lien symbolique');
    expect(await readFile(path.join(target, 'Cookies'), 'utf8')).toBe('untouched');
  });
});
