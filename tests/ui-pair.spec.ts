import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';
function scenario(pair = true): StudioState {
  const state = structuredClone(demoState);
  state.runtime = { state: 'ready', authenticated: true, models: [] };
  const feature = state.features[0],
    step = feature.steps[0];
  state.features = [feature];
  feature.steps = [step];
  feature.activeStepId = step.id;
  delete feature.autopilot;
  delete feature.finalValidation;
  feature.criteria = [];
  feature.reviewComments = [];
  feature.status = pair ? 'attention' : 'draft';
  step.status = pair ? 'waiting_input' : 'pending';
  step.dependsOn = [];
  step.attempts = pair
    ? [
        {
          id: '00000000-0000-4000-8000-000000000001',
          startedAt: feature.createdAt,
          status: 'waiting_input',
          feedback: '',
          logs: [],
          questions: [],
          answers: {},
          changedFiles: [],
          revision: 0,
          agentName: 'Architecte',
          usage: { source: 'measured', cost: 1500000000, unit: 'nano-AIU' },
          pair: {
            phase: 'planning',
            pace: 'batches',
            revision: 2,
            turns: 1,
            organizationApproved: false,
            inputHash: 'a'.repeat(64),
            sourceKey: '',
            sessionIds: [],
            messages: [
              {
                id: 'first',
                at: feature.createdAt,
                role: 'assistant',
                content:
                  'Nous travaillons ensemble. Je propose deux lots : comprendre le besoin, puis réaliser la solution. Quel rythme préfères-tu ?',
              },
            ],
          },
        },
      ]
    : [];
  return state;
}
async function open(page: Page, state: StudioState) {
  await page.addInitScript((data) => {
    const messages: unknown[] = [];
    let saved: object = {
      view: 'sessions',
      navigationVersion: 2,
      featureId: data.features[0].id,
      stepId: data.features[0].activeStepId,
    };
    Object.assign(window, {
      pairMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => saved,
        setState: (value: object) => (saved = value),
        postMessage: (message: { type: string }) => {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
}
const post = (page: Page, message: object) =>
  page.evaluate((value) => window.postMessage(value, '*'), message);
const last = async (page: Page, type: ClientMessage['type']) =>
  page.evaluate(
    (type) =>
      (Reflect.get(window, 'pairMessages') as ClientMessage[])
        .filter((m) => m.type === type)
        .at(-1),
    type,
  );

test('launches through the existing context preview and switches to the pair workspace', async ({
  page,
}) => {
  const state = scenario(false);
  await open(page, state);
  await page.getByRole('button', { name: 'Démarrer en mode pair', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Préparer le travail en mode pair.' });
  await dialog.getByLabel('Rythme proposé').selectOption('guided');
  await dialog.getByRole('button', { name: 'Préparer l’aperçu', exact: true }).click();
  const request = (await last(page, 'previewRun')) as Extract<
    ClientMessage,
    { type: 'previewRun' }
  >;
  expect(request.launch.pairPace).toBe('guided');
  await post(page, {
    type: 'runPreview',
    requestId: request.requestId,
    preview: {
      featureId: state.features[0].id,
      stepId: state.features[0].activeStepId,
      fingerprint: 'a'.repeat(64),
      prompt: 'Contexte confirmé',
      sections: [],
      characters: 18,
      estimatedTokens: 5,
      maxCharacters: 60000,
      errors: [],
    },
  });
  await dialog.getByRole('button', { name: 'Démarrer le cadrage en pair' }).click();
  expect(
    ((await last(page, 'runStep')) as Extract<ClientMessage, { type: 'runStep' }>).launch?.pairPace,
  ).toBe('guided');
  await post(page, { type: 'state', state: scenario() });
  await expect(page.getByRole('region', { name: 'Travail en mode pair' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Valider l’organisation et démarrer' }),
  ).toBeEnabled();
});
test('preserves a draft across navigation and separates adjusting the plan from starting work', async ({
  page,
}) => {
  const state = scenario();
  await open(page, state);
  await expect(page.getByText('1,5 crédits · 1 tour')).toBeVisible();
  const field = page.getByLabel('Ton message, tes préférences ou tes ajustements');
  await field.fill('Une petite action à la fois.');
  await page.getByRole('button', { name: 'Revenir à la session', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir le mode pair' }).click();
  await expect(field).toHaveValue('Une petite action à la fois.');
  await page.getByRole('button', { name: 'Envoyer et ajuster' }).click();
  const discuss = (await last(page, 'pairTurn')) as Extract<ClientMessage, { type: 'pairTurn' }>;
  expect(discuss.action).toBe('discuss');
  expect(discuss.message).toBe('Une petite action à la fois.');
  await post(page, { type: 'pairTurnResult', requestId: discuss.requestId });
  await page.getByRole('radio', { name: /Guidé/ }).check();
  await page.getByRole('button', { name: 'Valider l’organisation et démarrer' }).click();
  const work = (await last(page, 'pairTurn')) as Extract<ClientMessage, { type: 'pairTurn' }>;
  expect(work.action).toBe('work');
  expect(work.pace).toBe('guided');
  expect(work.expectedRevision).toBe(2);
  await post(page, { type: 'pairTurnResult', requestId: work.requestId, error: 'Contexte changé' });
  await expect(page.getByRole('alert')).toContainText('Contexte changé');
  await page.getByRole('button', { name: 'Voir le contexte confirmé' }).click();
  const context = (await last(page, 'pairContext')) as Extract<
    ClientMessage,
    { type: 'pairContext' }
  >;
  await post(page, {
    type: 'pairContextResult',
    requestId: context.requestId,
    context: 'MISSION CONFIRMÉE',
  });
  await expect(page.locator('.pair-context')).toHaveText('MISSION CONFIRMÉE');
});
test('can hand off an active lot, validates the final report and remains usable on mobile', async ({
  page,
}, info) => {
  const state = scenario(),
    step = state.features[0].steps[0],
    attempt = step.attempts[0];
  step.status = attempt.status = 'running';
  attempt.pair!.phase = 'working';
  attempt.pair!.organizationApproved = true;
  state.workspaceOperation = { featureId: state.features[0].id, label: 'Travail en mode pair' };
  await open(page, state);
  await page.getByRole('button', { name: 'Continuer en solo', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  await confirmation.getByRole('button', { name: /Confirmer|Continuer/ }).click();
  expect(
    ((await last(page, 'pairTurn')) as Extract<ClientMessage, { type: 'pairTurn' }>).action,
  ).toBe('solo');
  delete state.workspaceOperation;
  step.status = attempt.status = 'awaiting_review';
  attempt.pair!.phase = 'review';
  attempt.artifact = {
    name: 'REPORT.md',
    content: '# Travail terminé',
    updatedAt: state.features[0].updatedAt,
  };
  attempt.pair!.messages.push({
    id: 'final',
    at: state.features[0].updatedAt,
    role: 'assistant',
    content: '# Travail terminé',
  });
  await post(page, { type: 'state', state });
  await page.screenshot({ path: info.outputPath('pair-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('pair-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Valider l’étape', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Confirmer|Continuer/ })
    .click();
  const approval = (await last(page, 'approveStep')) as Extract<
    ClientMessage,
    { type: 'approveStep' }
  >;
  expect(approval.expectedAttemptId).toBe(attempt.id);
  await post(page, {
    type: 'stepApprovalResult',
    featureId: state.features[0].id,
    stepId: step.id,
    attemptId: attempt.id,
  });
  await expect(page.getByRole('region', { name: 'Travail en mode pair' })).not.toBeVisible();
});
