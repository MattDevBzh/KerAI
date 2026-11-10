import { expect, it } from 'vitest';
import { missingPrRuleReferences } from '../src/shared/prRuleReferences';

const audit =
  'F04 — Faire évoluer la base sans casser l’ancienne application.\nF11 et F12 — Clarifier le travail confié à une IA et ses vérifications.';
it.each([
  'F11/F12',
  'f11 / f12',
  'F11 et F12',
  'F11, F12',
  'F11;F12',
  'F11 & F12',
  'F11 + F12',
  'F11 and F12',
])('recognizes every explicitly cited identifier in %s', (rule) => {
  expect(missingPrRuleReferences(rule, [audit])).toEqual([]);
});
it('accepts an actual finding in the supplied audit without needing its title', () => {
  expect(missingPrRuleReferences('F04', [audit])).toEqual([]);
  expect(
    missingPrRuleReferences('F04 — Faire évoluer la base sans casser l’ancienne application.', [
      audit,
    ]),
  ).toEqual([]);
  expect(missingPrRuleReferences('SEC-01/SEC-02', ['SEC‑01 : premier', 'SEC-02 : second'])).toEqual(
    [],
  );
});
it('requires every grouped identifier and never matches an identifier prefix', () => {
  expect(missingPrRuleReferences('F11/F12', ['F11 : disponible', 'F120 : autre'])).toEqual(['f12']);
  expect(missingPrRuleReferences('F04', ['F040', 'XF04', 'F04.1', 'F04-EXTRA'])).toEqual(['f04']);
  expect(missingPrRuleReferences('F11/F99', [audit])).toEqual(['f99']);
  expect(missingPrRuleReferences('F11-F12', [audit])).toEqual(['f11-f12']);
});
it('keeps full titles intact and accepts normal punctuation around identifiers', () => {
  expect(missingPrRuleReferences('Conception et sécurité', ['Conception', 'sécurité'])).toEqual([
    'conception et sécurité',
  ]);
  expect(missingPrRuleReferences('Conception et sécurité', ['Conception\n et sécurité'])).toEqual(
    [],
  );
  expect(missingPrRuleReferences('F04', ['Constat : F04.'])).toEqual([]);
  expect(missingPrRuleReferences('', [])).toEqual([]);
});
