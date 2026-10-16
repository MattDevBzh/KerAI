import type { Page } from '@playwright/test';

/** Follow the visible navigation, including the compact-window menu. */
export async function navigate(page: Page, name: string) {
  await page.locator('.app-shell').waitFor({ state: 'visible' });
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  if (!(await nav.isVisible()))
    await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await nav.getByRole('button', { name, exact: true }).click();
}
