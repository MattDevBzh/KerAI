export const THEME_IDS = [
  'auto',
  'jardin-clair',
  'jardin-sombre',
  'papier-clair',
  'papier-sombre',
  'guilde-clair',
  'guilde-sombre',
  'halloween',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeDefinition {
  name: string;
  kind: string;
  description: string;
  family: 'native' | 'jardin' | 'papier' | 'guilde' | 'event';
  scheme?: 'light' | 'dark';
  /** A bundled seasonal pack, never a profile or a user-supplied path. */
  avatarPack?: 'halloween';
}
export const themeDefinitions: Record<ThemeId, ThemeDefinition> = {
  auto: {
    name: 'Suivre VS Code',
    kind: 'Automatique',
    description: 'Votre thème de l’éditeur',
    family: 'native',
  },
  'jardin-clair': {
    name: 'Jardin des idées',
    kind: 'Clair',
    description: 'Porcelaine & feuillage',
    family: 'jardin',
    scheme: 'light',
  },
  'jardin-sombre': {
    name: 'Jardin des idées',
    kind: 'Sombre',
    description: 'Pin & lumière dorée',
    family: 'jardin',
    scheme: 'dark',
  },
  'papier-clair': {
    name: 'Papier vivant',
    kind: 'Clair',
    description: 'Papier crème & cobalt',
    family: 'papier',
    scheme: 'light',
  },
  'papier-sombre': {
    name: 'Papier vivant',
    kind: 'Sombre',
    description: 'Ardoise & pervenche',
    family: 'papier',
    scheme: 'dark',
  },
  'guilde-clair': {
    name: 'Guilde pixel',
    kind: 'Clair',
    description: 'Ivoire & menthe',
    family: 'guilde',
    scheme: 'light',
  },
  'guilde-sombre': {
    name: 'Guilde pixel',
    kind: 'Sombre',
    description: 'Indigo & lavande',
    family: 'guilde',
    scheme: 'dark',
  },
  halloween: {
    name: 'Halloween',
    kind: 'Événement',
    description: 'Citrouilles, sortilèges & vingt costumes',
    family: 'event',
    scheme: 'dark',
    avatarPack: 'halloween',
  },
};
const legacyThemes: Readonly<Record<string, ThemeId>> = {
  aube: 'papier-clair',
  brume: 'guilde-clair',
  sauge: 'jardin-clair',
  minuit: 'guilde-sombre',
  foret: 'jardin-sombre',
};

export function normalizeTheme(value: unknown): ThemeId {
  if (typeof value !== 'string') return 'auto';
  if (THEME_IDS.some((theme) => theme === value)) return value as ThemeId;
  return Object.hasOwn(legacyThemes, value) ? legacyThemes[value] : 'auto';
}
