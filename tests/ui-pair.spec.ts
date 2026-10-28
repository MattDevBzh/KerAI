import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { demoState } from '../webview/demo';
import { createPair } from '../src/core/pair';
import { defaultPairPreferences } from '../src/shared/pair';
import { emptyLaunch } from '../src/core/context';
import { reviewApprovalRequest } from '../src/shared/reviewApproval';
import type { Attempt, ClientMessage, StudioState } from '../src/shared/types';

function scenario(phase: 'planning' | 'working' | 'review' = 'planning') {
  const state = structuredClone(demoState),
    feature = state.features[0];
  state.features = [feature];
  state.schemaVersion = 7;
  state.runtime = { state: 'ready', authenticated: true, models: [] };
  feature.title = 'Des filtres qui restent simples';
  feature.description =
    'Concevoir et vérifier les filtres de recherche avec un retour humain sur les choix.';
  feature.steps = [
    {
      ...feature.steps[0],
      name: 'Concevoir et réaliser les filtres',
      policy: 'workspace-write',
      dependsOn: [],
      attempts: [],
      status: 'waiting_input',
    },
  ];
  feature.status = 'attention';
  feature.activeStepId = feature.steps[0].id;
  feature.criteria = [];
  feature.reviewComments = [];
  const step = feature.steps[0],
    agent = state.agents.find((a) => a.id === step.agentId)!;
  agent.nickname = 'Ada';
  const attempt: Attempt = {
    id: 'pair-attempt',
    status: 'waiting_input',
    startedAt: '2026-10-20T14:00:00.000Z',
    agentName: 'Ada',
    feedback: '',
    logs: [],
    questions: [],
    answers: {},
    changedFiles: [],
    revision: 3,
  };
  attempt.launch = { ...emptyLaunch(), pair: { ...defaultPairPreferences } };
  attempt.pair = createPair({
    feature,
    step,
    attempt,
    agent,
    skills: [],
    workspacePath: state.workspace.path,
    settings: state.settings,
    launch: attempt.launch,
    preparedPrompt:
      'Feature : Des filtres qui restent simples\nMission : Concevoir et vérifier les filtres.\nContexte choisi : conserver la navigation et l’accessibilité.',
  });
  const pair = attempt.pair;
  pair.calls = 1;
  pair.phase = phase;
  pair.plans = [
    {
      revision: 1,
      summary:
        'On choisit ensemble le comportement des filtres, puis je réalise l’interface et je vérifie les parcours.',
      blocks: [
        {
          id: 'design',
          title: 'Choisir le comportement',
          description: 'Définir les filtres utiles et leur remise à zéro.',
        },
        {
          id: 'build',
          title: 'Réaliser l’interface',
          description: 'Ajouter les contrôles et préserver la navigation au clavier.',
        },
        {
          id: 'verify',
          title: 'Vérifier les parcours',
          description: 'Tester les combinaisons, le retour arrière et les petits écrans.',
        },
      ],
    },
  ];
  pair.messages = [
    {
      id: 'a1',
      role: 'assistant',
      status: 'complete',
      at: '2026-10-20T14:00:00.000Z',
      content:
        'On travaille en pair sur cette étape. Je te propose **trois blocs**, avec un point de contrôle entre chaque.\n\nOn commence par le comportement des filtres : lesquels sont utiles, et comment les remettre à zéro. Ensuite je réalise l’interface et je vérifie les parcours.\n\nTu préfères avancer par petits pas, ou valider les grands choix avant de me laisser dérouler ?',
    },
    {
      id: 'u1',
      role: 'user',
      status: 'complete',
      at: '2026-10-20T14:01:00.000Z',
      content:
        'Par blocs, avec une explication des choix. Je veux valider le comportement avant qu’on touche à l’interface.',
    },
    {
      id: 'a2',
      role: 'assistant',
      status: 'complete',
      at: '2026-10-20T14:01:30.000Z',
      content:
        'D’accord. Je m’arrêterai après chaque bloc pour ton retour. L’organisation ci-contre reprend ce rythme. **Le travail commencera quand tu la valideras.**',
    },
  ];
  if (phase !== 'planning') {
    pair.approvedRevision = 1;
    pair.plans[0].acceptedAt = '2026-10-20T14:02:00.000Z';
  }
  if (phase === 'working') {
    pair.busy = true;
    pair.turn = { kind: 'work', blockId: 'design' };
    step.status = attempt.status = 'running';
  }
  if (phase === 'review') {
    step.status = attempt.status = 'awaiting_review';
    pair.results = pair.plans[0].blocks.map((b) => ({
      planRevision: 1,
      blockId: b.id,
      title: b.title,
      content: 'Réalisé et vérifié.',
      at: '2026-10-20T14:10:00.000Z',
    }));
    attempt.artifact = {
      name: 'rapport.md',
      content:
        '# Résultat\n\nLes filtres sont réalisés et vérifiés. Les décisions convenues ont été conservées.',
      updatedAt: '2026-10-20T14:10:00.000Z',
    };
  }
  step.attempts = [attempt];
  return state;
}
async function open(page: Page, state = scenario(), pairOpen = true, theme = 'guilde-sombre') {
  await page.addInitScript(
    ({ initial, pairOpen, theme }) => {
      const data = JSON.parse(sessionStorage.getItem('pair-fixture') ?? 'null') ?? initial;
      const sent: unknown[] = [];
      let saved = JSON.parse(sessionStorage.getItem('pair-view') ?? 'null') ?? {
        navigationVersion: 2,
        view: 'sessions',
        featureId: data.features[0].id,
        stepId: data.features[0].activeStepId,
        pairOpen,
      };
      const publish = () => {
        sessionStorage.setItem('pair-fixture', JSON.stringify(data));
        window.postMessage({ type: 'state', state: data }, '*');
      };
      Object.assign(window, {
        pairFixture: data,
        pairMessages: sent,
        pairPublish: publish,
        pairError: '',
        acquireVsCodeApi: () => ({
          getState: () => saved,
          setState: (value: unknown) => {
            saved = value;
            sessionStorage.setItem('pair-view', JSON.stringify(value));
          },
          postMessage: (message: any) => {
            sent.push(message);
            const f = data.features[0],
              s = f.steps[0],
              a = s.attempts.at(-1),
              p = a?.pair;
            if (message.type === 'ready')
              setTimeout(() => {
                publish();
                window.postMessage({ type: 'themeState', theme }, '*');
              }, 0);
            if (message.type === 'previewRun')
              setTimeout(
                () =>
                  window.postMessage(
                    {
                      type: 'runPreview',
                      requestId: message.requestId,
                      preview: {
                        featureId: f.id,
                        stepId: s.id,
                        fingerprint: 'a'.repeat(64),
                        prompt: 'Contexte choisi',
                        sections: [],
                        characters: 15,
                        estimatedTokens: 4,
                        maxCharacters: 60000,
                        errors: [],
                      },
                    },
                    '*',
                  ),
                0,
              );
            if (message.type === 'runStep') {
              a.launch = message.launch;
              p.preferences = message.launch.pair;
              publish();
            }
            if (message.type === 'pairAction') {
              const error = Reflect.get(window, 'pairError') as string;
              if (!error) {
                if (message.action === 'message') {
                  p.messages.push({
                    id: message.requestId,
                    role: 'user',
                    content: message.content,
                    at: new Date().toISOString(),
                    status: 'complete',
                  });
                  if (p.busy) p.pendingMessages.push(message.requestId);
                }
                if (message.action === 'approve-plan') {
                  p.approvedRevision = p.plans.at(-1).revision;
                  p.plans.at(-1).acceptedAt = new Date().toISOString();
                  p.phase = 'working';
                  p.busy = true;
                  p.turn = { kind: 'work', blockId: p.plans.at(-1).blocks[0].id };
                  s.status = a.status = 'running';
                }
                if (message.action === 'solo') p.mode = 'solo';
                if (message.action === 'pair') p.mode = 'pair';
                if (message.action === 'pause') {
                  p.busy = false;
                  p.phase = 'paused';
                  p.mode = 'pair';
                  s.status = a.status = 'cancelled';
                }
                p.version++;
                publish();
              }
              setTimeout(
                () =>
                  window.postMessage(
                    {
                      type: 'pairActionResult',
                      requestId: message.requestId,
                      featureId: f.id,
                      stepId: s.id,
                      error,
                    },
                    '*',
                  ),
                0,
              );
            }
            if (message.type === 'approveStep') {
              const error = Reflect.get(window, 'pairError') as string;
              if (!error) {
                s.status = a.status = 'approved';
                publish();
              }
              setTimeout(
                () =>
                  window.postMessage(
                    {
                      type: 'stepApprovalResult',
                      featureId: f.id,
                      stepId: s.id,
                      attemptId: a.id,
                      error,
                    },
                    '*',
                  ),
                0,
              );
            }
          },
        }),
      });
    },
    { initial: state, pairOpen, theme },
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      name: pairOpen ? state.features[0].steps[0].name : state.features[0].title,
      exact: true,
    }),
  ).toBeVisible();
}
async function messages(page: Page, type: string) {
  return page.evaluate(
    (type) =>
      (Reflect.get(window, 'pairMessages') as ClientMessage[]).filter((m) => m.type === type),
    type,
  );
}

test('launches pair through the existing context preview with editable preferences', async ({
  page,
}) => {
  const state = scenario();
  state.features[0].steps[0].status = 'pending';
  // Keep the target response fixture available, but expose an ordinary unlaunched step first.
  await open(page, state, false);
  await page.getByRole('button', { name: 'Nouvelle tentative en pair', exact: true }).click();
  const confirm = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Relancer cette étape ?' }) });
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: /Confirmer/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Préparer le travail en pair' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Rythme', exact: true }).selectOption('oneshot');
  await dialog.getByRole('combobox', { name: 'Explications', exact: true }).selectOption('concise');
  await expect(dialog.getByRole('button', { name: 'Ouvrir le travail en pair' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Préparer l’aperçu', exact: true }).click();
  await dialog.getByRole('button', { name: 'Ouvrir le travail en pair' }).click();
  await expect(page.locator('.pair-page')).toBeVisible();
  expect((await messages(page, 'runStep'))[0]).toMatchObject({
    launch: { pair: { pace: 'oneshot', explanation: 'concise' } },
  });
});

test('keeps draft messages across navigation and reload, preserves errors and never delegates on back', async ({
  page,
}) => {
  await open(page);
  await page.getByLabel('Convenons de l’organisation').fill('Je préfère des blocs plus petits.');
  await page.getByRole('button', { name: 'Revenir à la session', exact: true }).click();
  expect(await messages(page, 'pairAction')).toHaveLength(0);
  await page.getByRole('button', { name: 'Ouvrir le travail en pair', exact: true }).click();
  await expect(page.getByLabel('Convenons de l’organisation')).toHaveValue(
    'Je préfère des blocs plus petits.',
  );
  await page.reload();
  await expect(page.getByLabel('Convenons de l’organisation')).toHaveValue(
    'Je préfère des blocs plus petits.',
  );
  await page.evaluate(() =>
    Reflect.set(window, 'pairError', 'Organisation modifiée dans une autre fenêtre.'),
  );
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Organisation modifiée');
  await expect(page.getByLabel('Convenons de l’organisation')).toHaveValue(
    'Je préfère des blocs plus petits.',
  );
  await page.evaluate(() => Reflect.set(window, 'pairError', ''));
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByLabel('Convenons de l’organisation')).toHaveValue('');
  await expect(page.getByRole('log')).toContainText('Je préfère des blocs plus petits.');
  expect(await messages(page, 'runStep')).toHaveLength(0);
});

test('approves a versioned organisation and supports live messages, solo, rejoining and pause', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Valider l’organisation et démarrer' }).click();
  expect((await messages(page, 'pairAction'))[0]).toMatchObject({
    attemptId: 'pair-attempt',
    expectedVersion: 0,
    action: 'approve-plan',
  });
  await page.getByRole('button', { name: 'Continuer cette étape en solo' }).click();
  await expect(page.getByRole('button', { name: 'Reprendre en pair' })).toBeVisible();
  await page.getByRole('button', { name: 'Reprendre en pair' }).click();
  await page.getByLabel('Votre message à l’agent').fill('Explique-moi la remise à zéro.');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Message enregistré');
  await page.getByRole('button', { name: 'Mettre en pause' }).click();
  await expect(
    page.getByRole('button', { name: 'Reprendre le travail', exact: true }),
  ).toBeVisible();
  expect((await messages(page, 'pairAction')).map((m) => ('action' in m ? m.action : ''))).toEqual([
    'approve-plan',
    'solo',
    'pair',
    'message',
    'pause',
  ]);
});

test('retains the result on rejected approval and returns only after a successful versioned approval', async ({
  page,
}) => {
  await open(page, scenario('review'));
  await page.evaluate(() => Reflect.set(window, 'pairError', 'Une preuve est devenue obsolète.'));
  await page.getByRole('button', { name: 'Valider l’étape et revenir à la session' }).click();
  await expect(page.getByRole('alert')).toContainText('obsolète');
  await expect(page.locator('.pair-page')).toBeVisible();
  expect((await messages(page, 'approveStep'))[0]).toMatchObject({
    expectedAttemptId: 'pair-attempt',
    expectedRevision: 3,
  });
  await page.evaluate(() => Reflect.set(window, 'pairError', ''));
  await page.getByRole('button', { name: 'Valider l’étape et revenir à la session' }).click();
  await expect(page.locator('.pair-page')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Des filtres qui restent simples', exact: true }),
  ).toBeVisible();
});

test('requires confirmation of review remarks before leaving the pair workspace', async ({
  page,
}) => {
  const state = scenario('review'),
    feature = state.features[0],
    step = feature.steps[0];
  step.attempts[0].review = {
    verdict: 'changes_requested',
    summary: 'Correction requise',
    findings: [
      { id: 'finding', severity: 'blocking', message: 'Vérifier la synchronisation ciblée.' },
    ],
  };
  const key = reviewApprovalRequest(feature, step)!.key;
  await open(page, state);
  const validate = page.getByRole('button', { name: 'Valider l’étape et revenir à la session' });
  await expect(validate).toBeEnabled();
  await validate.click();
  const dialog = page.getByRole('dialog', { name: 'Valider malgré les remarques ?' });
  await expect(dialog).toContainText('Vérifier la synchronisation ciblée.');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(await messages(page, 'approveStep')).toHaveLength(0);
  await validate.click();
  await dialog.getByRole('button', { name: 'Valider malgré les remarques', exact: true }).click();
  await expect.poll(() => messages(page, 'approveStep')).toHaveLength(1);
  expect((await messages(page, 'approveStep'))[0]).toMatchObject({
    expectedReviewWarningsKey: key,
  });
});

test('keeps earlier pair exchanges accessible read-only after a normal retry', async ({ page }) => {
  const state = scenario('review'),
    step = state.features[0].steps[0];
  step.attempts.push({ ...structuredClone(step.attempts[0]), id: 'normal-retry', pair: undefined });
  await open(page, state, false);
  await page.getByRole('button', { name: 'Consulter les échanges en pair' }).click();
  await expect(page.getByText('Tentative antérieure · consultation seule')).toBeVisible();
  await expect(page.getByRole('log')).toContainText('On travaille en pair sur cette étape');
  await expect(page.getByRole('button', { name: 'Envoyer', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Valider l’étape et revenir à la session' }),
  ).toHaveCount(0);
  expect(await messages(page, 'pairAction')).toHaveLength(0);
  expect(await messages(page, 'runStep')).toHaveLength(0);
});

test('renders the complete pair workspace in dark and compact light layouts without horizontal overflow', async ({
  page,
}) => {
  await open(page);
  const directory = resolve('design/proposals/2026-10-20-mode-pair');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: joinPath(directory, 'pair-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.evaluate(() => window.postMessage({ type: 'themeState', theme: 'papier-clair' }, '*'));
  await expect(
    page.getByRole('button', { name: 'Valider l’organisation et démarrer' }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: joinPath(directory, 'pair-compact.png'), fullPage: true });
});
function joinPath(directory: string, name: string) {
  return resolve(directory, name);
}
