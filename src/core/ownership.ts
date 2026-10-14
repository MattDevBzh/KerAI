import type { Feature } from '../shared/types';

/** Current owned contents, not the hashes of every historical write. */
export function currentOwnedFileHashes(
  feature: Feature,
  paths?: ReadonlySet<string>,
): Record<string, string> {
  const authoritative = feature.workspaceFileHashes ?? {};
  const latest = new Map<
    string,
    { hash: string; finished: number; started: number; ambiguous: boolean }
  >();
  for (const step of feature.steps)
    for (const attempt of step.attempts)
      for (const [file, hash] of Object.entries(attempt.fileHashes ?? {})) {
        if (paths && !paths.has(file)) continue;
        if (Object.hasOwn(authoritative, file)) continue;
        const started = Date.parse(attempt.startedAt);
        const finished = Date.parse(attempt.finishedAt ?? attempt.startedAt);
        const timestamp = Number.isFinite(finished) ? finished : started;
        if (!Number.isFinite(timestamp) || !Number.isFinite(started))
          throw new Error(
            `Historique d’écriture non daté pour ${file}. Relance son étape avant validation.`,
          );
        const previous = latest.get(file);
        if (
          !previous ||
          timestamp > previous.finished ||
          (timestamp === previous.finished && started > previous.started)
        )
          latest.set(file, { hash, finished: timestamp, started, ambiguous: false });
        else if (
          timestamp === previous.finished &&
          started === previous.started &&
          previous.hash !== hash
        )
          previous.ambiguous = true;
      }
  const hashes: Record<string, string> = { ...authoritative };
  for (const [file, version] of latest) {
    if (version.ambiguous)
      throw new Error(
        `Historique d’écriture ambigu pour ${file}. Relance son étape avant validation.`,
      );
    hashes[file] = version.hash;
  }
  return hashes;
}
