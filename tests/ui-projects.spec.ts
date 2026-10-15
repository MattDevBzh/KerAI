import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';

async function hosted(page: Page, empty = false) {
  const state = structuredClone(demoState);
  state.features = [];
  state.workspace.canIsolate = true;
  state.projectCatalog = {
    dedicated: true,
    windows: true,
    projects: empty
      ? []
      : [
          { id: 'api', name: 'API', path: 'C:\\Dev\\Api' },
          { id: 'web', name: 'Web', path: 'C:\\Dev\\Web' },
        ],
    selectedProjectIds: empty ? [] : ['api'],
    activeProjectId: empty ? undefined : 'api',
  };
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    const publish = () => window.postMessage({ type: 'state', state: data }, '*');
    Object.assign(window, {
      projectMessages: messages,
      projectState: data,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState() {},
        postMessage(message: ClientMessage) {
          messages.push(message);
          if (message.type === 'ready') setTimeout(publish, 0);
          if (message.type === 'activateProject') {
            data.projectCatalog!.activeProjectId = message.projectId;
            data.workspace.path = data.projectCatalog!.projects.find(
              (project) => project.id === message.projectId,
            )!.path;
            setTimeout(publish, 0);
          }
          if (message.type === 'selectProjects') {
            data.projectCatalog!.selectedProjectIds = message.projectIds;
            data.projectCatalog!.activeProjectId = message.projectIds[0];
          }
          if (message.type === 'addProjects') {
            data.projectCatalog!.projects = [{ id: 'api', name: 'API', path: 'C:\\Dev\\Api' }];
            data.projectCatalog!.selectedProjectIds = ['api'];
            data.projectCatalog!.activeProjectId = 'api';
          }
          if (message.type === 'hideProject') {
            data.projectCatalog!.projects.find(
              (project) => project.id === message.projectId,
            )!.hidden = message.hidden;
            data.projectCatalog!.selectedProjectIds =
              data.projectCatalog!.selectedProjectIds.filter((id) => id !== message.projectId);
          }
          if (
            ['selectProjects', 'addProjects', 'hideProject', 'createWindowsShortcut'].includes(
              message.type,
            ) &&
            'requestId' in message
          )
            setTimeout(() => {
              publish();
              window.postMessage(
                {
                  type: 'projectResult',
                  requestId: message.requestId,
                  message:
                    message.type === 'createWindowsShortcut'
                      ? 'Raccourci créé sur le Bureau.'
                      : undefined,
                },
                '*',
              );
            }, 20);
        },
      }),
    });
  }, state);
  await page.goto('/');
}

test('multi-selection is remembered, can reorder the primary and creates a multi-project session', async ({
  page,
}, testInfo) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).first().click();
  await page.locator('.project-picker summary').click();
  await page.getByRole('checkbox', { name: /Web/ }).click();
  await expect(page.getByRole('checkbox', { name: /Web/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Web/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Projet principal : Web' }).click();
  await expect(page.getByRole('button', { name: 'Projet principal : Web' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: testInfo.outputPath('project-picker.png') });
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).first().click();
  await expect(page.locator('.project-picker summary')).toContainText('Web + API');
  await page
    .getByPlaceholder('Ex. Une recherche plus agréable au clavier')
    .fill('API et interface');
  await page.getByRole('button', { name: 'Créer la feature' }).click();
  const messages = await page.evaluate(() => Reflect.get(window, 'projectMessages'));
  expect(messages.find((message: ClientMessage) => message.type === 'createFeature')).toMatchObject(
    { projectIds: ['web', 'api'], isolated: false, title: 'API et interface' },
  );
});

test('empty catalog blocks creation and lets the native folder picker register a project', async ({
  page,
}, testInfo) => {
  await hosted(page, true);
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).first().click();
  await page.getByPlaceholder('Ex. Une recherche plus agréable au clavier').fill('Premier projet');
  await expect(page.getByRole('button', { name: 'Créer la feature' })).toBeDisabled();
  await page.locator('.project-picker summary').click();
  await page.getByRole('button', { name: 'Ajouter un espace de travail' }).click();
  await expect(page.locator('.project-picker summary')).toContainText('API');
  await expect(page.getByRole('button', { name: 'Créer la feature' })).toBeEnabled();
});

test('settings expose folders and the Windows shortcut; switching updates the scoped project', async ({
  page,
}, testInfo) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Espaces de travail' })).toBeVisible();
  await page.getByRole('button', { name: 'Créer le raccourci Windows' }).click();
  await expect(page.getByText('Raccourci créé sur le Bureau.')).toBeVisible();
  await page.getByLabel('Projet actif', { exact: true }).selectOption('web');
  await expect(page.locator('.project-current-settings')).toContainText('Web');
  await page.screenshot({ path: testInfo.outputPath('project-settings.png') });
  await page
    .locator('.project-row')
    .filter({ hasText: 'C:\\Dev\\Api' })
    .getByRole('button', { name: 'Masquer du sélecteur' })
    .click();
  await expect(
    page
      .locator('.project-row')
      .filter({ hasText: 'C:\\Dev\\Api' })
      .getByRole('button', { name: 'Afficher dans le sélecteur' }),
  ).toBeVisible();
});
