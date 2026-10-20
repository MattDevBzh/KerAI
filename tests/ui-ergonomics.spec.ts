import { test, expect } from '@playwright/test';
import { navigate } from './ui-navigation-helpers';

test('compact navigation has labels, traps focus, closes with Escape and restores focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  const menu = page.getByRole('button', { name: 'Ouvrir le menu' });
  await menu.click();
  const navigation = page.getByRole('dialog', { name: 'Navigation du cockpit' });
  await expect(navigation.getByRole('button', { name: 'Fermer le menu' })).toBeFocused();
  await expect(page.locator('.main-shell')).toHaveAttribute('inert', '');
  await page.getByRole('searchbox', { name: 'Rechercher un écran' }).fill('reglages');
  await expect(navigation.getByRole('navigation').getByRole('button')).toHaveCount(1);
  await expect(navigation.getByRole('button', { name: 'Réglages', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.locator('.main-shell')).not.toHaveAttribute('inert');
  await menu.click();
  await navigation.getByRole('button', { name: 'Réglages', exact: true }).click();
  await expect(page.getByRole('main')).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'Les détails qui vous ressemblent.' }),
  ).toBeInViewport();
});

test('all screens reflow at 390px and navigation resets the page position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  for (const screen of [
    'Sessions',
    'Stats',
    'Discussion',
    'Validation',
    'Consommation',
    'Quêtes',
    'Parcours',
    'Agents',
    'Skills',
    'Automatisations',
    'Kits',
    'Réglages',
    'Livraison',
    'Azure DevOps',
    'PR',
    'Tickets',
    'Mémoire',
  ]) {
    await navigate(page, screen);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      screen,
    ).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => window.scrollY), screen).toBe(0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  }
});

test('session totals filter, search can be reset and sorting is usable', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Afficher les sessions à votre tour' }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.getByLabel('Filtrer les sessions')).toHaveValue('attention');
  await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
  await page.getByLabel('Rechercher une session').fill('inexistant');
  await expect(page.locator('.session-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Effacer les filtres', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(3);
  await page.getByLabel('Trier les sessions').selectOption('title');
  await expect(page.locator('.session-row h3').first()).toHaveText(
    'Navigation accessible au clavier',
  );
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', '5');
  await navigate(page, 'Parcours');
  await expect(page.getByRole('button', { name: 'Nouveau parcours' })).toBeVisible();
});

test('agent and skill catalogues support accent-insensitive search, origins and empty resets', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Agents');
  await page.getByRole('searchbox', { name: 'Rechercher un agent' }).fill('implemente');
  await expect(page.locator('.agent-library-item')).toHaveCount(1);
  await expect(page.locator('.agent-library-item')).toContainText('Pixel');
  await page.getByLabel('Origine des agents').selectOption('workspace');
  await expect(page.getByText('Aucun résultat pour ces filtres.')).toBeVisible();
  await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
  await expect(page.locator('.agent-library-item')).toHaveCount(5);
  await page.getByRole('checkbox', { name: 'Mes favoris', exact: true }).check();
  await expect(page.getByText('Aucun résultat pour ces filtres.')).toBeVisible();
  await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
  await navigate(page, 'Skills');
  await page.getByRole('searchbox', { name: 'Rechercher une skill' }).fill('inexistant');
  await expect(page.getByText('Aucun résultat pour ces filtres.')).toBeVisible();
});

test('settings shortcuts reach the right section and save or discard stays visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/?demo=1');
  await navigate(page, 'Réglages');
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  const timeout = page.getByRole('spinbutton', { name: 'Durée maximale d’une tentative minutes' });
  await timeout.fill('31');
  const save = page.getByRole('button', { name: 'Enregistrer les réglages' });
  await expect(save).toBeEnabled();
  await expect(save).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(save).toBeInViewport();
  await page.getByRole('button', { name: 'Annuler les modifications' }).click();
  await expect(timeout).toHaveValue('20');
  await expect(save).toBeDisabled();
});

test('dialogs retain drafts on backdrop click, keep keyboard inside and restore focus', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const create = page.getByRole('button', { name: 'Nouvelle session', exact: true });
  await create.click();
  const dialog = page.getByRole('dialog', { name: 'Une nouvelle feature' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(create).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('discussion offers all agents when no favourites exist and options can collapse', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Discussion');
  await expect(page.getByLabel('Agent de discussion').getByRole('option')).toHaveCount(6);
  await page.getByLabel('Agent de discussion').selectOption({ label: 'Pixel' });
  await expect(page.getByPlaceholder('Écrire à Pixel…')).toBeVisible();
  await page.locator('.discussion-options > summary').click();
  await expect(page.getByLabel('Agent de discussion')).not.toBeVisible();
  await expect(page.getByPlaceholder('Écrire à Pixel…')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('button', { name: 'Historique des discussions', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Historique des discussions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nouvelle discussion' })).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle discussion' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Historique des discussions' }),
  ).not.toBeVisible();
});

test('capture ergonomic changes in the light and dark cockpit', async ({ page }, testInfo) => {
  await page.goto('/?demo=1');
  for (const theme of ['Jardin des idées — Clair', 'Papier vivant — Sombre']) {
    await navigate(page, 'Réglages');
    await page.getByRole('radio', { name: theme, exact: true }).check();
    await navigate(page, 'Agents');
    await page.screenshot({
      path: testInfo.outputPath(`${theme.includes('Clair') ? 'light' : 'dark'}-agents.png`),
    });
  }
  await navigate(page, 'Sessions');
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('dashboard-compact.png') });
});
