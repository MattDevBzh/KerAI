import type { Page } from '@playwright/test';

/** Follow the visible navigation, including the compact-window menu. */
export async function navigate(page: Page, name: string) {
  await page.locator('.app-shell').waitFor({ state: 'visible' });
  if (name === 'Réglages') {
    const close = page.getByRole('button', { name: 'Fermer le menu', exact: true });
    if (await close.isVisible()) await close.click();
    await page.locator('.topbar').getByRole('button', { name, exact: true }).click();
    return;
  }
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  if (!(await nav.isVisible()))
    await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  const group = ['Mes équipes', 'Agents', 'Skills', 'Kits', 'Consommation'].includes(name)
    ? 'Atelier'
    : ['Azure DevOps', 'Tickets', 'PR', 'Livraison'].includes(name)
      ? 'DevOps'
      : undefined;
  if (group && !(await nav.getByRole('button', { name, exact: true }).isVisible()))
    await nav.getByRole('button', { name: group, exact: true }).click();
  await nav.getByRole('button', { name, exact: true }).click();
}
