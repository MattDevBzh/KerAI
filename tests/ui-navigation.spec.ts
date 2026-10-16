import { test, expect } from '@playwright/test';
import { demoState } from '../webview/demo';

test('navigation à 800×600 : atteindre Réglages au clavier sans faire défiler la page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.addInitScript((state) => {
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState() {},
        postMessage(message: { type: string }) {
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
        },
      }),
    });
  }, structuredClone(demoState));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).focus();
  const settings = nav.getByRole('button', { name: 'Réglages', exact: true });
  for (let i = 0; i < (await nav.getByRole('button').count()); i++) {
    if (await settings.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(settings).toBeFocused();
  const position = await settings.boundingBox();
  expect(position!.y).toBeGreaterThanOrEqual(0);
  expect(position!.y + position!.height).toBeLessThanOrEqual(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Les détails qui vous ressemblent.', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await expect(settings).toHaveAttribute('aria-current', 'page');
  const first = nav.getByRole('button', { name: 'Dashboard', exact: true });
  await first.focus();
  const firstPosition = await first.boundingBox();
  expect(firstPosition!.y).toBeGreaterThanOrEqual(0);
  expect(firstPosition!.y + firstPosition!.height).toBeLessThanOrEqual(600);
});
