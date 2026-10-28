import { expect, test, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';

function fixture(): StudioState {
  return {
    ...structuredClone(demoState),
    features: [],
    workspace: { ...demoState.workspace, trusted: true, canIsolate: true },
    runtime: { state: 'unavailable', models: [], error: 'Connectez votre compte Copilot.' },
  };
}
async function open(page: Page, state = fixture()) {
  await page.addInitScript((state) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      firstSessionMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({ view: 'sessions', navigationVersion: 2 }),
        setState() {},
        postMessage(message: ClientMessage) {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
          if (message.type === 'createFeature')
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'featureCreateResult',
                    requestId: message.requestId,
                    featureId: 'created',
                  },
                  '*',
                ),
              0,
            );
        },
      }),
    });
  }, state);
  await page.goto('/');
}
const messages = (page: Page): Promise<ClientMessage[]> =>
  page.evaluate(() => Reflect.get(window, 'firstSessionMessages'));

test('first session explains the path and prepares an actual team without connecting or running an agent', async ({
  page,
}, info) => {
  await open(page);
  await expect(page.getByRole('region', { name: 'Votre première session' })).toContainText(
    'Connectez votre compte Copilot.',
  );
  await page.getByRole('button', { name: 'Préparer ma première session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await dialog.getByLabel('Qu’allons-nous faire ?').fill('Ajouter un filtre');
  await expect(
    dialog.getByRole('radio', { name: 'Développer une évolution', exact: false }),
  ).toBeChecked();
  await expect(dialog.getByRole('combobox', { name: 'Permissions Copilot' })).not.toBeVisible();
  await expect(dialog.locator('.starter-preview')).toContainText('Cadrage → Conception');
  await page.screenshot({ path: info.outputPath('first-session-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Créer la session' }).click();
  await expect(dialog).not.toBeVisible();
  const sent = await messages(page);
  expect(sent.find((m) => m.type === 'createFeature')).toMatchObject({
    workflowId: 'feature',
    permissionMode: 'manual',
    isolated: true,
  });
  expect(sent.some((m) => ['runStep', 'startAutopilot', 'checkRuntime'].includes(m.type))).toBe(
    false,
  );
});

test('review uses the current changes and a changed intent preserves the human brief', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Préparer ma première session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Qu’allons-nous faire ?').fill('Relire ma correction');
  await dialog
    .getByLabel('Le contexte et le résultat souhaité')
    .fill('Vérifier la gestion des erreurs.');
  await dialog.getByRole('radio', { name: 'Corriger un problème', exact: false }).check();
  await expect(dialog.locator('.starter-preview')).toContainText(
    'Conception → Développement → Tests → Relecture',
  );
  await dialog.getByRole('radio', { name: 'Relire des changements', exact: false }).check();
  await expect(dialog.getByLabel('Le contexte et le résultat souhaité')).toHaveValue(
    'Vérifier la gestion des erreurs.',
  );
  await dialog.getByRole('button', { name: 'Créer la session' }).click();
  expect((await messages(page)).find((m) => m.type === 'createFeature')).toMatchObject({
    workflowId: 'code-review',
    isolated: false,
    permissionMode: 'manual',
  });
});

test('an unavailable member blocks its preset and an explicit custom team remains available', async ({
  page,
}) => {
  const state = fixture();
  state.agents = state.agents.filter(
    (agent) => agent.id !== state.workflows.find((w) => w.id === 'feature')!.steps[0].agentId,
  );
  await open(page, state);
  await page.getByRole('button', { name: 'Préparer ma première session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Qu’allons-nous faire ?').fill('Mon besoin');
  await expect(dialog.getByRole('alert')).toContainText('n’est plus disponible');
  await expect(dialog.getByRole('button', { name: 'Créer la session' })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Composer mon équipe', exact: false }).check();
  await dialog.getByRole('button', { name: 'Créer la session' }).click();
  const request = (await messages(page)).find((m) => m.type === 'createFeature');
  expect(request).toBeTruthy();
  expect(request).not.toHaveProperty('workflowId');
});

test('first session respects trust and keeps controls accessible in a narrow window', async ({
  page,
}, info) => {
  const state = fixture();
  state.workspace.trusted = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, state);
  await expect(page.getByRole('button', { name: 'Préparer ma première session' })).toBeDisabled();
  await page.getByRole('button', { name: 'Approuver le projet dans VS Code' }).click();
  expect((await messages(page)).at(-1)?.type).toBe('manageWorkspaceTrust');
  state.workspace.trusted = true;
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
  await page.getByRole('button', { name: 'Préparer ma première session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Qu’allons-nous faire ?').fill('Mon premier besoin');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const card of await dialog.locator('.session-starter').all()) {
    expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect((await card.getByRole('radio').boundingBox())!.width).toBeLessThan(32);
  }
  await dialog.locator('.creation-options > summary').click();
  await expect(dialog.getByRole('combobox', { name: 'Permissions Copilot' })).toHaveValue('manual');
  await expect(dialog.getByRole('button', { name: 'Créer la session' })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('first-session-390.png'), fullPage: true });
  await expect(dialog).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
