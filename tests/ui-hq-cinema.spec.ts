import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';
import { updateTaskBoard } from '../src/core/taskBoard';
import { THEME_IDS } from '../src/shared/themes';

function fixture() {
  const state = structuredClone(demoState);
  state.runtime.state = 'ready';
  const feature = state.features[0];
  feature.title = 'Un espace de connexion plus accueillant';
  feature.status = 'running';
  feature.steps.forEach((s, i) => {
    s.status = i < 2 ? 'approved' : i === 2 ? 'running' : 'pending';
  });
  const step = feature.steps[2];
  feature.activeStepId = step.id;
  step.attempts = [
    {
      id: 'board-attempt',
      startedAt: new Date().toISOString(),
      status: 'running',
      feedback: '',
      logs: [],
      questions: [],
      answers: {},
      changedFiles: [],
      taskBoard: updateTaskBoard(undefined, {
        mode: 'plan',
        title: 'Le plan de développement',
        items: [
          { id: 'read', text: 'Comprendre le parcours de connexion', status: 'done' },
          {
            id: 'form',
            text: 'Construire le formulaire accessible',
            status: 'in_progress',
            note: 'Je termine les messages d’erreur.',
          },
          { id: 'save', text: 'Relier le formulaire à la session', status: 'pending' },
          { id: 'report', text: 'Préparer le récapitulatif des changements', status: 'pending' },
        ],
      }),
    },
  ];
  return state;
}
async function host(page: Page, state = fixture()) {
  await page.addInitScript((initial) => {
    const current = JSON.parse(sessionStorage.getItem('cinema-state') ?? 'null') ?? initial;
    Object.assign(window, {
      cinemaState: current,
      cinemaMessages: [],
      acquireVsCodeApi: () => ({
        getState: () =>
          JSON.parse(sessionStorage.getItem('cinema-view') ?? 'null') ?? {
            view: 'sessions',
            navigationVersion: 2,
            featureId: current.features[0].id,
          },
        setState: (value: unknown) => sessionStorage.setItem('cinema-view', JSON.stringify(value)),
        postMessage: (message: ClientMessage) => {
          (Reflect.get(window, 'cinemaMessages') as ClientMessage[]).push(message);
          if (message.type === 'ready')
            setTimeout(() => {
              window.postMessage({ type: 'state', state: current }, '*');
              window.postMessage({ type: 'livingHqState', enabled: true }, '*');
              window.postMessage({ type: 'themeState', theme: 'jardin-sombre' }, '*');
            }, 0);
          if (message.type === 'hqWindow')
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'hqWindowResult',
                    requestId: message.requestId,
                    error: 'Commande indisponible dans cette fenêtre de test.',
                  },
                  '*',
                ),
              0,
            );
        },
      }),
    });
    window.addEventListener('message', (event) => {
      if (event.data.type === 'state') {
        Reflect.set(window, 'cinemaState', event.data.state);
        sessionStorage.setItem('cinema-state', JSON.stringify(event.data.state));
      }
    });
  }, state);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Agrandir le QG' })).toBeVisible();
  await page.getByRole('button', { name: 'Agrandir le QG' }).click();
  await expect(page.getByRole('dialog', { name: 'QG grand écran' })).toBeVisible();
}
const cinema = (page: Page) => page.getByRole('dialog', { name: 'QG grand écran' });
const publish = (page: Page, state: StudioState) =>
  page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'cinemaMessages') as ClientMessage[]);

test('grand écran : tableau vivant, persistance, bulle et retour au cockpit sans agir sur la session', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const state = fixture();
  await host(page, state);
  await expect(cinema(page).getByRole('region', { name: 'Tableau de Pixel' })).toBeVisible();
  await expect(page.locator('.hq-board-list [data-status="done"]')).toContainText(
    'Comprendre le parcours',
  );
  expect(
    await page
      .locator('.hq-board-line')
      .first()
      .evaluate((e) => getComputedStyle(e).textDecorationLine),
  ).toBe('line-through');
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  await expect(page.locator('.cinema-footer')).toBeInViewport();
  await expect(page.locator('.cinema-team')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('qg-cinema-jardin.png'), animations: 'disabled' });
  const attempt = state.features[0].steps[2].attempts[0];
  attempt.taskBoard = updateTaskBoard(attempt.taskBoard, {
    mode: 'plan',
    title: 'Le plan de développement',
    items: attempt.taskBoard!.items.map((i, index) => ({
      ...i,
      status: index < 2 ? 'done' : index === 2 ? 'in_progress' : 'pending',
    })),
  });
  await publish(page, state);
  await expect(page.locator('.hq-board-list [data-status="done"]')).toHaveCount(2);
  await page.reload();
  await expect(cinema(page)).toBeVisible();
  await expect(page.locator('.hq-board-list [data-status="done"]')).toHaveCount(2);
  await expect(page.locator('.hq-context-transfer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Détacher', exact: true }).click();
  await expect(cinema(page).getByRole('alert')).toContainText('indisponible');
  await page.getByRole('button', { name: 'Réduire pour intervenir' }).click();
  await expect(cinema(page)).toHaveCount(0);
  await expect(page.locator('.workbench-heading h2')).toHaveText('Développement');
  expect(
    (await messages(page)).filter((m) =>
      ['runStep', 'approveStep', 'answerHumanRequest', 'finalizeFeature', 'pairAction'].includes(
        m.type,
      ),
    ),
  ).toEqual([]);
});

test('une question bloque la scène et se répond seulement après réduction', async ({
  page,
}, info) => {
  const state = fixture();
  await host(page, state);
  state.humanRequests = [
    {
      id: 'question',
      featureId: state.features[0].id,
      stepId: state.features[0].steps[2].id,
      kind: 'question',
      question: 'Faut-il conserver la connexion pendant trente jours ?',
      allowFreeform: true,
    },
  ];
  await publish(page, state);
  await expect(page.locator('.cinema-bubble')).toContainText('Faut-il conserver');
  await expect(page.getByRole('dialog', { name: 'Votre réponse est attendue' })).toHaveCount(0);
  await expect(cinema(page).getByRole('textbox')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('qg-cinema-attente.png') });
  await page.keyboard.press('Escape');
  await expect(cinema(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Votre réponse est attendue' })).toBeVisible();
  expect((await messages(page)).some((m) => m.type === 'answerHumanRequest')).toBe(false);
});

test('suit les ateliers, leur numéro et leur titre, puis revient au QG', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const state = fixture();
  await host(page, state);
  const root = state.features[0],
    parent = root.steps[2];
  parent.status = 'waiting_input';
  const child = structuredClone(root);
  child.steps[2].status = 'running';
  child.id = 'child';
  child.title = 'Connexion par adresse e-mail';
  child.parent = { featureId: root.id, stepId: parent.id, iterationId: 'i1' };
  parent.subplan = { mode: 'automatic', teamName: 'Atelier de connexion', steps: [] };
  parent.subplanState = {
    acceptedRevisions: [1],
    iterations: [
      {
        id: 'i1',
        number: 1,
        taskId: 'one',
        title: child.title,
        description: '',
        planRevision: 1,
        orchestrationAttemptId: 'a',
        feature: child,
      },
      {
        id: 'i2',
        number: 2,
        taskId: 'two',
        title: 'Mot de passe oublié',
        description: '',
        planRevision: 1,
        orchestrationAttemptId: 'a',
        feature: {
          ...structuredClone(child),
          id: 'child2',
          status: 'draft',
          steps: child.steps.map((s) => ({ ...s, status: 'pending', attempts: [] })),
          parent: { featureId: root.id, stepId: parent.id, iterationId: 'i2' },
        },
      },
    ],
  };
  await publish(page, state);
  await expect(page.locator('.cinema-placard')).toContainText('SOUS-TÂCHE 1 / 2');
  await expect(page.locator('.cinema-placard h2')).toHaveText(child.title);
  await expect(cinema(page)).toHaveAttribute('data-workshop', 'true');
  await expect(page.locator('.cinema-arrival')).toContainText('Contexte transmis');
  await expect(page.locator('.cinema-arrival')).toHaveCount(0, { timeout: 6500 });
  await page.screenshot({ path: info.outputPath('qg-cinema-atelier.png'), animations: 'disabled' });
  for (const iteration of parent.subplanState!.iterations) {
    iteration.feature.status = 'completed';
    iteration.feature.steps.forEach((s) => {
      s.status = 'approved';
    });
  }
  parent.status = 'awaiting_review';
  await publish(page, state);
  await expect(cinema(page)).toHaveAttribute('data-workshop', 'false');
  await expect(page.locator('.cinema-placard')).toContainText('LE QG DE LA SESSION');
});

test('les longues listes défilent, restent lisibles et conservent le texte initial', async ({
  page,
}) => {
  await page.clock.install();
  const state = fixture();
  const attempt = state.features[0].steps[2].attempts[0];
  attempt.taskBoard = updateTaskBoard(attempt.taskBoard, {
    mode: 'plan',
    title: 'Plan avec vérifications',
    items: [
      ...attempt.taskBoard!.items.map((i, index) => ({
        ...i,
        text: index === 0 ? 'Lire les critères validés' : i.text,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `test${i}`,
        text: `Vérifier la fonctionnalité ${i + 1}`,
        status: 'pending' as const,
      })),
    ],
  });
  await host(page, state);
  await expect(page.locator('.hq-task-board')).toContainText('Page 1 / 5');
  await page.getByRole('button', { name: /Relire le plan initial/ }).click();
  await expect(page.locator('.hq-board-list')).toContainText('Comprendre le parcours de connexion');
  await page.getByRole('button', { name: 'Page suivante du tableau' }).click();
  await expect(page.locator('.hq-task-board')).toContainText('Page 2 / 5');
  await page.clock.runFor(14050);
  await expect(page.locator('.hq-task-board')).toContainText('Page 3 / 5');
});

test('tous les thèmes, petits écrans et réduction des mouvements', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await host(page);
  for (const theme of THEME_IDS) {
    await page.evaluate((theme) => window.postMessage({ type: 'themeState', theme }, '*'), theme);
    await expect(cinema(page)).toHaveAttribute('data-hq-theme', theme);
    await expect(page.locator('.hq-board-list')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.locator('.cinema-footer')).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`qg-cinema-${theme}.png`),
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.cinema-hero img[src$="working.gif"]')).toHaveCount(0);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(cinema(page)).toHaveAttribute('data-hq-theme', 'auto');
  await expect(page.locator('.hq-board-list')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Réduire pour intervenir' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('qg-cinema-mobile.png') });
});

test('un vrai passage de relais anime les avions et un nouvel agent commence avec sa mission', async ({
  page,
}) => {
  const state = fixture();
  await host(page, state);
  const feature = state.features[0];
  feature.steps[2].status = 'approved';
  const step = feature.steps[3];
  step.status = 'running';
  feature.activeStepId = step.id;
  step.attempts = [
    {
      id: 'test-attempt',
      status: 'running',
      startedAt: new Date().toISOString(),
      feedback: '',
      logs: [],
      questions: [],
      answers: {},
      changedFiles: [],
    },
  ];
  await publish(page, state);
  await expect(page.locator('.cinema-nameplate strong')).toHaveText('Ada');
  await expect(page.locator('.hq-task-board')).toContainText('Ma tâche courante');
  await expect(page.locator('.hq-task-board')).not.toContainText('Construire le formulaire');
  await expect(page.locator('.hq-cinema .hq-paper-plane')).toHaveCount(4);
  await expect(page.locator('.hq-cinema .hq-context-transfer')).toContainText('Pixel → Ada');
  feature.archived = true;
  await publish(page, state);
  await expect(page.locator('.hq-cinema .hq-paper-plane')).toHaveCount(0);
  await expect(page.locator('.cinema-hero img[src$="working.gif"]')).toHaveCount(0);
});

test('les notes longues se répartissent sur des pages lisibles même avec le zoom du cockpit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = fixture();
  const attempt = state.features[0].steps[2].attempts[0];
  attempt.taskBoard = updateTaskBoard(undefined, {
    mode: 'plan',
    title: 'Vérification des fonctionnalités',
    items: Array.from({ length: 4 }, (_, i) => ({
      id: `long${i}`,
      text: 'Vérifier le parcours complet de connexion et ses messages. '.repeat(3).slice(0, 180),
      status: i === 0 ? 'in_progress' : 'pending',
      note: 'La vérification reste en cours sur cette fonctionnalité. '.repeat(6).slice(0, 300),
    })),
  });
  await host(page, state);
  await page.evaluate(() => window.postMessage({ type: 'zoomState', zoom: 150 }, '*'));
  await expect(page.locator('.hq-task-board')).toContainText('Page 1 / 4');
  await expect(page.locator('.hq-board-note')).toHaveCount(1);
  await expect(page.locator('.hq-board-footer')).toBeInViewport();
  await expect(page.locator('.cinema-footer')).toBeInViewport();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.hq-cinema')))).toBe(
    true,
  );
});
