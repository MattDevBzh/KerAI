import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import { navigate } from './ui-navigation-helpers';
import type { AccountCredits } from '../src/shared/credits';

async function hosted(page: Page) {
  await page.addInitScript((state) => {
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState: () => {},
        postMessage: (message: { type: string }) => {
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
        },
      }),
    });
  }, demoState);
  await page.goto('/');
  await expect(page.locator('.account-credits')).toBeVisible();
}
async function update(page: Page, state: AccountCredits) {
  await page.evaluate((state) => window.postMessage({ type: 'accountCredits', state }, '*'), state);
}
const reading: AccountCredits = {
  state: 'ready',
  used: 125.5,
  included: 1500,
  overage: 2.5,
  overageAllowed: true,
  resetDate: '2026-11-01T12:00:00Z',
  checkedAt: '2026-10-16T12:34:56Z',
};

test('account total stays in the header across screens and distinguishes zero from unavailable', async ({
  page,
}) => {
  await hosted(page);
  const badge = page.locator('.account-credits');
  await expect(badge).toContainText('Chargement…');
  await update(page, reading);
  await expect(badge.locator('summary')).toContainText('125,5 / 1\u202f500');
  for (const screen of ['Discussion', 'Consommation', 'Sessions']) {
    await navigate(page, screen);
    await expect(badge.locator('summary')).toContainText('125,5 / 1\u202f500');
  }
  await badge.locator('summary').click();
  const details = page.getByRole('region', { name: 'Détail des crédits Copilot' });
  await expect(details).toContainText('tous les usages du compte');
  await expect(details).toContainText('2,5 crédits supplémentaires');
  await expect(details).toContainText('Dépassement autorisé');
  await expect(details).toContainText('01/11/2026');
  await update(page, { state: 'ready', used: 0, included: 1500 });
  await expect(badge.locator('summary')).toContainText('0 / 1\u202f500');
  await update(page, {
    state: 'unavailable',
    message: 'Le quota est temporairement indisponible.',
  });
  await expect(badge.locator('summary')).toContainText('Indisponibles');
  await expect(badge.locator('summary')).not.toContainText('0 /');
  await expect(details).toContainText('temporairement indisponible');
  await update(page, { state: 'ready', used: 3, unlimited: true });
  await expect(badge.locator('summary')).toContainText('3 / illimité');
});

for (const width of [1440, 390]) {
  test(`account credits details stay readable and keyboard accessible at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await hosted(page);
    await update(page, reading);
    const summary = page.locator('.account-credits > summary');
    await expect(summary).toBeInViewport();
    await summary.focus();
    await page.keyboard.press('Enter');
    const details = page.getByRole('region', { name: 'Détail des crédits Copilot' });
    await expect(details).toBeVisible();
    const bounds = await details.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`copilot-header-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(details).not.toBeVisible();
    await expect(summary).toBeFocused();
    await summary.click();
    await page.locator('.topbar-context').click();
    await expect(details).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
