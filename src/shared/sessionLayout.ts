export const SESSION_MODULE_IDS = [
  'summary',
  'work',
  'devops',
  'ticket',
  'workspace',
  'skipped',
  'autopilot',
  'team',
] as const;
export type SessionModuleId = (typeof SESSION_MODULE_IDS)[number];
export interface SessionLayoutPreference {
  order: SessionModuleId[];
  hidden: SessionModuleId[];
}
export const SESSION_MODULES: Record<SessionModuleId, { title: string; description: string }> = {
  summary: {
    title: 'Bilan et validation finale',
    description: 'Disponible lorsque toutes les étapes sont terminées ou passées.',
  },
  work: {
    title: 'Détail de l’étape',
    description: 'Conversation, livrable, tentatives et actions de l’agent sélectionné.',
  },
  devops: {
    title: 'Liens Azure DevOps',
    description: 'Les éléments Azure DevOps associés à cette session.',
  },
  ticket: {
    title: 'Ticket d’origine',
    description: 'Le ticket à partir duquel la session a été créée, lorsqu’il existe.',
  },
  workspace: {
    title: 'Projet, Git et outils',
    description: 'Espace de travail, restauration, analyse et outils de la session.',
  },
  skipped: {
    title: 'Interventions passées',
    description: 'Le récapitulatif des étapes facultatives que tu as passées.',
  },
  autopilot: {
    title: 'Autopilote et budget',
    description: 'Enchaînement des étapes, réponses automatiques et consommation.',
  },
  team: {
    title: 'Équipe et parcours',
    description: 'Composition de l’équipe, sélection des agents et QG vivant.',
  },
};
const isModule = (value: unknown): value is SessionModuleId =>
  typeof value === 'string' && (SESSION_MODULE_IDS as readonly string[]).includes(value);

/** Append newly introduced modules and recover gracefully from obsolete personal settings. */
export function normalizeSessionLayout(value: unknown): SessionLayoutPreference {
  const candidate =
    value && typeof value === 'object' ? (value as Partial<SessionLayoutPreference>) : {};
  const order = Array.isArray(candidate.order) ? candidate.order.filter(isModule) : [];
  const hidden = Array.isArray(candidate.hidden) ? candidate.hidden.filter(isModule) : [];
  return { order: [...new Set([...order, ...SESSION_MODULE_IDS])], hidden: [...new Set(hidden)] };
}
