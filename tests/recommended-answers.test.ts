import { describe, expect, it } from 'vitest';
import { recommendedChoice } from '../src/core/questions';

describe('explicit recommended choices', () => {
  it.each([
    'Petit lot (Recommandé)',
    '**Petite étape (Recommended)**',
    'Option [recommandée]',
    'Option — Recommandé',
    'Recommandé : lot court',
  ])('retains the original exact choice: %s', (choice) => {
    expect(recommendedChoice(['Autre option', choice])).toBe(choice);
  });
  it('leaves ambiguous, negative, unmarked and oversized choices to the user', () => {
    for (const choices of [
      undefined,
      [],
      ['Rapide', 'Complet'],
      ['Non recommandé'],
      ['Option (non recommandé)'],
      ['A (Recommended)', 'B (Recommandé)'],
      ['a'.repeat(30001) + ' (Recommended)'],
    ])
      expect(recommendedChoice(choices)).toBeUndefined();
  });
});
