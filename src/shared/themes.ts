export const THEME_IDS = ['auto', 'aube', 'brume', 'sauge', 'minuit', 'foret'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export function normalizeTheme(value: unknown): ThemeId {
  return typeof value === 'string' && THEME_IDS.some((theme) => theme === value)
    ? (value as ThemeId)
    : 'auto';
}
