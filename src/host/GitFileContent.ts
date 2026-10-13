import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { gitRead } from './gitRead';
import { MAX_TEXT_BYTES } from './textFiles';

async function canonicalPath(file: string): Promise<string> {
  let current = path.resolve(file);
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** Undefined means a confirmed absent HEAD/blob. Errors never become an empty diff baseline. */
export async function readHeadFile(
  workspace: string,
  absolute: string,
  maxBytes = MAX_TEXT_BYTES,
): Promise<string | undefined> {
  const top = await gitRead(workspace, ['rev-parse', '--show-toplevel'], {
    rawOutput: true,
    timeoutMs: 10000,
  });
  if (top.code !== 0 || top.truncated) throw new Error('Racine Git indisponible pour le diff.');
  const root = await realpath(top.stdout.replace(/\r?\n$/, ''));
  const relative = path
    .relative(root, await canonicalPath(absolute))
    .split(path.sep)
    .join('/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative))
    throw new Error('Le fichier du diff doit être dans le dépôt Git.');
  const head = await gitRead(root, ['rev-parse', '--verify', 'HEAD^{commit}'], {
    rawOutput: true,
    timeoutMs: 10000,
  });
  if (head.truncated) throw new Error('Identité HEAD tronquée.');
  if (head.code !== 0) {
    const symbolic = await gitRead(root, ['symbolic-ref', '--quiet', 'HEAD'], { rawOutput: true });
    if (symbolic.code === 0 && !symbolic.truncated) {
      const ref = symbolic.stdout.replace(/\r?\n$/, '');
      const exists = await gitRead(root, ['show-ref', '--verify', '--quiet', ref]);
      if (exists.code === 1 && !exists.truncated) return undefined;
    }
    throw new Error('Impossible de lire HEAD pour le diff.');
  }
  const commit = head.stdout.trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Identité HEAD invalide.');
  const tree = await gitRead(root, ['ls-tree', '-z', commit, '--', `:(literal)${relative}`], {
    rawOutput: true,
    timeoutMs: 10000,
    maxBytes: 16000,
  });
  if (tree.code !== 0 || tree.truncated) throw new Error('Inventaire HEAD incomplet pour le diff.');
  if (!tree.stdout) return undefined;
  const entry = /^(\d+) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/.exec(tree.stdout);
  if (!entry || entry[3] !== relative || entry[1] === '120000')
    throw new Error('Le fichier HEAD du diff doit être un fichier régulier.');
  const object = entry[2];
  const sizeResult = await gitRead(root, ['cat-file', '-s', object], { rawOutput: true });
  if (sizeResult.code !== 0 || sizeResult.truncated || !/^\d+\s*$/.test(sizeResult.stdout))
    throw new Error('Taille du fichier HEAD indisponible.');
  const size = Number(sizeResult.stdout.trim());
  if (!Number.isSafeInteger(size) || size > maxBytes)
    throw new Error(`Fichier HEAD trop volumineux pour le diff : limite de ${maxBytes} octets.`);
  const content = await gitRead(root, ['cat-file', 'blob', object], {
    rawOutput: true,
    timeoutMs: 10000,
    maxBytes: maxBytes + 1,
  });
  if (content.code !== 0 || content.truncated || Buffer.byteLength(content.stdout) !== size)
    throw new Error('Lecture HEAD incomplète ou tronquée : diff refusé.');
  return content.stdout;
}
