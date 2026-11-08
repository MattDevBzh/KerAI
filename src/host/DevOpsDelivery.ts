import { isSensitivePath } from './PolicyEngine';
import { redact } from './process';
import type { DeliveryService } from './DeliveryService';
/** Inspect committed PR changes only, with external diff drivers and text conversion disabled. */
export async function pullRequestDiff(
  delivery: Pick<DeliveryService, 'run'>,
  target: string,
  head: string,
) {
  if (![target, head].every((commit) => /^[a-f0-9]{40}$/i.test(commit)))
    throw new Error('Référence de commit invalide pour le diff de PR.');
  const result = await delivery.run([
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    `${target}...${head}`,
    '--',
  ]);
  if (result.code !== 0)
    return {
      diff: 'Diff de PR indisponible : le commit cible ou son historique n’est pas présent localement. Récupérez la branche cible dans Git et préparez un nouvel aperçu, ou relisez la comparaison dans Azure DevOps.',
      diffTruncated: false,
    };
  return {
    diff:
      result.stdout.slice(0, 100_000) ||
      'Aucun changement entre le point commun avec la cible et ce commit.',
    diffTruncated: result.stdout.length > 100_000,
  };
}

/** Only committed non-sensitive paths are supplied to the prose-only PR writer. */
export async function pullRequestWritingDiff(
  delivery: Pick<DeliveryService, 'run'>,
  target: string,
  head: string,
) {
  if (![target, head].every((commit) => /^[a-f0-9]{40}$/i.test(commit)))
    throw new Error('Référence de commit invalide.');
  const range = `${target}...${head}`;
  const names = await delivery.run([
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--name-only',
    '-z',
    range,
    '--',
  ]);
  if (names.code !== 0)
    throw new Error(
      'Comparaison indisponible. Récupère la branche cible et son historique dans ton outil Git, puis relance la rédaction.',
    );
  const paths = names.stdout.split('\0').filter(Boolean);
  if (!paths.length) throw new Error('Aucun changement à décrire par rapport à la branche cible.');
  const visible = paths.filter((file) => !isSensitivePath(file));
  const selected = visible.slice(0, 400);
  if (!selected.length)
    throw new Error(
      'Tous les fichiers du diff sont exclus de la rédaction automatique. Rédige la PR manuellement après vérification dans Git.',
    );
  const result = await delivery.run([
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    range,
    '--',
    ...selected,
  ]);
  if (result.code !== 0) throw new Error('Le diff de la PR est indisponible.');
  const partial = paths.length !== selected.length || result.stdout.length > 100_000;
  return `${partial ? 'COMPARAISON PARTIELLE : fichiers sensibles exclus ou limite de taille atteinte. Mentionne cette limite dans la description.\n' : ''}${redact(result.stdout.slice(0, 100_000))}`;
}
