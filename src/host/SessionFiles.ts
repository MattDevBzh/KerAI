import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';

export const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export const sessionDirectory = (id: string) => `sessions/${digest(id)}`;

/** Private storage paths never come from transcripts or caller-provided filesystem paths. */
export async function privateFile(root: string, fragment: string, create = false): Promise<string> {
  const base = resolve(root);
  await mkdir(base, { recursive: true, mode: 0o700 });
  if ((await lstat(base)).isSymbolicLink()) throw new Error('Stockage symbolique refusé.');
  const canonical = await realpath(base);
  const target = resolve(canonical, fragment);
  const rel = relative(canonical, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Chemin privé invalide.');
  let current = canonical;
  const parts = rel.split(/[\\/]/);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!stat && create && index < parts.length - 1) {
      await mkdir(current, { mode: 0o700 });
      stat = await lstat(current);
    }
    if (stat?.isSymbolicLink() || (stat?.isFile() && stat.nlink !== 1))
      throw new Error('Lien privé refusé.');
    if (stat && index < parts.length - 1 && !stat.isDirectory())
      throw new Error('Dossier privé invalide.');
  }
  return target;
}
export async function readPrivate(
  root: string,
  fragment: string,
  limit = 512 * 1024 * 1024,
): Promise<string> {
  const file = await privateFile(root, fragment);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit)
      throw new Error('Fichier privé invalide ou trop volumineux.');
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}
export async function writePrivate(root: string, fragment: string, text: string): Promise<void> {
  const target = await privateFile(root, fragment, true);
  const temporary = join(dirname(target), `.write-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await privateFile(root, fragment);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
export async function removePrivate(root: string, fragment: string): Promise<void> {
  const target = await privateFile(root, fragment);
  // rm removes directory entries rather than following links inside the tree.
  await rm(target, { recursive: true, force: true });
}
