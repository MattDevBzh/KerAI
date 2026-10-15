import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import { emptyQuestState, type QuestState } from '../src/shared/quests';
async function hosted(page: Page, progression = emptyQuestState()) {
  await page.addInitScript(
    ({ state, progression }) => {
      Object.assign(window, {
        questMessages: [],
        acquireVsCodeApi: () => ({
          getState: () => ({ view: 'quests' }),
          setState() {},
          postMessage(message: unknown) {
            (Reflect.get(window, 'questMessages') as unknown[]).push(message);
            if ((message as { type: string }).type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'questState', state: progression }, '*');
                window.postMessage({ type: 'themeState', theme: 'guilde-sombre' }, '*');
              }, 0);
          },
        }),
      });
    },
    { state: structuredClone(demoState), progression },
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Apprendre en jouant. Avancer à votre rythme.' }),
  ).toBeVisible();
}
async function update(page: Page, state: QuestState, earned: string[] = []) {
  await page.evaluate(
    ({ state, earned }) => window.postMessage({ type: 'questState', state, earned }, '*'),
    { state, earned },
  );
}

test('100 quêtes, séries masquées, récompense en direct et navigation sans exécution', async ({
  page,
}) => {
  await hosted(page);
  await expect(page.locator('.quest-menu-count')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Collection 100', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Composition', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Une nouvelle recrue', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Un duo maison', exact: true })).toHaveCount(0);
  const state: QuestState = {
    counts: { agentsCreated: 1 },
    completed: { 'agentsCreated-1': { at: '2026-10-16T00:00:00Z', reward: 2 } },
    trophies: 2,
  };
  await update(page, state, ['agentsCreated-1']);
  await expect(page.locator('.quest-menu-count')).toHaveText('2');
  await expect(page.locator('.quest-celebration')).toContainText('+2 trophées');
  await expect(page.getByRole('heading', { name: 'Un duo maison', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Une nouvelle recrue', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Fermer la récompense' }).click();
  await update(page, state);
  await expect(page.locator('.quest-celebration')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collection 100', exact: true }).click();
  await page.getByLabel('Rechercher une quête').fill('Cinq personnalités');
  const card = page.locator('[data-quest-id="agentsCreated-5"]');
  await expect(card).toHaveClass(/locked/);
  await expect(card.getByRole('button', { name: 'Ouvrir les agents' })).toBeDisabled();
  await card.locator('summary').click();
  await expect(card).toContainText('Agents → Nouvel agent');
  await page.getByLabel('Rechercher une quête').fill('Un duo maison');
  await page.getByRole('button', { name: 'Ouvrir les agents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nouvel agent', exact: true })).toBeVisible();
  const sent = await page.evaluate(
    () => Reflect.get(window, 'questMessages') as { type: string }[],
  );
  expect(sent.some((m) => ['runStep', 'createFeature', 'saveAgent'].includes(m.type))).toBe(false);
});

test('rechargement, écran vide et erreur ne prétendent pas gagner des trophées', async ({
  page,
}) => {
  const state: QuestState = {
    counts: { theme: 1 },
    completed: { 'theme-1': { at: '2026-10-16T00:00:00Z', reward: 1 } },
    trophies: 1,
  };
  await hosted(page, state);
  await page.reload();
  await expect(page.locator('.quest-menu-count')).toHaveText('1');
  await expect(page.locator('.quest-celebration')).toHaveCount(0);
  await page.getByRole('button', { name: 'Accomplies 1' }).click();
  await expect(page.getByRole('heading', { name: 'L’atelier vous ressemble' })).toBeVisible();
  await update(page, { ...state, error: 'Progression indisponible. Le fichier a été conservé.' });
  await expect(page.getByRole('alert')).toContainText('Le fichier a été conservé');
  await expect(page.locator('.quest-menu-count')).toHaveText('—');
  await page.getByRole('button', { name: 'Relire la progression' }).click();
  expect(await page.evaluate(() => Reflect.get(window, 'questMessages'))).toContainEqual({
    type: 'refreshQuests',
  });
  await update(page, emptyQuestState());
  await page.getByRole('button', { name: 'Accomplies 0' }).click();
  await expect(page.getByRole('heading', { name: 'Le premier trophée vous attend' })).toBeVisible();
});

for (const theme of ['jardin-clair', 'papier-sombre', 'guilde-sombre', 'halloween'])
  test(`quêtes lisibles en ${theme} sur bureau et mobile, clavier et mouvements réduits`, async ({
    page,
  }, testInfo) => {
    await hosted(page);
    await page.evaluate((theme) => window.postMessage({ type: 'themeState', theme }, '*'), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-${width}.png`),
        fullPage: false,
      });
    }
    await page.getByLabel('Rechercher une quête').fill('six fantastiques');
    const card = page.locator('[data-quest-id="relay-6"]');
    await expect(card).toBeVisible();
    await card.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(card.locator('details')).toHaveAttribute('open', '');
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
