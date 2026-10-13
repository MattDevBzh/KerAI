import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';
import type { DevOpsState } from '../src/shared/devops';
const base: DevOpsState = {
  authenticated: false,
  busy: false,
  notices: [],
  tickets: [],
  pullRequests: [],
  links: [],
  history: [],
  snapshot: {
    branch: 'codex/my-feature',
    head: 'a'.repeat(40),
    fingerprint: 'b'.repeat(64),
    files: [
      { path: 'src/selected.ts', staged: 'M', unstaged: 'M', untracked: false },
      { path: 'src/unrelated.ts', staged: 'M', unstaged: ' ', untracked: false },
      { path: 'new.txt', staged: '?', unstaged: '?', untracked: true },
    ],
    diff: 'diff selected',
    stagedDiff: 'staged content',
    unstagedDiff: 'working content',
    untrackedDiff: 'new content',
    diffTruncated: false,
    remote: 'origin',
    remoteUrl: 'https://example.com/repo.git',
  },
};
async function hosted(page: Page, devops: DevOpsState = structuredClone(base), features = false) {
  const state = structuredClone(demoState);
  if (!features) state.features = [];
  await page.addInitScript(
    ({ state, devops }) => {
      const messages: unknown[] = [];
      Object.assign(window, {
        devopsMessages: messages,
        devopsState: devops,
        acquireVsCodeApi: () => ({
          getState: () => ({}),
          setState() {},
          postMessage(message: ClientMessage) {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'devopsState', state: devops }, '*');
              }, 0);
            if (message.type === 'deliveryPreviewCommit')
              setTimeout(() => {
                devops.preview = {
                  kind: 'commit',
                  branch: devops.snapshot!.branch,
                  head: devops.snapshot!.head,
                  fingerprint: devops.snapshot!.fingerprint,
                  paths: message.paths,
                  title: message.title ?? 'feat: ajouter le menu',
                };
                window.postMessage({ type: 'devopsState', state: devops }, '*');
              }, 0);
          },
        }),
      });
    },
    { state, devops },
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Azure DevOps', exact: true })).toBeVisible();
}
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'devopsMessages') as ClientMessage[]);
test('menus Azure DevOps et livraison fonctionnent sans session, configuration locale complète et jeton hors webview', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Azure DevOps', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Azure DevOps', exact: true })).toBeVisible();
  await page.getByLabel('Organisation', { exact: true }).fill('my-org');
  await page.getByLabel('Projet', { exact: true }).fill('My Project');
  await page.getByLabel('Dépôt', { exact: true }).fill('repo');
  await page.getByRole('button', { name: 'Enregistrer la configuration' }).click();
  expect(await messages(page)).toContainEqual({
    type: 'devopsConfigure',
    config: { organization: 'my-org', project: 'My Project', repository: 'repo', remote: 'origin' },
  });
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Livraison', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent de livraison' })).toBeVisible();
  await expect(page.getByText('codex/my-feature', { exact: true })).toBeVisible();
  await page.getByText('Nouveaux fichiers', { exact: true }).click();
  await expect(page.getByText('new content', { exact: true })).toBeVisible();
});
test('commit sélection explicite, titre modifiable et ré-aperçu exigé après modification', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Livraison', exact: true }).click();
  await page.getByLabel('src/selected.ts').check();
  await page.getByLabel('Intention du changement').fill('ajouter le menu');
  await page.getByRole('button', { name: 'Proposer le titre et préparer' }).click();
  expect(await messages(page)).toContainEqual({
    type: 'deliveryPreviewCommit',
    paths: ['src/selected.ts'],
    intent: 'ajouter le menu',
  });
  await expect(page.getByLabel('Titre du commit (modifiable)')).toHaveValue(
    'feat: ajouter le menu',
  );
  await page.getByLabel('Titre du commit (modifiable)').fill('fix: corriger le menu');
  await expect(page.getByRole('button', { name: 'Confirmer le commit' })).toBeDisabled();
  await page.getByRole('button', { name: 'Actualiser l’aperçu du commit' }).click();
  await expect(page.getByRole('button', { name: 'Confirmer le commit' })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirmer le commit' }).click();
  expect(await messages(page)).toContainEqual({
    type: 'deliveryExecute',
    kind: 'commit',
    fingerprint: 'b'.repeat(64),
  });
  await page.getByLabel('src/unrelated.ts').check();
  await expect(page.getByRole('button', { name: 'Confirmer le commit' })).toBeDisabled();
});
test('tickets lisibles et inertes, critères/commentaires, liens feature et PR', async ({
  page,
}) => {
  const state = structuredClone(base);
  state.authenticated = true;
  state.config = { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' };
  state.account = 'Matt';
  state.tickets = [
    {
      id: 42,
      title: 'Ticket exemple',
      state: 'Active',
      url: 'https://dev.azure.com/org/project/_workitems/edit/42',
      description:
        '<p>Créer le tableau<br>Sans script</p><img src=x onerror="window.injected=true"><script>window.injected=true</script>',
      acceptanceCriteria: '<ul><li>Le menu fonctionne</li></ul>',
      commentsLoaded: true,
      comments: [{ id: 1, author: 'Matt', text: '<b>Prêt pour revue</b>' }],
    },
  ];
  state.pullRequests = [
    {
      id: 7,
      title: 'Livrer',
      status: 'active',
      url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/7',
      sourceBranch: 'refs/heads/feature/a',
      targetBranch: 'refs/heads/main',
    },
  ];
  state.links = [
    {
      featureId: demoState.features[0].id,
      ticketId: 42,
      ticketUrl: state.tickets[0].url,
      projectKey: 'org/project/repo',
      pullRequestIds: [7],
    },
  ];
  await hosted(page, state, true);
  await page.getByRole('button', { name: 'Azure DevOps', exact: true }).click();
  await page.getByText('Description et critères d’acceptation').click();
  await expect(page.getByText('Créer le tableau\nSans script', { exact: true })).toBeVisible();
  await expect(page.getByText('• Le menu fonctionne', { exact: true })).toBeVisible();
  await page.getByText('Commentaires (1)', { exact: true }).click();
  await expect(page.getByText('Prêt pour revue', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'injected'))).toBeUndefined();
  await page.getByRole('button', { name: /Ouvrir la feature/ }).click();
  await expect(page.getByRole('link', { name: 'Ticket #42', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PR #7 · active', exact: true })).toBeVisible();
});

test('une PR externe brouillon peut être liée sans ticket, modifiée ou dissociée depuis sa carte', async ({
  page,
}) => {
  const state = structuredClone(base);
  state.config = { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' };
  state.authenticated = true;
  state.pullRequests = [
    {
      id: 21,
      title: 'PR créée hors Studio',
      status: 'active',
      isDraft: true,
      url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/21',
      sourceBranch: 'refs/heads/feature/a',
      targetBranch: 'refs/heads/main',
    },
  ];
  state.tickets = [
    {
      id: 42,
      title: 'Ticket',
      state: 'Active',
      url: 'https://dev.azure.com/org/project/_workitems/edit/42',
      description: '',
      acceptanceCriteria: '',
      comments: [],
    },
  ];
  await hosted(page, state, true);
  await page.getByRole('button', { name: 'Azure DevOps', exact: true }).click();
  const card = page.getByRole('article', { name: 'PR 21', exact: true });
  await expect(card.getByText('Brouillon', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Lier cette PR', exact: true })).toBeDisabled();
  const featureId = demoState.features[0].id;
  await card.getByLabel('Session feature pour la PR #21').selectOption(featureId);
  await card.getByRole('button', { name: 'Lier cette PR', exact: true }).click();
  expect(await messages(page)).toContainEqual({
    type: 'devopsLinkPullRequest',
    pullRequestId: 21,
    featureId,
  });
  await page.evaluate(
    ({ featureId }) => {
      const devops = Reflect.get(window, 'devopsState') as DevOpsState;
      devops.links = [{ featureId, projectKey: 'org/project/repo', pullRequestIds: [21] }];
      window.postMessage({ type: 'devopsState', state: devops }, '*');
    },
    { featureId },
  );
  await card.getByRole('button', { name: 'Modifier le lien', exact: true }).click();
  await card.getByLabel('Ticket facultatif pour la PR #21').selectOption('42');
  await card.getByRole('button', { name: 'Remplacer ce lien PR', exact: true }).click();
  expect(await messages(page)).toContainEqual({
    type: 'devopsLinkPullRequest',
    pullRequestId: 21,
    featureId,
    ticketId: 42,
    replaces: { featureId },
  });
  await card.getByRole('button', { name: 'Retirer le lien PR', exact: true }).click();
  expect(await messages(page)).toContainEqual({
    type: 'devopsUnlinkPullRequest',
    pullRequestId: 21,
    featureId,
  });
});

test('configuration ouverte à 390px et URLs/branches longues gardent le document dans la fenêtre', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = structuredClone(base);
  const long = 'feature-' + 'a'.repeat(120);
  state.config = { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' };
  state.snapshot!.branch = long;
  state.snapshot!.remoteUrl = `https://dev.azure.com/org/project/_git/${long}`;
  state.pullRequests = [
    {
      id: 21,
      title: 'PR avec branche longue',
      status: 'active',
      url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/21',
      sourceBranch: `refs/heads/${long}`,
      targetBranch: 'refs/heads/main',
    },
  ];
  await hosted(page, state, true);
  await page.getByRole('button', { name: 'Azure DevOps', exact: true }).click();
  await page.getByText('Configuration et connexion', { exact: true }).click();
  await expect(page.getByLabel('Organisation', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Livraison', exact: true }).click();
  await expect(page.getByText(long, { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const input of await page
    .locator('.devops-panel input, .devops-panel select, .devops-panel textarea')
    .all()) {
    const bounds = await input.boundingBox();
    if (!bounds) continue;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
});
