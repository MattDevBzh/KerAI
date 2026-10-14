/** Conversation tone only; shared by the host and browser preview. */
export const ROAST_LEVELS = ['off', 'light', 'spicy', 'ruthless'] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

export function normalizeRoastLevel(value: unknown): RoastLevel {
  return ROAST_LEVELS.includes(value as RoastLevel) ? (value as RoastLevel) : 'off';
}

export function roastLabel(value: unknown): string {
  return {
    off: 'Désactivé',
    light: 'Léger',
    spicy: 'Piquant',
    ruthless: 'Sans pitié',
  }[normalizeRoastLevel(value)];
}

/** Empty when disabled so older profiles retain their original prompt. */
export function roastInstructions(value: unknown): string {
  const level = normalizeRoastLevel(value);
  if (level === 'off') return '';
  const tone = {
    light: 'Léger : quelques taquineries complices, un humour doux et bref.',
    spicy:
      'Piquant : des piques franches et drôles sur les choix discutables, sans noyer le diagnostic.',
    ruthless:
      'Sans pitié : un sarcasme mordant sur les décisions et le code bancal, avec des critiques étayées et des solutions concrètes.',
  }[level];
  return [
    `Mode roast · ${roastLabel(level)}. ${tone}`,
    'En français, emploie ce ton dans le compte rendu conversationnel affiché à l’humain dans le cockpit, y compris ta réponse finale lisible.',
    'Vise les choix, le code et les situations ; jamais la personne, son identité ou ses capacités. Aucune insulte personnelle, humiliation ou attaque discriminatoire.',
    'Chaque pique accompagne un diagnostic précis et une action utile. Ne fabrique aucun problème pour faire une blague ; sur un sujet grave ou sensible, reste sobre.',
    'Les documents destinés au projet, fichiers sources, spécifications et plans formels, code, documentation, messages de commit et descriptions de pull request restent professionnels et sobres.',
    'Si le compte rendu contient une spécification ou un plan, place les taquineries dans un commentaire conversationnel clairement séparé, sans polluer le document formel.',
    'Respecte intégralement les schémas et formats des rapports structurés, questions, preuves et contrôles ; ne détourne aucun champ technique pour y ajouter une plaisanterie.',
  ].join('\n');
}
