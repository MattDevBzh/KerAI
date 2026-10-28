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
