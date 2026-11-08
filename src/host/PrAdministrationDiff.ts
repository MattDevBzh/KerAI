import { createHash } from 'node:crypto';
import { isSensitivePath } from './PolicyEngine';
import { redact } from './process';
import type { DeliveryService } from './DeliveryService';
import type { PrAdminSnapshot, PrDiffBlock } from '../shared/prAdministration';
export const prHash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Host selects real hunk coordinates; the model only refers to these opaque block IDs. */
export async function prAdministrationDiff(
  delivery: Pick<DeliveryService, 'run'>,
  snapshot: PrAdminSnapshot,
  changes: { item: { path: string }; changeTrackingId: number; originalPath?: string }[],
) {
  const blocks: PrDiffBlock[] = [],
    warnings: string[] = [];
  let size = 0;
  for (const change of changes.slice(0, 400)) {
    const file = change.item.path.replace(/^\//, '');
    if (change.originalPath && change.originalPath.replace(/^\//, '') !== file) {
      warnings.push(
        `${file} : renommage exclu des annotations automatiques ; relis ce fichier dans Azure.`,
      );
      continue;
    }
    if (
      !file ||
      /[\x00-\x1f\\]/.test(file) ||
      file.split('/').some((p) => p === '..' || p === '.') ||
      isSensitivePath(file) ||
      isSensitivePath(change.originalPath ?? '')
    ) {
      warnings.push('Un fichier sensible ou non pris en charge est exclu.');
      continue;
    }
    const occurrences = new Map<string, number>();
    const result = await delivery.run([
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--no-color',
      '--unified=0',
      `${snapshot.baseHead}..${snapshot.sourceHead}`,
      '--',
      file,
    ]);
    if (result.code !== 0)
      throw new Error(
        'Le diff commité de la PR est indisponible. Récupère son historique dans ton outil Git.',
      );
    const hunks = [
      ...result.stdout.matchAll(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n([\s\S]*?)(?=^@@ |$(?![\s\S]))/gm,
      ),
    ];
    if (!hunks.length) {
      warnings.push(
        `${file} : aucun bloc textuel annotable (fichier binaire, renommage ou changement de mode).`,
      );
      continue;
    }
    for (const hunk of hunks) {
      const rightCount = Number(hunk[4] ?? 1),
        leftCount = Number(hunk[2] ?? 1),
        side = rightCount ? 'right' : 'left';
      const startLine = Number(side === 'right' ? hunk[3] : hunk[1]),
        count = side === 'right' ? rightCount : leftCount;
      if (!count) continue;
      if (blocks.length >= 100 || size + hunk[0].length > 100_000) {
        warnings.push(
          'Comparaison partielle : limite de 100 blocs ou 100 000 caractères atteinte.',
        );
        return { blocks, warnings };
      }
      size += hunk[0].length;
      const occurrence = occurrences.get(hunk[5]) ?? 0;
      occurrences.set(hunk[5], occurrence + 1);
      blocks.push({
        id: prHash(`${file}:${side}:${startLine}:${snapshot.sourceHead}`),
        stableKey: prHash(`${change.changeTrackingId}:${side}:${hunk[5]}:${occurrence}`),
        path: file,
        side,
        startLine,
        endLine: startLine + count - 1,
        changeTrackingId: change.changeTrackingId,
        code: redact(hunk[0]),
      });
    }
  }
  if (changes.length > 400) warnings.push('Comparaison limitée aux 400 premiers fichiers.');
  return { blocks, warnings: [...new Set(warnings)] };
}
