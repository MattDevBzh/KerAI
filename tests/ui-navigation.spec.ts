import { test, expect } from '@playwright/test';
import { demoState } from '../webview/demo';
import { navigate } from './ui-navigation-helpers';

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
  await page.locator('.account-credits > summary').focus();
  await page.keyboard.press('Tab');
  const settings = page.locator('.topbar').getByRole('button', { name: 'Réglages', exact: true });
  await expect(settings).toBeFocused();
  const position = await settings.boundingBox();
  expect(position!.y).toBeGreaterThanOrEqual(0);
  expect(position!.y + position!.height).toBeLessThanOrEqual(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Les détails qui vous ressemblent.', exact: true }),
  ).toBeVisible();
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.topbar-context')).toContainText('Réglages');
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('button', { name: 'Réglages', exact: true })).toHaveCount(0);
  const first = nav.getByRole('button', { name: 'Sessions', exact: true });
  await first.focus();
  const firstPosition = await first.boundingBox();
  expect(firstPosition!.y).toBeGreaterThanOrEqual(0);
  expect(firstPosition!.y + firstPosition!.height).toBeLessThanOrEqual(600);
});

test('les groupes se déplient au clavier et gardent la page active identifiable', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('button')).toHaveCount(10);
  const atelier = nav.getByRole('button', { name: 'Atelier', exact: true });
  const devops = nav.getByRole('button', { name: 'DevOps', exact: true });
  await expect(atelier).toHaveAttribute('aria-expanded', 'false');
  await expect(devops).toHaveAttribute('aria-expanded', 'false');
  await atelier.focus();
  await page.keyboard.press('Enter');
  await expect(atelier).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('button', { name: 'Mes équipes', exact: true })).toBeFocused();
  for (const name of ['Mes équipes', 'Agents', 'Skills', 'Kits', 'Consommation'])
    await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  await navigate(page, 'Agents');
  await expect(nav.getByRole('button', { name: 'Agents', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.topbar-context')).toHaveText('ATELIERAgents');
  await atelier.click();
  await expect(nav.getByRole('button', { name: 'Agents', exact: true })).not.toBeVisible();
  await expect(atelier).toHaveClass(/is-current/);
  await devops.click();
  for (const name of ['Azure DevOps', 'Tickets', 'PR', 'Livraison'])
    await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  await atelier.click();
  await expect(devops).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('button', { name: 'PR', exact: true })).not.toBeVisible();
});

test('la recherche retrouve les pages repliées, les groupes et les réglages', async ({ page }) => {
  await page.goto('/?demo=1');
  const search = page.getByRole('searchbox', { name: 'Rechercher un écran' });
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await search.fill('conso');
  await nav.getByRole('button', { name: 'Consommation', exact: true }).click();
  await expect(search).toBeEmpty();
  await expect(nav.getByRole('button', { name: 'Atelier', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(nav.getByRole('button', { name: 'Consommation', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await search.fill('devops');
  await expect(nav.getByRole('button')).toHaveText(['Azure DevOps', 'Tickets', 'PR', 'Livraison']);
  await search.fill('reglages');
  await nav.getByRole('button', { name: 'Réglages', exact: true }).click();
  await expect(page.locator('.settings-toggle')).toHaveAttribute('aria-current', 'page');
  await search.fill('introuvable');
  await expect(nav.getByRole('status')).toHaveText('Aucun écran. Essayez un autre mot.');
  await page.getByRole('button', { name: 'Effacer la recherche de navigation' }).click();
  await expect(nav.getByRole('button')).toHaveCount(10);
});

for (const [view, name, group] of [
  ['agents', 'Agents', 'Atelier'],
  ['devops-prs', 'PR', 'DevOps'],
  ['settings', 'Réglages', undefined],
] as const) {
  test(`restaurer ${name} conserve son accès et le bon groupe`, async ({ page }) => {
    await page.addInitScript(
      ({ state, view }) => {
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            getState: () => ({ view }),
            setState() {},
            postMessage(message: { type: string }) {
              if (message.type === 'ready')
                setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
            },
          }),
        });
      },
      { state: demoState, view },
    );
    await page.goto('/');
    await expect(page.locator('[aria-current="page"]')).toHaveAccessibleName(name);
    if (group)
      await expect(
        page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', {
          name: group,
          exact: true,
        }),
      ).toHaveAttribute('aria-expanded', 'true');
    else
      await expect(
        page.getByRole('heading', { name: 'Les détails qui vous ressemblent.', exact: true }),
      ).toBeVisible();
  });
}
