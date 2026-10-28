import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import { navigate } from './ui-navigation-helpers';
import type { ClientMessage, StudioState } from '../src/shared/types';
import type { DevOpsState } from '../src/shared/devops';
function scenario() {
  const state = structuredClone(demoState);
  const feature = state.features[0];
  state.features = [feature];
  feature.branch = 'codex/delivery';
  feature.criteria = [
    {
      id: 'menu',
      text: 'Navigation utilisable',
      status: 'passed',
      evidence: 'Vérification déclarée',
    },
  ];
  feature.status = 'attention';
  feature.steps = [feature.steps[0]];
  const step = feature.steps[0];
  step.status = 'awaiting_review';
  step.dependsOn = [];
  step.attempts = [
    {
      id: 'attempt',
      status: 'awaiting_review',
      revision: 0,
      descriptionRevision: feature.descriptionRevision ?? 0,
      startedAt: feature.createdAt,
      feedback: '',
      logs: [],
      questions: [],
      answers: {},
      changedFiles: ['src/menu.ts'],
      artifact: {
        name: 'report.md',
        content: 'Menu réalisé. Tests décrits par l’agent.',
        updatedAt: feature.updatedAt,
      },
    },
  ];
  const devops: DevOpsState = {
    config: { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' },
    authenticated: true,
    busy: false,
    notices: [],
    tickets: [],
    pullRequests: [],
    history: [],
    links: [
      {
        featureId: feature.id,
        ticketId: 42,
        ticketUrl: 'https://dev.azure.com/org/project/_workitems/edit/42',
        projectKey: 'org/project/repo',
        pullRequestIds: [],
      },
    ],
    snapshot: {
      branch: 'codex/delivery',
      head: 'a'.repeat(40),
      fingerprint: 'b'.repeat(64),
      files: [{ path: 'src/menu.ts', staged: ' ', unstaged: 'M', untracked: false }],
      diff: 'WORKTREE_DIFF',
      diffTruncated: false,
      remoteUrl: 'https://dev.azure.com/org/project/_git/repo',
    },
  };
  return { state, devops };
}
async function open(page: Page, state: StudioState, devops: DevOpsState) {
  await page.addInitScript(
    ({ state, devops }) => {
      const messages: ClientMessage[] = [];
      Object.assign(window, {
        deliveryMessages: messages,
        acquireVsCodeApi: () => ({
          getState: () => JSON.parse(sessionStorage.getItem('kerai-persisted-ui') || '{}'),
          setState: (value: unknown) =>
            sessionStorage.setItem('kerai-persisted-ui', JSON.stringify(value)),
          postMessage: (message: ClientMessage) => {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'devopsState', state: devops }, '*');
              }, 0);
            if (message.type === 'deliveryPreviewPr')
              setTimeout(
                () =>
                  window.postMessage(
                    {
                      type: 'devopsState',
                      state: { ...devops, error: 'Connexion momentanément indisponible' },
                    },
                    '*',
                  ),
                0,
              );
          },
        }),
      });
    },
    { state, devops },
  );
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
}
test('livraison préremplie, titre commit distinct et reprise sans ressaisie après échec puis rechargement', async ({
  page,
}) => {
  const { state, devops } = scenario();
  await open(page, state, devops);
  await navigate(page, 'Livraison');
  await page
    .getByRole('combobox', { name: 'Session associée', exact: true })
    .selectOption(state.features[0].id);
  await expect(page.getByLabel('Titre de la PR', { exact: true })).toHaveValue(
    state.features[0].title,
  );
  await expect(page.getByRole('combobox', { name: 'Ticket associé', exact: true })).toHaveValue(
    '42',
  );
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    /Aucun test exécuté par le host/,
  );
  await page.getByLabel('Titre du commit (modifiable)').fill('fix: commit séparé');
  await page.getByLabel('Titre de la PR', { exact: true }).fill('PR relue par Matt');
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Description relue et conservée');
  await page.getByLabel('Branche cible', { exact: true }).fill('develop');
  await page.getByLabel('src/menu.ts').check();
  await page.getByRole('button', { name: 'Préparer la PR brouillon', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Connexion momentanément indisponible');
  await expect(page.getByLabel('Titre du commit (modifiable)')).toHaveValue('fix: commit séparé');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    'Description relue et conservée',
  );
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, 'deliveryMessages') as ClientMessage[]).some(
        (message) => message.type === 'deliveryExecute',
      ),
    ),
  ).toBe(false);
  await page.reload();
  await expect(page.getByLabel('Titre de la PR', { exact: true })).toHaveValue('PR relue par Matt');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    'Description relue et conservée',
  );
  await expect(page.getByLabel('Branche cible', { exact: true })).toHaveValue('develop');
  await expect(page.getByLabel('src/menu.ts')).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Ticket associé', exact: true })).toHaveValue(
    '42',
  );
});
test('centre de décision : résultat et déclarations visibles, échecs prioritaires, accès à la bonne étape à 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, devops } = scenario();
  const blocked = structuredClone(state.features[0]);
  blocked.id = 'blocked';
  blocked.title = 'Blocage à traiter';
  blocked.steps[0].attempts[0].evidence = [
    {
      id: 'test-failed',
      source: 'host',
      commandId: 'unit',
      name: 'Tests menu',
      command: 'npm',
      args: ['test'],
      startedAt: blocked.createdAt,
      finishedAt: blocked.updatedAt,
      exitCode: 1,
      stdout: '',
      stderr: 'FAIL',
      truncated: false,
      fileHashes: {},
    },
  ];
  state.features.push(blocked);
  await open(page, state, devops);
  await navigate(page, 'Validation');
  const cards = page.locator('.validation-decision');
  await expect(cards.first()).toContainText('Blocage à traiter');
  await expect(cards.first()).toContainText('À résoudre avant validation');
  await cards.last().getByText('Critères d’acceptation', { exact: false }).click();
  await expect(cards.last()).toContainText('Déclaré validé · Navigation utilisable');
  await cards.last().getByText('Tests exécutés par le host', { exact: false }).click();
  await expect(cards.last()).toContainText('Aucun test exécuté attesté');
  await page.getByLabel('Filtrer le centre de validation').selectOption('blocked');
  await expect(cards).toHaveCount(1);
  await cards.first().getByText('Changements de la tentative', { exact: false }).click();
  await cards
    .first()
    .getByRole('button', { name: 'Voir le diff de src/menu.ts', exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, 'deliveryMessages') as ClientMessage[]).filter(
        (message) => message.type === 'openDiff',
      ),
    ),
  ).toContainEqual({ type: 'openDiff', featureId: blocked.id, path: 'src/menu.ts' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await cards.first().getByRole('button', { name: 'Examiner les blocages' }).click();
  await expect(page.getByRole('heading', { name: 'Blocage à traiter', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: blocked.steps[0].name, exact: true }).first(),
  ).toBeVisible();
});

test('changer de session actualise le texte généré mais conserve une relecture manuelle avec son avertissement', async ({
  page,
}) => {
  const { state, devops } = scenario();
  const second = structuredClone(state.features[0]);
  second.id = 'session-two';
  second.title = 'Seconde session';
  state.features.push(second);
  await open(page, state, devops);
  await navigate(page, 'Livraison');
  const session = page.getByRole('combobox', { name: 'Session associée', exact: true });
  const title = page.getByRole('textbox', { name: 'Titre de la PR', exact: true });
  const description = page.getByRole('textbox', { name: 'Description', exact: true });
  await session.selectOption(state.features[0].id);
  await expect(title).toHaveValue(state.features[0].title);
  await session.selectOption(second.id);
  await expect(title).toHaveValue(second.title);
  await expect(description).toHaveValue(/session-two/);
  const generated = await description.inputValue();
  await description.fill(generated + '\nRelecture personnelle conservée');
  await session.selectOption(state.features[0].id);
  await expect(description).toHaveValue(generated + '\nRelecture personnelle conservée');
  await expect(page.getByRole('status')).toContainText(
    'Le texte conservé référence encore la session Seconde session',
  );
});
