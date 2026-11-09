import { redact } from './process';

export function deliveryGitError(args: string[], result: { code: number; stderr: string }) {
  const operation =
    args.find((arg) =>
      [
        'commit-tree',
        'update-ref',
        'write-tree',
        'read-tree',
        'add',
        'push',
        'fetch',
        'check-ref-format',
        'rev-parse',
        'status',
        'diff',
        'ls-files',
        'remote',
      ].includes(arg),
    ) ?? 'Git';
  const detail = redact(
    result.stderr
      .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[identifiants masqués]@')
      .replace(/(authorization\s*[:=]\s*)(?:Basic|Bearer)\s+[^\s]+/gi, '$1[secret masqué]'),
  )
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 2000);
  const hint = /author identity unknown|unable to auto-detect email|empty ident name/i.test(
    result.stderr,
  )
    ? 'Ton nom et ton adresse e-mail Git ne sont pas configurés. Renseigne user.name et user.email dans ce dépôt puis valide à nouveau le commit.'
    : /index\.lock|another git process|cannot lock ref/i.test(result.stderr)
      ? 'Git est verrouillé par une autre opération. Termine les opérations Git en cours puis actualise ; si le verrou persiste, vérifie-le dans ton outil Git.'
      : /authentication failed|permission denied|could not read username|terminal prompts disabled|logon failed/i.test(
            result.stderr,
          )
        ? 'Git ne parvient pas à s’authentifier. Vérifie la connexion HTTPS ou la clé SSH dans ton outil Git ; la connexion Azure DevOps de KerAI ne connecte pas automatiquement Git.'
        : /non-fast-forward|fetch first|\[rejected\]/i.test(result.stderr)
          ? 'La branche distante contient des changements absents localement. Récupère-les et intègre-les dans ton outil Git, puis prépare un nouveau push.'
          : /dubious ownership|safe\.directory/i.test(result.stderr)
            ? 'Git refuse l’accès à ce dépôt à cause de son propriétaire. Vérifie le dossier et son autorisation dans ton outil Git.'
            : operation === 'check-ref-format'
              ? 'Le nom de branche est invalide. Utilise un nom sans espace ni caractères spéciaux Git.'
              : 'L’opération Git a échoué. Corrige la cause indiquée puis réessaie.';
  return new Error(
    `${hint}\nÉtape : ${operation} (code ${result.code}).${detail ? `\nDétail Git : ${detail}` : ''}`,
  );
}
