import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';
import type { DevOpsState } from '../src/shared/devops';
import { defaultPullRequestSettings } from '../src/shared/pullRequestPreparation';

async function openSession(page: Page, dirty = false) {
  const state = structuredClone(demoState),
    feature = state.features[0];
  state.features = [feature];
  feature.branch = 'codex/pr-session';
  feature.status = 'completed';
  feature.steps.forEach((step) => {
    step.status = 'approved';
  });
  state.agents.push({
    ...state.agents[0],
    id: 'fs-devops-pr',
    name: 'Rédacteur de PR',
    nickname: '',
    model: 'project-model',
  });
  const devops: DevOpsState = {
    config: { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' },
    authenticated: true,
    busy: false,
    notices: [],
    tickets: [],
    pullRequests: [],
    history: [],
    links: [],
    prSettings: { ...defaultPullRequestSettings, target: 'develop' },
    snapshot: {
      branch: 'codex/pr-session',
      head: 'a'.repeat(40),
      fingerprint: 'b'.repeat(64),
      files: dirty ? [{ path: 'app.ts', staged: ' ', unstaged: 'M', untracked: false }] : [],
      diff: '',
      diffTruncated: false,
    },
  };
  await page.addInitScript(
    ({ state, devops, featureId }) => {
      const messages: ClientMessage[] = [];
      let active = devops,
        generation = 0;
      const publish = () => window.postMessage({ type: 'devopsState', state: active }, '*');
      Object.assign(window, {
        prMessages: messages,
        updatePr: (patch: Partial<DevOpsState>) => {
          active = { ...active, ...patch };
          publish();
        },
        finishPr: () => {
          active = {
            ...active,
            busy: false,
            prGenerating: false,
            prGeneration: {
              id: String(++generation),
              featureId,
              title: `Titre agent ${generation}`,
              description: `Description agent ${generation}`,
              head: 'a'.repeat(40),
              target: 'develop',
              targetHead: 'c'.repeat(40),
              agentId: 'fs-devops-pr',
              model: 'project-model',
            },
          };
          publish();
        },
        cleanPr: () => {
          active = { ...active, snapshot: { ...active.snapshot!, files: [] } };
          publish();
        },
        acquireVsCodeApi: () => ({
          getState: () => JSON.parse(sessionStorage.getItem('pr-view') || '{}'),
          setState: (value: unknown) => sessionStorage.setItem('pr-view', JSON.stringify(value)),
          postMessage: (message: ClientMessage) => {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                publish();
                window.postMessage({ type: 'navigate', view: 'sessions', featureId }, '*');
              }, 0);
            if (message.type === 'openSessionDelivery') {
              active = {
                ...active,
                deliverySession: {
                  featureId,
                  title: state.features[0].title,
                  path: '/isolated/session',
                  branch: 'codex/pr-session',
                },
              };
              publish();
              window.postMessage({ type: 'navigate', view: 'delivery' }, '*');
            }
            if (message.type === 'deliveryGeneratePr') {
              active = { ...active, busy: true, prGenerating: true, prGeneration: undefined };
              publish();
            }
            if (message.type === 'deliverySavePrSettings') {
              active = { ...active, prSettings: message.settings };
              publish();
            }
            if (message.type === 'deliverySearchReviewers') {
              active = {
                ...active,
                reviewerResults: [
                  { id: '12345678-1234-4234-8234-123456789012', name: 'Camille', required: false },
                ],
              };
              publish();
            }
            if (message.type === 'deliveryPreviewPr') {
              active = {
                ...active,
                preview: {
                  kind: 'pr',
                  branch: active.snapshot!.branch,
                  head: active.snapshot!.head,
                  fingerprint: active.snapshot!.fingerprint,
                  paths: [],
                  title: message.title,
                  description: message.description,
                  target: message.target,
                  featureId: message.featureId,
                  isDraft: message.isDraft,
                  reviewers: message.reviewers,
                  diff: 'committed comparison',
                },
              };
              publish();
            }
          },
        }),
      });
    },
    { state, devops, featureId: feature.id },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Préparer la PR', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `Préparer la PR · ${feature.title}`, exact: true }),
  ).toBeVisible();
  return feature;
}
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'prMessages') as ClientMessage[]);
const finish = (page: Page) => page.evaluate(() => Reflect.get(window, 'finishPr')());

test('fin de session, rédaction automatique, corrections préservées et champs Azure relus avant création', async ({
  page,
}) => {
  await openSession(page);
  await expect(page.getByRole('status')).toContainText('L’agent rédige');
  expect(
    (await messages(page)).filter((message) => message.type === 'deliveryGeneratePr'),
  ).toHaveLength(1);
  await finish(page);
  const title = page.getByLabel('Titre de la PR', { exact: true }),
    description = page.getByRole('textbox', { name: 'Description', exact: true });
  await expect(title).toHaveValue('Titre agent 1');
  await expect(description).toHaveValue('Description agent 1');
  await title.fill('Ma correction');
  await page.getByRole('button', { name: 'Régénérer avec l’agent', exact: true }).click();
  await description.fill('Ma modification pendant la rédaction');
  await finish(page);
  await expect(title).toHaveValue('Ma correction');
  await expect(description).toHaveValue('Ma modification pendant la rédaction');
  await page
    .getByRole('button', { name: 'Remplacer le titre et la description par cette proposition' })
    .click();
  await expect(title).toHaveValue('Titre agent 2');
  await page.getByLabel('Rechercher un relecteur').fill('Camille');
  await page.getByRole('button', { name: 'Rechercher dans Azure DevOps' }).click();
  await page.getByRole('button', { name: 'Ajouter Camille', exact: true }).click();
  await page.getByLabel('Obligatoire', { exact: true }).check();
  await page.getByLabel('Créer cette PR en brouillon', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Préparer la PR prête à relire', exact: true }).click();
  const preview = (await messages(page))
    .filter((message) => message.type === 'deliveryPreviewPr')
    .at(-1);
  expect(preview).toMatchObject({
    isDraft: false,
    reviewers: [{ name: 'Camille', required: true }],
    title: 'Titre agent 2',
    target: 'develop',
  });
  expect((await messages(page)).some((message) => message.type === 'deliveryExecute')).toBe(false);
  await expect(
    page.getByRole('heading', { name: 'Aperçu à confirmer · PR prête à relire' }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('pr-preparation.png'), fullPage: true });
});

test('à 390px le code non commité bloque la rédaction, les réglages restent accessibles et la génération démarre après commit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSession(page, true);
  expect((await messages(page)).some((message) => message.type === 'deliveryGeneratePr')).toBe(
    false,
  );
  await page.locator('#delivery-pr > summary').click();
  await page.getByText('Réglages de PR pour ce dépôt', { exact: true }).click();
  await page.getByLabel('Consignes et modèle de description').fill('Décrire les tests observés');
  await page.getByRole('button', { name: 'Enregistrer les réglages de PR' }).click();
  expect(
    (await messages(page)).filter((message) => message.type === 'deliverySavePrSettings').at(-1),
  ).toMatchObject({
    settings: {
      agentId: 'fs-devops-pr',
      target: 'develop',
      instructions: 'Décrire les tests observés',
    },
  });
  await page.evaluate(() => Reflect.get(window, 'cleanPr')());
  await expect(page.getByRole('button', { name: 'Arrêter la rédaction' })).toBeVisible();
  await finish(page);
  await expect(page.getByLabel('Titre de la PR', { exact: true })).toHaveValue('Titre agent 1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('shows failed commit and confirmation states near their action, with the exact pushed commit and local files warning', async ({
  page,
}) => {
  await openSession(page, true);
  await page.evaluate(() =>
    Reflect.get(
      window,
      'updatePr',
    )({
      busy: true,
      deliveryProgress: { kind: 'commit', message: 'Confirme dans la boîte de dialogue VS Code.' },
    }),
  );
  await expect(page.locator('.delivery-feedback')).toContainText('boîte de dialogue VS Code');
  await page.evaluate(() =>
    Reflect.get(
      window,
      'updatePr',
    )({
      busy: false,
      deliveryProgress: undefined,
      deliveryResults: { commit: { status: 'error', message: 'Configure ton identité Git.' } },
    }),
  );
  await expect(page.locator('.delivery-feedback.error')).toContainText(
    'Configure ton identité Git',
  );
  await expect(page.locator('#delivery-push')).toContainText('1 fichier(s) ne sont pas commités');
  await expect(page.locator('#delivery-push')).toContainText('aaaaaaaaaaaa');
  await expect(page.locator('#delivery-push')).toContainText('Corrige d’abord l’erreur du commit');
  await page.screenshot({
    path: test.info().outputPath('delivery-commit-feedback.png'),
    fullPage: true,
  });
});

test('explains a missing agent and displays generation errors next to retry without erasing the draft', async ({
  page,
}) => {
  await openSession(page);
  await finish(page);
  const title = page.getByLabel('Titre de la PR', { exact: true });
  await title.fill('Mon titre conservé');
  await page.evaluate(() =>
    Reflect.get(
      window,
      'updatePr',
    )({ error: 'Git ne parvient pas à s’authentifier.', errorAction: 'deliveryGeneratePr' }),
  );
  await expect(
    page.getByRole('region', { name: 'Rédaction de la PR' }).getByRole('alert'),
  ).toContainText('s’authentifier');
  await expect(title).toHaveValue('Mon titre conservé');
  await page.evaluate((settings) => Reflect.get(window, 'updatePr')({ prSettings: settings }), {
    ...defaultPullRequestSettings,
    agentId: 'missing-agent',
    target: 'develop',
  });
  await expect(
    page.getByRole('button', { name: 'Régénérer avec l’agent', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Rédaction de la PR' })).toContainText(
    'agent de rédaction est indisponible',
  );
});

test('explains an existing PR for the selected target and allows drafting for another target', async ({
  page,
}) => {
  await openSession(page);
  await finish(page);
  await page.evaluate(() =>
    Reflect.get(
      window,
      'updatePr',
    )({
      existingPr: {
        id: 42,
        title: 'Existing',
        status: 'active',
        isDraft: true,
        sourceBranch: 'refs/heads/codex/pr-session',
        targetBranch: 'refs/heads/develop',
        url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/42',
        repository: 'repo',
        createdBy: 'Matt',
        reviewers: [],
      },
    }),
  );
  const writing = page.getByRole('region', { name: 'Rédaction de la PR' });
  await expect(writing).toContainText('La PR #42 existe déjà pour ces branches');
  await expect(
    writing.getByRole('button', { name: 'Régénérer avec l’agent', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Branche cible', { exact: true }).fill('release');
  await expect(
    writing.getByRole('button', { name: 'Régénérer avec l’agent', exact: true }),
  ).toBeEnabled();
});
