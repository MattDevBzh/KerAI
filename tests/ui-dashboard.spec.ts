import { test, expect } from '@playwright/test';
import { installDashboardHost } from './fixtures/dashboard';
import type { ClientMessage } from '../src/shared/types';
const messages = (page: import('@playwright/test').Page) =>
  page.evaluate(() => Reflect.get(window, 'dashboardMessages') as ClientMessage[]);

test('Métro affiche les états réels et renvoie à la station de la session', async ({ page }) => {
  await installDashboardHost(page);
  await expect(page.getByRole('heading', { name: 'Chaque session, à sa station.' })).toBeVisible();
  const metro = page.locator('.session-metro').first();
  await expect(metro).toContainText('étapes validées');
  await metro.getByRole('button', { name: / : / }).first().click();
  const message = (await messages(page)).find((m) => m.type === 'dashboardOpen');
  expect(message).toMatchObject({ type: 'dashboardOpen', stepId: 'discover' });
  await expect(page.getByRole('button', { name: 'Vos sessions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cadrage', exact: true })).toBeVisible();
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
});
test('les modules se dupliquent, se filtrent, se redimensionnent et persistent après rechargement', async ({
  page,
}) => {
  await installDashboardHost(page);
  await page.getByRole('button', { name: 'Personnaliser', exact: true }).click();
  await page.getByRole('button', { name: 'Dupliquer Tickets', exact: true }).click();
  await page.getByRole('button', { name: 'Réglages de Tickets · copie', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titre', { exact: true }).fill('Mes bugs urgents');
  await dialog.getByLabel('Types (séparés par ;)').pressSequentially('Bug; Défaut maison');
  await dialog.getByLabel('Tags (séparés par ;)').pressSequentially('Urgent; UX');
  await dialog.getByLabel('Largeur Métro').selectOption('4');
  await dialog.getByLabel('Hauteur').selectOption('440');
  await dialog.getByRole('button', { name: 'Appliquer' }).click();
  await expect(
    page
      .locator('.overview-module')
      .filter({ has: page.getByRole('heading', { name: 'Mes bugs urgents', exact: true }) }),
  ).toHaveCSS('height', '440px');
  await page.getByRole('button', { name: 'Monter Mes bugs urgents' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Réglages de Mes bugs urgents' }).click();
  await expect(page.getByRole('dialog').getByLabel('Types (séparés par ;)')).toHaveValue(
    'Bug; Défaut maison',
  );
  await expect(page.getByRole('dialog').getByLabel('Tags (séparés par ;)')).toHaveValue(
    'Urgent; UX',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = (await messages(page)).filter((m) => m.type === 'dashboardSave');
  expect(saved).toHaveLength(0);
});
test('fenêtre de contrôle, filtrage global, quota inconnu et actualisation explicite', async ({
  page,
}) => {
  await installDashboardHost(page, true);
  await expect(page.getByRole('heading', { name: 'Feature Studio · Dashboard' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByText('Indisponibles', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'design/proposals/2026-10-17-dashboard/02-tour-de-controle.png',
    fullPage: true,
  });
  await page.getByLabel('Projet du dashboard').selectOption('portal');
  await expect(page.locator('.session-metro')).toHaveCount(1);
  await page.getByLabel('Fréquence d’actualisation').selectOption('0');
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await page.getByRole('button', { name: 'Plein écran', exact: true }).click();
  await page.getByRole('button', { name: 'Revenir au cockpit', exact: true }).click();
  expect((await messages(page)).map((m) => m.type)).toEqual(
    expect.arrayContaining(['dashboardRefresh', 'dashboardFullscreen', 'dashboardOpen']),
  );
});
test('une mise à jour du moteur change la station sans actualisation Azure', async ({ page }) => {
  await installDashboardHost(page);
  const metro = page.getByRole('article', { name: 'Une palette de commandes, enfin fluide' });
  await expect(metro).toBeVisible();
  const before = (await messages(page)).filter((m) => m.type === 'dashboardRefresh').length;
  await page.evaluate(() => {
    const state = Reflect.get(window, 'studioFixture');
    state.features[0].steps[1].status = 'failed';
    state.features[0].steps.forEach((s: { status: string }, i: number) => {
      if (i !== 1 && s.status === 'running') s.status = 'pending';
    });
    state.features[0].activeStepId = state.features[0].steps[1].id;
    window.postMessage({ type: 'state', state }, '*');
  });
  await expect(metro.getByRole('button', { name: 'Conception : Échec' })).toBeVisible();
  expect((await messages(page)).filter((m) => m.type === 'dashboardRefresh')).toHaveLength(before);
});
for (const width of [1440, 1100, 820, 390])
  test(`dashboard lisible à ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await installDashboardHost(page);
    await expect(page.locator('.overview-grid')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Ouvrir dans une nouvelle fenêtre', exact: true }),
    ).toBeVisible();
    if (width === 1440)
      await page.screenshot({
        path: 'design/proposals/2026-10-17-dashboard/01-metro.png',
        fullPage: true,
      });
  });
