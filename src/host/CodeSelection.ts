import { realpath, readFile, stat } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { CodeSelection } from '../shared/codeSelection';
export async function selectionContext(selection: CodeSelection, roots: string[]): Promise<string> {
  const actual = await realpath(selection.path);
  const allowed = await Promise.all(roots.map((root) => realpath(root)));
  if (
    !allowed.some((root) => {
      const rel = relative(root, actual);
      return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
    })
  )
    throw Error('La sélection appartient à un autre projet.');
  if ((await stat(actual)).size > 5_000_000)
    throw Error('La sélection provient d’un fichier trop volumineux.');
  const content = await readFile(actual, 'utf8');
  const changed = createHash('sha256').update(content).digest('hex') !== selection.hash;
  return `Extrait sélectionné : ${actual}:${selection.startLine}-${selection.endLine}\n${changed ? 'ATTENTION : le fichier a changé depuis cette sélection. Vérifie sa version actuelle avant toute modification.' : 'Référence vérifiée au moment de l’envoi.'}\n${selection.text}`;
}
