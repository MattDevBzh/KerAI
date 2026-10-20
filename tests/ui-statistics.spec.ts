import { test, expect, type Page } from '@playwright/test';
import type { ClientMessage } from '../src/shared/types';
import { defaultStatsFilters } from '../src/shared/statistics';
import { statisticsState, statsFeature } from './statistics-fixture';
import { navigate } from './ui-navigation-helpers';

test.use({ timezoneId: 'Europe/Paris' });
async function openStats(page: Page, large = false) {
  const state = statisticsState();
  if (large)
    state.features = Array.from({ length: 55 }, (_, index) => statsFeature(`batch-${index}`));
  await page.addInitScript(
    ({ data, filters }) => {
      const messages: unknown[] = [];
      let saved = { view: 'stats', navigationVersion: 2, statistics: filters };
      Object.assign(window, {
        statsMessages: messages,
        statsFixture: data,
        acquireVsCodeApi: () => ({
          getState: () => saved,
          setState: (value: typeof saved) => {
            saved = value;
          },
          postMessage: (message: { type: string }) => {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
          },
        }),
      });
    },
    { data: state, filters: { ...defaultStatsFilters, period: 'all' as const } },
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible();
}
const card = (page: Page, label: string) =>
  page.getByRole('article', { name: label, exact: true }).locator('strong');
async function storageRequest(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(window, 'statsMessages') as ClientMessage[])
      .filter((message) => message.type === 'statsStorage')
      .at(-1),
  ) as Promise<Extract<ClientMessage, { type: 'statsStorage' }>>;
}
test('Stats aggregates all projects, filters archived and multi-project sessions, and restores filters after opening a session', async ({
  page,
}) => {
  await openStats(page);
  await expect(card(page, 'Sessions dans la période')).toHaveText('4');
  await expect(card(page, 'Tentatives lancées')).toHaveText('3');
  await expect(card(page, 'Crédits observés')).toHaveText('3,5');
  await expect(page.locator('.stats-podium li').first()).toContainText('Développeur');
  await page.getByLabel('Projet des statistiques').selectOption('lxp');
  await expect(card(page, 'Sessions dans la période')).toHaveText('2');
  await expect(card(page, 'Tentatives lancées')).toHaveText('1');
  await page.getByLabel('Inclure les archives').uncheck();
  await expect(card(page, 'Sessions dans la période')).toHaveText('1');
  await expect(card(page, 'Crédits observés')).toHaveText('—');
  await page.getByLabel('Inclure les archives').check();
  await page.getByRole('button', { name: 'Ouvrir Session beta', exact: true }).click();
  await navigate(page, 'Stats');
  await expect(page.getByLabel('Projet des statistiques')).toHaveValue('lxp');
  await expect(card(page, 'Tentatives lancées')).toHaveText('1');
  expect(
    (await page.evaluate(() => Reflect.get(window, 'statsMessages') as ClientMessage[])).some(
      (message) => ['runStep', 'runObservation', 'statsStorage'].includes(message.type),
    ),
  ).toBe(false);
});
test('custom dates, monthly charts, unknown values and empty results are explicit', async ({
  page,
}) => {
  await openStats(page);
  await page.getByLabel('Période des statistiques').selectOption('custom');
  await expect(page.getByRole('alert')).toContainText('dates valides');
  await page.getByLabel('Début de période').fill('2026-10-20');
  await page.getByLabel('Fin de période').fill('2026-10-20');
  await expect(card(page, 'Tentatives lancées')).toHaveText('1');
  await expect(card(page, 'Sessions créées')).toHaveText('0');
  await page.getByLabel('Regroupement des statistiques').selectOption('month');
  await page.getByLabel('Indicateur d’activité').selectOption('credits');
  await expect(page.getByRole('img', { name: /Crédits observés par mois/ })).toBeVisible();
  await page.getByText('Voir les valeurs du graphique', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Activité détaillée' })).toContainText('2');
  await page.getByLabel('Mesure par modèle').selectOption('credits');
  await expect(page.locator('.stats-models')).toContainText('luna');
  await page.getByLabel('Début de période').fill('2030-01-01');
  await page.getByLabel('Fin de période').fill('2030-01-01');
  await expect(
    page.getByRole('heading', { name: 'Pas encore d’activité dans ce périmètre' }),
  ).toBeVisible();
  await expect(card(page, 'Durée moyenne d’une tentative')).toHaveText('—');
});
test('storage runs in bounded batches, keeps missing measurements distinct, and ignores stale responses', async ({
  page,
}) => {
  await openStats(page, true);
  await page.getByRole('button', { name: 'Calculer le stockage' }).click();
  const first = await storageRequest(page);
  expect(first.featureIds).toHaveLength(50);
  await page.evaluate(
    (request) =>
      window.postMessage(
        {
          type: 'statsStorageResult',
          requestId: request.requestId,
          items: request.featureIds.map((featureId) => ({ featureId, bytes: 1024 })),
        },
        '*',
      ),
    first,
  );
  await expect.poll(async () => (await storageRequest(page)).requestId).not.toBe(first.requestId);
  const second = await storageRequest(page);
  expect(second.featureIds).toHaveLength(5);
  await page.evaluate(
    (request) =>
      window.postMessage(
        {
          type: 'statsStorageResult',
          requestId: request.requestId,
          items: request.featureIds.map((featureId, index) =>
            index ? { featureId, bytes: 1024 } : { featureId, error: 'Projet indisponible' },
          ),
        },
        '*',
      ),
    second,
  );
  await expect(
    page.getByText('54 / 55 sessions mesurées · résultat partiel. Instantané à la demande.'),
  ).toBeVisible();
  await expect(page.getByText('54 Kio au total · 1 Kio / session', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actualiser la taille' }).click();
  const stale = await storageRequest(page);
  await page.getByLabel('Projet des statistiques').selectOption('lxp');
  await page.evaluate(
    (request) =>
      window.postMessage(
        {
          type: 'statsStorageResult',
          requestId: request.requestId,
          items: request.featureIds.map((featureId) => ({ featureId, bytes: 99999 })),
        },
        '*',
      ),
    stale,
  );
  await expect(
    page.getByRole('heading', { name: 'Pas encore d’activité dans ce périmètre' }),
  ).toBeVisible();
  await page.getByLabel('Projet des statistiques').selectOption('lms');
  await expect(page.getByRole('button', { name: 'Calculer le stockage' })).toBeEnabled();
});
test('Stats remains readable at 390px and supports native dark and light themes', async ({
  page,
}) => {
  await openStats(page);
  await page.screenshot({ path: test.info().outputPath('stats-desktop.png'), fullPage: true });
  for (const theme of ['jardin-clair', 'jardin-sombre']) {
    await page.evaluate((theme) => window.postMessage({ type: 'themeState', theme }, '*'), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Projet des statistiques')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: test.info().outputPath(`stats-mobile-${theme}.png`),
      fullPage: true,
    });
  }
});
