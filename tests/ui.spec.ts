import { navigate } from './ui-navigation-helpers';
import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';
import { featureStateKey } from '../src/shared/collaboration';
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
      autoPreview: true,
      autoComparison: true,
      acquireVsCodeApi: () => ({
        getState: () => saved,
        setState: (v: object) => (saved = v),
        postMessage: (m: ClientMessage) => {
          messages.push(m);
          if (m.type === 'createFeature' && m.requestId)
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'featureCreateResult',
                    requestId: m.requestId,
                    featureId: 'created-fixture',
                  },
                  '*',
                ),
              0,
            );
          if (m.type === 'saveAgent' || m.type === 'saveSkill')
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'profileSaveResult',
                    requestId: m.requestId,
                    scope: m.options.scope,
                    path: '/mock/saved.md',
                    revision: 'a'.repeat(64),
                  },
                  '*',
                ),
              0,
            );
          if (m.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
          if (m.type === 'compareCheckpoint' && Reflect.get(window, 'autoComparison')) {
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'checkpointComparison',
                    requestId: m.requestId,
                    comparison: {
                      featureId: m.featureId,
                      checkpointId: m.checkpointId,
                      ...(m.targetCheckpointId ? { targetCheckpointId: m.targetCheckpointId } : {}),
                      fingerprint: 'b'.repeat(64),
                      files: Reflect.get(window, 'checkpointFiles') ?? [
                        {
                          path: 'src/palette.ts',
                          status: 'modified',
                          beforeHash: 'old',
                          afterHash: 'new',
                          binary: false,
                          restorable: true,
                        },
                        {
                          path: 'notes/new.md',
                          status: 'added',
                          afterHash: 'added',
                          binary: false,
                          restorable: true,
                        },
                        {
                          path: '.env',
                          status: 'modified',
                          binary: false,
                          restorable: false,
                          reason: 'Fichier exclu des points',
                        },
                      ],
                    },
                  },
                  '*',
                ),
              0,
            );
          }
          if (m.type === 'previewRun' && Reflect.get(window, 'autoPreview')) {
            const content = m.launch.initialContext;
            const step = data.features
              .find((f) => f.id === m.featureId)
              ?.steps.find((s) => s.id === m.stepId);
            const agent = data.agents.find((a) => a.id === step?.agentId);
            const supplied = Reflect.get(window, 'previewSections') as
              | {
                  id: string;
                  label: string;
                  source: string;
                  content: string;
                  unavailable?: boolean;
                }[]
              | undefined;
            const sections = (
              supplied ?? [{ id: 'human', label: 'Votre contexte', source: 'human', content }]
            ).map((s) => ({
              ...s,
              originalContent: s.content,
              content: m.launch.contextBlocks?.[s.id]?.content ?? s.content,
              editable: s.source !== 'system',
              enabled:
                s.source === 'system' ||
                (m.launch.contextBlocks?.[s.id]?.enabled ??
                  (m.launch.contextMode ?? (agent?.emptyContextByDefault ? 'empty' : 'all')) ===
                    'all'),
            }));
            const prompt = sections
              .filter((s) => s.enabled)
              .map((s) => s.content)
              .join('\n\n');
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'runPreview',
                    requestId: m.requestId,
                    preview: {
                      featureId: m.featureId,
                      stepId: m.stepId,
                      fingerprint: 'a'.repeat(64),
                      prompt: prompt || 'Instructions de test déterministes',
                      sections,
                      characters: prompt.length,
                      estimatedTokens: Math.ceil(prompt.length / 4),
                      maxCharacters: 60000,
                      errors: sections
                        .filter((s) => s.unavailable && s.enabled)
                        .map((s) => s.content),
                      existingChanges: Reflect.get(window, 'existingChanges'),
                    },
                  },
                  '*',
                ),
              0,
            );
          }
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
async function finishLaunch(page: Page, resume = false) {
  await page.getByRole('button', { name: 'Préparer l’aperçu', exact: true }).click();
  await expect(page.getByText('Aperçu host')).toBeVisible();
  await page
    .getByRole('button', { name: resume ? 'Lancer la reprise' : 'Lancer cette étape', exact: true })
    .click();
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
  await page.getByRole('button', { name: 'Créer la feature' }).click();
  await expect(page.locator('.toast[role=status]')).toContainText(
    'aucune commande, écriture ou exécution',
  );
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
  await page.getByLabel('Qu’allons-nous faire ?').fill('Analyser un composant');
  await page.getByLabel('Le contexte et le résultat souhaité').fill('Comprendre les contraintes.');
  await page.getByRole('button', { name: 'Créer la feature' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'createFeature',
    requestId: expect.any(String),
    title: 'Analyser un composant',
    description: 'Comprendre les contraintes.',
    isolated: false,
  });
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
});
test('le compte rendu modifié est enregistré avant validation de sa révision acquittée', async ({
  page,
}) => {
  const state = fresh();
  await hosted(page, state);
  await page.locator('.session-card').filter({ hasText: 'Une palette de commandes' }).click();
  await page.getByRole('button', { name: 'Modifier le compte rendu' }).click();
  await page
    .getByRole('textbox', { name: 'Compte rendu modifié', exact: true })
    .fill('# Le livrable revu');
  await expect(page.getByRole('button', { name: 'Valider cette étape' })).toBeDisabled();
  await page.getByRole('button', { name: 'Enregistrer et valider', exact: true }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveArtifact',
    content: '# Le livrable revu',
    stepId: 'design',
    expectedRevision: 0,
  });
  expect((await messages(page)).some((m) => m.type === 'approveStep')).toBe(false);
  const attempt = state.features[0].steps[1].attempts[0];
  attempt.artifact!.content = '# Le livrable revu';
  attempt.revision = 1;
  await page.evaluate(
    ({ s, id }) => {
      window.postMessage(
        {
          type: 'artifactSaveResult',
          featureId: 'command-palette',
          stepId: 'design',
          attemptId: id,
          revision: 1,
        },
        '*',
      );
      window.postMessage({ type: 'state', state: s }, '*');
    },
    { s: state, id: attempt.id },
  );
  await expect
    .poll(async () => (await messages(page)).filter((m) => m.type === 'approveStep'))
    .toHaveLength(1);
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'approveStep',
    featureId: 'command-palette',
    stepId: 'design',
    expectedAttemptId: attempt.id,
    expectedRevision: 1,
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
  expect((await messages(page)).at(-1)).toEqual({
    type: 'openDiff',
    path: 'src/palette.ts',
    featureId: 'command-palette',
  });
});
test('édition agent : pseudo libre et avatar enregistrés, modal utilisable au clavier', async ({
  page,
}) => {
  await hosted(page);
  await navigate(page, 'Agents');
  await page.getByRole('button', { name: 'Nouvel agent' }).click();
  await expect(
    page.getByText('Enregistré au niveau utilisateur, disponible dans tous les projets.'),
  ).toBeVisible();
  await page.getByLabel('Son petit nom').fill('Capitaine Bug');
  await page.getByRole('button', { name: 'Responsable des livraisons' }).click();
  await page.getByLabel('Nom du profil').fill('Quality companion');
  await page.getByLabel('Instructions', { exact: false }).fill('Vérifie les critères de réussite.');
  await page.getByRole('checkbox', { name: 'Contexte vide par défaut' }).check();
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveAgent',
    agent: {
      emptyContextByDefault: true,
      id: 'quality-companion',
      nickname: 'Capitaine Bug',
      avatar: 'release-manager',
    },
  });
  await page.getByRole('button', { name: 'Nouvel agent' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('catalogue métiers : vingt portraits chargés et libellés mobiles', async ({ page }) => {
  await hosted(page);
  await navigate(page, 'Agents');
  await page.getByRole('button', { name: 'Nouvel agent' }).click();
  const picker = page.locator('.avatar-picker');
  await expect(picker.getByRole('button')).toHaveCount(20);
  await expect
    .poll(() =>
      picker
        .locator('img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth === 256,
          ),
        ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Architecte logiciel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Architecte logiciel', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => picker.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
  await expect
    .poll(() =>
      picker
        .locator('span')
        .evaluateAll((labels) =>
          labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
        ),
    )
    .toBe(true);
});
test('nouveau hook désactivé par défaut, activation uniquement après action humaine', async ({
  page,
}) => {
  await hosted(page);
  await navigate(page, 'Automatisations');
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
for (const screen of ['Réglages', 'Automatisations']) {
  test(`${screen} : accès à l’approbation et conservation du brouillon jusqu’au retour de VS Code`, async ({
    page,
  }) => {
    const state = fresh();
    state.workspace.trusted = false;
    if (screen === 'Automatisations') await page.setViewportSize({ width: 390, height: 844 });
    await hosted(page, state);
    await navigate(page, screen);
    if (screen === 'Automatisations') {
      await page.getByRole('button', { name: 'Ajouter un hook' }).click();
      await page.getByLabel('Nom du hook').fill('Mon brouillon conservé');
      await page.getByLabel('Exécutable', { exact: true }).fill('node');
    } else {
      await page
        .getByRole('spinbutton', { name: 'Durée maximale d’une tentative minutes' })
        .fill('31');
    }
    const footer = page.locator('.settings-save');
    const save = footer.getByRole('button', { name: 'Enregistrer les réglages' });
    await expect(footer).toContainText('Approbation requise dans VS Code');
    await expect(save).toBeDisabled();
    await footer.getByRole('button', { name: 'Gérer l’approbation dans VS Code' }).click();
    expect((await messages(page)).at(-1)).toEqual({ type: 'manageWorkspaceTrust' });
    // Opening or dismissing the native screen is not an approval.
    await expect(save).toBeDisabled();
    expect((await messages(page)).some((message) => message.type === 'saveSettings')).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    state.workspace.trusted = true;
    await page.evaluate((next) => window.postMessage({ type: 'state', state: next }, '*'), state);
    await expect(page.locator('.warning-banner')).toHaveCount(0);
    await expect(footer).toContainText('Projet approuvé dans VS Code');
    await expect(
      footer.getByRole('button', { name: 'Gérer l’approbation dans VS Code' }),
    ).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    expect((await messages(page)).at(-1)).toMatchObject({
      type: 'saveSettings',
      settings:
        screen === 'Automatisations'
          ? { hooks: [{ name: 'Mon brouillon conservé', command: 'node', enabled: false }] }
          : { timeoutMinutes: 31 },
    });
  });
}

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
  await navigate(page, 'Agents');
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
  await finishLaunch(page);
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
  await finishLaunch(page, true);
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
  await finishLaunch(page);
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    featureId: 'command-palette',
    stepId: 'discover',
    feedback: 'Intégrer les remarques de relecture.',
  });
  await expect(page.getByText('Une étape de plus.')).toBeVisible();
});
test('les raccourcis ouvrent les catalogues et une nouvelle session reste sans équipe', async ({
  page,
}) => {
  const state = fresh();
  state.workflows.sort((a, b) => a.id.localeCompare(b.id));
  await hosted(page, state);
  await page
    .getByRole('button', { name: 'Explorer les parcours Choisir une méthode de travail' })
    .click();
  await expect(page.getByRole('button', { name: 'Nouveau parcours' })).toBeVisible();
  await navigate(page, 'Sessions');
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Feature complète' })).toHaveCount(0);
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
test('lancement manuel : US, MCP explicite et mémoire opt-in passent par un aperçu host', async ({
  page,
}) => {
  const state = fresh();
  state.settings.mcpServers = [
    {
      id: 'ado',
      name: 'Azure DevOps',
      transport: 'stdio',
      command: 'npx',
      args: [],
      envKeys: [],
      headers: {},
      tools: ['wit_work_item'],
      enabled: true,
      autoApproveReadOnly: false,
    },
  ];
  state.memory = [
    {
      id: 'mem',
      title: 'Conventions du projet',
      content: 'Utiliser des tests comportementaux.',
      category: 'convention',
      enabled: true,
      agentIds: [],
      updatedAt: '2026-10-13T00:00:00Z',
    },
  ];
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await expect(
    page.getByRole('checkbox', { name: 'Inclure la mémoire du projet' }),
  ).not.toBeChecked();
  await page
    .getByLabel('US, demande ou contexte initial')
    .fill('En tant que lecteur, je retrouve une commande au clavier.');
  await page.getByRole('checkbox', { name: 'Azure DevOps' }).check();
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByText('Aperçu host')).toBeVisible();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'previewRun',
    launch: {
      initialContext: 'En tant que lecteur, je retrouve une commande au clavier.',
      mcpServerIds: ['ado'],
      useProjectMemory: false,
      memoryIds: [],
    },
  });
  await page
    .getByLabel('US, demande ou contexte initial')
    .fill('US corrigée : navigation avec Échap.');
  await expect(page.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await finishLaunch(page);
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    previewFingerprint: 'a'.repeat(64),
    launch: {
      initialContext: 'US corrigée : navigation avec Échap.',
      mcpServerIds: ['ado'],
      useProjectMemory: false,
    },
  });
});
test('MCP : serveur off par défaut, preset explicite, secret password et permissions humaines', async ({
  page,
}) => {
  const state = fresh();
  state.humanRequests = [
    {
      id: 'permission',
      featureId: 'command-palette',
      stepId: 'design',
      kind: 'mcp-permission',
      question: 'Autoriser wit_work_item ?',
      details: 'Lecture du work item 42',
      allowFreeform: false,
    },
  ];
  await hosted(page, state);
  await page.getByRole('button', { name: 'Ouvrir la demande' }).click();
  await page.getByRole('button', { name: 'Autoriser cette demande' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'answerHumanRequest',
    requestId: 'permission',
    answer: 'allow',
  });
  await navigate(page, 'Réglages');
  await page.getByLabel('Organisation Azure DevOps').fill('atelier');
  await page.getByRole('button', { name: 'Ajouter le preset Azure DevOps' }).click();
  const server = page.locator('.mcp-server');
  await expect(server.getByRole('checkbox', { name: 'Désactivé' })).not.toBeChecked();
  await expect(server.getByLabel('Outils autorisés')).toHaveValue('wit_work_item');
  await page.getByLabel('Clé du secret').fill('TOKEN');
  await page.getByLabel('Valeur du secret').fill('secret-only-in-message');
  await expect(page.getByLabel('Valeur du secret')).toHaveAttribute('type', 'password');
  await expect(
    page.getByRole('button', { name: 'Enregistrer dans le coffre VS Code' }),
  ).toBeDisabled();
  await server.getByLabel('Clés d’environnement').fill('TOKEN');
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveSettings' }>;
  expect(saved).toMatchObject({
    type: 'saveSettings',
    settings: {
      mcpServers: [
        {
          name: 'Azure DevOps · atelier',
          enabled: false,
          tools: ['wit_work_item'],
          command: 'npx',
          args: [
            '-y',
            '@azure-devops/mcp@2.10.0',
            'atelier',
            '-d',
            'work-items',
            '--authentication',
            'interactive',
          ],
          envKeys: ['TOKEN'],
        },
      ],
    },
  });
  expect(JSON.stringify(saved)).not.toContain('secret-only-in-message');
  state.settings = saved.settings;
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await page.getByLabel('Clé du secret').fill('TOKEN');
  await page.getByLabel('Valeur du secret').fill('secret-only-in-message');
  await page.getByRole('button', { name: 'Enregistrer dans le coffre VS Code' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'setMcpSecret',
    key: 'TOKEN',
    value: 'secret-only-in-message',
  });
  await expect(page.getByLabel('Valeur du secret')).toHaveValue('');
});
test('configuration MCP : identifiant lettre et transports restent exclusifs sans outils vides', async ({
  page,
}) => {
  await hosted(page);
  await navigate(page, 'Réglages');
  await page.getByRole('button', { name: 'Ajouter un serveur MCP', exact: true }).click();
  const server = page.locator('.mcp-server');
  await server.getByLabel('Exécutable MCP').fill('node');
  await server.getByLabel('Outils autorisés').fill('read_item\n\n');
  await server.getByLabel('Clés d’environnement').fill('TOKEN\n');
  await server.getByLabel('Transport de Nouveau serveur').selectOption('http');
  await server.getByLabel('URL du serveur MCP').fill('https://example.test/mcp');
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveSettings' }>;
  expect(saved.settings.mcpServers![0]).toMatchObject({
    id: expect.stringMatching(/^mcp-[a-z0-9-]+$/),
    transport: 'http',
    command: undefined,
    url: 'https://example.test/mcp',
    tools: ['read_item'],
    envKeys: ['TOKEN'],
    enabled: false,
    autoApproveReadOnly: false,
  });
  await server.getByLabel('Transport de Nouveau serveur').selectOption('stdio');
  await server.getByLabel('Exécutable MCP').fill('node');
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveSettings',
    settings: { mcpServers: [{ transport: 'stdio', url: undefined, command: 'node' }] },
  });
});
test('mémoire locale désactivée par défaut, opt-in sans sélection n’injecte rien', async ({
  page,
}) => {
  const state = fresh();
  state.memory = [
    {
      id: 'context',
      title: 'Architecture locale',
      content: 'Un store pour chaque projet.',
      category: 'architecture',
      enabled: true,
      agentIds: [],
      updatedAt: '2026-10-13T00:00:00Z',
    },
    {
      id: 'off',
      title: 'Décision en attente',
      content: 'À relire.',
      category: 'decision',
      enabled: false,
      agentIds: [],
      updatedAt: '2026-10-13T00:00:00Z',
    },
  ];
  await hosted(page, state);
  await navigate(page, 'Mémoire');
  await page.getByRole('button', { name: 'Nouvelle note' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Rendre cette note disponible pour les prompts' }),
  ).not.toBeChecked();
  await page.getByLabel('Titre de la note').fill('Conventions CSS');
  await page.getByLabel('Contenu de la note').fill('Utiliser les variables du thème.');
  await page.getByRole('button', { name: 'Enregistrer la note' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveMemory',
    entry: {
      title: 'Conventions CSS',
      enabled: false,
      content: 'Utiliser les variables du thème.',
    },
  });
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
  await navigate(page, 'Sessions');
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Inclure la mémoire du projet' }).check();
  await expect(
    page.getByText('0 note sélectionnée : aucune mémoire ne sera injectée.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Décision en attente' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Architecture locale' }).check();
  await finishLaunch(page);
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    launch: { useProjectMemory: true, memoryIds: ['context'] },
  });
});
test('autopilot : cadre explicite, contextes par étape et pause fournie par le host', async ({
  page,
}) => {
  const state = fresh();
  state.memory = [
    {
      id: 'memo',
      title: 'Conventions validées',
      content: 'Clavier prioritaire.',
      enabled: true,
      agentIds: [],
      category: 'convention',
      updatedAt: '2026-10-13T00:00:00Z',
    },
  ];
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await page.locator('.autopilot-bar').getByRole('button', { name: 'Configurer' }).click();
  await expect(page.getByLabel('Nombre maximal d’exécutions')).toHaveValue('5');
  await expect(page.getByLabel('Cycles de correction maximum')).toHaveValue('0');
  await expect(page.getByLabel('Cycles de correction maximum')).toHaveAttribute('max', '20');
  await page
    .getByLabel('Contexte initial de Conception')
    .fill('Prévoir une palette accessible au clavier.');
  await page.getByRole('checkbox', { name: 'Sélectionner de la mémoire pour cet agent' }).check();
  await expect(
    page.getByText('0 note sélectionnée : aucune mémoire ne sera injectée.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Conventions validées' }).check();
  await page.getByRole('button', { name: 'Enregistrer l’autopilot' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveAutopilot' }>;
  expect(saved).toMatchObject({
    type: 'saveAutopilot',
    config: {
      maxRuns: 5,
      maxCorrectionCycles: 0,
      checkpoints: ['review'],
      stepInputs: {
        design: {
          initialContext: 'Prévoir une palette accessible au clavier.',
          useProjectMemory: true,
          memoryIds: ['memo'],
        },
      },
    },
  });
  expect((await messages(page)).some((m) => m.type === 'startAutopilot')).toBe(false);
  state.features[0].autopilot = {
    ...saved.config,
    status: 'idle',
    runs: 0,
    correctionCycles: 0,
    updatedAt: '2026-10-13T00:00:00Z',
  };
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await page.getByRole('button', { name: 'Activer l’autopilot' }).click();
  await page.getByRole('button', { name: 'Démarrer l’autopilot' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'startAutopilot',
    featureId: 'command-palette',
  });
  state.features[0].autopilot!.status = 'running';
  state.features[0].autopilot!.runs = 1;
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await page.getByRole('button', { name: 'Demander la pause' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'pauseAutopilot',
    featureId: 'command-palette',
  });
  await expect(page.locator('.autopilot-bar h3')).toContainText('En cours');
  state.features[0].autopilot!.status = 'paused';
  state.features[0].autopilot!.reason = 'Une question humaine reste ouverte.';
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.locator('.autopilot-bar h3')).toContainText('En pause');
  await expect(page.getByText('Une question humaine reste ouverte.')).toBeVisible();
});
test('validation : preuves host, critères et remarques ; approbation liée à la révision', async ({
  page,
}) => {
  const state = fresh();
  const attempt = state.features[0].steps[1].attempts[0];
  attempt.revision = 7;
  attempt.evidence = [
    {
      id: 'proof',
      source: 'host',
      commandId: 'unit',
      name: 'Tests unitaires',
      command: 'npm',
      args: ['test'],
      startedAt: '2026-10-13T00:00:00Z',
      finishedAt: '2026-10-13T00:00:02Z',
      exitCode: 0,
      stdout: '4 tests passed',
      stderr: '',
      truncated: false,
      fileHashes: { 'src/palette.ts': 'hash' },
    },
  ];
  await hosted(page, state);
  await navigate(page, 'Validation');
  await page.locator('.validation-card').filter({ hasText: 'Conception' }).click();
  await page.getByRole('tab', { name: 'Preuves' }).click();
  await expect(page.getByText('Exécuté par le host', { exact: false })).toBeVisible();
  await expect(page.getByText('4 tests passed')).toBeVisible();
  await page.getByRole('tab', { name: 'Relecture', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByLabel('Critère 1', { exact: true }).fill('Échap ferme la palette');
  await page.getByLabel('État du critère 1').selectOption('passed');
  await page.getByLabel('Preuve du critère 1').fill('Test clavier npm test');
  await page.getByRole('button', { name: 'Enregistrer les critères' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveCriteria',
    criteria: [
      { text: 'Échap ferme la palette', status: 'passed', evidence: 'Test clavier npm test' },
    ],
  });
  await page.getByLabel('Un retour sur cette tentative').fill('Préciser le focus après fermeture.');
  await page.getByRole('checkbox', { name: 'Bloque la validation' }).check();
  await page.getByRole('button', { name: 'Ajouter le commentaire' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'addReviewComment',
    comment: {
      stepId: 'design',
      attemptId: attempt.id,
      blocking: true,
      text: 'Préciser le focus après fermeture.',
    },
  });
  await page.getByRole('button', { name: 'Valider cette étape' }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'approveStep',
    expectedAttemptId: attempt.id,
    expectedRevision: 7,
  });
});
test('budgets : conversion des crédits vers le stockage nano-AIU et valeurs absentes ou partielles signalées', async ({
  page,
}) => {
  const state = fresh();
  state.features[0].steps[0].attempts[0].usage = {
    source: 'measured',
    inputTokens: 100,
    outputTokens: 20,
    cost: 400,
    unit: 'nano-AIU',
    incompleteTokens: true,
    incompleteCost: true,
  };
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await expect(page.locator('.budget-meter')).toContainText('120');
  await expect(page.locator('.budget-meter')).toContainText('< 0,000001');
  await expect(page.locator('.budget-meter')).toContainText('mesure absente ou partielle');
  await page.locator('.budget-meter').getByRole('button', { name: 'Budget', exact: true }).click();
  await expect(page.getByLabel('Nombre maximal d’exécutions')).toHaveAttribute('max', '1000');
  await expect(page.getByLabel('Caractères maximum du prompt')).toHaveAttribute('max', '500000');
  await page.getByLabel('Seuil de tokens mesurés').fill('5000');
  await page.getByLabel('Seuil de crédits IA').fill('1000');
  await page.getByRole('button', { name: 'Enregistrer le budget' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'saveBudget',
    budget: {
      maxRuns: 10,
      maxPromptChars: 60000,
      maxTokens: 5000,
      maxNanoAiu: 1_000_000_000_000,
      modelProfile: 'current',
    },
  });
});
test('éditeur visuel : étapes, dépendances et réorganisation clavier sans YAML', async ({
  page,
}) => {
  await hosted(page);
  await navigate(page, 'Parcours');
  await page.getByRole('button', { name: 'Nouveau parcours' }).click();
  await page.getByLabel('Nom du parcours').fill('Mon parcours');
  await page.getByLabel('Nom de l’étape').fill('Explorer');
  await page.getByRole('button', { name: 'Étape', exact: true }).click();
  await page.getByLabel('Nom de l’étape').fill('Construire');
  await page.getByLabel('Permissions de l’étape').selectOption('workspace-write');
  await page.getByLabel('Nom du fichier livrable').fill('construction.txt');
  await expect(
    page.getByText('le livrable doit être un fichier .md.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le parcours' })).toBeDisabled();
  await page.getByLabel('Nom du fichier livrable').fill('construction.md');
  await page.getByRole('button', { name: 'Monter Construire' }).click();
  await expect(page.locator('.workflow-node').first()).toContainText('Construire');
  await page.getByRole('button', { name: 'Enregistrer le parcours' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveWorkflow' }>;
  expect(saved.type).toBe('saveWorkflow');
  expect(saved.workflow.id).toBe('mon-parcours');
  expect(saved.workflow.steps[0]).toMatchObject({
    name: 'Construire',
    policy: 'workspace-write',
    artifact: 'construction.md',
    dependsOn: [saved.workflow.steps[1].id],
  });
  expect(saved.workflow.steps[1].name).toBe('Explorer');
});
async function labelCapture(page: Page) {
  await page.evaluate(() => {
    const label = document.createElement('div');
    label.textContent = 'DÉMONSTRATION · données d’exemple · aucune exécution Copilot';
    label.style.cssText =
      'font-size:9px;letter-spacing:.8px;color:#e5c18e;border:1px solid #e5c18e40;background:#e5c18e08;padding:9px 12px;border-radius:6px;margin-bottom:22px';
    document.querySelector('[role="dialog"] .modal-heading')?.before(label);
  });
}
test('captures documentées : lancement avec US/MCP et éditeur de parcours', async ({ page }) => {
  const state = fresh();
  state.settings.mcpServers = [
    {
      id: 'mcp-azure',
      name: 'Azure DevOps · atelier-product',
      transport: 'stdio',
      command: 'npx',
      args: [
        '-y',
        '@azure-devops/mcp@2.10.0',
        'atelier-product',
        '-d',
        'work-items',
        '--authentication',
        'interactive',
      ],
      envKeys: [],
      headers: {},
      tools: ['wit_work_item'],
      enabled: true,
      autoApproveReadOnly: false,
    },
  ];
  state.mcpCatalogs = {
    'mcp-azure': {
      state: 'ready',
      tools: [{ name: 'wit_work_item', description: 'Lire une user story et ses critères.' }],
      checkedAt: '2026-10-13T00:00:00Z',
    },
  };
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page
    .getByLabel('US, demande ou contexte initial')
    .fill(
      '# US-142 · Une palette de commandes au clavier\n\nEn tant que membre de l’atelier, je veux retrouver une action avec ⌘ K, pour rester dans le fil de mon travail.\n\nCritères d’acceptation\n• Les flèches changent la sélection, Entrée ouvre l’action.\n• Échap ferme la palette et restitue le focus.\n• L’état vide suggère de préciser la recherche.\n\nContrainte : recherche locale, sans dépendance distante.',
    );
  await page
    .getByLabel('Retour pour cette tentative')
    .fill(
      'Conserver les conventions d’accessibilité existantes et préciser le contrat du composant.',
    );
  await page.getByRole('checkbox', { name: 'Azure DevOps · atelier-product' }).check();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByText('Aperçu host')).toBeVisible();
  await labelCapture(page);
  await page.getByLabel('US, demande ou contexte initial').evaluate((n) => {
    n.scrollTop = 0;
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/images/launch-context.png', fullPage: false });
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await navigate(page, 'Parcours');
  await page
    .locator('.workflow-library-card')
    .filter({ hasText: 'Feature complète' })
    .getByRole('button', { name: 'Ouvrir l’éditeur' })
    .click();
  await page.getByRole('button', { name: 'Configurer l’étape Conception' }).click();
  await page.setViewportSize({ width: 1440, height: 1320 });
  await labelCapture(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/images/workflow-editor.png', fullPage: false });
});
test('nouvelles vues et panneaux ne débordent pas en mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hosted(page);
  for (const view of ['Validation', 'Mémoire', 'Parcours']) {
    await navigate(page, view);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Nouveau parcours' }).click();
  await page.getByLabel('Nom du parcours').fill('Un petit parcours');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await navigate(page, 'Sessions');
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.getByLabel('US, demande ou contexte initial').fill('US mobile');
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByText('Aperçu host')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
function checkpointState(): StudioState {
  const state = fresh();
  state.workspace.canIsolate = true;
  const feature = state.features[0];
  feature.worktree = {
    path: '/demo/atelier-product/.worktrees/command-palette',
    branch: 'codex/command-palette',
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    createdAt: '2026-10-13T09:00:00Z',
  };
  feature.branch = feature.worktree.branch;
  feature.steps[1].attempts[0].checkpointBeforeId = 'before';
  feature.steps[1].attempts[0].checkpointAfterId = 'after';
  feature.checkpoints = [
    {
      id: 'before',
      label: 'Avant conception',
      kind: 'before-run',
      createdAt: '2026-10-13T09:10:00Z',
      branch: feature.branch,
      head: 'a'.repeat(40),
      stepId: 'design',
      attemptId: feature.steps[1].attempts[0].id,
      fileCount: 42,
      totalBytes: 184320,
      excludedCount: 1,
      excludedPaths: ['.env'],
    },
    {
      id: 'after',
      label: 'Après conception',
      kind: 'after-run',
      createdAt: '2026-10-13T09:15:00Z',
      branch: feature.branch,
      head: 'a'.repeat(40),
      stepId: 'design',
      attemptId: feature.steps[1].attempts[0].id,
      fileCount: 43,
      totalBytes: 186420,
      excludedCount: 1,
      excludedPaths: ['.env'],
    },
  ];
  return state;
}
async function openCheckpoints(page: Page) {
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Points de restauration', exact: false }).click();
  await expect(
    page.getByRole('dialog', { name: 'Le code garde des points de repère.' }),
  ).toBeVisible();
}
test('création Git sans équipe : worktree par défaut et choix explicite du dossier courant', async ({
  page,
}) => {
  const state = checkpointState();
  await hosted(page, state);
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Worktree isolé' })).toBeChecked();
  await expect(
    page.getByText('Les changements non commités restent dans le dossier source', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Worktree isolé' })).toBeChecked();
  await page.getByLabel('Qu’allons-nous faire ?').fill('Une session isolée');
  await page.getByRole('button', { name: 'Créer la feature' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'createFeature',
    isolated: true,
  });
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  await page.getByRole('radio', { name: 'Dossier courant' }).click();
  await expect(page.getByRole('radio', { name: 'Dossier courant' })).toBeChecked();
  await page.getByLabel('Qu’allons-nous faire ?').fill('Relire les changements existants');
  await page.getByRole('button', { name: 'Créer la feature' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'createFeature',
    isolated: false,
  });
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
});
test('espace courant legacy, isolation indisponible et opérations Git bloquent les mutations', async ({
  page,
}) => {
  const state = fresh();
  state.workspace.canIsolate = false;
  state.workspace.isolationReason = 'Ce dossier ne contient pas encore de commit Git.';
  await hosted(page, state);
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Worktree isolé' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Dossier courant' })).toBeChecked();
  await expect(page.getByText(state.workspace.isolationReason)).toBeVisible();
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.locator('.session-card').first().click();
  await expect(page.locator('.git-workspace-band')).toContainText('Dossier courant');
  await expect(page.locator('.git-workspace-band')).toContainText(state.workspace.path);
  await page.getByRole('button', { name: 'Ouvrir le dossier' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'openFeatureWorkspace',
    featureId: 'command-palette',
  });
  state.workspaceOperation = { featureId: 'command-palette', label: 'Sauvegarde Git en cours' };
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(
    page.getByRole('button', { name: 'Nouvelle tentative', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Points de restauration', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Nouveau point' })).toBeDisabled();
});
test('points : diff à la bonne racine, sélection vide et restauration ciblée confirmée avec fingerprint', async ({
  page,
}) => {
  await hosted(page, checkpointState());
  await openCheckpoints(page);
  await page.locator('.checkpoint-list button').filter({ hasText: 'Avant conception' }).click();
  await page.getByRole('button', { name: 'Comparer les fichiers' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Restaurer src/palette.ts', exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Restaurer notes/new.md', exact: true }),
  ).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Restaurer .env', exact: true })).toBeDisabled();
  await expect(page.getByText('la restauration le supprimera', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restaurer la sélection' })).toBeDisabled();
  await page
    .locator('.checkpoint-change')
    .filter({ hasText: 'src/palette.ts' })
    .getByRole('button', { name: 'Diff', exact: true })
    .click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'openCheckpointDiff',
    featureId: 'command-palette',
    checkpointId: 'before',
    path: 'src/palette.ts',
  });
  await page.getByRole('checkbox', { name: 'Restaurer src/palette.ts', exact: true }).check();
  await page.getByRole('button', { name: 'Restaurer la sélection' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('sauvegarde de récupération');
  await expect(page.getByRole('alertdialog')).toContainText(
    'validations du parcours deviendront à actualiser',
  );
  expect((await messages(page)).some((m) => m.type === 'restoreCheckpoint')).toBe(false);
  await page.getByRole('button', { name: 'Confirmer la restauration' }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'restoreCheckpoint',
    featureId: 'command-palette',
    checkpointId: 'before',
    paths: ['src/palette.ts'],
    expectedFingerprint: 'b'.repeat(64),
  });
  await expect(page.locator('.checkpoint-list button')).toHaveCount(2);
  await page.evaluate(() =>
    window.postMessage(
      { type: 'error', message: 'Comparaison obsolète : recommencez avant de restaurer.' },
      '*',
    ),
  );
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Comparaison obsolète');
});
test('comparaison de deux points reste consultative et route le diff avec ses deux ids', async ({
  page,
}) => {
  await hosted(page, checkpointState());
  await openCheckpoints(page);
  await page.locator('.checkpoint-list button').filter({ hasText: 'Avant conception' }).click();
  await page.getByLabel('Cible de la comparaison').selectOption('after');
  await page.getByRole('button', { name: 'Comparer les fichiers' }).click();
  await expect(page.getByText('consultation uniquement', { exact: false })).toBeVisible();
  await expect(page.locator('.checkpoint-change')).toHaveCount(3);
  await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restaurer la sélection' })).toHaveCount(0);
  await page
    .locator('.checkpoint-change')
    .first()
    .getByRole('button', { name: 'Diff', exact: true })
    .click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'openCheckpointDiff',
    featureId: 'command-palette',
    checkpointId: 'before',
    targetCheckpointId: 'after',
    path: 'src/palette.ts',
  });
  expect((await messages(page)).some((m) => m.type === 'restoreCheckpoint')).toBe(false);
});
test('point manuel et état courant restent pilotés par le host, sans appel IA', async ({
  page,
}) => {
  const state = fresh();
  state.features[0].checkpoints = [];
  await hosted(page, state);
  await openCheckpoints(page);
  await page.getByRole('button', { name: 'Nouveau point' }).click();
  await page.getByLabel('Nom du point manuel').fill('Avant mon ajustement');
  await page.getByRole('button', { name: 'Créer le point', exact: true }).click();
  expect((await messages(page)).at(-1)).toEqual({
    type: 'createCheckpoint',
    featureId: 'command-palette',
    label: 'Avant mon ajustement',
  });
  await expect(page.locator('.checkpoint-list button')).toHaveCount(0);
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
  state.features[0].checkpoints = [
    {
      id: 'manual',
      label: 'Avant mon ajustement',
      kind: 'manual',
      createdAt: '2026-10-13T09:30:00Z',
      branch: 'main',
      head: 'a'.repeat(40),
      fileCount: 10,
      totalBytes: 8192,
      excludedCount: 0,
      excludedPaths: [],
    },
  ];
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.locator('.checkpoint-list button')).toHaveCount(1);
  await expect(page.locator('.checkpoint-list')).toContainText('Point manuel');
});
test('restauration et nouveaux lancements restent indisponibles pendant une tentative globale', async ({
  page,
}) => {
  const state = checkpointState();
  state.features[1].steps[0].status = 'running';
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await expect(
    page.getByRole('button', { name: 'Nouvelle tentative', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Points de restauration', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Nouveau point' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Comparer les fichiers' })).toBeDisabled();
  expect(
    (await messages(page)).some((m) => m.type === 'runStep' || m.type === 'restoreCheckpoint'),
  ).toBe(false);
});
test('panneau points de restauration utilisable au clavier et contenu dans la largeur mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hosted(page, checkpointState());
  await openCheckpoints(page);
  await page.getByRole('button', { name: 'Comparer les fichiers' }).click();
  await expect(page.locator('.checkpoint-change')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('checkbox', { name: 'Restaurer src/palette.ts', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('checkbox', { name: 'Restaurer src/palette.ts', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Restaurer la sélection' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Conserver l’état actuel' }).click();
  expect((await messages(page)).some((m) => m.type === 'restoreCheckpoint')).toBe(false);
});
test('capture documentée du panneau de comparaison et restauration Git', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await hosted(page, checkpointState());
  await openCheckpoints(page);
  await page.locator('.checkpoint-list button').filter({ hasText: 'Avant conception' }).click();
  await page.getByRole('button', { name: 'Comparer les fichiers' }).click();
  await page.getByRole('checkbox', { name: 'Restaurer src/palette.ts', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Restaurer la sélection' })).toBeEnabled();
  await labelCapture(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/images/checkpoints.png', fullPage: false });
});
test('une tentative ouvre directement la comparaison de ses points avant et après', async ({
  page,
}) => {
  await hosted(page, checkpointState());
  await page.locator('.session-card').first().click();
  await page
    .locator('.attempt-checkpoint-links')
    .getByRole('button', { name: 'Comparer', exact: true })
    .click();
  await expect(page.getByLabel('Cible de la comparaison')).toHaveValue('after');
  await page.getByRole('button', { name: 'Comparer les fichiers' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'compareCheckpoint',
    featureId: 'command-palette',
    checkpointId: 'before',
    targetCheckpointId: 'after',
  });
  await expect(page.getByRole('button', { name: 'Restaurer la sélection' })).toHaveCount(0);
});
test('le statut hôte de comparaison puis de diff conserve la réponse et la sélection', async ({
  page,
}) => {
  const state = checkpointState();
  await hosted(page, state);
  await page.evaluate(() => Reflect.set(window, 'autoComparison', false));
  await openCheckpoints(page);
  await page.getByRole('button', { name: 'Comparer les fichiers' }).click();
  const request = (await messages(page)).at(-1) as Extract<
    ClientMessage,
    { type: 'compareCheckpoint' }
  >;
  state.workspaceOperation = {
    featureId: request.featureId,
    label: 'Comparaison des fichiers',
    readOnly: true,
  };
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.getByRole('button', { name: 'Nouveau point' })).toBeDisabled();
  delete state.workspaceOperation;
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.getByRole('button', { name: 'Nouveau point' })).toBeEnabled();
  await page.evaluate(
    (r) =>
      window.postMessage(
        {
          type: 'checkpointComparison',
          requestId: r.requestId,
          comparison: {
            featureId: r.featureId,
            checkpointId: r.checkpointId,
            fingerprint: 'c'.repeat(64),
            files: [
              { path: 'src/palette.ts', status: 'modified', binary: false, restorable: true },
            ],
          },
        },
        '*',
      ),
    request,
  );
  const checkbox = page.getByRole('checkbox', { name: 'Restaurer src/palette.ts', exact: true });
  await checkbox.check();
  state.workspaceOperation = {
    featureId: request.featureId,
    label: 'Ouverture de la comparaison',
    readOnly: true,
  };
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.getByRole('button', { name: 'Restaurer la sélection' })).toBeDisabled();
  await expect(checkbox).toBeChecked();
  delete state.workspaceOperation;
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.getByRole('button', { name: 'Restaurer la sélection' })).toBeEnabled();
});
test('une comparaison tardive ou invalidée par une mutation ne réactive jamais la restauration', async ({
  page,
}) => {
  const state = checkpointState();
  await hosted(page, state);
  await page.evaluate(() => Reflect.set(window, 'autoComparison', false));
  await openCheckpoints(page);
  await page.getByRole('button', { name: 'Comparer les fichiers' }).click();
  const first = (await messages(page)).at(-1) as Extract<
    ClientMessage,
    { type: 'compareCheckpoint' }
  >;
  await page.locator('.checkpoint-list button').filter({ hasText: 'Avant conception' }).click();
  const response = (requestId: string, checkpointId: string) => ({
    type: 'checkpointComparison',
    requestId,
    comparison: {
      featureId: 'command-palette',
      checkpointId,
      fingerprint: 'c'.repeat(64),
      files: [{ path: 'src/palette.ts', status: 'modified', binary: false, restorable: true }],
    },
  });
  await page.evaluate(
    (message) => window.postMessage(message, '*'),
    response(first.requestId, 'after'),
  );
  await expect(page.locator('.checkpoint-change')).toHaveCount(0);
  await page.getByRole('button', { name: 'Comparer les fichiers' }).click();
  const second = (await messages(page)).at(-1) as Extract<
    ClientMessage,
    { type: 'compareCheckpoint' }
  >;
  await page.evaluate(
    (message) => window.postMessage(message, '*'),
    response(second.requestId, 'before'),
  );
  await page.getByRole('checkbox', { name: 'Restaurer src/palette.ts', exact: true }).check();
  state.workspaceOperation = {
    featureId: 'command-palette',
    label: 'Création d’un point en cours',
  };
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.getByRole('button', { name: 'Comparer les fichiers' })).toBeDisabled();
  await expect(page.locator('.checkpoint-change')).toHaveCount(0);
  delete state.workspaceOperation;
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await page.evaluate(
    (message) => window.postMessage(message, '*'),
    response(second.requestId, 'before'),
  );
  await expect(page.locator('.checkpoint-change')).toHaveCount(0);
  expect((await messages(page)).some((m) => m.type === 'restoreCheckpoint')).toBe(false);
});

test('migration accessible et édition projet sans migration obligatoire', async ({ page }) => {
  const state = fresh();
  state.agents[0].source = 'workspace';
  state.agents[0].nickname = 'Agent projet à migrer';
  state.agents[0].path = '.github/agents/project.agent.md';
  await hosted(page, state);
  await page.locator('.sidebar-tools > summary').click();
  await page.getByRole('button', { name: 'Migrer les profils du projet' }).click();
  expect((await messages(page)).at(-1)).toEqual({ type: 'migrateUserKit' });
  await navigate(page, 'Agents');
  await page.getByRole('button').filter({ hasText: 'Agent projet à migrer' }).click();
  await expect(page.getByLabel('Portée du profil')).toHaveValue('workspace');
  await expect(page.getByRole('button', { name: 'Enregistrer le profil' })).toBeEnabled();
  await page.getByRole('button', { name: 'Migrer vers le compte utilisateur' }).click();
  expect((await messages(page)).at(-1)).toEqual({ type: 'migrateUserKit' });
});

test('contexte : décocher la spec, modifier le plan et actualiser avant lancement', async ({
  page,
}) => {
  await hosted(page);
  await page.evaluate(() =>
    Reflect.set(window, 'previewSections', [
      {
        id: 'artifact:specs',
        label: 'Spec fonctionnelle',
        source: 'artifact',
        content: 'SPEC_ORIGINALE',
      },
      {
        id: 'artifact:plan',
        label: 'Plan technique',
        source: 'artifact',
        content: 'PLAN_ORIGINAL',
      },
      {
        id: 'completion',
        label: 'Format de sortie',
        source: 'system',
        content: 'CADRE_OBLIGATOIRE',
      },
    ]),
  );
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByText('Aperçu host')).toBeVisible();
  await page.getByRole('checkbox', { name: /Spec fonctionnelle/ }).uncheck();
  const plan = page.locator('.context-block').filter({ hasText: 'Plan technique' });
  await plan.locator('summary').click();
  await page.getByLabel('Contenu · Plan technique').fill('PLAN_ADAPTÉ');
  await expect(page.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByText('Aperçu host')).toBeVisible();
  await page.getByText('Lire le prompt assemblé complet', { exact: true }).click();
  const prompt = page
    .locator('.assembled-prompt')
    .filter({ hasText: 'Lire le prompt assemblé complet' });
  await expect(prompt).toContainText('PLAN_ADAPTÉ');
  await expect(prompt).toContainText('CADRE_OBLIGATOIRE');
  await expect(prompt).not.toContainText('SPEC_ORIGINALE');
  await expect(prompt).not.toContainText('PLAN_ORIGINAL');
  await page.screenshot({ path: 'test-results/context-selection.png', fullPage: true });
  await page.getByRole('button', { name: 'Lancer cette étape' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    launch: {
      contextBlocks: {
        'artifact:specs': { enabled: false },
        'artifact:plan': { content: 'PLAN_ADAPTÉ' },
      },
    },
  });
});

test('contexte : skill absente visible et décochable avant de lancer', async ({ page }) => {
  await hosted(page);
  await page.evaluate(() =>
    Reflect.set(window, 'previewSections', [
      {
        id: 'skill:missing-custom',
        label: 'Skill introuvable · missing-custom',
        source: 'skill',
        content: 'La skill missing-custom est absente.',
        unavailable: true,
      },
    ]),
  );
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByText('Aperçu host')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Skill introuvable · missing-custom/ }).uncheck();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByRole('button', { name: 'Lancer cette étape' })).toBeEnabled();
  await page.getByRole('button', { name: 'Lancer cette étape' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    launch: { contextBlocks: { 'skill:missing-custom': { enabled: false } } },
  });
});

test('contexte vide par défaut : sélectionner seulement la spec, tout cocher et réinitialiser', async ({
  page,
}) => {
  const state = fresh();
  state.agents.find(
    (agent) => agent.id === state.features[0].steps[1].agentId,
  )!.emptyContextByDefault = true;
  await hosted(page, state);
  await page.evaluate(() =>
    Reflect.set(window, 'previewSections', [
      { id: 'artifact:specs', label: 'Spec fonctionnelle', source: 'artifact', content: 'SPEC' },
      { id: 'artifact:plan', label: 'Plan technique', source: 'artifact', content: 'PLAN' },
      { id: 'agent', label: 'Instructions de l’agent', source: 'agent', content: 'ROLE' },
    ]),
  );
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByText('Aperçu host')).toBeVisible();
  await expect(page.locator('.context-block input:checked')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tout cocher' }).click();
  await expect(page.locator('.context-block input:checked')).toHaveCount(3);
  await page.getByRole('button', { name: 'Tout décocher' }).click();
  await page.getByRole('checkbox', { name: /Spec fonctionnelle/ }).check();
  const spec = page.locator('.context-block').filter({ hasText: 'Spec fonctionnelle' });
  await spec.locator('summary').click();
  await page.getByLabel('Contenu · Spec fonctionnelle').fill('NOUVELLE_SPEC');
  await page.getByRole('button', { name: 'Rétablir le contenu d’origine' }).click();
  await expect(page.getByLabel('Contenu · Spec fonctionnelle')).toHaveValue('SPEC');
  await expect(page.locator('.context-block input:checked')).toHaveCount(1);
  await finishLaunch(page);
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    launch: { contextMode: 'empty', contextBlocks: { 'artifact:specs': { enabled: true } } },
  });
});

test('autoriser un fichier existant exige une sélection explicite et un nouvel aperçu', async ({
  page,
}) => {
  await hosted(page);
  await page.evaluate(() =>
    Reflect.set(window, 'existingChanges', {
      files: [
        { path: 'SyfadisProvider.cs' },
        { path: 'Other.cs' },
        { path: 'deleted.cs', reason: 'Fichier supprimé' },
      ],
      omittedCount: 0,
    }),
  );
  await page.locator('.session-card').first().click();
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByRole('checkbox', { name: 'SyfadisProvider.cs' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /deleted.cs/ })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'SyfadisProvider.cs' }).check();
  await expect(page.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await finishLaunch(page);
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    launch: { editableExistingFiles: ['SyfadisProvider.cs'] },
  });
  await page.getByRole('button', { name: 'Nouvelle tentative', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByRole('checkbox', { name: 'SyfadisProvider.cs' })).not.toBeChecked();
});

test('dernière étape : afficher les blocages, un refus hôte et la confirmation de fin', async ({
  page,
}) => {
  const state = fresh();
  const feature = state.features[0];
  const step = feature.steps[1];
  step.dependsOn = [];
  feature.steps = [step];
  feature.activeStepId = step.id;
  feature.criteria = [{ id: 'ac', text: 'Nettoyage ciblé', status: 'pending', evidence: '' }];
  await hosted(page, state);
  await page.locator('.session-card').first().click();
  await expect(page.getByRole('button', { name: 'Valider cette étape' })).toBeDisabled();
  await expect(page.getByText('Validation bloquée', { exact: true })).toBeVisible();
  await expect(page.locator('.approval-blockers')).toContainText('critères d’acceptation');
  feature.criteria[0] = {
    ...feature.criteria[0],
    status: 'passed',
    evidence: 'Relecture effectuée',
  };
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await page.getByRole('button', { name: 'Valider cette étape' }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Validation en cours…' })).toBeDisabled();
  await page.evaluate(
    ({ featureId, stepId, attemptId }) =>
      window.postMessage(
        {
          type: 'stepApprovalResult',
          featureId,
          stepId,
          attemptId,
          error: 'La preuve de test est obsolète : source modifiée.',
        },
        '*',
      ),
    { featureId: feature.id, stepId: step.id, attemptId: step.attempts[0].id },
  );
  await expect(
    page.getByText('La validation n’a pas été enregistrée', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.approval-blockers[role="alert"]')).toContainText(
    'preuve de test est obsolète',
  );
  await expect(page.getByRole('button', { name: 'Valider cette étape' })).toBeEnabled();
  await page.getByRole('button', { name: 'Valider cette étape' }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  step.status = 'approved';
  step.attempts[0].status = 'approved';
  feature.status = 'awaiting_final_validation';
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await expect(page.getByRole('button', { name: 'Valider définitivement' })).toBeVisible();
  await expect(page.locator('.celebration-confetti')).toHaveCount(0);
  await page.getByRole('button', { name: 'Valider définitivement' }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'finalizeFeature',
    featureId: feature.id,
  });
  feature.finalValidation = {
    id: 'final-legacy-path',
    at: feature.updatedAt,
    stateKey: featureStateKey(feature),
    author: 'human',
  };
  feature.status = 'completed';
  await page.evaluate((s) => window.postMessage({ type: 'state', state: s }, '*'), state);
  await page.evaluate(
    (featureId) =>
      window.postMessage(
        { type: 'featureFinalizationResult', featureId, finalizationId: 'final-legacy-path' },
        '*',
      ),
    feature.id,
  );
  await expect(
    page.getByText('Décision finale enregistrée — session terminée', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Valider cette étape' })).toHaveCount(0);
});
