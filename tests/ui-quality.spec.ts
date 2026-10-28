import { navigate } from './ui-navigation-helpers';
import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';
async function hosted(page: Page, state: StudioState) {
  await page.addInitScript((data) => {
    const messages: unknown[] = [];
    Object.assign(window, {
      qualityMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState() {},
        postMessage(message: { type: string }) {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Sessions / })).toBeVisible();
}
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'qualityMessages') as ClientMessage[]);
test('qualité : installation explicite et configuration du rapport dans la commande approuvée', async ({
  page,
}) => {
  const state = structuredClone(demoState);
  state.settings.testCommands = [
    {
      id: 'visual',
      name: 'Recette',
      command: 'node',
      args: ['node_modules/@playwright/test/cli.js', 'test'],
    },
  ];
  await hosted(page, state);
  await navigate(page, 'Réglages');
  await page.getByRole('button', { name: 'Installer le reporter qualité', exact: true }).click();
  expect((await messages(page)).at(-1)).toEqual({ type: 'installQualityKit' });
  await page.getByLabel('Collecte de preuves').selectOption('counterexample');
  await page
    .getByLabel('Rapport JSON approuvé')
    .fill('.feature-studio/quality/counterexamples.json');
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveSettings',
    settings: {
      testCommands: [
        {
          id: 'visual',
          quality: {
            kind: 'counterexample',
            reportPath: '.feature-studio/quality/counterexamples.json',
          },
        },
      ],
    },
  });
});
test('qualité : contre-exemple lisible, preuves sélectionnées par id et aucune validation implicite', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = structuredClone(demoState),
    feature = state.features[0],
    attempt = feature.steps[1].attempts[0];
  attempt.evidence = [
    {
      id: 'proof-visual',
      source: 'host',
      commandId: 'visual',
      name: 'Parcours profil',
      command: 'node',
      args: ['node_modules/@playwright/test/cli.js', 'test'],
      startedAt: '2026-10-13T10:00:00Z',
      finishedAt: '2026-10-13T10:00:02Z',
      exitCode: 1,
      stdout: '',
      stderr: '',
      truncated: false,
      fileHashes: { 'src/profile.ts': 'a'.repeat(64) },
      quality: {
        version: 1,
        kind: 'counterexample',
        featureId: feature.id,
        attemptId: attempt.id,
        commandId: 'visual',
        evidenceId: 'proof-visual',
        collectedAt: '2026-10-13T10:00:02Z',
        status: 'failed',
        runner: 'playwright',
        reportPath: '.feature-studio/quality/report.json',
        reportSha256: 'b'.repeat(64),
        cases: [
          {
            id: 'case-empty',
            title: 'Un nom vide est accepté',
            criterionIds: ['C1'],
            status: 'failed',
            expected: 'Nom requis',
            actual: 'Profil sauvegardé',
            steps: ['Ouvrir le profil', 'Vider le nom', 'Enregistrer'],
            errors: ['Assertion échouée : erreur absente'],
            reproduction: ['Ouvrir /profile', 'Soumettre un nom vide'],
            attachmentIds: ['image', 'trace'],
          },
        ],
        attachments: [
          {
            id: 'image',
            name: 'Formulaire réel',
            kind: 'screenshot',
            mime: 'image/png',
            sizeBytes: 2000,
            sha256: 'c'.repeat(64),
          },
          {
            id: 'trace',
            name: 'Parcours complet',
            kind: 'trace',
            mime: 'application/zip',
            sizeBytes: 12000,
            sha256: 'd'.repeat(64),
          },
        ],
      },
    },
  ];
  await hosted(page, state);
  await navigate(page, 'Validation');
  await page
    .locator('.validation-card')
    .filter({ hasText: 'Conception' })
    .getByRole('button', { name: 'Examiner les blocages', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Preuves' }).click();
  await page.getByText('Détails des outils et tests de cette tentative', { exact: true }).click();
  const panel = page.getByRole('region', { name: 'Recette et contre-exemples' });
  await expect(panel.getByText('Profil sauvegardé', { exact: false })).toBeVisible();
  await expect(panel.getByText('Critères : C1')).toBeVisible();
  await panel.getByRole('button', { name: 'Voir la capture : Formulaire réel' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'openQualityAttachment',
    featureId: feature.id,
    evidenceId: 'proof-visual',
    attachmentId: 'image',
  });
  await panel.getByRole('button', { name: 'Enregistrer la trace : Parcours complet' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'openQualityAttachment',
    attachmentId: 'trace',
  });
  expect(
    (await messages(page)).some(
      (message) => message.type === 'saveCriteria' || message.type === 'approveStep',
    ),
  ).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('quality-mobile.png'), fullPage: true });
});

test('qualité : les exigences enregistrées restent conservées avec les profils hérités', async ({
  page,
}) => {
  const state = structuredClone(demoState);
  state.workflows[0].steps[0].requiredQuality = 'visual';
  await hosted(page, state);
  await navigate(page, 'Mes équipes');
  await page
    .locator('.workflow-library-card')
    .first()
    .getByRole('button', { name: 'Ouvrir l’éditeur' })
    .click();
  await expect(page.getByLabel('Rapport qualité requis')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enregistrer l’équipe' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveWorkflow' }>;
  expect(saved.type).toBe('saveWorkflow');
  expect(saved.workflow.steps[0].requiredQuality).toBe('visual');
});
