import { expect, test, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';

async function open(page: Page) {
  const state = structuredClone(demoState);
  state.features = [state.features[0]];
  state.features[0].title = 'Session habituelle';
  state.features[0].archived = false;
  state.features[0].status = 'draft';
  state.features[0].steps.forEach((step) => {
    step.status = 'pending';
    step.attempts = [];
  });
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      reviewMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({ view: 'reviews', navigationVersion: 2 }),
        setState() {},
        postMessage(message: ClientMessage) {
          messages.push(message);
          const post = (value: unknown) => setTimeout(() => window.postMessage(value, '*'), 0);
          if (message.type === 'ready') post({ type: 'state', state: data });
          if (message.type === 'reviewBranches')
            post({
              type: 'reviewBranchesResult',
              requestId: message.requestId,
              branches: [
                { name: 'main', ref: 'refs/heads/main', commit: 'a'.repeat(40) },
                { name: 'feature/test', ref: 'refs/heads/feature/test', commit: 'b'.repeat(40) },
              ],
            });
          if (message.type === 'createFeature') {
            const step = {
              ...data.features[0].steps.at(-1)!,
              id: 'review',
              name: 'Relecture',
              dependsOn: [],
              status: 'pending' as const,
              attempts: [],
            };
            const feature = {
              ...data.features[0],
              id: 'review-created',
              title: message.title,
              reviewTarget: message.reviewTarget,
              description: '',
              workflowName: 'Relecture',
              steps: [step],
              activeStepId: 'review',
              autopilot: undefined,
            };
            data.features.push(feature);
            post({ type: 'state', state: data });
            post({
              type: 'featureCreateResult',
              requestId: message.requestId,
              featureId: feature.id,
            });
            post({ type: 'navigate', view: 'reviews', featureId: feature.id });
          }
        },
      }),
    });
  }, state);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Relectures 0' })).toBeVisible();
}
const sent = (page: Page): Promise<ClientMessage[]> =>
  page.evaluate(() => Reflect.get(window, 'reviewMessages'));

test('creates local review without asking for context, opens the ordinary editable session and keeps lists separate', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText('Session habituelle', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle relecture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle relecture' });
  await expect(dialog.locator('textarea')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Créer la relecture' }).click();
  await expect(
    page.getByRole('heading', { name: 'Relecture · Modifications non commitées', exact: true }),
  ).toBeVisible();
  expect((await sent(page)).find((message) => message.type === 'createFeature')).toMatchObject({
    description: '',
    reviewTarget: { kind: 'working-tree' },
  });
  await page.getByText('Équipe et parcours ·', { exact: false }).click();
  await page.getByRole('button', { name: 'Modifier l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Composer mon équipe' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Vos relectures' }).click();
  await expect(page.getByRole('heading', { name: 'Relectures 1' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('reviews-list.png') });
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sessions 1' })).toBeVisible();
  await expect(page.getByText('Session habituelle', { exact: true })).toBeVisible();
});

test('requires two distinct branches and preserves source and destination', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Nouvelle relecture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle relecture' });
  await dialog.getByLabel('Changements à relire').selectOption('branches');
  await dialog.getByLabel('Branche source').selectOption('refs/heads/main');
  await dialog.getByLabel('Branche destination').selectOption('refs/heads/main');
  await expect(dialog.getByRole('button', { name: 'Créer la relecture' })).toBeDisabled();
  await dialog.getByLabel('Branche source').selectOption('refs/heads/feature/test');
  await page.screenshot({ path: test.info().outputPath('reviews-branches.png') });
  await dialog.getByRole('button', { name: 'Créer la relecture' }).click();
  expect((await sent(page)).find((message) => message.type === 'createFeature')).toMatchObject({
    reviewTarget: {
      kind: 'branches',
      source: 'refs/heads/feature/test',
      destination: 'refs/heads/main',
    },
  });
});

test('requires a valid PR URL and offers distinct reviewer preferences', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Nouvelle relecture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle relecture' });
  await dialog.getByRole('button', { name: 'Pull Request', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Créer la relecture' })).toBeDisabled();
  await dialog.getByLabel('URL de la Pull Request').fill('https://github.com/team/repo/pull/42');
  await dialog.getByRole('button', { name: 'Créer la relecture' }).click();
  expect((await sent(page)).find((message) => message.type === 'createFeature')).toMatchObject({
    reviewTarget: { kind: 'pull-request', url: 'https://github.com/team/repo/pull/42' },
  });
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await expect(page.getByLabel('Relecteur des Pull Requests')).toBeVisible();
  await page.getByLabel('Relecteur des Pull Requests').selectOption('reviewer');
  await page.getByLabel('Relecteur des branches Git').selectOption('architect');
  await page.getByRole('button', { name: /Enregistrer les réglages/ }).click();
  expect((await sent(page)).find((message) => message.type === 'saveSettings')).toMatchObject({
    settings: { reviewDefaults: { pullRequest: 'reviewer', branch: 'architect' } },
  });
});

test('review creation fits a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: 'Nouvelle relecture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle relecture' });
  await dialog.getByLabel('Changements à relire').selectOption('branches');
  await dialog.getByLabel('Branche source').selectOption('refs/heads/feature/test');
  await expect(dialog.getByLabel('Branche destination')).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('reviews-mobile.png') });
});
