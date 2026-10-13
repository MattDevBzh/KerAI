import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';
import { canonicalCaseless } from './UnicodeCaseFold';

const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const sameEntry = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino;
export type FileEquivalence = 'same' | 'different' | 'uncertain';

async function statIfPresent(file: string): Promise<Stats | undefined> {
  try {
    return await lstat(file);
  } catch (error) {
    if (!absent(error)) throw error;
  }
}
async function existingParent(
  file: string,
): Promise<{ directory: string; rest: string; stat: Stats }> {
  let directory = path.dirname(file);
  const parts = [path.basename(file)];
  for (;;) {
    const stat = await statIfPresent(directory);
    if (stat) return { directory: await realpath(directory), rest: parts.join('/'), stat };
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Parent du fichier indisponible.');
    parts.unshift(path.basename(directory));
    directory = parent;
  }
}

/** Probe the containing directory, never infer its behavior from another volume. */
async function directoryIgnoresCase(directory: string): Promise<boolean | undefined> {
  const names = await readdir(directory);
  for (const name of names) {
    const alias = name.replace(/[a-zA-Z]/, (letter) =>
      letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase(),
    );
    if (
      alias.normalize('NFD') === name.normalize('NFD') ||
      canonicalCaseless(alias) !== canonicalCaseless(name)
    )
      continue;
    const original = await statIfPresent(path.join(directory, name));
    if (!original || original.isSymbolicLink() || (!original.isDirectory() && original.nlink > 1))
      continue;
    const alternate = await statIfPresent(path.join(directory, alias));
    if (!alternate) return false;
    if (sameEntry(original, alternate) && !names.includes(alias)) return true;
    if (!sameEntry(original, alternate)) return false;
  }
  // Empty/unprobeable directories stay unknown: Windows and Linux can vary per directory.
  return undefined;
}

/** Existing distinct files stay distinct, even if Unicode would fold their names together. */
export async function equivalentWorkspaceFiles(
  root: string,
  left: string,
  right: string,
): Promise<FileEquivalence> {
  left = path.posix.normalize(left);
  right = path.posix.normalize(right);
  if (left === right) return 'same';
  if (canonicalCaseless(left) !== canonicalCaseless(right)) return 'different';
  const [a, b] = [path.resolve(root, left), path.resolve(root, right)];
  const [leftFile, rightFile] = await Promise.all([statIfPresent(a), statIfPresent(b)]);
  if (leftFile && rightFile) return sameEntry(leftFile, rightFile) ? 'same' : 'different';
  if (leftFile || rightFile) return 'different';
  const [leftParent, rightParent] = await Promise.all([existingParent(a), existingParent(b)]);
  if (!sameEntry(leftParent.stat, rightParent.stat)) return 'different';
  if (leftParent.rest === rightParent.rest) return 'same';
  const insensitive = await directoryIgnoresCase(leftParent.directory);
  if (insensitive === true) return 'same';
  // Canonical spelling aliases may be normalization-insensitive even on a case-sensitive volume.
  if (leftParent.rest.normalize('NFD') === rightParent.rest.normalize('NFD')) return 'uncertain';
  return insensitive === false ? 'different' : 'uncertain';
}
