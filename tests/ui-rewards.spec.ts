import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import { rewards, emptyRewardSelection, type RewardSelection } from '../src/shared/rewards';
import { featureStateKey } from '../src/shared/collaboration';
import type { ClientMessage } from '../src/shared/types';
import { navigate } from './ui-navigation-helpers';

async function hosted(
  page: Page,
  {
    trophies = 0,
    theme = 'guilde-sombre',
    session = false,
    completed = false,
    selection = emptyRewardSelection(),
  } = {},
) {
  const studio = structuredClone(demoState);
  studio.runtime.state = 'ready';
  if (completed) {
    const feature = studio.features[0];
    feature.steps.forEach((step) => {
      step.status = 'approved';
      step.attempts.forEach((attempt) => {
        attempt.status = 'approved';
      });
    });
    feature.status = 'completed';
    feature.criteria = [];
    feature.reviewComments = [];
    feature.finalValidation = {
      id: 'reward-final',
      at: feature.updatedAt,
      author: 'human',
      stateKey: featureStateKey(feature),
    };
  }
  await page.addInitScript(
    ({ studio, trophies, theme, session, selection, rewards }) => {
      const key = 'reward-test-preferences';
      let preferences = JSON.parse(localStorage.getItem(key) ?? 'null') ?? { selection, theme };
      let total = trophies;
      const sent: ClientMessage[] = [];
      const rewardState = () => ({
        ready: true,
        unlocked: rewards.filter((reward) => total >= reward.threshold).map((reward) => reward.id),
        selection: preferences.selection,
      });
      const publish = () => {
        window.postMessage(
          { type: 'questState', state: { counts: {}, completed: {}, trophies: total } },
          '*',
        );
        window.postMessage({ type: 'rewardState', state: rewardState() }, '*');
        window.postMessage({ type: 'themeState', theme: preferences.theme }, '*');
      };
      Object.assign(window, {
        rewardMessages: sent,
        rewardPublish: (next: number) => {
          total = next;
          publish();
        },
        acquireVsCodeApi: () => ({
          getState: () => ({
            navigationVersion: 2,
            view: session ? 'sessions' : 'quests',
            ...(session
              ? { featureId: studio.features[0].id, stepId: studio.features[0].activeStepId }
              : {}),
          }),
          setState() {},
          postMessage(message: ClientMessage) {
            sent.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state: studio }, '*');
                window.postMessage({ type: 'livingHqState', enabled: true }, '*');
                window.postMessage({ type: 'zoomState', zoom: 100 }, '*');
                publish();
              }, 0);
            if (message.type === 'refreshRewards') publish();
            if (message.type === 'setReward' && !Reflect.get(window, 'dropReward'))
              setTimeout(() => {
                const reward = rewards.find((candidate) => candidate.id === message.rewardId)!;
                const rejected = Reflect.get(window, 'rejectReward') || total < reward.threshold;
                if (!rejected) {
                  preferences = structuredClone(preferences);
                  if (reward.kind === 'theme')
                    preferences.theme = message.enabled ? reward.id : 'auto';
                  else preferences.selection[reward.kind] = message.enabled ? reward.id : null;
                  localStorage.setItem(key, JSON.stringify(preferences));
                  window.postMessage({ type: 'themeState', theme: preferences.theme }, '*');
                }
                window.postMessage(
                  {
                    type: 'rewardState',
                    state: rewardState(),
                    requestId: message.requestId,
                    ...(rejected ? { error: 'Préférences en lecture seule.' } : {}),
                  },
                  '*',
                );
              }, 10);
          },
        }),
      });
    },
    { studio, trophies, theme, session, selection, rewards },
  );
  await page.goto('/');
  await expect(page.locator(session ? '.feature-page' : '.quests-page')).toBeVisible();
}
const card = (page: Page, id: string) => page.locator(`.reward-card[data-reward-id="${id}"]`);
const update = (page: Page, trophies: number) =>
  page.evaluate((total) => Reflect.get(window, 'rewardPublish')(total), trophies);
async function noBusinessCommands(page: Page) {
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, 'rewardMessages') as ClientMessage[]).some((message) =>
        ['runStep', 'approveStep', 'finalizeFeature', 'saveArtifact', 'createFeature'].includes(
          message.type,
        ),
      ),
    ),
  ).toBe(false);
}

test('un seul cadeau futur, tous les seuils exacts, jauge par palier et collection complète à 200', async ({
  page,
}, testInfo) => {
  await hosted(page);
  for (const total of [0, 4, 5, 19, 20, 28, 39, 40, 69, 70, 109, 110, 199, 200, 427]) {
    await update(page, total);
    const next = rewards.find((reward) => reward.threshold > total);
    await expect(page.locator('.reward-next')).toHaveCount(next ? 1 : 0);
    if (next) {
      await expect(page.locator('.reward-next')).toHaveAttribute('data-reward-id', next.id);
      await expect(page.locator('.reward-next')).toContainText(
        `Encore ${next.threshold - total} trophée`,
      );
      for (const future of rewards.filter((reward) => reward.threshold > next.threshold))
        await expect(
          page.getByRole('img', { name: `Aperçu : ${future.name}`, exact: true }),
        ).toHaveCount(0);
    }
    await expect(page.locator('.reward-card')).toHaveCount(
      rewards.filter((reward) => reward.threshold <= total).length,
    );
    if (total === 28) {
      await expect(
        page.getByRole('progressbar', { name: 'Progression vers la prochaine récompense' }),
      ).toHaveAttribute('value', '8');
      await expect(
        page.getByRole('progressbar', { name: 'Progression vers la prochaine récompense' }),
      ).toHaveAttribute('max', '20');
      await page
        .locator('.rewards-section')
        .screenshot({ path: testInfo.outputPath('prochain-cadeau.png') });
    }
  }
  await expect(page.getByText('Toutes les récompenses actuelles sont débloquées !')).toBeVisible();
  await noBusinessCommands(page);
});

test('un déblocage propose Activer ou Plus tard, sans activation automatique ni répétition au rechargement', async ({
  page,
}) => {
  await hosted(page, { trophies: 4 });
  await update(page, 5);
  const notice = page.getByRole('complementary', { name: 'Nouvelle récompense' });
  await expect(notice).toContainText('Noob');
  await expect(page.locator('html')).toHaveAttribute(
    'data-studio-theme-effective',
    'guilde-sombre',
  );
  await notice.getByRole('button', { name: 'Activer Noob' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'noob');
  await expect(notice).toHaveCount(0);
  await expect(card(page, 'noob').getByRole('button')).toContainText('Activé');
  await update(page, 20);
  await notice.getByRole('button', { name: 'Plus tard' }).click();
  await expect(page.locator('.reward-title')).toHaveCount(0);
  await expect(card(page, 'architecte')).toBeVisible();
  // Reload with a known existing entitlement, just as the host re-reads its ledger.
  await page.reload();
  await expect(notice).toHaveCount(0);
  await noBusinessCommands(page);
});

test('les titres se remplacent, les choix persistent et les cadeaux restent acquis après désactivation', async ({
  page,
}) => {
  await hosted(page, { trophies: 200 });
  await card(page, 'architecte')
    .getByRole('button', { name: 'Activer Architecte du dimanche' })
    .click();
  await expect(page.locator('.reward-title')).toHaveText('Architecte du dimanche');
  await card(page, 'dresseur').getByRole('button', { name: 'Activer Dresseur d’agents' }).click();
  await expect(page.locator('.reward-title')).toHaveText('Dresseur d’agents');
  await card(page, 'eiffel')
    .getByRole('button', { name: /Activer/ })
    .click();
  await card(page, 'kitten')
    .getByRole('button', { name: /Activer/ })
    .click();
  await expect(card(page, 'kitten').getByRole('button')).toContainText('Activé');
  await page.reload();
  await expect(page.locator('.reward-title')).toHaveText('Dresseur d’agents');
  await expect(card(page, 'eiffel').getByRole('button')).toContainText('Activé');
  await expect(card(page, 'kitten').getByRole('button')).toContainText('Activé');
  await card(page, 'dresseur').getByRole('button').click();
  await expect(page.locator('.reward-title')).toHaveCount(0);
  await expect(page.locator('.reward-card')).toHaveCount(6);
  await expect(page.locator('.quest-trophy strong')).toHaveText('200');
  await noBusinessCommands(page);
});

test('un refus, une réponse étrangère ou une expiration ne prétend pas appliquer une récompense', async ({
  page,
}) => {
  await hosted(page, { trophies: 200 });
  await page.evaluate(() => Reflect.set(window, 'rejectReward', true));
  await card(page, 'architecte').getByRole('button').click();
  await expect(page.locator('.reward-error')).toContainText('lecture seule');
  await expect(page.locator('.reward-title')).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.set(window, 'rejectReward', false);
    Reflect.set(window, 'dropReward', true);
  });
  await page.clock.install();
  await card(page, 'dresseur').getByRole('button').click();
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'rewardState',
        requestId: 'foreign',
        state: {
          ready: true,
          unlocked: ['dresseur'],
          selection: { title: 'dresseur', celebration: null, mascot: null },
        },
      },
      '*',
    ),
  );
  await expect(page.locator('.reward-title')).toHaveCount(0);
  await page.clock.fastForward(16000);
  await expect(page.locator('.reward-error')).toContainText('n’a pas confirmé');
  await expect(card(page, 'dresseur').getByRole('button')).toBeEnabled();
  await expect(page.locator('.reward-title')).toHaveCount(0);
});

test('les thèmes verrouillés restent absents des réglages ; les thèmes gagnés et leur QG fonctionnent', async ({
  page,
}) => {
  await hosted(page, { trophies: 0 });
  await navigate(page, 'Réglages');
  await expect(page.getByRole('radio', { name: 'Noob — Récompense' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Matrix — Récompense' })).toHaveCount(0);
  await update(page, 5);
  await expect(page.getByRole('radio', { name: 'Noob — Récompense' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Matrix — Récompense' })).toHaveCount(0);
  await update(page, 70);
  await expect(page.getByRole('radio', { name: 'Matrix — Récompense' })).toBeVisible();
});

for (const theme of ['noob', 'matrix'])
  test(`récompenses et thème ${theme} lisibles à 1440 et 390 px`, async ({ page }, testInfo) => {
    await hosted(page, {
      trophies: 200,
      theme,
      selection: { ...emptyRewardSelection(), title: 'dresseur' },
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      await expect
        .poll(() =>
          page
            .locator('.reward-preview img')
            .evaluateAll((images) =>
              images.every(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-${width}.png`),
        fullPage: false,
      });
    }
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', 'auto');
    await expect(card(page, 'noob').getByRole('button')).toBeVisible();
    await page.emulateMedia({ forcedColors: 'none' });
    await expect(page.locator('html')).toHaveAttribute('data-studio-theme-effective', theme);
  });

test('le chaton marche seulement dans le QG et reste immobile avec mouvement réduit', async ({
  page,
}, testInfo) => {
  const selection: RewardSelection = { ...emptyRewardSelection(), mascot: 'kitten' };
  await hosted(page, { trophies: 200, theme: 'noob', session: true, selection });
  await page.clock.install();
  const kitten = page.getByRole('img', { name: 'Chaton, ton compagnon du QG' });
  await expect(kitten).toBeVisible();
  await page.clock.fastForward(2500);
  await expect(kitten.locator('.kitten-position')).toHaveAttribute('data-phase', '1');
  await expect(kitten.locator('.kitten-sprite')).toHaveClass(/walking/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(kitten.locator('.kitten-position')).toHaveAttribute('data-phase', '0');
  await expect(kitten.locator('.kitten-sprite')).toHaveCSS('animation-name', 'none');
  await page
    .getByRole('navigation', { name: 'QG de la session' })
    .getByRole('button', { name: /Étape 4/ })
    .click();
  await expect(page.locator('.workbench-heading h2')).toHaveText('Tests');
  await page.locator('.session-hq').screenshot({ path: testInfo.outputPath('noob-kitten.png') });
  await page.getByRole('checkbox', { name: 'Afficher le QG vivant' }).uncheck();
  await expect(kitten).toHaveCount(0);
  await noBusinessCommands(page);
});

test('le feu d’artifice célèbre une session finalisée, se ferme et respecte le mouvement réduit', async ({
  page,
}, testInfo) => {
  await hosted(page, {
    trophies: 200,
    session: true,
    completed: true,
    selection: { ...emptyRewardSelection(), celebration: 'eiffel' },
  });
  await expect(page.locator('.eiffel-celebration')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rejouer la célébration' }).click();
  await expect(page.locator('.eiffel-celebration')).toBeVisible();
  await expect(page.locator('.eiffel-celebration img')).toHaveJSProperty('complete', true);
  await expect
    .poll(() =>
      page
        .locator('.firework i')
        .first()
        .evaluate((spark) => Number(getComputedStyle(spark).opacity)),
    )
    .toBeGreaterThan(0.5);
  await page
    .locator('.eiffel-celebration')
    .screenshot({ path: testInfo.outputPath('eiffel.png'), animations: 'allow' });
  await page.getByRole('button', { name: 'Fermer le feu d’artifice' }).click();
  await expect(page.locator('.eiffel-celebration')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Rejouer la célébration' })).toBeDisabled();
  await noBusinessCommands(page);
});
