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
  await nav.getByRole('button', { name: 'Azure DevOps', exact: true }).click();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
  const settings = nav.getByRole('button', { name: 'Réglages', exact: true });
  await expect(settings).toBeFocused();
  const position = await settings.boundingBox();
  expect(position!.y).toBeGreaterThanOrEqual(0);
  expect(position!.y + position!.height).toBeLessThanOrEqual(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { name: 'Les détails qui vous ressemblent.', exact: true }),
  ).toBeVisible();
  const first = nav.getByRole('button', { name: 'Azure DevOps', exact: true });
  await first.focus();
  const firstPosition = await first.boundingBox();
  expect(firstPosition!.y).toBeGreaterThanOrEqual(0);
  expect(firstPosition!.y + firstPosition!.height).toBeLessThanOrEqual(600);
});
