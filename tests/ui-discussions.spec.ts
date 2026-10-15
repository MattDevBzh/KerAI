import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';
import type { DiscussionState } from '../src/shared/discussions';

async function hosted(page: Page, theme = 'minuit', preferred = true) {
  const studio = structuredClone(demoState);
  studio.features = [];
  studio.agents[0].nickname = 'Ada';
  studio.agents[0].discussionAgent = preferred;
  studio.agents[1].nickname = 'Merlin';
  studio.agents[1].discussionAgent = false;
  studio.runtime = {
    state: 'ready',
    models: [
      { id: 'thoughtful', name: 'Réflexion', reasoningEfforts: ['low', 'high'] },
      { id: 'fast', name: 'Rapide' },
    ],
  };
  studio.projectCatalog = {
    dedicated: true,
    windows: true,
    selectedProjectIds: ['api'],
    activeProjectId: 'api',
    projects: [
      { id: 'api', name: 'API', path: '/projects/api' },
      { id: 'web', name: 'Web', path: '/projects/web' },
    ],
  };
  const discussions: DiscussionState = {
    discussions: [],
    defaultModel: 'thoughtful',
    agents: studio.agents.slice(0, 2).map((profile) => ({ key: `global:${profile.id}`, profile })),
  };
  await page.addInitScript(
    ({ studio, discussions, theme }) => {
      const saved = localStorage.getItem('discussion-fixture');
      if (saved) discussions.discussions = JSON.parse(saved);
      const sent: ClientMessage[] = [];
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const publish = () => {
        localStorage.setItem('discussion-fixture', JSON.stringify(discussions.discussions));
        window.postMessage({ type: 'state', state: studio }, '*');
        window.postMessage({ type: 'discussionState', state: discussions }, '*');
      };
      const acknowledge = (message: { requestId: string; discussionId: string }, error?: string) =>
        window.postMessage(
          {
            type: 'discussionResult',
            requestId: message.requestId,
            discussionId: message.discussionId,
            error,
          },
          '*',
        );
      Object.assign(window, {
        discussionMessages: sent,
        discussionFixture: discussions,
        studioFixture: studio,
        acquireVsCodeApi: () => ({
          getState: () =>
            JSON.parse(localStorage.getItem('view-fixture') || '{"view":"discussion"}'),
          setState: (view: unknown) => localStorage.setItem('view-fixture', JSON.stringify(view)),
          postMessage(message: ClientMessage) {
            sent.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                publish();
                window.postMessage({ type: 'themeState', theme }, '*');
              }, 0);
            if (message.type === 'activateProject') {
              studio.projectCatalog!.activeProjectId = message.projectId;
              publish();
            }
            if (message.type === 'sendDiscussion') {
              if (Reflect.get(window, 'rejectNextDiscussion')) {
                Reflect.set(window, 'rejectNextDiscussion', false);
                setTimeout(() => acknowledge(message, 'Agent indisponible'), 0);
                return;
              }
              let discussion = discussions.discussions.find(
                (item) => item.id === message.discussionId,
              );
              const now = new Date().toISOString();
              if (!discussion) {
                discussion = {
                  id: message.discussionId,
                  title: message.content,
                  agentKey: message.agentKey,
                  createdAt: now,
                  updatedAt: now,
                  messages: [],
                };
                discussions.discussions.push(discussion);
              }
              discussion.model = message.model;
              discussion.reasoning = message.reasoning;
              discussion.agentKey = message.agentKey;
              discussion.updatedAt = now;
              const profile = discussions.agents.find(
                (agent) => agent.key === message.agentKey,
              )!.profile;
              discussion.messages.push({
                id: crypto.randomUUID(),
                role: 'user',
                content: message.content,
                createdAt: now,
                status: 'complete',
              });
              const reply = {
                id: crypto.randomUUID(),
                role: 'assistant' as const,
                content: 'Je prépare une proposition.',
                createdAt: now,
                status: 'streaming' as 'streaming' | 'complete' | 'interrupted',
                agent: profile,
                model: message.model || 'thoughtful',
                reasoning: message.reasoning,
                usage: {
                  source: 'measured' as const,
                  inputTokens: 24,
                  outputTokens: 12,
                  cost: 1000000000,
                  unit: 'nano-AIU',
                },
              };
              discussion.messages.push(reply);
              setTimeout(() => {
                publish();
                if (Reflect.get(window, 'holdAcknowledgement'))
                  Reflect.set(window, 'acknowledgeDiscussion', () => acknowledge(message));
                else acknowledge(message);
              }, 0);
              const finish = () => {
                reply.status = 'complete';
                reply.content =
                  'Voici **trois pistes** pour votre projet.\n\n1. Clarifier le besoin.\n2. Comparer les solutions.\n3. Choisir la prochaine étape.';
                publish();
              };
              Reflect.set(window, 'finishDiscussion', finish);
              if (!Reflect.get(window, 'holdDiscussion'))
                timers.set(discussion.id, setTimeout(finish, 1200));
            }
            if (message.type === 'cancelDiscussion') {
              clearTimeout(timers.get(message.discussionId));
              const reply = discussions.discussions
                .find((item) => item.id === message.discussionId)!
                .messages.at(-1)!;
              reply.status = 'interrupted';
              reply.error = 'Réponse arrêtée.';
              publish();
            }
            if (message.type === 'deleteDiscussion') {
              discussions.discussions = discussions.discussions.filter(
                (item) => item.id !== message.discussionId,
              );
              publish();
              setTimeout(() => acknowledge(message), 0);
            }
            if (message.type === 'deleteWorkflow') {
              studio.workflows = studio.workflows.filter(
                (workflow) => workflow.id !== message.workflowId,
              );
              publish();
              setTimeout(
                () =>
                  window.postMessage(
                    { type: 'workflowDeleteResult', requestId: message.requestId },
                    '*',
                  ),
                0,
              );
            }
          },
        }),
      });
    },
    { studio, discussions, theme },
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Discussion', exact: true })).toBeVisible();
}

test('navigation order and project selector match each page; common settings precede project controls', async ({
  page,
}) => {
  await hosted(page);
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('button')).toHaveText([
    'Dashboard',
    'Discussion',
    'Validation',
    'Consommation',
    'Parcours',
    'Agents',
    'Skills',
    'Automatisations',
    'Kits',
    'Réglages',
    'Livraison',
    'Azure DevOps',
    'PR',
    'Tickets',
    'Mémoire',
  ]);
  for (const name of ['Dashboard', 'Discussion', 'Validation', 'Consommation']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('Projet actif', { exact: true })).toHaveCount(0);
  }
  for (const name of ['Mémoire', 'Agents', 'Azure DevOps']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('Projet actif', { exact: true })).toBeVisible();
  }
  await nav.getByRole('button', { name: 'Réglages', exact: true }).click();
  const common = page.getByRole('region', { name: 'Réglages communs' });
  await expect(common.getByLabel('Projet actif', { exact: true })).toHaveCount(0);
  const scoped = page.getByRole('region', { name: 'Réglages du projet' });
  await expect(scoped.getByLabel('Projet actif', { exact: true })).toBeVisible();
  await scoped.getByLabel('Projet actif', { exact: true }).selectOption('web');
  await expect(scoped).toContainText('Web');
  await page.getByLabel('Durée maximale d’une tentative').fill('32');
  await expect(scoped.getByLabel('Projet actif', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Annuler les modifications' }).click();
  await expect(scoped.getByLabel('Projet actif', { exact: true })).toBeEnabled();
});

test('preferred agents, contextual model, streamed bubbles and history survive navigation and reload', async ({
  page,
}, testInfo) => {
  await hosted(page);
  await page.evaluate(() => Reflect.set(window, 'holdDiscussion', true));
  const agents = page.getByLabel('Agent de discussion', { exact: true });
  await expect(agents.locator('option')).toHaveText(['Choisir un agent', 'Ada']);
  await page.getByRole('button', { name: 'Voir plus (1)' }).click();
  await expect(agents.locator('option')).toHaveText(['Choisir un agent', 'Ada', 'Merlin']);
  await page.getByLabel('Modèle de la discussion').selectOption('thoughtful');
  await page.getByLabel('Raisonnement de la discussion').selectOption('high');
  await page.getByLabel('Votre message', { exact: true }).fill('Comment organiser notre équipe ?');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.locator('.discussion-message.user')).toContainText(
    'Comment organiser notre équipe ?',
  );
  await expect(page.getByRole('button', { name: 'Arrêter la réponse' })).toBeVisible();
  await expect(agents).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, 'finishDiscussion')());
  await expect(page.locator('.discussion-message.assistant')).toContainText('trois pistes');
  await expect(page.locator('.discussion-history-item')).toHaveCount(1);
  await expect(page.getByLabel('Votre message', { exact: true })).toHaveValue('');
  const human = await page.locator('.discussion-message.user .discussion-bubble').boundingBox();
  const agent = await page
    .locator('.discussion-message.assistant .discussion-bubble')
    .boundingBox();
  expect(human!.x).toBeGreaterThan(agent!.x);
  await expect(page.locator('.discussion-message.assistant .pixel-avatar img')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('discussion-minuit.png') });
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Discussion', exact: true }).click();
  await expect(page.locator('.discussion-message')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.discussion-message')).toHaveCount(2);
  await expect(page.getByLabel('Modèle de la discussion')).toHaveValue('thoughtful');
  await expect(page.getByLabel('Raisonnement de la discussion')).toHaveValue('high');
  await page.getByRole('button', { name: 'Consommation', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Discussions', exact: true })).toHaveCount(1);
  await page
    .getByRole('region', { name: 'Par session' })
    .getByRole('button', { name: /Comment organiser/ })
    .click();
  await expect(page.locator('.discussion-message')).toHaveCount(2);
});

test('errors retain the draft; Shift+Enter adds a line; stop and delete leave a usable composer', async ({
  page,
}) => {
  await hosted(page);
  await page.evaluate(() => Reflect.set(window, 'holdDiscussion', true));
  await page.evaluate(() => Reflect.set(window, 'rejectNextDiscussion', true));
  const input = page.getByLabel('Votre message', { exact: true });
  await input.fill('Bonjour');
  await input.press('Shift+Enter');
  await input.press('A');
  await expect(input).toHaveValue('Bonjour\nA');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Agent indisponible');
  await expect(input).toHaveValue('Bonjour\nA');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Arrêter la réponse' }).click();
  await expect(page.locator('.discussion-message.assistant')).toContainText('Réponse arrêtée.');
  await expect(page.getByRole('button', { name: 'Envoyer le message' })).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer la discussion' }).click();
  await expect(page.locator('.discussion-history-item')).toHaveCount(0);
  await input.fill('Nouvelle question');
  await expect(page.getByRole('button', { name: 'Envoyer le message' })).toBeEnabled();
});

test('late acknowledgements keep the active draft and clear only the submitted conversation', async ({
  page,
}) => {
  await hosted(page);
  await page.evaluate(() => {
    Reflect.set(window, 'holdDiscussion', true);
    Reflect.set(window, 'holdAcknowledgement', true);
  });
  const input = page.getByLabel('Votre message', { exact: true });
  await input.fill('Première conversation');
  await input.press('Enter');
  await expect(page.locator('.discussion-history-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Nouvelle discussion' }).click();
  await input.fill('Un autre brouillon');
  await page.evaluate(() => Reflect.get(window, 'acknowledgeDiscussion')());
  await expect(input).toHaveValue('Un autre brouillon');
  await expect(page.locator('.discussion-message')).toHaveCount(0);
  await page.locator('.discussion-history-item').click();
  await expect(input).toHaveValue('');
  await expect(page.locator('.discussion-message.user')).toContainText('Première conversation');
});

test('marking an existing profile as a discussion agent immediately makes it selectable', async ({
  page,
}) => {
  await hosted(page, 'minuit', false);
  const agents = page.getByLabel('Agent de discussion', { exact: true });
  await expect(agents.locator('option')).toHaveText(['Choisir un agent']);
  await page.evaluate(() => {
    const state = Reflect.get(window, 'discussionFixture') as DiscussionState;
    state.agents[0].profile.discussionAgent = true;
    window.postMessage({ type: 'discussionState', state }, '*');
  });
  await expect(agents.locator('option')).toHaveText(['Choisir un agent', 'Ada']);
  await expect(agents).toHaveValue(`global:${demoState.agents[0].id}`);
});

test('workflow deletion removes only the chosen template from the catalogue', async ({ page }) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Parcours', exact: true }).click();
  const cards = page.locator('.workflow-library-card');
  const count = await cards.count();
  const title = await cards.first().getByRole('heading').textContent();
  await cards
    .first()
    .getByRole('button', { name: /^Supprimer le parcours/ })
    .click();
  await expect(cards).toHaveCount(count - 1);
  await expect(cards.filter({ hasText: title! })).toHaveCount(0);
});

test('history sorts discussions by date and supports finding an older thread', async ({ page }) => {
  await hosted(page);
  await page.evaluate(() => {
    const data = Reflect.get(window, 'discussionFixture') as DiscussionState;
    data.discussions = [
      'Ancienne discussion',
      'Discussion récente',
      'Discussion intermédiaire',
    ].map((title, index) => {
      const date = new Date();
      date.setDate(date.getDate() - [5, 0, 1][index]);
      return {
        id: crypto.randomUUID(),
        title,
        agentKey: data.agents[0].key,
        messages: [],
        createdAt: date.toISOString(),
        updatedAt: date.toISOString(),
      };
    });
    window.postMessage({ type: 'discussionState', state: data }, '*');
  });
  await expect(page.locator('.discussion-history-item > span')).toHaveText([
    'Discussion récente',
    'Discussion intermédiaire',
    'Ancienne discussion',
  ]);
  await expect(page.getByRole('heading', { name: 'Aujourd’hui', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hier', exact: true })).toBeVisible();
  await page.getByLabel('Rechercher une discussion').fill('Ancienne');
  await expect(page.locator('.discussion-history-item')).toHaveCount(1);
  await page.locator('.discussion-history-item').click();
  await expect(page.locator('.discussion-title')).toContainText('Ancienne discussion');
});

test('discussion remains usable in a compact high-contrast window', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await hosted(page);
  await page
    .getByRole('textbox', { name: 'Votre message', exact: true })
    .fill('Une question accessible.');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.locator('.discussion-message.assistant')).toContainText('trois pistes');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Nouvelle discussion' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('discussion-compact-contrast.png') });
});

test('agent creation and editing expose the discussion marker', async ({ page }) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvel agent', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Agent de discussion/ })).not.toBeChecked();
  await page.getByRole('checkbox', { name: /Agent de discussion/ }).check();
  await page.getByLabel('Nom du profil', { exact: false }).fill('Conseiller');
  await page.getByLabel('Instructions', { exact: false }).fill('Aider à réfléchir.');
  await page
    .getByRole('button', { name: /Enregistrer|Créer l’agent/ })
    .last()
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...(Reflect.get(window, 'discussionMessages') as ClientMessage[])]
          .reverse()
          .find((message) => message.type === 'saveAgent'),
      ),
    )
    .toMatchObject({ type: 'saveAgent', agent: { discussionAgent: true } });
});

for (const theme of ['aube', 'brume', 'sauge', 'minuit', 'foret'])
  test(`discussion bubbles remain distinct and readable in ${theme}`, async ({
    page,
  }, testInfo) => {
    await hosted(page, theme);
    await page.getByLabel('Votre message', { exact: true }).fill('Préparons la prochaine version.');
    await page.getByRole('button', { name: 'Envoyer le message' }).click();
    await expect(page.locator('.discussion-message.assistant')).toContainText('trois pistes');
    const colors = await page.locator('.discussion-bubble').evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgb = (color: string) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const luminance = (color: string) =>
          rgb(color)
            .map((channel) => channel / 255)
            .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const a = luminance(style.color),
          b = luminance(style.backgroundColor);
        return {
          background: style.backgroundColor,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      }),
    );
    expect(colors[0].background).not.toBe(colors[1].background);
    for (const color of colors) expect(color.contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath(`discussion-${theme}.png`) });
  });
