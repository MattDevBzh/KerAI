import { open } from 'node:fs/promises';

// Match the per-file checkpoint limit so edited files remain restorable.
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;
export const MAX_READ_BYTES = 64_000;

/** Bound host memory as well as model output, and never silently repair invalid UTF-8. */
export async function readTextFile(target: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const handle = await open(target, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Fichier non régulier.');
    if (stat.size > MAX_TEXT_BYTES) throw new Error('Fichier trop volumineux : limite de 4 Mio.');
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_TEXT_BYTES + 1 - size));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_TEXT_BYTES) throw new Error('Fichier trop volumineux : limite de 4 Mio.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const bytes = Buffer.concat(chunks, size);
    if (bytes.includes(0)) throw new Error('Fichier binaire non pris en charge.');
    let text: string;
    try {
      // ignoreBOM retains the BOM in the decoded string, so patches preserve original bytes.
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error('Le fichier doit être un texte UTF-8 valide.');
    }
    return { bytes, text, mode: stat.mode };
  } finally {
    await handle.close();
  }
}

export function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === '\n' && i + 1 < text.length) offsets.push(i + 1);
  return offsets;
}

export function textPage(text: string, startLine?: number, endLine?: number) {
  const offsets = lineOffsets(text);
  const start = startLine ?? 1;
  if (start > offsets.length) throw new Error(`Le fichier contient ${offsets.length} lignes.`);
  const whole =
    startLine === undefined && endLine === undefined && Buffer.byteLength(text) <= MAX_READ_BYTES;
  const requestedEnd = endLine ?? (whole ? offsets.length : start + 199);
  if (requestedEnd < start || (!whole && requestedEnd - start >= 2000))
    throw new Error('Plage de lignes invalide : 2 000 lignes maximum par lecture.');
  const from = offsets[start - 1];
  let to = from;
  let end = start - 1;
  let bytes = 0;
  for (let line = start; line <= Math.min(requestedEnd, offsets.length); line++) {
    const next = offsets[line] ?? text.length;
    const size = Buffer.byteLength(text.slice(to, next));
    if (bytes + size > MAX_READ_BYTES) break;
    bytes += size;
    to = next;
    end = line;
  }
  if (end < start)
    throw new Error(
      'Une ligne dépasse 64 000 octets ; lecture par lignes impossible sans tronquer le contenu.',
    );
  return {
    content: text.slice(from, to),
    startLine: start,
    endLine: end,
    totalLines: offsets.length,
    truncated: from !== 0 || to !== text.length,
    nextStartLine: end < offsets.length ? end + 1 : undefined,
    from,
    to,
  };
}
