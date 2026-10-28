/** Routes to the actual project catalogue; selecting one never starts an agent. */
export const sessionStarters = [
  {
    id: 'bugfix',
    label: 'Corriger un problème',
    description: 'Diagnostiquer, corriger, tester et relire.',
  },
  {
    id: 'feature',
    label: 'Développer une évolution',
    description: 'Clarifier le besoin, préparer le plan, développer, tester et relire.',
  },
  {
    id: 'code-review',
    label: 'Relire des changements',
    description: 'Une relecture indépendante des modifications existantes.',
  },
  {
    id: 'custom',
    label: 'Composer mon équipe',
    description: 'Créer une session vide et choisir les interventions sur sa fiche.',
  },
] as const;

export type SessionStarterId = (typeof sessionStarters)[number]['id'];
