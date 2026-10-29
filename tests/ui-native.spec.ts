import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';

function fixture(running = false): StudioState {
  const state = structuredClone(demoState),
    feature = state.features[0],
    step = feature.steps[0];
  state.features = [feature];
  feature.steps = [step];
  feature.activeStepId = step.id;
  feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
  feature.title = 'Une recherche plus agréable';
  feature.status = running ? 'running' : 'draft';
  delete feature.autopilot;
  delete feature.worktree;
  delete feature.archived;
  step.dependsOn = [];
  step.status = running ? 'running' : 'pending';
  step.maxAttempts = 10;
  step.attempts = running
    ? [
        {
          id: 'native-fixture',
          startedAt: '2026-10-21T12:00:00Z',
          status: 'running',
          feedback: '',
          logs: [],
          questions: [],
          answers: {},
          changedFiles: [],
          sessionId: 'native-session',
          launch: {
            initialContext: '',
            mcpServerIds: [],
            memoryIds: [],
            useProjectMemory: false,
            permissionMode: 'manual',
          },
          nativeActivity: [
            {
              id: 'native-shell',
              source: 'copilot',
              tool: 'bash',
              sessionId: 'native-session',
              startedAt: '2026-10-21T12:00:00Z',
              finishedAt: '2026-10-21T12:00:01Z',
              status: 'completed',
              directory: '/workspace/website',
              arguments: '{"command":"npm test"}',
              command: 'npm test',
              output: '12 tests passed',
              exitCode: 0,
            },
          ],
        },
      ]
    : [];
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
  state.humanRequests = running
    ? [
        {
          id: 'native-permission',
          kind: 'native-permission',
          featureId: feature.id,
          stepId: step.id,
          question: 'Exécuter cette commande ?',
          details: 'Dossier : /workspace/website\nCommande : npm run build',
          choices: ['allow', 'deny'],
          allowFreeform: false,
        },
      ]
    : [];
  delete state.workspaceOperation;
  return state;
}

async function open(page: Page, state: StudioState, selected = true) {
  await page.addInitScript(
    ({ state, selected }) => {
      const sent: ClientMessage[] = [];
      const saved = {
        navigationVersion: 2,
        view: 'sessions',
        featureId: selected ? state.features[0].id : '',
        stepId: selected ? state.features[0].steps[0].id : '',
      };
      Object.assign(window, {
        nativeMessages: sent,
        nativeFixture: state,
        acquireVsCodeApi: () => ({
          getState: () => saved,
          setState() {},
          postMessage(message: ClientMessage) {
            sent.push(message);
            if (message.type === 'ready')
              setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
          },
        }),
      });
    },
    { state, selected },
  );
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
}
async function sent(page: Page, type: string) {
  return page.evaluate(
    (type) =>
      (Reflect.get(window, 'nativeMessages') as ClientMessage[]).filter(
        (message) => message.type === type,
      ),
    type,
  );
}

test('shows checkpoint and connection progress and keeps a saved session ID from enabling permissions too early', async ({
  page,
}) => {
  const state = fixture(true);
  state.humanRequests = [];
  const feature = state.features[0],
    step = feature.steps[0];
  state.runProgress = {
    featureId: feature.id,
    stepId: step.id,
    attemptId: step.attempts[0].id,
    phase: 'checkpoint',
    message: 'Vérification des fichiers du point de restauration — aucun prompt envoyé.',
    nativeReady: false,
    completed: 100,
    total: 12000,
  };
  await open(page, state);
  const notice = page.getByRole('status', { name: 'Avancement de la tentative' });
  const picker = page.getByRole('combobox', { name: 'Permissions Copilot' });
  await expect(notice).toContainText(/100 \/ 12\s000 fichiers vérifiés/);
  await expect(picker).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Arrêter l’exécution', exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    const state = Reflect.get(window, 'nativeFixture') as StudioState;
    Object.assign(state.runProgress!, {
      phase: 'connecting',
      message: 'Démarrage du CLI Copilot',
      completed: undefined,
      total: undefined,
    });
    window.postMessage({ type: 'state', state }, '*');
  });
  await expect(notice).toContainText('Démarrage du CLI Copilot');
  await expect(picker).toBeDisabled();
  expect(await sent(page, 'setPermissionMode')).toEqual([]);
  await page.evaluate(() => {
    const state = Reflect.get(window, 'nativeFixture') as StudioState;
    Object.assign(state.runProgress!, {
      phase: 'running',
      message: 'Copilot travaille sur cette étape.',
      nativeReady: true,
    });
    window.postMessage({ type: 'state', state }, '*');
  });
  await expect(notice).toHaveCount(0);
  await expect(picker).toBeEnabled();
  await picker.selectOption('allow-all');
  await expect.poll(() => sent(page, 'setPermissionMode')).toMatchObject([{ mode: 'allow-all' }]);
});

test('creates a native session with an explicit permission choice and shows unavailable assisted mode', async ({
  page,
}) => {
  await open(page, fixture(), false);
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await dialog.locator('.creation-options > summary').click();
  const picker = dialog.getByRole('combobox', { name: 'Permissions Copilot' });
  await expect(picker).toHaveValue('manual');
  await expect(picker.locator('option[value="assisted"]')).toHaveAttribute('disabled', '');
  await picker.selectOption('allow-all');
  await dialog.getByPlaceholder('Ex. Une recherche plus agréable au clavier').fill('Native task');
  await dialog.getByRole('button', { name: 'Créer la session' }).click();
  await expect
    .poll(() => sent(page, 'createFeature'))
    .toMatchObject([{ permissionMode: 'allow-all', title: 'Native task' }]);
  expect(await sent(page, 'runStep')).toHaveLength(0);
});

test('shows native permission scope, disables concurrent mode changes and sends an explicit refusal', async ({
  page,
}) => {
  await open(page, fixture(true));
  const dialog = page.getByRole('dialog', { name: 'Votre réponse est attendue' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('AUTORISATION COPILOT · CETTE DEMANDE')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Permissions Copilot' })).toBeDisabled();
  await expect(
    dialog.getByText('Dossier : /workspace/website\nCommande : npm run build'),
  ).toBeVisible();
  await mkdir(resolve('test-results/native'), { recursive: true });
  await page.screenshot({ path: resolve('test-results/native/permission.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Refuser' }).click();
  await expect
    .poll(() => sent(page, 'answerHumanRequest'))
    .toEqual([{ type: 'answerHumanRequest', requestId: 'native-permission', answer: 'deny' }]);
});

test('renders native command evidence without claiming host test validation', async ({ page }) => {
  const state = fixture(true);
  state.humanRequests = [];
  state.features[0].steps[0].status = 'awaiting_review';
  state.features[0].steps[0].attempts[0].status = 'awaiting_review';
  state.features[0].steps[0].attempts[0].artifact = {
    name: 'result.md',
    content: 'Travail réalisé.',
    updatedAt: '2026-10-21T12:01:00Z',
  };
  await open(page, state);
  await page.getByRole('tab', { name: /Preuves/ }).click();
  await page.getByText('Détails des outils et tests de cette tentative', { exact: true }).click();
  const activity = page.getByRole('region', { name: 'Activité native Copilot' });
  await activity.locator('summary').first().click();
  await expect(activity).toContainText('Terminé · code 0');
  await expect(activity).toContainText('12 tests passed');
  await expect(page.getByText('Aucune commande attestée pour cette tentative.')).toHaveCount(0);
  await mkdir(resolve('test-results/native'), { recursive: true });
  await page.screenshot({ path: resolve('test-results/native/evidence.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Permissions Copilot' }).selectOption('allow-all');
  await expect.poll(() => sent(page, 'setPermissionMode')).toMatchObject([{ mode: 'allow-all' }]);
  expect(await sent(page, 'pairAction')).toHaveLength(0);
});

for (const [label, answer] of [
  ['Autoriser les lectures dans cette solution', 'allow-workspace-read'],
  ['Autoriser ce type pour la session', 'allow-kind'],
] as const) {
  test(`sends the explicit native permission scope: ${answer}`, async ({ page }) => {
    const state = fixture(true);
    Object.assign(state.humanRequests![0], {
      question: 'Autoriser cette lecture ?',
      details: 'Dossier de la session : /workspace/website\nChemin : src/filters.ts',
      permissionKind: 'read',
      choices: ['allow', 'deny', 'allow-kind', 'allow-workspace-read'],
    });
    await open(page, state);
    const dialog = page.getByRole('dialog', { name: 'Votre réponse est attendue' });
    await expect(dialog.getByRole('button', { name: label })).toBeEnabled();
    if (answer === 'allow-workspace-read') {
      await mkdir(resolve('docs/screenshots/session-ergonomics'), { recursive: true });
      await page.screenshot({
        path: resolve('docs/screenshots/session-ergonomics/permissions.png'),
      });
    }
    await dialog.getByRole('button', { name: label }).click();
    await expect
      .poll(() => sent(page, 'answerHumanRequest'))
      .toEqual([{ type: 'answerHumanRequest', requestId: 'native-permission', answer }]);
    await expect(dialog.getByRole('button', { name: label })).toBeDisabled();
  });
}
