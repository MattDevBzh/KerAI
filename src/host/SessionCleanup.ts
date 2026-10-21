import { allFeatures } from '../shared/subplans';
import { readdir, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Feature } from '../shared/types';
import {
  digest,
  sessionDirectory,
  privateFile,
  readPrivate,
  writePrivate,
  removePrivate,
} from './SessionFiles';

const deletionItemSchema = z
  .object({
    featureId: z.string(),
    attempts: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)),
    checkpoints: z.array(z.string().uuid()),
    sessionIds: z.array(z.string()),
    quality: z.array(z.string().regex(/^[a-f0-9]{64}\.(png|jpg|zip)$/)),
  })
  .strict();
const deletionSchema = deletionItemSchema.extend({
  children: z.array(deletionItemSchema).optional(),
});
export type SessionDeletion = z.infer<typeof deletionSchema>;
const qualityPaths = (feature: Feature) =>
  feature.steps.flatMap((s) =>
    s.attempts.flatMap((a) =>
      (a.evidence ?? []).flatMap((e) =>
        (e.quality?.attachments ?? []).map(
          (p) =>
            `${p.sha256}${p.mime === 'image/png' ? '.png' : p.mime === 'image/jpeg' ? '.jpg' : '.zip'}`,
        ),
      ),
    ),
  );
export function deletionRecord(feature: Feature): SessionDeletion {
  return deletionSchema.parse({
    featureId: feature.id,
    attempts: feature.steps.flatMap((s) => s.attempts.map((a) => a.id)),
    checkpoints: (feature.checkpoints ?? []).map((p) => p.id),
    sessionIds: [
      ...new Set([
        ...feature.steps.flatMap((s) =>
          s.attempts.flatMap((a) => [
            ...(a.sessionId ? [a.sessionId] : []),
            ...(a.pair?.sessionIds ?? []),
          ]),
        ),
        ...(feature.observations ?? []).flatMap((r) =>
          r.calls.flatMap((c) => (c.sessionId ? [c.sessionId] : [])),
        ),
      ]),
    ],
    quality: [...new Set(qualityPaths(feature))],
  });
}
export async function pendingDeletions(root: string): Promise<SessionDeletion[]> {
  const path = await privateFile(root, 'deletions/placeholder');
  const entries = await readdir(dirname(path)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const records: SessionDeletion[] = [];
  for (const name of entries)
    if (/^[a-f0-9]{64}\.json$/.test(name)) {
      const record = deletionSchema.parse(
        JSON.parse(await readPrivate(root, `deletions/${name}`, 8 * 1024 * 1024)),
      );
      if (`${digest(record.featureId)}.json` !== name)
        throw new Error('Suppression enregistrée incohérente.');
      records.push(...(record.children ?? []), record);
    }
  return records;
}
export async function markDeletion(root: string, feature: Feature): Promise<void> {
  // One durable tombstone owns the entire tree; the root is removed after its children.
  const [record, ...children] = allFeatures([feature]).map(deletionRecord);
  await writePrivate(
    root,
    `deletions/${digest(feature.id)}.json`,
    JSON.stringify({ ...record, ...(children.length ? { children } : {}) }),
  );
}
export async function cleanSessionFiles(
  root: string,
  record: SessionDeletion,
  survivors: Feature[],
): Promise<void> {
  await removePrivate(root, sessionDirectory(record.featureId));
  for (const id of record.attempts) await removePrivate(root, `existing-changes/${id}`);
  const retained = new Set(allFeatures(survivors).flatMap(qualityPaths));
  const qualityDirectory = dirname(await privateFile(root, 'quality/placeholder'));
  const files = await readdir(qualityDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  // Evidence media is copied before its reference is persisted: also collect crash orphans.
  for (const file of files)
    if (/^[a-f0-9]{64}\.(png|jpg|zip)$/.test(file) && !retained.has(file))
      await removePrivate(root, `quality/${file}`);
}
export const finishDeletion = (root: string, featureId: string) =>
  removePrivate(root, `deletions/${digest(featureId)}.json`);
export async function privateSize(root: string, fragment: string): Promise<number> {
  const file = await privateFile(root, fragment);
  const walk = async (path: string): Promise<number> => {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!stat) return 0;
    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) {
      if (stat.nlink !== 1) return 0;
      return stat.size;
    }
    if (!stat.isDirectory()) throw new Error('Objet privé irrégulier.');
    let size = 0;
    for (const name of await readdir(path)) size += await walk(join(path, name));
    return size;
  };
  return walk(file);
}
