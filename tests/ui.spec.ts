import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';
const fresh = (): StudioState => ({
  ...structuredClone(demoState),
  runtime: {
    state: 'ready',
    authenticated: true,
    version: 'test',
    models: [
      { id: 'real-model', name: 'Modèle fourni par le runtime', reasoningEfforts: ['low', 'high'] },
    ],
  },
});
async function hosted(page: Page, state = fresh()) {
  await page.addInitScript((data) => {
    let saved = {};
    const messages: unknown[] = [];
    Object.assign(window, {
      testMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => saved,
        setState: (v: object) => (saved = v),
        postMessage: (m: { type: string }) => {
          messages.push(m);
          if (m.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Chaque idée mérite un beau parcours.' }),
  ).toBeVisible();
}
async function messages(page: Page) {
  return page.evaluate(() => Reflect.get(window, 'testMessages') as ClientMessage[]);
}
test('le navigateur affiche un accès VS Code, la démo nécessite un choix explicite', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Feature Studio' })).toBeVisible();
  await expect(page.getByText('Démonstration — aucune exécution Copilot')).toHaveCount(0);
  await page.getByRole('link', { name: 'Explorer la démonstration' }).click();
  await expect(page.getByText('Démonstration — aucune exécution Copilot')).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  await page.getByLabel('Qu’allons-nous faire ?').fill('Une feature de démo');
  await page.getByRole('button', { name: 'Créer la session' }).click();
  await expect(page.getByRole('status')).toContainText('aucune commande, écriture ou exécution');
});
test('recherche, filtres et création transmettent le contrat exact sans lancer Copilot', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('textbox', { name: 'Rechercher une session' }).fill('palette');
  await expect(page.locator('.session-card')).toHaveCount(1);
  await page.getByLabel('Filtrer les sessions').selectOption('completed');
  await expect(page.getByText('Aucune session ne correspond')).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  await page.getByRole('radio', { name: 'Session libre' }).click();
  await page.getByLabel('Qu’allons-nous faire ?').fill('Analyser un composant');
  await page.getByLabel('Le contexte et le résultat souhaité').fill('Comprendre les contraintes.');
  await page.getByLabel('Agent de la première étape').selectOption('reviewer');
  await page.getByLabel('Modèle', { exact: true }).selectOption('real-model');
  await page.getByRole('button', { name: 'Créer la session' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'createFeature',
    title: 'Analyser un composant',
    description: 'Comprendre les contraintes.',
    workflowId: 'single',
    agentId: 'reviewer',
    model: 'real-model',
  });
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
});
test('la relecture modifiée doit être enregistrée avant validation; confirmation explicite', async ({
  page,
}) => {
  let state = fresh();
  await hosted(page, state);
  await page.locator('.session-card').filter({ hasText: 'Une palette de commandes' }).click();
  await page.getByRole('button', { name: 'Éditer le Markdown' }).click();
  await page.getByLabel('Contenu Markdown du livrable').fill('# Le livrable revu');
  await expect(page.getByRole('button', { name: 'Valider cette étape' })).toBeDisabled();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveArtifact',
    content: '# Le livrable revu',
    stepId: 'design',
  });
  state.features[0].steps[1].attempts[0].artifact!.content = '# Le livrable revu';
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.getByRole('button', { name: 'Valider cette étape' })).toBeEnabled();
  await page.getByRole('button', { name: 'Valider cette étape' }).click();
  await expect(page.getByRole('dialog', { name: 'Valider cette étape ?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'approveStep',
    featureId: 'command-palette',
    stepId: 'design',
  });
  await expect(page.getByText('Prêt pour votre regard.')).toBeVisible();
});
test('les questions structurées sont répondues et les diffs utilisent le bridge', async ({
  page,
}) => {
  const state = fresh();
  const step = state.features[0].steps[1];
  step.status = 'waiting_input';
  step.attempts[0].status = 'waiting_input';
  step.attempts[0].questions = [
    { id: 'scope', text: 'Quelle portée ?', choices: ['Locale', 'Globale'] },
    { id: 'detail', text: 'Quel détail ?' },
  ];
  step.attempts[0].changedFiles = ['src/palette.ts'];
  await hosted(page, state);
  await page.locator('.session-card').filter({ hasText: 'Une palette de commandes' }).click();
  await page.getByLabel('Quelle portée ?').selectOption('Locale');
  await page.getByLabel('Quel détail ?').fill('Navigation clavier');
  await page.getByRole('button', { name: 'Transmettre les réponses' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'answerQuestions',
    answers: { scope: 'Locale', detail: 'Navigation clavier' },
  });
  await page.getByRole('tab', { name: 'Fichiers' }).click();
  await page.getByRole('button', { name: 'Voir le diff' }).click();
  expect((await messages(page)).at(-1)).toEqual({ type: 'openDiff', path: 'src/palette.ts' });
});
test('édition agent : pseudo libre et avatar enregistrés, modal utilisable au clavier', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvel agent' }).click();
  await page.getByLabel('Son petit nom').fill('Capitaine Bug');
  await page.getByRole('button', { name: 'La capitaine' }).click();
  await page.getByLabel('Nom du profil').fill('Quality companion');
  await page.getByLabel('Instructions', { exact: false }).fill('Vérifie les critères de réussite.');
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveAgent',
    agent: { id: 'quality-companion', nickname: 'Capitaine Bug', avatar: 'captain' },
  });
  await page.getByRole('button', { name: 'Nouvel agent' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('nouveau hook désactivé par défaut, activation uniquement après action humaine', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Automatisations', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter un hook' }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByLabel('Nom du hook').fill('Rapport local');
  await page.getByLabel('Exécutable', { exact: true }).fill('node');
  await page.getByLabel('Arguments').fill('scripts/report.mjs');
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  let message = (await messages(page)).at(-1);
  expect(message).toMatchObject({
    type: 'saveSettings',
    settings: {
      hooks: [
        {
          name: 'Rapport local',
          event: 'beforeRun',
          command: 'node',
          args: ['scripts/report.mjs'],
          enabled: false,
        },
      ],
    },
  });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveSettings',
    settings: { hooks: [{ enabled: true }] },
  });
});
test('aucun run en espace non approuvé, runtime indisponible ou dépendance non validée', async ({
  page,
}) => {
  const state = fresh();
  state.workspace.trusted = false;
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await expect(
    page.getByRole('button', { name: 'Nouvelle tentative', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Développement À venir' }).click();
  await expect(page.getByRole('button', { name: 'Exécuter cette étape' })).toBeDisabled();
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
});
test('le cockpit reste dans la largeur mobile et respecte la réduction des animations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await hosted(page);
  await expect(page.getByRole('button', { name: 'Nouvelle session', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/cockpit-mobile.png', fullPage: true });
});
test('relance et annulation passent par une confirmation, le statut reste celui du host', async ({
  page,
}) => {
  const state = fresh();
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await page.getByLabel('Votre retour').fill('Préciser les critères clavier.');
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Relancer cette étape ?' })).toBeVisible();
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    featureId: 'command-palette',
    stepId: 'design',
    feedback: 'Préciser les critères clavier.',
  });
  await expect(page.getByText('Prêt pour votre regard.')).toBeVisible();
  state.features[0].status = 'running';
  state.features[0].steps[1].status = 'running';
  state.features[0].steps[1].attempts[0].status = 'running';
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await page.getByRole('button', { name: 'Arrêter l’exécution' }).click();
  await expect(page.getByRole('dialog', { name: 'Arrêter cette exécution ?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'cancelRun',
    featureId: 'command-palette',
  });
  await expect(page.getByText('Ça prend forme.')).toBeVisible();
});
test('avatars reflètent les états et la réduction du mouvement, reprise de session explicite', async ({
  page,
}) => {
  const state = fresh();
  const step = state.features[0].steps[1];
  step.status = 'interrupted';
  step.attempts[0].status = 'interrupted';
  step.attempts[0].sessionId = 'previous-session';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Reprendre la session' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({ type: 'runStep', resume: true });
  step.status = 'running';
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.locator('.agent-strip .pixel-avatar img')).toHaveAttribute('src', /idle\.png$/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.agent-strip .pixel-avatar img')).toHaveAttribute(
    'src',
    /working\.gif$/,
  );
  step.status = 'approved';
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.locator('.agent-strip .pixel-avatar img')).toHaveAttribute(
    'src',
    /approved\.png$/,
  );
});
test('thèmes VS Code et détail mobile restent lisibles et dans le viewport', async ({ page }) => {
  await hosted(page);
  await page.locator('.session-card').first().click();
  for (const theme of ['vscode-light', 'vscode-high-contrast']) {
    await page.evaluate((t) => {
      document.body.className = t;
      if (t === 'vscode-light') {
        document.documentElement.style.setProperty('--vscode-editor-background', '#fff');
        document.documentElement.style.setProperty('--vscode-editorWidget-background', '#fafafa');
        document.documentElement.style.setProperty('--vscode-sideBar-background', '#f6f5f3');
        document.documentElement.style.setProperty('--vscode-input-background', '#f1f1f1');
        document.documentElement.style.setProperty('--vscode-foreground', '#292b2d');
        document.documentElement.style.setProperty('--vscode-descriptionForeground', '#626768');
        document.documentElement.style.setProperty('--vscode-panel-border', '#d8dcdd');
      }
    }, theme);
    await expect(page.getByRole('heading', { name: 'Conception', exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('tab', { name: 'Activité' }).click();
  await expect(page.getByText('Contexte du projet chargé.')).toBeVisible();
});
test('rejouer une étape validée annonce l’invalidation et ne simule aucun état host', async ({
  page,
}) => {
  await hosted(page);
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: '01 Cadrage Validée' }).click();
  await page.getByLabel('Votre retour').fill('Intégrer les remarques de relecture.');
  await page.getByRole('button', { name: 'Rejouer cette étape' }).click();
  await expect(page.getByRole('dialog', { name: 'Rejouer une étape validée ?' })).toBeVisible();
  await expect(
    page.getByText('Les étapes suivantes deviennent à actualiser', { exact: false }),
  ).toBeVisible();
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    featureId: 'command-palette',
    stepId: 'discover',
    feedback: 'Intégrer les remarques de relecture.',
  });
  await expect(page.getByText('Une étape de plus.')).toBeVisible();
});
test('les cartes de parcours gardent leur identité malgré un registry trié par fichier', async ({
  page,
}) => {
  const state = fresh();
  state.workflows.sort((a, b) => a.id.localeCompare(b.id));
  await hosted(page, state);
  const review = page.locator('.template-list button').filter({ hasText: 'Relecture de code' });
  await expect(review).toContainText('Un regard indépendant');
  const feature = page.locator('.template-list button').filter({ hasText: 'Feature complète' });
  await expect(feature).toContainText('De l’idée aux tests');
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Feature complète' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
test('augmenter le budget de tentatives exige une sauvegarde explicite et permet la configuration épuisée', async ({
  page,
}) => {
  const state = fresh();
  const step = state.features[0].steps[1];
  step.status = 'waiting_input';
  step.maxAttempts = 1;
  step.attempts[0].status = 'waiting_input';
  step.attempts[0].sessionId = 'session-budget';
  step.attempts[0].questions = [];
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await expect(page.getByRole('button', { name: 'Reprendre la session' })).toBeDisabled();
  await expect(page.getByText('La limite de 1 tentative est atteinte.')).toBeVisible();
  await page.getByRole('button', { name: 'Modifier la limite' }).click();
  const limit = page.getByLabel('Limite de tentatives');
  await expect(limit).toHaveValue('1');
  await expect(limit).toHaveAttribute('max', '100');
  await limit.fill('4');
  expect((await messages(page)).some((m) => m.type === 'configureStep')).toBe(false);
  await page.getByRole('button', { name: 'Enregistrer la configuration' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'configureStep',
    featureId: 'command-palette',
    stepId: 'design',
    maxAttempts: 4,
  });
  await expect(page.getByRole('button', { name: 'Reprendre la session' })).toBeDisabled();
  step.maxAttempts = 4;
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.getByRole('button', { name: 'Reprendre la session' })).toBeEnabled();
});
