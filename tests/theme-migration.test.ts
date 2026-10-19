import { expect, it } from 'vitest';
import { normalizeTheme, THEME_IDS, themeDefinitions } from '../src/shared/themes';
it('migrates all five previous personal preferences and rejects untrusted pack names', () => {
  const aliases = {
    aube: 'papier-clair',
    brume: 'guilde-clair',
    sauge: 'jardin-clair',
    minuit: 'guilde-sombre',
    foret: 'jardin-sombre',
  };
  for (const [old, current] of Object.entries(aliases)) expect(normalizeTheme(old)).toBe(current);
  for (const invalid of [null, undefined, '__proto__', 'constructor', '../../halloween'])
    expect(normalizeTheme(invalid)).toBe('auto');
  expect(THEME_IDS).toHaveLength(11);
  expect(THEME_IDS.filter((id) => themeDefinitions[id].avatarPack)).toEqual([
    'halloween',
    'dragonball',
  ]);
});
