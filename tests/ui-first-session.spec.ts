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
    let persisted: Record<string, unknown> = { view: 'sessions', navigationVersion: 2 };
    let drafts: import('../src/shared/taskDrafts').TaskDraft[] = [];
    Object.assign(window, {
      firstSessionMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => persisted,
        setState(value: Record<string, unknown>) {
          persisted = value;
        },
        postMessage(message: ClientMessage) {
          messages.push(message);
          if (message.type === 'prepareSessionGit')
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'sessionGitPrepared',
                    requestId: message.requestId,
                    preparation: {
                      id: message.requestId,
                      branch: 'main',
                      head: 'a'.repeat(40),
                      dirtyCount: 0,
                      remotes: ['origin'],
                      remote: 'origin',
                      fetchedAt: '2026-11-08T12:00:00Z',
                      defaultRef: 'refs/remotes/origin/main',
                      branches: [
                        {
                          name: 'origin/main',
                          ref: 'refs/remotes/origin/main',
                          commit: 'b'.repeat(40),
                        },
                      ],
                      ...Reflect.get(window, 'gitPreparationPatch'),
                    },
                  },
                  '*',
                ),
              0,
            );
          if (message.type === 'saveTaskDraft')
            drafts = [
              ...drafts.filter((d) => d.id !== message.draft.id),
              { ...message.draft, revision: message.draft.revision + 1 },
            ];
          if (message.type === 'deleteTaskDraft')
            drafts = drafts.filter((d) => d.id !== message.id);
          if (['listTaskDrafts', 'saveTaskDraft', 'deleteTaskDraft'].includes(message.type))
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'taskDrafts',
                    drafts,
                    requestId: 'requestId' in message ? message.requestId : undefined,
                  },
                  '*',
                ),
              0,
            );
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

test('keeps a task draft while another task runs and restores its pair and progression choices', async ({
  page,
}) => {
  const state = fixture();
  state.workspaceOperation = { label: 'Agent au travail' };
  await open(page, state);
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await dialog.getByLabel('Qu’allons-nous faire ?').fill('Préparer sans interrompre');
  await dialog
    .getByRole('combobox')
    .filter({ has: page.locator('option[value="pair"]') })
    .selectOption('pair');
  await dialog
    .getByRole('combobox')
    .filter({ has: page.locator('option[value="balanced"]') })
    .selectOption('balanced');
  await expect(dialog.getByRole('button', { name: 'Créer et démarrer' })).toBeDisabled();
  await expect(dialog.getByText('Brouillon enregistré', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Garder en brouillon' }).click();
  await page.getByRole('button', { name: /Préparer sans interrompre · Reprendre/ }).click();
  await expect(dialog.getByLabel('Qu’allons-nous faire ?')).toHaveValue(
    'Préparer sans interrompre',
  );
  await expect(
    dialog.getByRole('combobox').filter({ has: page.locator('option[value="pair"]') }),
  ).toHaveValue('pair');
  await expect(
    dialog.getByRole('combobox').filter({ has: page.locator('option[value="balanced"]') }),
  ).toHaveValue('balanced');
  expect((await messages(page)).filter((m) => m.type === 'createFeature')).toHaveLength(0);
});

test('create and start sends one concrete launch choice', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await dialog.getByLabel('Qu’allons-nous faire ?').fill('Une tâche guidée');
  await dialog
    .getByRole('combobox')
    .filter({ has: page.locator('option[value="pair"]') })
    .selectOption('pair');
  await dialog.getByRole('button', { name: 'Créer et démarrer' }).click();
  await expect(dialog).not.toBeVisible();
  const creates = (await messages(page)).filter((m) => m.type === 'createFeature');
  expect(creates).toHaveLength(1);
  expect(creates[0]).toMatchObject({ start: { pair: true, progression: 'guided' } });
});

test('clearing a saved task keeps the empty edit and still allows explicit abandonment', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  const title = dialog.getByLabel('Qu’allons-nous faire ?');
  await title.fill('Une idée à effacer');
  await expect(dialog.getByText('Brouillon enregistré', { exact: true })).toBeVisible();
  await title.fill('');
  await expect
    .poll(
      async () =>
        (await messages(page)).filter((m) => m.type === 'saveTaskDraft').at(-1)?.draft.title,
    )
    .toBe('');
  await expect(dialog.getByText('Brouillon enregistré', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abandonner ce brouillon' }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(async () => (await messages(page)).filter((m) => m.type === 'deleteTaskDraft').length)
    .toBe(1);
  await expect(page.getByRole('region', { name: 'Brouillons de tâches' })).toHaveCount(0);
});

test('Git preparation requires cached consent, preserves the branch name on retry and sends its exact base', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() =>
    Reflect.set(window, 'gitPreparationPatch', {
      fetchError: 'Serveur indisponible',
      dirtyCount: 2,
    }),
  );
  await page.getByRole('button', { name: 'Préparer ma première session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Qu’allons-nous faire ?').fill('Nouvelle recherche');
  await dialog.getByLabel('Nouvelle branche', { exact: true }).fill('feature/recherche');
  await expect(
    dialog.getByRole('button', { name: 'Créer la session', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('Partir de la dernière version connue').check();
  await expect(dialog.getByRole('button', { name: 'Créer la session', exact: true })).toBeEnabled();
  await page.evaluate(() => Reflect.set(window, 'gitPreparationPatch', { dirtyCount: 2 }));
  await dialog.getByRole('button', { name: 'Actualiser les branches' }).click();
  await expect(dialog.getByLabel('Nouvelle branche', { exact: true })).toHaveValue(
    'feature/recherche',
  );
  await dialog.getByRole('button', { name: 'Créer la session', exact: true }).click();
  expect((await messages(page)).find((m) => m.type === 'createFeature')).toMatchObject({
    isolated: true,
    gitChoice: {
      baseRef: 'refs/remotes/origin/main',
      baseCommit: 'b'.repeat(40),
      branchName: 'feature/recherche',
      allowCached: false,
    },
  });
});

test('current-folder branch creation blocks local changes and continues after rechecking', async ({
  page,
}, info) => {
  await open(page);
  await page.evaluate(() => Reflect.set(window, 'gitPreparationPatch', { dirtyCount: 1 }));
  await page.getByRole('button', { name: 'Préparer ma première session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Qu’allons-nous faire ?').fill('Correction');
  await dialog.getByRole('radio', { name: 'Dossier courant' }).check();
  await dialog.getByLabel('Travail dans le dossier courant').selectOption('new');
  await dialog
    .locator('.session-git-preparation')
    .screenshot({ path: info.outputPath('git-preparation.png') });
  await expect(
    dialog.getByRole('button', { name: 'Créer la session', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Ouvrir Git', exact: true }).click();
  expect((await messages(page)).some((m) => m.type === 'openSessionGit')).toBe(true);
  await page.evaluate(() => Reflect.set(window, 'gitPreparationPatch', { dirtyCount: 0 }));
  await dialog.getByRole('button', { name: 'Actualiser les branches' }).click();
  await dialog.getByRole('button', { name: 'Créer la session', exact: true }).click();
  expect((await messages(page)).find((m) => m.type === 'createFeature')).toMatchObject({
    isolated: false,
    gitChoice: { branchName: 'codex/correction' },
  });
});
