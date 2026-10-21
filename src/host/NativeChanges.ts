import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import type { RunInput } from '../shared/types';
import { gitInfo } from './ToolHost';

/** Observed working-tree differences, deliberately never used as file ownership. */
export async function nativeChangesSnapshot(input: RunInput): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const projects = input.projects?.length
    ? input.projects
    : [{ id: '', path: input.workspacePath }];
  let bytes = 0;
  for (const project of projects) {
    const files = (await gitInfo(project.path)).dirty;
    if (files.size > 2000) throw new Error('Observation Git limitée à 2 000 fichiers par projet.');
    for (const file of files) {
      const target = resolve(project.path, file),
        rel = relative(project.path, target);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) continue;
      const key = projects.length > 1 ? `@${project.id}/${file}` : file;
      try {
        const info = await lstat(target);
        if (info.isSymbolicLink()) snapshot.set(key, `link:${await readlink(target)}`);
        else if (info.isFile() && info.size <= 8_000_000 && bytes + info.size <= 64_000_000) {
          bytes += info.size;
          snapshot.set(
            key,
            createHash('sha256')
              .update(await readFile(target))
              .digest('hex'),
          );
        } else snapshot.set(key, `metadata:${info.size}:${info.mtimeMs}:${info.mode}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') snapshot.set(key, 'deleted');
        else throw error;
      }
    }
  }
  return snapshot;
}
export function observedNativeChanges(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  );
}
