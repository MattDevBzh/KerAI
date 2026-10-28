import { test, expect, type Page } from '@playwright/test';
import { navigate } from './ui-navigation-helpers';
import { demoState } from '../webview/demo';
import { featureStateKey } from '../src/shared/collaboration';
import type { StudioState, ClientMessage } from '../src/shared/types';

function scenario(automatic = true): StudioState {
  const state = structuredClone(demoState);
  state.runtime = { state: 'ready', authenticated: true, models: [] };
  const feature = state.features[0];
  feature.status = 'attention';
  feature.steps.forEach((step, index) => {
    step.status = 'pending';
    step.attempts = [];
    step.optional = index === 0;
  });
  feature.activeStepId = feature.steps[0].id;
  feature.autopilot = {
    status: 'paused',
    runs: 0,
    maxRuns: 10,
    maxCorrectionCycles: 1,
    correctionCycles: 0,
    checkpoints: [],
    stepInputs: {},
    updatedAt: feature.updatedAt,
  };
  if (automatic)
    feature.optionalRequest = {
      id: 'optional-request',
      stepId: feature.activeStepId,
      stateKey: featureStateKey(feature),
    };
  state.features = [feature];
  return state;
}
async function open(page: Page, state = scenario()) {
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      optionalMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({
          view: 'dashboard',
          featureId: data.features[0].id,
          stepId: data.features[0].activeStepId,
        }),
        setState() {},
        postMessage(message: ClientMessage) {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
}
async function choices(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(window, 'optionalMessages') as ClientMessage[]).filter(
      (m) => m.type === 'resolveOptionalStep',
    ),
  );
}
test('passes a cancelled optional attempt only after confirmation', async ({ page }) => {
  const state = scenario(false),
    feature = state.features[0],
    step = feature.steps[0];
  step.status = 'cancelled';
  step.optionalDecision = {
    id: 'run-choice',
    action: 'run',
    at: feature.updatedAt,
    author: 'human',
  };
  step.attempts = [
    {
      id: 'stopped',
      status: 'cancelled',
      startedAt: feature.createdAt,
      feedback: '',
      logs: [],
      questions: [],
      answers: {},
      changedFiles: ['src/partial.ts'],
    },
  ];
  await open(page, state);
  const skip = page.getByRole('button', { name: 'Passer cette intervention', exact: true });
  await expect(skip).toBeEnabled();
  await skip.click();
  const dialog = page.getByRole('dialog', { name: 'Passer cette intervention ?' });
  await expect(dialog).toContainText(
    'Les modifications déjà faites dans le projet sont conservées',
  );
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(await choices(page)).toHaveLength(0);
  await skip.click();
  await dialog.getByRole('button', { name: 'Passer et continuer', exact: true }).click();
  await expect.poll(() => choices(page)).toHaveLength(1);
  expect((await choices(page))[0]).toMatchObject({
    choice: 'skip',
    expectedStateKey: featureStateKey(feature),
  });
});

test('automatic decisions remain visible after deferral and reopening, with no inference', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 650 });
  await open(page);
  const banner = page.getByRole('region', { name: 'Décision facultative attendue' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Exécuter et continuer' })).toBeVisible();
  await banner.getByRole('button', { name: 'Décider plus tard' }).click();
  await expect(banner).toContainText('Le pilote reste en pause');
  expect(await choices(page)).toHaveLength(0);
  await page.reload();
  await expect(banner).toBeVisible();
  expect(await choices(page)).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('optional-small.png'), fullPage: true });
  expect(await banner.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('skip and execute use versioned decisions, block duplicate clicks and allow retry after rejection', async ({
  page,
}) => {
  const state = scenario();
  await open(page, state);
  const banner = page.getByRole('region', { name: 'Décision facultative attendue' });
  await banner.getByRole('button', { name: 'Passer et continuer' }).click();
  await expect.poll(() => choices(page)).toHaveLength(1);
  const message = (await choices(page))[0];
  expect(message).toMatchObject({
    featureId: state.features[0].id,
    stepId: state.features[0].activeStepId,
    expectedStateKey: featureStateKey(state.features[0]),
    decisionId: 'optional-request',
    choice: 'skip',
    continueAutopilot: true,
  });
  await expect(banner.getByRole('button', { name: 'Passer et continuer' })).toBeDisabled();
  await page.evaluate(
    (requestId) =>
      window.postMessage(
        { type: 'optionalStepResult', requestId, error: 'La session a changé.' },
        '*',
      ),
    message.requestId,
  );
  await expect(banner.getByRole('alert')).toContainText('La session a changé.');
  await banner.getByRole('button', { name: 'Exécuter et continuer' }).click();
  await expect.poll(() => choices(page)).toHaveLength(2);
  expect((await choices(page))[1]).toMatchObject({ choice: 'run', continueAutopilot: true });
});

test('manual skip does not start the pilot and final skipped work is never displayed as executed', async ({
  page,
}, testInfo) => {
  const state = scenario(false),
    feature = state.features[0];
  await open(page, state);
  await page.getByRole('button', { name: 'Passer cette intervention' }).click();
  await expect.poll(() => choices(page)).toHaveLength(1);
  expect((await choices(page))[0]).not.toHaveProperty('continueAutopilot');
  feature.steps = [feature.steps[0]];
  const step = feature.steps[0];
  step.status = 'skipped';
  step.optionalDecision = {
    id: 'decision',
    action: 'skip',
    at: feature.updatedAt,
    author: 'human',
  };
  feature.status = 'awaiting_final_validation';
  await page.evaluate((data) => window.postMessage({ type: 'state', state: data }, '*'), state);
  await expect(page.getByRole('region', { name: 'Interventions passées' })).toContainText(
    '1 intervention passée — sans validation de résultat',
  );
  await expect(page.getByRole('navigation', { name: 'Étapes du parcours' })).toContainText(
    'Passée',
  );
  await expect(page.locator('.journey-check')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Valider définitivement', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText('0 validée · 1 passée / 1 intervention').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('skipped-summary.png'), fullPage: true });
});

test('the validation centre exposes optional choices and counts passed work honestly', async ({
  page,
}) => {
  const state = scenario();
  await open(page, state);
  await navigate(page, 'Validation');
  await page.getByLabel('Filtrer le centre de validation').selectOption('optional');
  const card = page.locator('.validation-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Intervention facultative à choisir');
  await card.click();
  await expect(page.getByRole('region', { name: 'Décision facultative attendue' })).toBeVisible();
  const feature = state.features[0];
  delete feature.optionalRequest;
  feature.steps = [feature.steps[0]];
  feature.steps[0].status = 'skipped';
  feature.steps[0].optionalDecision = {
    id: 'human-skip',
    action: 'skip',
    at: feature.updatedAt,
    author: 'human',
  };
  feature.status = 'awaiting_final_validation';
  await page.evaluate((data) => window.postMessage({ type: 'state', state: data }, '*'), state);
  await navigate(page, 'Validation');
  await expect(page.locator('.validation-card')).toContainText(
    '0 validée · 1 passée / 1 intervention',
  );
});
