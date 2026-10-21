import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { demoState } from '../webview/demo';
import { createPair } from '../src/core/pair';
import { emptyLaunch } from '../src/core/context';
import type { Attempt, ClientMessage, StudioState } from '../src/shared/types';

function scenario(mode: 'solo' | 'pair' = 'pair', busy = false) {
  const state = structuredClone(demoState),
    feature = state.features[0],
    step = feature.steps[0];
  state.features = [feature];
  feature.steps = [step];
  feature.activeStepId = step.id;
  feature.title = 'Des filtres qui restent simples';
  feature.description = 'Concevoir les filtres de recherche et préserver la navigation au clavier.';
  feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
  feature.status = busy ? 'running' : 'attention';
  delete feature.autopilot;
  delete feature.archived;
  delete feature.worktree;
  feature.criteria = [];
  feature.reviewComments = [];
  step.dependsOn = [];
  step.status = busy ? 'running' : 'awaiting_review';
  const agent = state.agents.find((a) => a.id === step.agentId)!;
  const attempt: Attempt = {
    id: 'conversation-attempt',
    agentName: 'Ada',
    startedAt: '2026-10-21T12:00:00Z',
    status: step.status,
    logs: [],
    questions: [],
    answers: {},
    feedback: '',
    changedFiles: ['src/filters.ts'],
    revision: 2,
    sessionId: 'native-session',
    artifact: {
      name: 'Filtres.md',
      content: '# Filtres simples\n\nLa navigation au clavier est conservée.',
      updatedAt: '2026-10-21T12:01:00Z',
    },
  };
  attempt.launch = { ...emptyLaunch(), permissionMode: 'manual' };
  attempt.pair = createPair({
    feature,
    step,
    attempt,
    agent,
    skills: [],
    workspacePath: state.workspace.path,
    settings: state.settings,
    launch: attempt.launch,
    preparedPrompt: 'Préserver la navigation au clavier.',
  });
  Object.assign(attempt.pair, {
    mode,
    engaged: mode === 'pair',
    phase: busy ? 'working' : 'review',
    busy,
    calls: 1,
    turn: { kind: 'solo' },
    sessionIds: ['native-session'],
  });
  attempt.pair.messages = [
    {
      id: 'user',
      role: 'user',
      content: 'Ajoute des filtres simples, accessibles au clavier.',
      at: '2026-10-21T12:00:00Z',
      status: 'complete',
      delivery: 'received',
    },
    {
      id: 'reason',
      role: 'assistant',
      kind: 'reasoning',
      content: 'Je consulte le composant existant pour préserver le comportement au clavier.',
      at: '2026-10-21T12:00:01Z',
      status: 'complete',
    },
    {
      id: 'assistant',
      role: 'assistant',
      content:
        'J’ai conservé les contrôles natifs pour la navigation au clavier. Les filtres sont prêts à relire.\n\nTu peux me demander une explication ou un ajustement avant de valider l’étape.',
      at: '2026-10-21T12:00:03Z',
      status: 'complete',
    },
  ];
  attempt.nativeActivity = [
    {
      id: 'tool',
      source: 'copilot',
      tool: 'view',
      sessionId: 'native-session',
      startedAt: '2026-10-21T12:00:02Z',
      finishedAt: '2026-10-21T12:00:02Z',
      status: 'completed',
      directory: '/workspace/search',
      arguments: '{"path":"src/filters.ts"}',
      output: 'export function Filters() { /* ... */ }',
    },
  ];
  step.attempts = [attempt];
  state.runtime = {
    state: 'ready',
    authenticated: true,
    models: [],
    native: {
      available: true,
      tools: ['view', 'edit', 'bash', 'ask_user'],
      permissionModes: ['manual', 'allow-all'],
    },
  };
  state.humanRequests = [];
  delete state.workspaceOperation;
  return state;
}
async function open(page: Page, state: StudioState) {
  await page.addInitScript((initial) => {
    const sent: ClientMessage[] = [],
      data = initial;
    let saved: unknown = {
      navigationVersion: 2,
      view: 'sessions',
      featureId: data.features[0].id,
      stepId: data.features[0].activeStepId,
      pairOpen: true,
    };
    const publish = () => window.postMessage({ type: 'state', state: data }, '*');
    Object.assign(window, {
      conversationState: data,
      conversationSent: sent,
      conversationPublish: publish,
      conversationError: '',
      acquireVsCodeApi: () => ({
        getState: () => saved,
        setState: (s: unknown) => {
          saved = s;
        },
        postMessage(message: ClientMessage) {
          sent.push(message);
          if (message.type === 'ready')
            setTimeout(() => {
              publish();
              window.postMessage({ type: 'themeState', theme: 'guilde-sombre' }, '*');
            }, 0);
          if (message.type === 'pairAction')
            setTimeout(() => {
              const pair = data.features[0].steps[0].attempts[0].pair!,
                error = Reflect.get(window, 'conversationError');
              if (!error) {
                if (message.action === 'pair' || message.action === 'solo') {
                  if (pair.busy) pair.requestedMode = message.action;
                  else pair.mode = message.action;
                }
                if (message.action === 'pause') pair.pauseRequested = true;
                if (message.action === 'preferences' && message.preferences)
                  pair.preferences = message.preferences;
                if (message.action === 'message')
                  pair.messages.push({
                    id: message.requestId,
                    requestId: message.requestId,
                    role: 'user',
                    content: message.content!,
                    at: new Date().toISOString(),
                    status: 'complete',
                    delivery: pair.busy ? 'pending' : 'received',
                  });
                pair.version++;
              }
              publish();
              window.postMessage(
                {
                  type: 'pairActionResult',
                  requestId: message.requestId,
                  error: error || undefined,
                },
                '*',
              );
            }, 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Conversation', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}
const sent = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'conversationSent') as ClientMessage[]);
async function update(page: Page, change: 'paused' | 'approved') {
  await page.evaluate((value) => {
    const state = Reflect.get(window, 'conversationState') as StudioState,
      step = state.features[0].steps[0],
      attempt = step.attempts[0];
    if (value === 'approved') step.status = attempt.status = 'approved';
    else {
      attempt.pair!.busy = false;
      attempt.pair!.phase = 'paused';
      step.status = attempt.status = 'cancelled';
    }
    Reflect.get(window, 'conversationPublish')();
  }, change);
}

test('shows the same native timeline in solo, joins pair without changing permissions, and accepts an intervention while busy', async ({
  page,
}) => {
  await open(page, scenario('solo', true));
  await expect(page.getByLabel('Ton message à l’agent')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Livrable', exact: true })).toBeVisible();
  await page.locator('.conversation-tool summary').click();
  await expect(page.locator('.conversation-tool')).toContainText('src/filters.ts');
  await page.getByText('Réflexion transmise par Copilot', { exact: true }).click();
  await expect(page.locator('.conversation-reasoning')).toContainText('composant existant');
  await page.getByRole('button', { name: 'Passer en pair', exact: true }).click();
  await expect(page.getByLabel('Ton message à l’agent')).toBeEnabled();
  await expect(page.locator('.conversation-state')).toContainText('Passage en pair demandé');
  await expect(page.getByRole('combobox', { name: 'Permissions Copilot' })).toHaveValue('manual');
  await page.getByLabel('Ton message à l’agent').fill('Conserve le raccourci existant.');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByText('En attente de transmission', { exact: true })).toBeVisible();
  expect((await sent(page)).filter((m) => m.type === 'setPermissionMode')).toHaveLength(0);
});

test('keeps the chat open for final questions, routes the artifact link back, and locks only after step validation', async ({
  page,
}) => {
  await open(page, scenario());
  await expect(page.locator('.conversation-state')).toContainText('Résultat prêt');
  await page.getByRole('tab', { name: 'Livrable', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Filtres simples' })).toBeVisible();
  await page.getByRole('button', { name: 'Revenir à la conversation' }).click();
  await page.getByLabel('Ton message à l’agent').fill('Pourquoi ces contrôles ?');
  await page.evaluate(() => Reflect.set(window, 'conversationError', 'Stockage indisponible'));
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Stockage indisponible');
  await expect(page.getByLabel('Ton message à l’agent')).toHaveValue('Pourquoi ces contrôles ?');
  await page.getByRole('tab', { name: 'Livrable', exact: true }).click();
  await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
  await expect(page.getByLabel('Ton message à l’agent')).toHaveValue('Pourquoi ces contrôles ?');
  await update(page, 'approved');
  await expect(page.locator('.conversation-state')).toContainText('Étape validée');
  await expect(page.getByLabel('Ton message à l’agent')).toHaveCount(0);
  expect((await sent(page)).filter((m) => m.type === 'openReportDiscussion')).toHaveLength(0);
});

test('keeps rhythm, explanations, permissions and takeover as independent explicit choices', async ({
  page,
}) => {
  await open(page, scenario());
  await page
    .getByText('Par blocs · Ajuster le rythme et les explications', { exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Rythme', exact: true }).selectOption('small');
  await page.getByRole('combobox', { name: 'Explications', exact: true }).selectOption('concise');
  await page.getByRole('button', { name: 'Appliquer mes préférences' }).click();
  await expect
    .poll(async () => (await sent(page)).filter((m) => m.type === 'pairAction').at(-1))
    .toMatchObject({
      action: 'preferences',
      preferences: { pace: 'small', explanation: 'concise' },
    });
  await expect(page.getByRole('combobox', { name: 'Permissions Copilot' })).toHaveValue('manual');
});

test('does not claim the user has control before the native runtime has stopped', async ({
  page,
}) => {
  await open(page, scenario('pair', true));
  await page.getByRole('button', { name: 'Reprendre la main', exact: true }).click();
  await expect(page.locator('.conversation-state')).toContainText('Arrêt demandé');
  await expect(page.locator('.conversation-state')).not.toContainText('À toi');
  await update(page, 'paused');
  await expect(page.locator('.conversation-state')).toContainText('À toi · exécution arrêtée');
  await expect(
    page.getByRole('button', { name: 'Reprendre le travail', exact: true }),
  ).toBeEnabled();
});

test('shows retained uncertain messages with an explicit choice before resending', async ({
  page,
}) => {
  const state = scenario(),
    pair = state.features[0].steps[0].attempts[0].pair!;
  pair.phase = 'interrupted';
  pair.messages[0].delivery = 'uncertain';
  await open(page, state);
  await expect(
    page.getByText('Transmission à vérifier · message conservé', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Garder sans renvoyer' }).click();
  await expect
    .poll(async () => (await sent(page)).filter((m) => m.type === 'pairAction').at(-1))
    .toMatchObject({ action: 'keep-message', messageId: 'user' });
});

test('can continue in the same conversation after answering questions attached to a partial result', async ({
  page,
}) => {
  const state = scenario('solo'),
    step = state.features[0].steps[0],
    attempt = step.attempts[0];
  step.status = attempt.status = 'waiting_input';
  attempt.pair!.phase = 'checkpoint';
  attempt.questions = [{ id: 'audience', text: 'Pour qui ?' }];
  attempt.answers = { audience: 'Matt' };
  await open(page, state);
  await page.getByRole('button', { name: 'Poursuivre après mes réponses' }).click();
  await expect
    .poll(async () => (await sent(page)).filter((m) => m.type === 'pairAction').at(-1))
    .toMatchObject({ action: 'resume' });
});

test('renders the shared conversation in the project theme and fits a narrow VS Code editor', async ({
  page,
}) => {
  await open(page, scenario());
  await mkdir(resolve('docs/screenshots'), { recursive: true });
  await page.screenshot({
    path: resolve('docs/screenshots/conversation-pair.png'),
    fullPage: true,
  });
  await page
    .locator('.step-layout')
    .screenshot({ path: resolve('docs/screenshots/conversation-detail.png') });
  await page.setViewportSize({ width: 560, height: 920 });
  await expect(page.getByLabel('Ton message à l’agent')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: resolve('docs/screenshots/conversation-narrow.png'),
    fullPage: true,
  });
});
