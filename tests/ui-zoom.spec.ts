import { expect, test, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';
import type { ZoomPreference } from '../src/shared/zoom';
import { navigate } from './ui-navigation-helpers';

const zoom = (page: Page) =>
  page.locator('.topbar').getByRole('combobox', { name: 'Zoom de Feature Studio' });

async function hosted(page: Page, preference: ZoomPreference = 'auto') {
  const state = structuredClone(demoState);
  state.features[0] = {
    ...state.features[0],
    steps: [],
    activeStepId: '',
    status: 'draft',
    teamRevision: 0,
  };
  await page.addInitScript(
    ({ state, preference }) => {
      const messages: ClientMessage[] = [];
      Object.assign(window, {
        zoomMessages: messages,
        rejectZoom: false,
        acquireVsCodeApi: () => ({
          getState: () => ({ view: 'dashboard', featureId: state.features[0].id }),
          setState() {},
          postMessage(message: ClientMessage) {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'themeState', theme: 'jardin-clair' }, '*');
                window.postMessage(
                  {
                    type: 'zoomState',
                    zoom: JSON.parse(
                      localStorage.getItem('savedZoom') ?? JSON.stringify(preference),
                    ),
                  },
                  '*',
                );
              }, 0);
            if (message.type === 'setZoom')
              setTimeout(() => {
                const rejected = Reflect.get(window, 'rejectZoom');
                if (!rejected) localStorage.setItem('savedZoom', JSON.stringify(message.zoom));
                window.postMessage(
                  {
                    type: 'zoomState',
                    zoom: JSON.parse(
                      localStorage.getItem('savedZoom') ?? JSON.stringify(preference),
                    ),
                    requestId: message.requestId,
                    error: rejected ? 'Réglages personnels en lecture seule.' : undefined,
                  },
                  '*',
                );
              }, 10);
          },
        }),
      });
    },
    { state, preference },
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Aucune équipe constituée' })).toBeVisible();
}

async function noHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(() => {
      const y = scrollY;
      window.scrollTo(100000, y);
      const x = scrollX;
      window.scrollTo(0, y);
      return x;
    }),
  ).toBeLessThanOrEqual(1);
}

for (const viewport of [
  { width: 1440, height: 900, percent: 100 },
  { width: 1920, height: 1080, percent: 125 },
  { width: 2560, height: 1440, percent: 150 },
  { width: 3840, height: 2160, percent: 175 },
  { width: 3440, height: 800, percent: 100 },
]) {
  test(`auto ${viewport.width}×${viewport.height}: ${viewport.percent} %, feature et composition accessibles`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await hosted(page);
    await expect(page.locator('html')).toHaveAttribute(
      'data-studio-zoom-effective',
      String(viewport.percent),
    );
    await noHorizontalScroll(page);
    const sidebar = await page.locator('.sidebar').boundingBox();
    expect(sidebar!.height).toBeCloseTo(viewport.height, 0);
    await page.getByRole('button', { name: 'Composer mon équipe' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    const agent = page.locator('.team-agent').first();
    await agent.locator('.team-avatar-drag').dragTo(page.locator('.team-empty-target'));
    await expect(page.locator('.team-member')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (viewport.width === 2560) await page.screenshot({ path: 'test-results/zoom-qhd.png' });
  });
}

test('zoom personnel : boutons, navigation, redémarrage, erreur et retour automatique', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await hosted(page);
  await page.getByRole('button', { name: 'Agrandir le zoom', exact: true }).click();
  await expect(zoom(page)).toHaveValue('175');
  await expect(zoom(page)).toBeEnabled();
  await navigate(page, 'Réglages');
  const settings = page
    .locator('.settings-card')
    .filter({ has: page.getByRole('heading', { name: 'Taille de l’interface', exact: true }) });
  await expect(settings.getByRole('combobox')).toHaveValue('175');
  await page.reload();
  await expect(zoom(page)).toHaveValue('175');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('html')).toHaveAttribute('data-studio-zoom-effective', '175');
  await page.evaluate(() => Reflect.set(window, 'rejectZoom', true));
  await zoom(page).selectOption('200');
  await expect(page.getByRole('alert')).toContainText('lecture seule');
  await expect(zoom(page)).toHaveValue('175');
  await page.evaluate(() => Reflect.set(window, 'rejectZoom', false));
  await zoom(page).selectOption('auto');
  await expect(page.locator('html')).toHaveAttribute('data-studio-zoom-effective', '125');
  await expect(zoom(page)).toBeEnabled();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('html')).toHaveAttribute('data-studio-zoom-effective', '100');
  const messages = await page.evaluate(
    () => Reflect.get(window, 'zoomMessages') as ClientMessage[],
  );
  expect(messages.some((m) => ['runStep', 'saveSettings', 'sendDiscussion'].includes(m.type))).toBe(
    false,
  );
});

test('200 % : colonnes compactes, dialogue après défilement et menus utilisables', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await hosted(page, 200);
  await expect(page.locator('html')).toHaveAttribute('data-studio-zoom-effective', '200');
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir le menu' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Composer mon équipe' }).click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
  await navigate(page, 'Réglages');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await navigate(page, 'Agents');
  await page.getByRole('button', { name: 'Nouvel agent' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Enregistrer le profil' }).scrollIntoViewIfNeeded();
  const footer = await dialog.getByRole('button', { name: 'Enregistrer le profil' }).boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(800);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await noHorizontalScroll(page);
});

test('fenêtre étroite : commandes de zoom accessibles et zoom démo mémorisé', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  await expect(zoom(page)).toBeVisible();
  await noHorizontalScroll(page);
  await zoom(page).selectOption('125');
  await page.reload();
  await expect(zoom(page)).toHaveValue('125');
  await expect(page.getByRole('button', { name: 'Réduire le zoom', exact: true })).toBeInViewport();
  await noHorizontalScroll(page);
  await zoom(page).selectOption('auto');
  await expect(page.locator('html')).toHaveAttribute('data-studio-zoom-effective', '100');
});

test('zoom et crédits conservent une navigation accessible lors du passage au menu compact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await hosted(page, 200);
  await page.evaluate(() =>
    window.postMessage(
      { type: 'accountCredits', state: { state: 'ready', used: 125.5, included: 1500 } },
      '*',
    ),
  );
  const credits = page.locator('.account-credits > summary');
  await expect(credits).toBeInViewport();
  await expect(zoom(page)).toBeInViewport();
  await credits.click();
  const details = page.getByRole('region', { name: 'Détail des crédits Copilot' });
  const bounds = await details.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Navigation du cockpit' });
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds!.height).toBeCloseTo(800, 0);
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.main-shell')).not.toHaveAttribute('inert');
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  await noHorizontalScroll(page);
});
