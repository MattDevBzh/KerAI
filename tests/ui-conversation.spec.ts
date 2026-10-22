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
                    images: message.images,
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

test('shows actual skill and instruction loads, preserves historic content and fits narrow screens', async ({
  page,
}) => {
  const state = scenario('solo');
  const attempt = state.features[0].steps[0].attempts[0];
  attempt.nativeContextLoads = [
    {
      id: 'loaded-skill',
      sessionId: 'native-session',
      at: '2026-10-22T14:00:01Z',
      kind: 'skill',
      name: 'Revue d’une API .NET',
      path: '/catalogue/skills/revue-api/SKILL.md',
      origin: 'user',
      trigger: 'agent-invoked',
      content:
        'Vérifier les autorisations, les erreurs HTTP et les accès aux données.\nLes tests attendent la validation humaine du code.',
      digest: 'a'.repeat(64),
    },
    {
      id: 'loaded-instruction',
      sessionId: 'native-session',
      at: '2026-10-22T14:00:02Z',
      kind: 'instruction',
      name: 'Conventions du backend',
      path: '.github/instructions/backend.instructions.md',
      origin: 'project',
      trigger: 'view-instruction',
      content:
        '---\napplyTo: "src/host/**/*.ts"\n---\nConserver les permissions côté hôte. Masquer les secrets dans les traces.',
      digest: 'b'.repeat(64),
    },
  ];
  await open(page, state);
  const panel = page.locator('.session-conversation .native-context-panel');
  await panel.locator(':scope > summary').click();
  await expect(panel).toContainText('1 compétence · 1 instruction');
  await panel.getByText('Revue d’une API .NET', { exact: true }).click();
  await expect(panel).toContainText('Les tests attendent la validation humaine du code.');
  await panel.getByText('Conventions du backend', { exact: true }).click();
  await expect(panel).toContainText('Instruction consultée');
  await expect(panel).toContainText('Extrait effectivement lu');
  await expect(panel).toContainText('Masquer les secrets');
  await mkdir(resolve('docs/screenshots'), { recursive: true });
  await page.screenshot({
    path: resolve('docs/screenshots/native-context-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({
    path: resolve('docs/screenshots/native-context-narrow.png'),
    fullPage: true,
  });
});
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
  await page.getByRole('button', { name: /Afficher les messages intermédiaires/ }).click();
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

test('shares the prompt draft across the popin and chat, avoids duplicate answers and advances the queue', async ({
  page,
}) => {
  const state = scenario('pair', true),
    feature = state.features[0],
    step = feature.steps[0];
  state.humanRequests = [
    {
      id: 'question-one',
      kind: 'question',
      featureId: feature.id,
      stepId: step.id,
      question: 'Quel comportement pour les filtres ?',
      allowFreeform: true,
      choices: ['Conserver le choix', 'Réinitialiser'],
    },
  ];
  await open(page, state);
  const dialog = page.getByRole('dialog', { name: 'Votre réponse est attendue' });
  const chat = page.locator('.session-conversation');
  await expect(dialog).toBeVisible();
  await expect(
    chat.getByRole('heading', { name: 'Quel comportement pour les filtres ?' }),
  ).toBeAttached();
  await dialog
    .getByLabel('Votre réponse', { exact: true })
    .fill('Conserver les filtres pendant la session.');
  await mkdir(resolve('docs/screenshots/session-ergonomics'), { recursive: true });
  await page.screenshot({ path: resolve('docs/screenshots/session-ergonomics/prompt-popin.png') });
  await dialog.getByRole('button', { name: 'Réduire au chat' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chat.getByLabel('Votre réponse', { exact: true })).toHaveValue(
    'Conserver les filtres pendant la session.',
  );
  await chat
    .getByLabel('Votre réponse', { exact: true })
    .fill('Conserver aussi la navigation au clavier.');
  await page.evaluate(() => Reflect.get(window, 'conversationPublish')());
  await expect(dialog).toHaveCount(0);
  await chat.getByRole('button', { name: 'Mettre en avant le prompt' }).click();
  await expect(dialog.getByLabel('Votre réponse', { exact: true })).toHaveValue(
    'Conserver aussi la navigation au clavier.',
  );
  await dialog.getByRole('button', { name: 'Transmettre la réponse' }).click();
  await expect(dialog.getByRole('button', { name: 'Transmettre la réponse' })).toBeDisabled();
  expect((await sent(page)).filter((m) => m.type === 'answerHumanRequest')).toEqual([
    {
      type: 'answerHumanRequest',
      requestId: 'question-one',
      answer: 'Conserver aussi la navigation au clavier.',
    },
  ]);
  await page.evaluate(() => {
    const data = Reflect.get(window, 'conversationState') as StudioState;
    data.humanRequests = [
      { ...data.humanRequests![0], id: 'question-two', question: 'Une dernière précision ?' },
    ];
    Reflect.get(window, 'conversationPublish')();
  });
  await expect(dialog.getByRole('heading', { name: 'Une dernière précision ?' })).toBeVisible();
  await expect(dialog.getByLabel('Votre réponse', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => {
    const data = Reflect.get(window, 'conversationState') as StudioState;
    data.humanRequests = [];
    Reflect.get(window, 'conversationPublish')();
  });
  await expect(chat.getByRole('button', { name: 'Mettre en avant le prompt' })).toHaveCount(0);
});

test('automatically folds live technical messages when a user-facing message arrives', async ({
  page,
}) => {
  const state = scenario('pair', true),
    pair = state.features[0].steps[0].attempts[0].pair!;
  pair.messages = pair.messages.filter((m) => m.id !== 'assistant');
  await open(page, state);
  await expect(
    page.getByRole('button', { name: /Masquer les messages intermédiaires/ }),
  ).toBeVisible();
  await expect(page.locator('.conversation-tool')).toBeVisible();
  await page.evaluate(() => {
    const data = Reflect.get(window, 'conversationState') as StudioState;
    data.features[0].steps[0].attempts[0].pair!.messages.push({
      id: 'reply',
      role: 'assistant',
      kind: 'text',
      content: 'Les filtres sont prêts.',
      at: '2026-10-21T12:00:04Z',
      status: 'streaming',
    });
    Reflect.get(window, 'conversationPublish')();
  });
  await expect(
    page.getByRole('button', { name: /Afficher les messages intermédiaires/ }),
  ).toBeVisible();
  await expect(page.locator('.conversation-tool')).toHaveCount(0);
  await expect(page.getByText('Les filtres sont prêts.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Afficher les messages intermédiaires/ }).click();
  await expect(page.locator('.conversation-tool')).toBeVisible();
  await page.getByRole('button', { name: /Masquer les messages intermédiaires/ }).click();
  await expect(page.locator('.conversation-tool')).toHaveCount(0);
});

test('minimizing closes the whole pending queue, keeps independent drafts and fits a narrow window', async ({
  page,
}) => {
  const state = scenario('pair', true),
    feature = state.features[0];
  state.humanRequests = ['Première question ?', 'Deuxième question ?'].map((question, i) => ({
    id: `queue-${i}`,
    kind: 'question',
    featureId: feature.id,
    stepId: feature.activeStepId,
    question,
    allowFreeform: true,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, state);
  const dialog = page.getByRole('dialog', { name: 'Votre réponse est attendue' });
  await dialog.getByLabel('Votre réponse', { exact: true }).fill('Premier brouillon');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Réduire au chat' }).click();
  await expect(dialog).toHaveCount(0);
  const cards = page.locator('.session-conversation .human-request');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByLabel('Votre réponse', { exact: true })).toHaveValue(
    'Premier brouillon',
  );
  await cards.nth(1).getByRole('button', { name: 'Mettre en avant le prompt' }).click();
  await expect(dialog.getByLabel('Votre réponse', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('heading', { name: 'Deuxième question ?' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await mkdir(resolve('docs/screenshots/session-ergonomics'), { recursive: true });
  await page.screenshot({ path: resolve('docs/screenshots/session-ergonomics/prompt-narrow.png') });
  await page.evaluate(() => {
    const data = Reflect.get(window, 'conversationState') as StudioState;
    data.humanRequests = [];
    Reflect.get(window, 'conversationPublish')();
  });
  await expect(dialog).toHaveCount(0);
  expect((await sent(page)).filter((m) => m.type === 'answerHumanRequest')).toHaveLength(0);
});

test('images : fichier et collage, aperçu, retrait et transmission dans la conversation', async ({
  page,
}) => {
  const state = scenario();
  await open(page, state);
  const image = await page.screenshot();
  const file = page
    .getByRole('region', { name: 'Conversation de l’étape' })
    .getByLabel('Ajouter des images');
  await file.setInputFiles({ name: 'bug.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('img', { name: 'bug.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retirer bug.png' }).click();
  await expect(page.getByRole('img', { name: 'bug.png', exact: true })).toHaveCount(0);
  await page.getByLabel('Ton message à l’agent').evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'capture-collee.png', { type: 'image/png' }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, image.toString('base64'));
  await expect(page.getByRole('img', { name: 'capture-collee.png', exact: true })).toBeVisible();
  await page.getByLabel('Ton message à l’agent').fill('Le problème est dans cette zone.');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByLabel('Ton message à l’agent')).toHaveValue('');
  await expect(page.getByRole('img', { name: 'capture-collee.png', exact: true })).toBeVisible();
  const sent = await page.evaluate(() => Reflect.get(window, 'conversationSent'));
  const message = [...sent]
    .reverse()
    .find((m: ClientMessage) => m.type === 'pairAction' && m.action === 'message');
  expect(message.images[0].mimeType).toBe('image/png');
  expect(message.images[0].data.length).toBeGreaterThan(100);
  await page.screenshot({ path: 'docs/screenshots/images-conversation.png', fullPage: true });
});

test('dossier : conclusions reliées, sources datées, export et affichage compact', async ({
  page,
}) => {
  const state = scenario(),
    feature = state.features[0],
    attempt = feature.steps[0].attempts[0];
  attempt.nativeActivity = [
    {
      id: 'source-code',
      source: 'copilot',
      sessionId: 'native-session',
      tool: 'view',
      startedAt: '2026-10-23T00:00:00Z',
      finishedAt: '2026-10-23T00:00:01Z',
      directory: '/repo',
      arguments: '{"path":"src/filters.ts"}',
      status: 'completed',
      output: 'Le filtre conserve les contrôles natifs et leur navigation au clavier.',
    },
  ];
  attempt.proofClaims = [
    {
      id: 'afc26fe5-d797-4290-a1fa-88ad4f4d049b',
      text: 'Les contrôles natifs sont conservés.',
      proofIds: ['runtime:source-code'],
      verdict: 'supported',
      author: 'agent',
      at: '2026-10-23T00:00:02Z',
      reportRevision: 2,
    },
  ];
  await open(page, state);
  await page.getByRole('tab', { name: /Preuves/ }).click();
  const dossier = page.getByRole('region', { name: 'Dossier de preuves' });
  await expect(dossier).toBeVisible();
  await expect(dossier).toContainText('Appréciation de l’agent');
  await dossier.locator('.proof-links').getByRole('button').click();
  await expect(dossier.locator('pre').filter({ hasText: 'Le filtre conserve' })).toBeVisible();
  await dossier.getByRole('button', { name: 'Réviser cette conclusion' }).click();
  await expect(dossier.getByLabel('Conclusion', { exact: true })).toHaveValue(
    'Les contrôles natifs sont conservés.',
  );
  await dossier.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/dossier-preuves.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dossier).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/dossier-preuves-390.png', fullPage: true });
  await dossier.getByRole('button', { name: 'Exporter le dossier' }).click();
  expect((await page.evaluate(() => Reflect.get(window, 'conversationSent'))).at(-1).type).toBe(
    'exportProofDossier',
  );
});

test('exports : chaque format conserve la tentative et la révision affichées', async ({ page }) => {
  const state = scenario();
  await open(page, state);
  await page.getByRole('tab', { name: 'Livrable', exact: true }).click();
  for (const format of ['md', 'docx', 'pptx', 'html']) {
    await page.getByLabel('Format du document').selectOption(format);
    await page.getByRole('button', { name: `Télécharger .${format}`, exact: true }).click();
    const message = (await sent(page)).at(-1)!;
    expect(message).toMatchObject({
      type: 'exportAgentReport',
      format,
      attemptId: 'conversation-attempt',
      revision: 2,
    });
    await page.evaluate(
      (message) =>
        window.postMessage(
          {
            type: 'agentReportExported',
            requestId: 'requestId' in message ? message.requestId : '',
            cancelled: true,
          },
          '*',
        ),
      message,
    );
  }
});
