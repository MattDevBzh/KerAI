import { expect, test, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';

function scenario() {
  const state = structuredClone(demoState);
  state.runtime = { state: 'ready', authenticated: true, models: [] };
  const feature = state.features[0];
  feature.status = 'attention';
  feature.activeStepId = feature.steps.at(-1)!.id;
  feature.criteria = [];
  feature.steps.forEach((step, index) => {
    step.status = index < feature.steps.length - 1 ? 'approved' : 'awaiting_review';
    step.attempts = [
      {
        id: `attempt-${step.id}`,
        revision: 2,
        status: step.status,
        startedAt: feature.createdAt,
        finishedAt: feature.updatedAt,
        feedback: '',
        logs: [],
        questions: [],
        answers: {},
        changedFiles: [],
        artifact: {
          name: step.artifact,
          content: 'CURRENT_HUMAN_VERSION',
          updatedAt: feature.updatedAt,
        },
        artifactVersions: [
          {
            revision: 0,
            author: 'agent',
            content: 'ORIGINAL_AGENT_VERSION',
            at: feature.createdAt,
          },
          {
            revision: 1,
            author: 'human',
            content: 'FIRST_HUMAN_VERSION',
            at: feature.updatedAt,
            reason: 'Human clarification',
          },
          { revision: 2, author: 'human', content: 'CURRENT_HUMAN_VERSION', at: feature.updatedAt },
        ],
      },
    ];
  });
  state.features = [feature];
  return state;
}
async function open(page: Page, state: StudioState) {
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      independentMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({
          view: 'dashboard',
          featureId: data.features[0].id,
          stepId: data.features[0].activeStepId,
        }),
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
  await expect(
    page.getByRole('heading', { name: state.features[0].title, exact: true }),
  ).toBeVisible();
}
async function post(page: Page, state: StudioState) {
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
}
async function savedRequests(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(window, 'independentMessages') as ClientMessage[]).filter(
      (message) => message.type === 'saveArtifact',
    ),
  );
}

test('closing and reopening a stale editorial draft keeps its original concurrency baseline', async ({
  page,
}) => {
  const state = scenario(),
    feature = state.features[0],
    step = feature.steps.at(-1)!;
  await open(page, state);
  await page.getByRole('button', { name: 'Modifier le compte rendu' }).click();
  await page
    .getByRole('textbox', { name: 'Compte rendu modifié', exact: true })
    .fill('MY_STALE_DRAFT');
  step.attempts[0].revision = 3;
  step.attempts[0].artifact!.content = 'EXTERNAL_WINNING_VERSION';
  await post(page, state);
  await expect(
    page.getByRole('textbox', { name: 'Compte rendu modifié', exact: true }),
  ).toHaveValue('MY_STALE_DRAFT');
  await page.getByRole('button', { name: 'Fermer l’éditeur' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Étapes du parcours' }).getByRole('button').first(),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Modifier le compte rendu' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Compte rendu modifié', exact: true }),
  ).toHaveValue('MY_STALE_DRAFT');
  await page.getByRole('button', { name: 'Enregistrer et valider' }).click();
  await expect.poll(() => savedRequests(page)).toHaveLength(1);
  expect((await savedRequests(page))[0]).toMatchObject({
    expectedRevision: 2,
    content: 'MY_STALE_DRAFT',
  });
});

test('the agent original and human revisions restore into a draft without mutating saved history', async ({
  page,
}) => {
  const state = scenario();
  await open(page, state);
  await page.getByRole('button', { name: 'Modifier le compte rendu' }).click();
  await page.getByText('Original produit par l’agent', { exact: true }).click();
  await page.getByRole('button', { name: 'Utiliser l’original de l’agent' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Compte rendu modifié', exact: true }),
  ).toHaveValue('ORIGINAL_AGENT_VERSION');
  expect(await savedRequests(page)).toHaveLength(0);
  await page.getByText('Historique des versions (2)', { exact: true }).click();
  const historical = page
    .locator('.report-editor details')
    .filter({ has: page.locator('summary').filter({ hasText: 'Version 2 ·' }) })
    .last();
  await historical.locator('summary').first().click();
  await historical.getByRole('button', { name: 'Utiliser cette version du compte rendu' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Compte rendu modifié', exact: true }),
  ).toHaveValue('FIRST_HUMAN_VERSION');
  expect(await savedRequests(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Aperçu du compte rendu' }).click();
  await expect(page.locator('.report-preview')).toContainText('FIRST_HUMAN_VERSION');
});

test('correction context exclusions are visible in the preview and emitted request at a mobile viewport', async ({
  page,
}) => {
  const state = scenario(),
    feature = state.features[0],
    source = feature.steps.at(-1)!,
    excluded = feature.steps[0];
  excluded.attempts[0].artifact!.content = 'UNSELECTED_SOURCE_ORIGINAL';
  await page.setViewportSize({ width: 430, height: 850 });
  await open(page, state);
  await page.getByRole('button', { name: 'Demander une correction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Demander une correction' });
  await dialog
    .getByLabel('Correction attendue')
    .fill('A precise correction to the selected review.');
  await dialog.getByText('Inspecter et ajuster le contexte transmis', { exact: true }).click();
  await dialog.getByText(`${excluded.name} · compte rendu actuel`, { exact: true }).click();
  const block = dialog
    .locator('.correction-context-block')
    .filter({ hasText: `${excluded.name} · compte rendu actuel` });
  await block.getByRole('checkbox', { name: 'Transmettre ce compte rendu' }).uncheck();
  await expect(block.getByRole('textbox')).toBeDisabled();
  await dialog.getByText('Aperçu du contexte de correction', { exact: true }).click();
  const preview = dialog.locator('pre').last();
  await expect(preview).not.toContainText('UNSELECTED_SOURCE_ORIGINAL');
  await expect(preview).toContainText('A precise correction');
  await dialog.getByRole('button', { name: 'Lancer la correction' }).click();
  const request = await page.evaluate(() =>
    (Reflect.get(window, 'independentMessages') as ClientMessage[]).find(
      (message) => message.type === 'requestCorrection',
    ),
  );
  expect(request).toMatchObject({
    sourceStepId: source.id,
    artifactContext: { [excluded.id]: { enabled: false } },
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
