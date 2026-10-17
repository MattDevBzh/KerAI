import { navigate } from './ui-navigation-helpers';
import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';
import type { DevOpsState } from '../src/shared/devops';

const config = { organization: 'org', project: 'Studio', repository: 'cockpit', remote: 'origin' };
const connected: DevOpsState = {
  config,
  authenticated: true,
  account: 'Matt',
  busy: false,
  notices: [],
  history: [],
  refreshedAt: '2026-10-13T10:00:00Z',
  tickets: [
    {
      id: 42,
      title: 'Un cockpit plus vivant',
      state: 'En atelier',
      url: 'https://dev.azure.com/org/Studio/_workitems/edit/42',
      description:
        '<p>Voir les prochaines étapes</p><img src=x onerror="window.injected=true"><script>window.injected=true</script>',
      acceptanceCriteria: '<ul><li>Menus au clavier</li></ul>',
      workItemType: 'User Story',
      assignedTo: 'Matt',
      tags: ['UX', 'navigation'],
      iterationPath: 'Studio\\Octobre',
      areaPath: 'Studio\\Cockpit',
      changedDate: '2026-10-13T09:00:00Z',
      comments: [],
    },
    {
      id: 12,
      title: 'Accessibilité du panneau',
      state: 'Validation maison',
      url: 'https://dev.azure.com/org/Studio/_workitems/edit/12',
      description: '',
      acceptanceCriteria: '',
      comments: [],
      commentsLoaded: true,
      tags: ['accessibilité'],
      changedDate: '2026-10-12T09:00:00Z',
    },
    {
      id: 65,
      title: 'Zéro date disponible',
      state: 'Closed',
      url: 'https://dev.azure.com/org/Studio/_workitems/edit/65',
      description: '',
      acceptanceCriteria: '',
      comments: [],
      commentsLoaded: true,
    },
  ],
  pullRequests: [
    {
      id: 7,
      title: 'Les tickets prennent vie',
      status: 'active',
      url: 'https://dev.azure.com/org/Studio/_git/cockpit/pullrequest/7',
      sourceBranch: 'refs/heads/feature/tickets',
      targetBranch: 'refs/heads/main',
      createdBy: 'Matt',
      creationDate: '2026-10-13T08:00:00Z',
      description: '<p>Des cartes plus lisibles</p><script>window.injected=true</script>',
      mergeStatus: 'succeeded',
      reviewers: [
        { id: '1', displayName: 'Camille', vote: 5, isRequired: true },
        { id: '2', displayName: 'Alex', vote: -5 },
        { id: '3', displayName: 'Vote futur', vote: 2 },
      ],
    },
    {
      id: 21,
      title: 'Le dashboard en préparation',
      status: 'active',
      isDraft: true,
      url: 'https://dev.azure.com/org/Studio/_git/cockpit/pullrequest/21',
      sourceBranch: 'refs/heads/feature/dashboard',
      targetBranch: 'refs/heads/main',
      creationDate: '2026-10-12T08:00:00Z',
    },
    {
      id: 31,
      title: 'Ancienne livraison',
      status: 'completed',
      url: 'https://dev.azure.com/org/Studio/_git/cockpit/pullrequest/31',
      sourceBranch: 'refs/heads/feature/old',
      targetBranch: 'refs/heads/main',
    },
  ],
  links: [
    {
      projectKey: 'org/studio/cockpit',
      featureId: demoState.features[0].id,
      ticketId: 42,
      ticketUrl: 'https://dev.azure.com/org/Studio/_workitems/edit/42',
      pullRequestIds: [7],
    },
    {
      projectKey: 'another/studio/cockpit',
      featureId: demoState.features[0].id,
      ticketId: 12,
      pullRequestIds: [21],
    },
  ],
};
async function hosted(
  page: Page,
  devops: DevOpsState = structuredClone(connected),
  view = 'dashboard',
) {
  if (!devops.ticketSearch && devops.authenticated && devops.refreshedAt)
    devops.ticketSearch = {
      filters: {
        query: '',
        types: [],
        states: [],
        assignment: 'all',
        identity: '',
        tags: [],
        areaPath: '',
        iterationPath: '',
      },
      tickets: devops.tickets,
      searchedAt: devops.refreshedAt,
      hasMore: false,
      limitReached: false,
      omitted: 0,
    };
  await page.addInitScript(
    ({ devops, state, view }) => {
      const messages: ClientMessage[] = [];
      Object.assign(window, {
        dashboardMessages: messages,
        dashboardState: devops,
        acquireVsCodeApi: () => ({
          getState: () => ({ view }),
          setState() {},
          postMessage(message: ClientMessage) {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'devopsState', state: devops }, '*');
              }, 0);
          },
        }),
      });
    },
    { devops, state: structuredClone(demoState), view },
  );
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
}
const panel = (page: Page) => page.locator('.devops-dashboard:visible');
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'dashboardMessages') as ClientMessage[]);
async function update(page: Page, changes: Partial<DevOpsState>) {
  await page.evaluate((changes) => {
    const state = Object.assign(Reflect.get(window, 'dashboardState') as DevOpsState, changes);
    window.postMessage({ type: 'devopsState', state }, '*');
  }, changes);
}

test('groupe DevOps, reprise de vue et configuration/livraison préservées', async ({ page }) => {
  await hosted(
    page,
    {
      ...structuredClone(connected),
      config: undefined,
      authenticated: false,
      tickets: [],
      pullRequests: [],
      refreshedAt: undefined,
    },
    'devops-prs',
  );
  await expect(panel(page).getByRole('heading', { name: 'Tes PR, en mouvement.' })).toBeVisible();
  await expect(page.locator('[aria-current=page]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Configurer Azure DevOps', exact: true }).click();
  await page.getByLabel('Organisation', { exact: true }).fill('configuration-en-cours');
  await navigate(page, 'Tickets');
  await expect(panel(page).getByText('Ton dashboard attend son projet')).toBeVisible();
  await navigate(page, 'Azure DevOps');
  await expect(page.getByLabel('Organisation', { exact: true })).toHaveValue(
    'configuration-en-cours',
  );
  await expect(page.getByRole('heading', { name: 'À faire', exact: true })).toBeVisible();
  await navigate(page, 'Livraison');
  await page.getByLabel('Intention du changement').fill('garder mon brouillon');
  await navigate(page, 'PR');
  await navigate(page, 'Livraison');
  await expect(page.getByLabel('Intention du changement')).toHaveValue('garder mon brouillon');
  await navigate(page, 'Réglages');
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', { name: 'DevOps', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'PR', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tickets', exact: true })).toBeVisible();
  expect(
    (await messages(page)).filter((message) => !['ready', 'checkRuntime'].includes(message.type)),
  ).toEqual([]);
});

test('PR : branches, revue honnête, aperçu texte sûr et actions locales inchangées', async ({
  page,
}) => {
  await hosted(page);
  await navigate(page, 'PR');
  const dashboard = panel(page);
  await dashboard.getByLabel('Rechercher une PR').fill('feature/tickets');
  const card = dashboard.getByRole('article', { name: 'PR 7', exact: true });
  await expect(dashboard.getByRole('article')).toHaveCount(1);
  await card.getByText('Aperçu de la description').click();
  await expect(card.getByText('Des cartes plus lisibles', { exact: true })).toBeVisible();
  await card.getByText('Relecteurs (3)', { exact: true }).click();
  await expect(
    card.getByText('Obligatoire · Approuvé avec réserves', { exact: true }),
  ).toBeVisible();
  await expect(card.getByText('En attente de l’auteur', { exact: true })).toBeVisible();
  await expect(card.getByText('Vote inconnu (2)', { exact: true })).toBeVisible();
  await expect(card.getByText(/politiques de validation/)).toBeVisible();
  await card.getByRole('button', { name: 'Modifier le lien', exact: true }).click();
  await card.getByLabel('Ticket facultatif pour la PR #7').selectOption('12');
  await card.getByRole('button', { name: 'Remplacer ce lien PR', exact: true }).click();
  expect(await messages(page)).toContainEqual({
    type: 'devopsLinkPullRequest',
    pullRequestId: 7,
    featureId: demoState.features[0].id,
    ticketId: 12,
    replaces: { featureId: demoState.features[0].id, ticketId: 42 },
  });
  await card.getByRole('button', { name: 'Retirer le lien PR', exact: true }).click();
  expect(await messages(page)).toContainEqual({
    type: 'devopsUnlinkPullRequest',
    pullRequestId: 7,
    featureId: demoState.features[0].id,
    ticketId: 42,
  });
  await dashboard.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
  await dashboard.getByLabel('État', { exact: true }).selectOption('completed');
  await expect(dashboard.getByRole('article')).toHaveAttribute('aria-label', 'PR 31');
  expect(await page.evaluate(() => Reflect.get(window, 'injected'))).toBeUndefined();
  await dashboard.getByRole('button', { name: 'Actualiser', exact: true }).click();
  expect(await messages(page)).toContainEqual({ type: 'devopsRefresh' });
});

for (const theme of ['vscode-light', 'vscode-high-contrast', 'vscode-high-contrast-light'])
  test(`390px et ${theme} : filtres et cartes accessibles sans débordement`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const state = structuredClone(connected);
    state.pullRequests[0].sourceBranch = 'refs/heads/' + 'branche-'.repeat(30);
    state.tickets[0].tags = ['tag-'.repeat(40)];
    await hosted(page, state);
    await page.evaluate((theme) => document.body.classList.add(theme), theme);
    for (const name of ['PR', 'Tickets']) {
      await navigate(page, name);
      await expect(panel(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      for (const input of await panel(page).locator('input, select, button').all()) {
        const bounds = await input.boundingBox();
        if (bounds) expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
      }
      await expect(page.locator('[aria-current=page]')).toHaveCount(1);
    }
  });
