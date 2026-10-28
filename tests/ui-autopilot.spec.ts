import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';

async function hosted(page: Page, configured = false) {
  const state: StudioState = structuredClone(demoState);
  state.runtime = { state: 'ready', authenticated: true, models: [] };
  const feature = state.features[0];
  if (configured)
    feature.autopilot = {
      checkpoints: ['review'],
      maxRuns: 8,
      runs: 2,
      maxCorrectionCycles: 1,
      correctionCycles: 0,
      stepInputs: {},
      status: 'paused',
      reason: 'Validation humaine requise.',
      updatedAt: new Date().toISOString(),
      decisions: [
        {
          at: new Date().toISOString(),
          kind: 'pause',
          stepId: 'design',
          message: 'Relire le résultat.',
          runs: 2,
          correctionCycles: 0,
        },
      ],
    };
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      testMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState: () => {},
        postMessage: (message: ClientMessage) => {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
  await page
    .locator('.session-row')
    .first()
    .getByRole('button', { name: /^Ouvrir / })
    .click();
  return state;
}
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'testMessages') as ClientMessage[]);

for (const width of [1440, 390]) {
  test(`automatic answers recap is readable and closable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await hosted(page, true);
    state.features[0].autopilot!.automaticAnswers = [
      {
        at: '2026-10-28T09:00:00Z',
        stepId: 'design',
        attemptId: 'attempt-1',
        questionId: 'q-1',
        question: 'Comment organiser les modifications ?',
        answer: 'Par petits lots (Recommandé)',
      },
    ];
    state.features[0].autopilot!.resumeAfterInteraction = true;
    await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
    await page.getByRole('button', { name: 'Réponses automatiques · 1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Réponses automatiques de l’autopilot' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Comment organiser les modifications ?');
    await expect(dialog).toContainText('Par petits lots (Recommandé)');
    await expect(dialog).toContainText('Conception');
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`automatic-answers-${width}.png`),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: 'Fermer le récapitulatif' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Rester en pause' }).click();
    expect((await messages(page)).at(-1)).toEqual({
      type: 'pauseAutopilot',
      featureId: state.features[0].id,
    });
  });
}

test('autopilot preserves configuration after a rejected save and waits for acknowledgement', async ({
  page,
}) => {
  await hosted(page);
  await page.locator('.autopilot-bar').getByRole('button', { name: 'Configurer' }).click();
  await page.getByLabel('Profil d’autonomie').selectOption('autonomous');
  await page.getByLabel('Contexte initial de Conception').fill('Conserver cette saisie');
  await page.getByRole('button', { name: 'Enregistrer l’autopilot' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveAutopilot' }>;
  expect(saved.config.checkpoints).toEqual([]);
  await expect(page.getByRole('button', { name: 'Enregistrement…' })).toBeDisabled();
  await page.evaluate(
    (requestId) =>
      window.postMessage(
        { type: 'autopilotSaved', requestId, error: 'Route de correction invalide.' },
        '*',
      ),
    saved.requestId,
  );
  await expect(page.getByRole('alert')).toContainText('Route de correction invalide.');
  await expect(page.getByLabel('Contexte initial de Conception')).toHaveValue(
    'Conserver cette saisie',
  );
  await page.getByRole('button', { name: 'Enregistrer l’autopilot' }).click();
  const retry = (await messages(page)).at(-1) as typeof saved;
  expect(retry.requestId).not.toBe(saved.requestId);
  expect(retry.config).toEqual(saved.config);
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'autopilotSaved', requestId }, '*'),
    saved.requestId,
  );
  await expect(page.getByLabel('Contexte initial de Conception')).toBeVisible();
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'autopilotSaved', requestId }, '*'),
    retry.requestId,
  );
  await expect(page.getByLabel('Contexte initial de Conception')).toHaveCount(0);
  expect((await messages(page)).some((message) => message.type === 'startAutopilot')).toBe(false);
});

test('autopilot waits for a usable preflight and displays the decision journal', async ({
  page,
}) => {
  const state = await hosted(page, true);
  await page.getByText('Journal du pilote · 1 décisions conservées').click();
  await expect(page.locator('.autopilot-journal')).toContainText('Relire le résultat.');
  await page.getByRole('button', { name: 'Reprendre l’autopilot' }).click();
  await expect(page.getByRole('button', { name: 'Démarrer l’autopilot' })).toBeDisabled();
  const request = (await messages(page)).at(-1) as Extract<
    ClientMessage,
    { type: 'previewAutopilot' }
  >;
  expect(request.type).toBe('previewAutopilot');
  const preview = {
    featureId: state.features[0].id,
    next: 'Exécuter : Conception.',
    remainingRuns: 6,
    remainingCorrections: 1,
    errors: ['Contexte périmé.'],
    steps: [
      {
        id: 'design',
        name: 'Conception',
        notes: ['Validation humaine après cette étape.', 'Permissions : Manuel.'],
      },
    ],
  };
  await page.evaluate(
    ({ requestId, preview }) =>
      window.postMessage({ type: 'autopilotPreview', requestId, preview }, '*'),
    { requestId: request.requestId, preview },
  );
  await expect(page.getByRole('alert')).toContainText('Contexte périmé.');
  await expect(page.getByRole('button', { name: 'Démarrer l’autopilot' })).toBeDisabled();
  preview.errors = [];
  await page.evaluate(
    ({ requestId, preview }) =>
      window.postMessage({ type: 'autopilotPreview', requestId, preview }, '*'),
    { requestId: request.requestId, preview },
  );
  await expect(page.getByText('6 exécutions et 1 corrections restantes.')).toBeVisible();
  await expect(page.getByText('Permissions : Manuel.')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('autopilot-preflight.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Démarrer l’autopilot' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'startAutopilot',
    featureId: state.features[0].id,
  });
});

test('autonomy profiles change checkpoints without changing Copilot permissions at narrow width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await hosted(page);
  await page.locator('.autopilot-bar').getByRole('button', { name: 'Configurer' }).click();
  await page.getByLabel('Profil d’autonomie').selectOption('guided');
  await expect(
    page
      .getByRole('group', { name: 'Validation humaine après ces étapes' })
      .getByRole('checkbox')
      .first(),
  ).toBeChecked();
  await page.getByLabel('Profil d’autonomie').selectOption('balanced');
  await page.getByRole('button', { name: 'Enregistrer l’autopilot' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveAutopilot' }>;
  expect(saved.config.checkpoints).toContain('review');
  expect(Object.values(saved.config.stepInputs).every((input) => !input.permissionMode)).toBe(true);
  expect(state.features[0].execution).toBeUndefined();
  const width = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    screen: innerWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.screen);
  await page.screenshot({ path: test.info().outputPath('autopilot-mobile.png'), fullPage: true });
});
