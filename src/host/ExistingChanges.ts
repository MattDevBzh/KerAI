import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { RunInput, RunPreview } from '../shared/types';
import { safePath } from '../core/registry';
import { isSensitivePath, PolicyEngine, sha256 } from './PolicyEngine';
import { MAX_TEXT_BYTES, readTextFile } from './textFiles';

const MAX_SELECTED_BYTES = 32 * 1024 * 1024;
const canEdit = (input: RunInput) =>
  input.step.policy !== 'read-only' &&
  input.agent.tools.some((tool) =>
    ['edit', 'write', 'studio_write_file', 'studio_replace_text'].includes(tool),
  );

/** Only the host sets grants. Listing a path or putting it in a model prompt grants nothing. */
export async function inspectExistingChanges(
  input: RunInput,
  dirty: Set<string>,
): Promise<NonNullable<RunPreview['existingChanges']>> {
  const selected = input.launch?.editableExistingFiles ?? [];
  if (selected.length && !canEdit(input))
    throw new Error('Cet agent ne peut pas reprendre des modifications : édition non autorisée.');
  input.existingChangeGrants = {};
  if (!canEdit(input)) return { files: [], omittedCount: 0 };
  for (const file of selected)
    if (posix.normalize(file) !== file || !dirty.has(file))
      throw new Error(
        `Le fichier sélectionné n’est plus une modification locale : ${file}. Actualise la sélection.`,
      );
  const paths = [...new Set([...selected, ...[...dirty].sort()])].filter(
    (file) => !isSensitivePath(file),
  );
  const policy = new PolicyEngine(input.workspacePath, input.step.policy, input.settings.testPaths);
  const files: NonNullable<RunPreview['existingChanges']>['files'] = [];
  let selectedBytes = 0;
  // Selected paths are checked even when the inventory is capped.
  for (const file of paths.slice(0, 250)) {
    let reason: string | undefined;
    try {
      const target = await policy.resolve(file, true);
      const stat = await lstat(target);
      if (!stat.isFile()) throw new Error('Un fichier régulier est requis.');
      if (stat.size > MAX_TEXT_BYTES) throw new Error('Fichier trop volumineux : limite de 4 Mio.');
      if (selected.includes(file)) {
        const content = await readTextFile(target, new AbortController().signal);
        selectedBytes += content.bytes.length;
        if (selectedBytes > MAX_SELECTED_BYTES)
          throw new Error('Sélection limitée à 32 Mio par tentative.');
        input.existingChangeGrants[file] = sha256(content.bytes);
      }
    } catch (error) {
      reason =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'Fichier supprimé : recréation non autorisée.'
          : (error as Error).message;
      if (selected.includes(file)) throw new Error(`${file} : ${reason}`);
    }
    files.push({ path: file, ...(reason ? { reason } : {}) });
  }
  if (selected.some((file) => !Object.hasOwn(input.existingChangeGrants!, file)))
    throw new Error('Un fichier sélectionné est exclu du périmètre d’édition.');
  return { files, omittedCount: dirty.size - files.length };
}

/** Copy and verify the approved bytes before hooks or model tools can write. */
export async function backupExistingChanges(
  input: RunInput,
  storageRoot: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const entries = Object.entries(input.existingChangeGrants ?? {});
  if (!entries.length) return undefined;
  const directory = await safePath(storageRoot, `existing-changes/${input.attempt.id}`);
  await mkdir(directory, { recursive: true });
  const policy = new PolicyEngine(input.workspacePath, input.step.policy, input.settings.testPaths);
  const files: { path: string; sha256: string; backup: string; mode: number }[] = [];
  for (const [file, hash] of entries) {
    signal.throwIfAborted();
    const content = await readTextFile(await policy.resolve(file, true), signal);
    if (sha256(content.bytes) !== hash)
      throw new Error(`${file} a changé depuis l’autorisation. Prépare un nouvel aperçu.`);
    const backup = `${files.length}.bin`;
    const target = await safePath(storageRoot, `existing-changes/${input.attempt.id}/${backup}`);
    const handle = await open(target, 'wx', 0o600);
    try {
      await handle.writeFile(content.bytes, { signal });
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (sha256(await readFile(target)) !== hash)
      throw new Error('Vérification de sauvegarde impossible.');
    files.push({ path: file, sha256: hash, backup, mode: content.mode & 0o777 });
  }
  const manifest = await open(join(directory, 'manifest.json'), 'wx', 0o600);
  try {
    await manifest.writeFile(
      JSON.stringify(
        {
          workspace: input.workspacePath,
          attemptId: input.attempt.id,
          createdAt: new Date().toISOString(),
          files,
        },
        null,
        2,
      ),
      'utf8',
    );
    await manifest.sync();
  } finally {
    await manifest.close();
  }
  return directory;
}
