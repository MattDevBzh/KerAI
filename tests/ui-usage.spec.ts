import { test, expect, type Page } from '@playwright/test';
import type { Attempt, ClientMessage, StudioState } from '../src/shared/types';
import { demoState } from '../webview/demo';
function fixture(): StudioState {
  const data = structuredClone(demoState);
  const base = data.features[0];
  const row = (id: string, extra: Partial<Attempt> = {}): Attempt => ({
    id,
    startedAt: '2026-10-13T10:00:00Z',
    status: 'awaiting_review',
    feedback: '',
    logs: [],
    questions: [],
    answers: {},
    changedFiles: [],
    ...extra,
  });
  const one = {
    ...structuredClone(base),
    id: 'usage-human',
    title: 'Session mesurée',
    workflowId: 'feature',
    workflowName: 'Feature complète',
  };
  one.steps = [
    {
      ...one.steps[0],
      status: 'approved',
      attempts: [
        row('failed-before', {
          status: 'failed',
          model: 'Prior model',
          startedAt: '2026-10-12T20:00:00Z',
        }),
        row('human-final', {
          status: 'approved',
          approvedBy: 'human',
          model: 'requested-model',
          revision: 4,
          usage: {
            source: 'measured',
            model: 'Observed model',
            inputTokens: 120,
            outputTokens: 40,
            cost: 50,
            unit: 'nano-AIU',
          },
        }),
      ],
    },
  ];
  const two = {
    ...structuredClone(base),
    id: 'usage-partial',
    title: 'Session partielle',
    workflowId: 'review',
    workflowName: 'Relecture seule',
  };
  two.steps = [
    {
      ...two.steps[0],
      status: 'approved',
      attempts: [
        row('zero', {
          status: 'cancelled',
          model: 'Observed model',
          usage: { source: 'measured', inputTokens: 0, outputTokens: 0, cost: 0, unit: 'nano-AIU' },
        }),
        row('partial', {
          status: 'approved',
          approvedBy: 'autopilot',
          usage: {
            source: 'measured',
            inputTokens: 20,
            incompleteTokens: true,
            cost: 900,
            unit: 'USD',
          },
        }),
      ],
    },
  ];
  const archived = {
    ...structuredClone(base),
    id: 'usage-archived',
    title: 'Session archivée',
    archived: true,
    workflowId: 'feature',
    workflowName: 'Feature complète',
  };
  archived.steps = [
    {
      ...archived.steps[0],
      attempts: [
        row('archived-run', {
          usage: {
            source: 'measured',
            model: 'Archive model',
            inputTokens: 1000,
            outputTokens: 200,
            cost: 100,
            unit: 'nano-AIU',
          },
        }),
      ],
    },
  ];
  data.features = [one, two, archived];
  return data;
}
async function hosted(page: Page) {
  await page.addInitScript((state) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      usageMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState: () => {},
        postMessage: (message: ClientMessage) => {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
        },
      }),
    });
  }, fixture());
  await page.goto('/');
  await page.getByRole('button', { name: 'Consommation', exact: true }).click();
}
test('consommation : mesures partielles, zéro réel, unités exactes et validations explicites', async ({
  page,
}) => {
  await hosted(page);
  await expect(page.getByRole('heading', { name: 'Consommation', exact: true })).toBeVisible();
  const input = page.getByRole('article', { name: 'Tokens d’entrée' });
  await expect(input).toContainText('140');
  await expect(input).toContainText('Somme observée partielle');
  await expect(input).toContainText('1 zéro(s) réellement mesuré(s)');
  await expect(page.getByRole('article', { name: 'Tokens de sortie' })).toContainText('40');
  await expect(page.getByRole('article', { name: 'Consommation en crédits' })).toContainText(
    '< 0,000001',
  );
  await expect(
    page.getByText('1 mesure(s) de coût dans une autre unité exclue(s)', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Par modèle effectif', exact: true }),
  ).toContainText('Observed model');
  await expect(
    page.getByRole('region', { name: 'Par modèle effectif', exact: true }),
  ).not.toContainText('requested-model');
  await expect(
    page.getByRole('region', { name: 'Par modèle effectif', exact: true }),
  ).toContainText('Non communiqué');
  await expect(page.getByRole('region', { name: 'Validations et tentatives' })).toContainText(
    '2 tentative(s) en moyenne',
  );
  await expect(
    page.locator('.usage-outcomes div').filter({ hasText: 'Validées par un humain' }),
  ).toContainText('1');
  await expect(
    page.locator('.usage-outcomes div').filter({ hasText: 'Validées par le pilote automatique' }),
  ).toContainText('1');
  await expect(
    page.getByRole('meter', { name: 'crédits mesurés · Observed model' }),
  ).toHaveAttribute('aria-valuetext', '< 0,000001 crédits observés');
  const messages = await page.evaluate(
    () => Reflect.get(window, 'usageMessages') as ClientMessage[],
  );
  expect(messages.filter((message) => message.type !== 'ready')).toEqual([]);
});
test('consommation : filtres, archives, historique hors sélection et ouverture session', async ({
  page,
}) => {
  await hosted(page);
  await page.getByLabel('Du', { exact: true }).fill('2026-10-13');
  await page.getByLabel('Au', { exact: true }).fill('2026-10-13');
  await page.getByLabel('Filtrer par parcours', { exact: true }).selectOption('feature');
  await page
    .getByLabel('Filtrer par modèle effectif', { exact: true })
    .selectOption('Observed model');
  await expect(page.getByRole('article', { name: 'Tokens d’entrée' })).toContainText('120');
  await expect(page.getByRole('region', { name: 'Validations et tentatives' })).toContainText(
    '2 tentative(s) en moyenne',
  );
  await expect(page.getByRole('region', { name: 'Validations et tentatives' })).toContainText(
    '1 hors filtres',
  );
  await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
  await page.getByLabel('Inclure les sessions archivées').check();
  await expect(page.getByRole('region', { name: 'Par session', exact: true })).toContainText(
    'Session archivée',
  );
  await expect(page.getByRole('article', { name: 'Tokens d’entrée' })).toContainText('1 140');
  await page.getByRole('button', { name: 'Ouvrir la session Session mesurée' }).click();
  await expect(page.getByRole('button', { name: 'Vos sessions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Session mesurée', exact: true })).toBeVisible();
});
test('consommation : période vide et mobile accessible sans débordement global', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hosted(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('Du', { exact: true }).fill('2030-01-01');
  await expect(
    page.getByRole('heading', { name: 'Aucune donnée pour cette sélection' }),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: 'Tokens d’entrée' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
  await page.getByLabel('Inclure les sessions archivées').focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Inclure les sessions archivées')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByText('Détail des 5 tentative(s)', { exact: true }).click();
  await expect(page.locator('.usage-attempt-details')).toContainText('révision 4');
});
