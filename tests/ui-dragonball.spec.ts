import { test, expect, type Page } from '@playwright/test';
import { DRAGON_BALL_CODE } from '../src/shared/dragonBall';
import { avatarIds } from '../src/shared/avatars';
import { installDashboardHost } from './fixtures/dashboard';
import { navigate, openSessionSection } from './ui-navigation-helpers';
import type { ClientMessage } from '../src/shared/types';

const requests = (page: Page) =>
  page.evaluate(() =>
    (Reflect.get(window, 'dashboardMessages') as ClientMessage[]).filter(
      (m) => m.type === 'unlockDragonBall',
    ),
  );
async function keys(page: Page, sequence: readonly string[] = DRAGON_BALL_CODE) {
  for (const key of sequence) await page.keyboard.press(key);
}
async function unlock(page: Page) {
  await page.locator('.overview-heading h1').click();
  await keys(page);
  await expect(page.getByRole('dialog')).toContainText('Dragon Ball est débloqué et activé');
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'dragonball');
}
async function closeReveal(page: Page) {
  await page.getByRole('button', { name: 'Entrer dans le dojo' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function noBusinessWrites(page: Page) {
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, 'dashboardMessages') as ClientMessage[]).some((m) =>
        [
          'runStep',
          'approveStep',
          'finalizeFeature',
          'saveAgent',
          'saveSettings',
          'setReward',
        ].includes(m.type),
      ),
    ),
  ).toBe(false);
}

test('le code exact révèle le thème, le garde après rechargement et permet de revenir aux autres thèmes', async ({
  page,
}, info) => {
  await installDashboardHost(page);
  await navigate(page, 'Réglages');
  await expect(page.getByRole('radio', { name: 'Dragon Ball — Secret' })).toHaveCount(0);
  await keys(page);
  expect(await requests(page)).toHaveLength(0);
  await navigate(page, 'Dashboard');
  await unlock(page);
  await page.getByRole('dialog').screenshot({ path: info.outputPath('revelation.png') });
  await closeReveal(page);
  await expect(page.locator('.dragon-hero')).toBeVisible();
  expect(await requests(page)).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.dragon-hero')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await navigate(page, 'Réglages');
  await expect(page.getByRole('radio', { name: 'Dragon Ball — Secret' })).toBeChecked();
  await page.getByRole('radio', { name: 'Papier vivant — Clair' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'papier-clair');
  await expect(page.getByRole('radio', { name: 'Dragon Ball — Secret' })).toBeVisible();
  await page.getByRole('radio', { name: 'Dragon Ball — Secret' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'dragonball');
  await noBusinessWrites(page);
});

test('erreurs, pauses, répétitions, saisie et navigation interrompent le code sans détourner les flèches', async ({
  page,
}) => {
  await installDashboardHost(page);
  await page.locator('.overview-heading h1').click();
  await keys(page, [...DRAGON_BALL_CODE.slice(0, 6), 'ArrowUp', 'ArrowRight']);
  expect(await requests(page)).toHaveLength(0);
  await page.clock.install();
  await keys(page, DRAGON_BALL_CODE.slice(0, 4));
  await page.clock.fastForward(5000);
  await keys(page, DRAGON_BALL_CODE.slice(4));
  expect(await requests(page)).toHaveLength(0);
  await page.getByLabel('Projet du dashboard').focus();
  await keys(page);
  expect(await requests(page)).toHaveLength(0);
  await page.locator('.overview-heading h1').click();
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowUp');
  await page.keyboard.up('ArrowUp');
  await keys(page, DRAGON_BALL_CODE.slice(2));
  expect(await requests(page)).toHaveLength(0);
  await keys(page, DRAGON_BALL_CODE.slice(0, 4));
  await navigate(page, 'Sessions');
  await navigate(page, 'Dashboard');
  await page.locator('.overview-heading h1').click();
  await keys(page, DRAGON_BALL_CODE.slice(4));
  expect(await requests(page)).toHaveLength(0);
  // A partial overlap (three Up keys) can still finish the exact eight-key suffix.
  await page.keyboard.press('ArrowUp');
  await keys(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await noBusinessWrites(page);
});

test('un refus ou une expiration ne simule pas un déblocage et une réponse étrangère est ignorée', async ({
  page,
}) => {
  await installDashboardHost(page);
  await page.evaluate(() => Reflect.set(window, 'rejectSecret', true));
  await page.locator('.overview-heading h1').click();
  await keys(page);
  await expect(page.getByRole('alert')).toContainText('Stockage personnel indisponible');
  await expect(page.locator('html')).toHaveAttribute(
    'data-studio-theme-effective',
    'jardin-sombre',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.set(window, 'rejectSecret', false);
    Reflect.set(window, 'dropSecret', true);
  });
  await page.clock.install();
  await keys(page);
  await page.evaluate(() =>
    window.postMessage(
      { type: 'secretThemeState', dragonBallUnlocked: true, requestId: 'foreign' },
      '*',
    ),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(16000);
  await expect(page.getByRole('alert')).toContainText('n’a pas été confirmé');
  await navigate(page, 'Réglages');
  await expect(page.getByRole('radio', { name: 'Dragon Ball — Secret' })).toHaveCount(0);
});

test('les vingt costumes, le dojo et le QG restent visibles sous un thème VS Code contrasté', async ({
  page,
}, info) => {
  await installDashboardHost(page);
  await page.evaluate(() => (document.body.className = 'vscode-high-contrast'));
  await unlock(page);
  await expect(page.locator('.dragon-reveal-art')).toBeVisible();
  await closeReveal(page);
  await expect(page.locator('.dragon-hero')).toBeVisible();
  await navigate(page, 'Agents');
  await page.getByRole('button', { name: 'Nouvel agent', exact: true }).click();
  const portraits = page.locator('.avatar-picker svg[data-agent-art="dragonball"]');
  await expect(portraits).toHaveCount(20);
  expect(
    await portraits.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-avatar'))),
  ).toEqual(avatarIds);
  await page.locator('.avatar-picker').screenshot({ path: info.outputPath('vingt-agents.png') });
  await page.keyboard.press('Escape');
  await navigate(page, 'Dashboard');
  await page
    .getByRole('article', { name: 'Une palette de commandes, enfin fluide' })
    .getByRole('button', { name: / : / })
    .first()
    .click();
  await openSessionSection(page, 'Équipe et parcours');
  await expect(page.locator('.session-hq')).toBeVisible();
  await expect(page.locator('.hq-scenery')).toBeVisible();
  await page.evaluate(() => {
    const studio = Reflect.get(window, 'studioFixture');
    studio.features[0].steps[1].status = 'running';
    studio.features[0].steps[1].attempts.at(-1).status = 'running';
    window.postMessage({ type: 'state', state: studio }, '*');
  });
  for (const pose of ['idle.png', 'working.gif', 'approved.png'])
    await expect(page.locator(`.session-hq svg[data-pose="${pose}"]`).first()).toBeVisible();
  await page.locator('.session-hq').screenshot({ path: info.outputPath('qg-dragonball.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.session-hq svg[data-pose="working.gif"]')).toHaveCount(0);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('svg[data-agent-art="dragonball"]')).toHaveCount(0);
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(page.locator('.session-hq svg[data-agent-art="dragonball"]').first()).toBeVisible();
  await page.route('**/avatar-events/dragonball/*.png', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.reload();
  await page
    .getByRole('article', { name: 'Une palette de commandes, enfin fluide' })
    .getByRole('button', { name: / : / })
    .first()
    .click();
  await openSessionSection(page, 'Équipe et parcours');
  await expect(page.locator('.session-hq .pixel-avatar img').first()).toHaveAttribute(
    'src',
    /\/avatars\//,
  );
  await noBusinessWrites(page);
});

for (const width of [1440, 390])
  test(`dojo et révélation accessibles à ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1050 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installDashboardHost(page);
    await unlock(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCSS('animation-name', 'none');
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`dashboard-${width}.png`), fullPage: false });
    await noBusinessWrites(page);
  });

test('le code fonctionne aussi dans la Tour de contrôle détachée', async ({ page }) => {
  await installDashboardHost(page, true);
  await unlock(page);
  await closeReveal(page);
  await expect(page.locator('.dragon-hero')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await noBusinessWrites(page);
});
