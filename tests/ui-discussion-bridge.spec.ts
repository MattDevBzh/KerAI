import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';
import type { DiscussionState, DiscussionFeatureDraft } from '../src/shared/discussions';

async function setup(page: Page, mode: 'report' | 'idea' = 'report') {
  const studio = structuredClone(demoState);
  const feature = studio.features[0];
  studio.features = [feature];
  feature.status = 'attention';
  feature.archived = false;
  const step = feature.steps[0];
  feature.activeStepId = step.id;
  for (const item of feature.steps) {
    item.status = 'pending';
    item.attempts = [];
  }
  step.status = 'awaiting_review';
  step.attempts = [
    {
      id: 'attempt-original',
      revision: 0,
      status: 'awaiting_review',
      startedAt: new Date().toISOString(),
      feedback: '',
      logs: [],
      questions: [],
      answers: {},
      changedFiles: [],
      artifact: {
        name: 'rapport.md',
        content: '# Choix de départ\n\nNous recommandons une recherche locale.',
        updatedAt: new Date().toISOString(),
      },
    },
  ];
  studio.runtime = {
    state: 'ready',
    authenticated: true,
    models: [{ id: 'original-model', name: 'Modèle original', reasoningEfforts: ['high'] }],
  };
  const agent = studio.agents.find((item) => item.id === step.agentId)!;
  agent.nickname = 'Ada';
  agent.discussionAgent = true;
  const discussionId = '63ad5cb0-99da-4d92-92bb-e54f91a16bc7';
  const discussions: DiscussionState = {
    agents: [{ key: 'global:agent', profile: agent }],
    discussions:
      mode === 'idea'
        ? [
            {
              id: discussionId,
              agentKey: 'global:agent',
              title: 'Une recherche au clavier',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messages: [
                {
                  id: 'u',
                  role: 'user',
                  status: 'complete',
                  content: 'Construisons une recherche locale.',
                  createdAt: new Date().toISOString(),
                },
                {
                  id: 'a',
                  role: 'assistant',
                  status: 'complete',
                  content: 'Prévoyons une navigation au clavier.',
                  createdAt: new Date().toISOString(),
                },
              ],
            },
          ]
        : [],
  };
  const proposal: DiscussionFeatureDraft = {
    requestId: '',
    createdAt: new Date().toISOString(),
    title: 'Recherche au clavier',
    description: 'Permettre une recherche locale au clavier.',
    criteria: ['Entrée ouvre le résultat', 'Aucune requête réseau'],
    team: [
      {
        agentId: agent.id,
        name: 'Cadrage',
        description: 'Définir les interactions',
        policy: 'read-only',
      },
      {
        agentId: studio.agents[1].id,
        name: 'Développement',
        description: 'Construire la recherche',
        policy: 'workspace-write',
      },
    ],
  };
  await page.addInitScript(
    ({ studio, discussions, mode, discussionId, proposal }) => {
      const feature = studio.features[0],
        step = feature.steps[0],
        agent = studio.agents.find((item) => item.id === step.agentId)!;
      let saved = {
        view: mode === 'report' ? 'dashboard' : 'discussion',
        featureId: feature.id,
        stepId: step.id,
        discussionId,
      };
      const sent: ClientMessage[] = [];
      const publish = () => {
        window.postMessage({ type: 'state', state: studio }, '*');
        window.postMessage({ type: 'discussionState', state: discussions }, '*');
      };
      Object.assign(window, {
        bridgeMessages: sent,
        bridgeStudio: studio,
        bridgeDiscussions: discussions,
        acquireVsCodeApi: () => ({
          getState: () => saved,
          setState: (value: typeof saved) => {
            saved = value;
          },
          postMessage: (message: ClientMessage) => {
            sent.push(message);
            if (message.type === 'ready') setTimeout(publish, 0);
            if (message.type === 'openReportDiscussion')
              setTimeout(() => {
                if (!discussions.discussions.length)
                  discussions.discussions.push({
                    id: discussionId,
                    title: 'Cadrage · session',
                    agentKey: 'session:original',
                    model: 'original-model',
                    reasoning: 'high',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    messages: [],
                    source: {
                      featureId: feature.id,
                      featureTitle: feature.title,
                      stepId: step.id,
                      stepName: step.name,
                      attemptId: step.attempts[0].id,
                      revision: 0,
                      agent,
                      model: 'original-model',
                      reasoning: 'high',
                      capturedAt: new Date().toISOString(),
                      context: 'Le contexte original et les skills sélectionnés.',
                      output: step.attempts[0].artifact!.content,
                      warnings: ['Ancienne exécution : certains échanges sont absents.'],
                    },
                  });
                publish();
                window.postMessage(
                  { type: 'reportDiscussionOpened', requestId: message.requestId, discussionId },
                  '*',
                );
              }, 0);
            if (message.type === 'returnToDiscussionReport')
              setTimeout(() => {
                publish();
                window.postMessage(
                  {
                    type: 'discussionReportOpened',
                    featureId: feature.id,
                    stepId: step.id,
                    attemptId: step.attempts[0].id,
                    edit: message.edit,
                    notice: step.attempts[0].revision
                      ? 'Le compte rendu a évolué depuis cette discussion.'
                      : undefined,
                  },
                  '*',
                );
              }, 0);
            if (message.type === 'prepareDiscussionFeature')
              setTimeout(() => {
                const discussion = discussions.discussions[0];
                discussion.featureDraft = { ...proposal, requestId: message.requestId };
                discussion.messages.push({
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: 'Le brouillon est prêt à être ajusté.',
                  status: 'complete',
                  createdAt: new Date().toISOString(),
                });
                publish();
                window.postMessage(
                  { type: 'discussionResult', requestId: message.requestId, discussionId },
                  '*',
                );
              }, 0);
          },
        }),
      });
    },
    { studio, discussions, mode, discussionId, proposal },
  );
  await page.goto('/');
  return { studio, feature, step, discussionId };
}
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'bridgeMessages') as ClientMessage[]);

test('a report opens a frozen discussion without sending, then returns directly to its editor', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.getByRole('button', { name: 'Discuter avec l’agent' }).click();
  await expect(page.getByRole('region', { name: 'Compte rendu lié' })).toBeVisible();
  await expect(page.getByLabel('Agent de discussion', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Modèle de la discussion')).toHaveValue('original-model');
  await expect(page.getByLabel('Raisonnement de la discussion')).toHaveValue('high');
  await expect(
    page.getByText('Ancienne exécution : certains échanges sont absents.'),
  ).toBeVisible();
  await page.getByText('Compte rendu au début de cette discussion', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choix de départ' })).toBeVisible();
  expect(
    (await messages(page)).some(
      (message) => message.type === 'sendDiscussion' || message.type === 'runStep',
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Peux-tu m’expliquer tes choix ?' }).click();
  await expect(page.getByLabel('Votre message', { exact: true })).toHaveValue(
    'Peux-tu m’expliquer tes choix ?',
  );
  await page.screenshot({ path: testInfo.outputPath('report-discussion.png') });
  await page.getByRole('button', { name: 'Modifier le compte rendu actuel' }).click();
  await expect(page.getByLabel('Compte rendu modifié')).toHaveValue(/recherche locale/);
  await page.getByRole('button', { name: 'Fermer l’éditeur' }).click();
  await page.getByRole('button', { name: 'Discuter avec l’agent' }).click();
  await expect(page.locator('.discussion-history-item')).toHaveCount(1);
  await expect(page.getByLabel('Votre message', { exact: true })).toHaveValue(
    'Peux-tu m’expliquer tes choix ?',
  );
});

test('human report drafts cannot be lost by opening a discussion', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Modifier le compte rendu', exact: false }).click();
  await page.getByLabel('Compte rendu modifié').fill('Mon brouillon non enregistré');
  await expect(page.getByRole('button', { name: 'Discuter avec l’agent' })).toBeDisabled();
  expect((await messages(page)).some((message) => message.type === 'openReportDiscussion')).toBe(
    false,
  );
});

test('the discussed copy stays frozen when the current report changes', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Discuter avec l’agent' }).click();
  await expect(page.getByRole('region', { name: 'Compte rendu lié' })).toBeVisible();
  await page.evaluate(() => {
    const studio = Reflect.get(window, 'bridgeStudio') as typeof demoState;
    studio.features[0].steps[0].attempts[0].artifact!.content = 'Version humaine plus récente';
    studio.features[0].steps[0].attempts[0].revision = 1;
  });
  await page.getByText('Compte rendu au début de cette discussion', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choix de départ' })).toBeVisible();
  await page.getByRole('button', { name: 'Modifier le compte rendu actuel' }).click();
  await expect(page.getByLabel('Compte rendu modifié')).toHaveValue('Version humaine plus récente');
  await expect(page.getByText('Le compte rendu a évolué depuis cette discussion.')).toBeVisible();
});

test('a discussion becomes an editable feature proposal and failed creation keeps the adjustments', async ({
  page,
}, testInfo) => {
  const fixture = await setup(page, 'idea');
  await page.getByLabel('Votre message', { exact: true }).fill('Une question encore en brouillon');
  await page.getByRole('button', { name: 'Créer une feature', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Une nouvelle feature' })).toBeVisible();
  await expect(page.getByLabel('Qu’allons-nous faire ?', { exact: false })).toHaveValue(
    'Recherche au clavier',
  );
  await page
    .getByLabel('Qu’allons-nous faire ?', { exact: false })
    .fill('Recherche validée par Matt');
  await page
    .getByLabel('Critères de réussite', { exact: false })
    .fill('Entrée ouvre le résultat\nÉchap ferme la recherche');
  await expect(page.getByRole('textbox', { name: 'Mission 1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Autorisations 2', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Modèle de l’intervention').first()).toHaveValue('');
  await expect(page.getByLabel('Niveau de réflexion').first()).toHaveValue('');
  await page.getByRole('button', { name: 'Monter l’intervention 2' }).click();
  await page.screenshot({ path: testInfo.outputPath('discussion-feature-proposal.png') });
  await page.getByRole('button', { name: 'Créer la feature', exact: true }).click();
  const request = (await messages(page)).find((message) => message.type === 'createFeature');
  expect(request).toMatchObject({
    title: 'Recherche validée par Matt',
    discussionId: fixture.discussionId,
    criteria: ['Entrée ouvre le résultat', 'Échap ferme la recherche'],
    team: [{ name: 'Développement' }, { name: 'Cadrage' }],
  });
  expect(
    (await messages(page)).some(
      (message) => message.type === 'runStep' || message.type === 'startAutopilot',
    ),
  ).toBe(false);
  await page.evaluate(
    (request) =>
      window.postMessage(
        {
          type: 'featureCreateResult',
          requestId: request!.requestId,
          error: 'Le projet est occupé.',
        },
        '*',
      ),
    request,
  );
  await expect(page.getByRole('alert')).toContainText('Le projet est occupé');
  await expect(page.getByLabel('Qu’allons-nous faire ?', { exact: false })).toHaveValue(
    'Recherche validée par Matt',
  );
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(page.getByLabel('Votre message', { exact: true })).toHaveValue(
    'Une question encore en brouillon',
  );
  await page.getByRole('button', { name: 'Ajuster et créer la feature' }).click();
  await expect(page.getByLabel('Qu’allons-nous faire ?', { exact: false })).toHaveValue(
    'Recherche validée par Matt',
  );
  await page.getByRole('button', { name: 'Créer la feature', exact: true }).click();
  const retry = (await messages(page))
    .filter((message) => message.type === 'createFeature')
    .at(-1)!;
  await page.evaluate(
    (request) =>
      window.postMessage(
        { type: 'featureCreateResult', requestId: request.requestId, featureId: 'new-feature' },
        '*',
      ),
    retry,
  );
  await expect(page.getByRole('dialog', { name: 'Une nouvelle feature' })).toHaveCount(0);
});

test('linked discussions remain usable in a compact window', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await setup(page);
  await page.getByRole('button', { name: 'Discuter avec l’agent' }).click();
  await expect(page.getByRole('button', { name: 'Modifier le compte rendu actuel' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByLabel('Votre message', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Envoyer le message' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('report-discussion-compact.png') });
});
