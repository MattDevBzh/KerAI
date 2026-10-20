import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import { featureStateKey } from '../src/shared/collaboration';
import type { StudioState, ClientMessage } from '../src/shared/types';

function scenario(final = false): StudioState {
  const state = structuredClone(demoState);
  state.runtime = { state: 'ready', authenticated: true, models: [] };
  const feature = state.features[0];
  feature.status = final ? 'awaiting_final_validation' : 'attention';
  feature.activeStepId = feature.steps.at(-1)!.id;
  feature.criteria = [
    {
      id: 'criterion',
      text: 'Navigation accessible',
      status: 'passed',
      evidence: 'Commande exécutée',
    },
  ];
  feature.steps.forEach((step, index) => {
    step.status = final || index < feature.steps.length - 1 ? 'approved' : 'awaiting_review';
    step.attempts = [
      {
        id: `attempt-${step.id}`,
        revision: 0,
        status: step.status,
        startedAt: feature.createdAt,
        finishedAt: feature.updatedAt,
        feedback: '',
        logs: [],
        questions: [],
        answers: {},
        changedFiles: [],
        artifact: {
          name: step.artifact,
          content: `# Original ${step.name}\n\nRapport de l’agent.`,
          updatedAt: feature.updatedAt,
        },
        artifactVersions: [
          {
            revision: 0,
            author: 'agent',
            content: `# Original ${step.name}\n\nRapport de l’agent.`,
            at: feature.updatedAt,
          },
        ],
      },
    ];
  });
  state.features = [feature];
  return state;
}
async function open(page: Page, state = scenario(), preference = true) {
  await page.addInitScript(
    ({ data, enabled }) => {
      let saved: object = {
        view: 'dashboard',
        featureId: data.features[0].id,
        stepId: data.features[0].activeStepId,
        celebrationEnabled: enabled,
      };
      const messages: unknown[] = [];
      Object.assign(window, {
        testMessages: messages,
        testState: data,
        testSaved: () => saved,
        acquireVsCodeApi: () => ({
          getState: () => saved,
          setState: (value: object) => (saved = value),
          postMessage: (message: { type: string }) => {
            messages.push(message);
            if (message.type === 'ready')
              window.setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
          },
        }),
      });
    },
    { data: state, enabled: preference },
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: state.features[0].title, exact: true }),
  ).toBeVisible();
}
async function messages(page: Page, type: string) {
  return page.evaluate(
    (kind) =>
      (Reflect.get(window, 'testMessages') as ClientMessage[]).filter(
        (message) => message.type === kind,
      ),
    type,
  );
}
async function post(page: Page, message: object) {
  await page.evaluate((value) => window.postMessage(value, '*'), message);
}

test('correction previews dependent route and adjusted reports before emitting a versioned request', async ({
  page,
}, testInfo) => {
  const state = scenario(),
    feature = state.features[0],
    review = feature.steps.at(-1)!;
  review.attempts[0].review = {
    verdict: 'pass',
    summary: 'Un détail à préciser',
    findings: [
      { id: 'finding', severity: 'warning', message: 'Le raccourci doit rester visible.' },
    ],
  };
  await open(page, state);
  await page.getByRole('tab', { name: 'Relecture', exact: true }).click();
  await page.getByRole('button', { name: 'Demander une correction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Demander une correction' });
  await expect(dialog.getByLabel('Correction attendue')).toHaveValue(
    'Le raccourci doit rester visible.',
  );
  const build = feature.steps[2];
  await dialog
    .getByRole('checkbox', {
      name: `${build.name} ${state.agents.find((a) => a.id === build.agentId)?.nickname}`,
      exact: true,
    })
    .check();
  await expect(dialog.getByRole('list', { name: 'Étapes à rejouer' })).toContainText(build.name);
  await expect(dialog.getByRole('list', { name: 'Étapes à rejouer' })).toContainText(
    feature.steps[3].name,
  );
  await dialog.getByText('Inspecter et ajuster le contexte transmis', { exact: true }).click();
  await dialog.getByText(`${build.name} · compte rendu actuel`, { exact: true }).click();
  await dialog
    .getByLabel(`Copie transmise · ${build.name}`)
    .fill('Version du compte rendu ajustée pour la correction.');
  await dialog.getByText('Aperçu du contexte de correction', { exact: true }).click();
  await expect(dialog.locator('pre').last()).toContainText('Version du compte rendu ajustée');
  await page.screenshot({ path: testInfo.outputPath('correction.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Lancer la correction' }).click();
  await expect.poll(() => messages(page, 'requestCorrection')).toHaveLength(1);
  const message = (await messages(page, 'requestCorrection'))[0] as Extract<
    ClientMessage,
    { type: 'requestCorrection' }
  >;
  expect(message.expectedStateKey).toBe(featureStateKey(feature));
  expect(message.findingIds).toEqual(['finding']);
  expect(message.rootStepIds).toContain(build.id);
  expect(message.artifactContext?.[build.id]?.content).toBe(
    'Version du compte rendu ajustée pour la correction.',
  );
  await post(page, {
    type: 'correctionResult',
    featureId: feature.id,
    error: 'La session a changé.',
  });
  await expect(dialog.getByRole('alert')).toContainText('La session a changé.');
  await expect(dialog.getByLabel('Correction attendue')).toHaveValue(
    'Le raccourci doit rester visible.',
  );
});

test('report edits keep drafts on rejection and approve only the saved acknowledged revision', async ({
  page,
}, testInfo) => {
  const state = scenario(),
    feature = state.features[0],
    step = feature.steps.at(-1)!;
  await open(page, state);
  await page.getByRole('button', { name: 'Modifier le compte rendu' }).click();
  await page
    .getByRole('textbox', { name: 'Compte rendu modifié', exact: true })
    .fill('# Compte rendu relu par Matt');
  await page.getByLabel('Raison de la modification').fill('Précision de la conclusion');
  await page.getByRole('button', { name: 'Aperçu du compte rendu' }).click();
  await expect(page.getByRole('heading', { name: 'Compte rendu relu par Matt' })).toBeVisible();
  await page.getByRole('button', { name: 'Éditeur', exact: true }).click();
  await page.getByText('Original produit par l’agent', { exact: true }).click();
  await expect(page.getByRole('heading', { name: `Original ${step.name}` })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Étapes du parcours' }).getByRole('button').first(),
  ).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Enregistrer et valider' }).click();
  await expect.poll(() => messages(page, 'saveArtifact')).toHaveLength(1);
  expect((await messages(page, 'saveArtifact'))[0]).toMatchObject({
    expectedAttemptId: step.attempts[0].id,
    expectedRevision: 0,
    expectedStateKey: featureStateKey(feature),
    content: '# Compte rendu relu par Matt',
    reason: 'Précision de la conclusion',
  });
  expect(await messages(page, 'approveStep')).toHaveLength(0);
  await post(page, {
    type: 'artifactSaveResult',
    featureId: feature.id,
    stepId: step.id,
    error: 'Version modifiée ailleurs',
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Modification non enregistrée' }),
  ).toContainText('Version modifiée ailleurs');
  await expect(
    page.getByRole('textbox', { name: 'Compte rendu modifié', exact: true }),
  ).toHaveValue('# Compte rendu relu par Matt');
  await page.getByRole('button', { name: 'Enregistrer et valider' }).click();
  await post(page, {
    type: 'artifactSaveResult',
    featureId: feature.id,
    stepId: step.id,
    attemptId: step.attempts[0].id,
    revision: 1,
  });
  expect(await messages(page, 'approveStep')).toHaveLength(0);
  step.attempts[0].revision = 1;
  step.attempts[0].artifact!.content = '# Compte rendu relu par Matt';
  await post(page, { type: 'state', state });
  await expect.poll(() => messages(page, 'approveStep')).toHaveLength(1);
  expect((await messages(page, 'approveStep'))[0]).toMatchObject({
    expectedAttemptId: step.attempts[0].id,
    expectedRevision: 1,
  });
});

test('brief changes require replay from first roots and preserve edited report in correction context', async ({
  page,
}) => {
  const state = scenario(),
    feature = state.features[0],
    step = feature.steps.at(-1)!;
  await open(page, state);
  await page.getByRole('button', { name: 'Modifier le compte rendu' }).click();
  await page
    .getByRole('textbox', { name: 'Compte rendu modifié', exact: true })
    .fill('Conclusion corrigée');
  await page.getByText('Corriger le besoin initial', { exact: true }).click();
  await page.getByLabel('Besoin initial de la session').fill('Nouveau besoin confirmé');
  await expect(page.getByRole('button', { name: 'Enregistrer et valider' })).toBeDisabled();
  await page.getByRole('button', { name: 'Faire réviser par l’agent' }).click();
  await expect.poll(() => messages(page, 'saveArtifact')).toHaveLength(1);
  expect((await messages(page, 'saveArtifact'))[0]).toMatchObject({
    description: 'Nouveau besoin confirmé',
  });
  feature.description = 'Nouveau besoin confirmé';
  feature.descriptionRevision = 1;
  feature.steps.forEach((item) => (item.status = 'stale'));
  step.attempts[0].revision = 1;
  step.attempts[0].artifact!.content = 'Conclusion corrigée';
  await post(page, { type: 'state', state });
  await post(page, {
    type: 'artifactSaveResult',
    featureId: feature.id,
    stepId: step.id,
    attemptId: step.attempts[0].id,
    revision: 1,
  });
  const dialog = page.getByRole('dialog', { name: 'Demander une correction' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Étapes à rejouer' })).toContainText(
    feature.steps[0].name,
  );
  await expect(dialog.getByRole('button', { name: 'Lancer la correction' })).toBeEnabled();
  expect(await messages(page, 'approveStep')).toHaveLength(0);
});

test('final celebration waits for a successful acknowledgment and matching state, and reopening stays still', async ({
  page,
}, testInfo) => {
  const state = scenario(true),
    feature = state.features[0];
  await open(page, state);
  await expect(
    page.getByRole('heading', { name: 'Tout est prêt pour votre dernier regard' }),
  ).toBeVisible();
  await expect(page.locator('.celebration-confetti')).toHaveCount(0);
  await page.getByRole('button', { name: 'Valider définitivement' }).click();
  await expect.poll(() => messages(page, 'finalizeFeature')).toHaveLength(1);
  expect((await messages(page, 'finalizeFeature'))[0]).toMatchObject({
    expectedStateKey: featureStateKey(feature),
  });
  await post(page, {
    type: 'featureFinalizationResult',
    featureId: feature.id,
    finalizationId: 'final-1',
  });
  await expect(page.locator('.celebration-confetti')).toHaveCount(0);
  feature.status = 'completed';
  feature.finalValidation = {
    id: 'final-1',
    at: feature.updatedAt,
    stateKey: featureStateKey(feature),
    author: 'human',
  };
  await post(page, { type: 'state', state });
  await expect(page.getByRole('heading', { name: 'Parcours validé définitivement' })).toBeVisible();
  await expect(page.locator('.celebration-confetti')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('celebration.png'), fullPage: true });
  await page
    .locator('.final-panel')
    .screenshot({ path: testInfo.outputPath('celebration-card.png') });
  expect(await page.locator('.celebration-card').count()).toBe(
    new Set(feature.steps.map((s) => s.agentId)).size,
  );
  await page.getByLabel('Activer la célébration').uncheck();
  await expect(page.locator('.celebration-confetti')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'testSaved')().celebrationEnabled)).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Vos sessions', exact: true }).click();
  await page.getByRole('button', { name: `Ouvrir ${feature.title}`, exact: true }).click();
  await expect(page.getByLabel('Activer la célébration')).not.toBeChecked();
  await expect(page.locator('.celebration-confetti')).toHaveCount(0);
});

test('failed final validation never celebrates and reduced motion keeps approved portraits static', async ({
  page,
}) => {
  const state = scenario(true),
    feature = state.features[0];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, state);
  await page.getByRole('button', { name: 'Valider définitivement' }).click();
  await post(page, {
    type: 'featureFinalizationResult',
    featureId: feature.id,
    error: 'Un commentaire est encore bloquant.',
  });
  await expect(page.getByRole('alert')).toContainText('Un commentaire est encore bloquant.');
  await expect(page.locator('.celebration-confetti')).toHaveCount(0);
  await page.getByRole('button', { name: 'Valider définitivement' }).click();
  feature.status = 'completed';
  feature.finalValidation = {
    id: 'reduced-1',
    at: feature.updatedAt,
    stateKey: featureStateKey(feature),
    author: 'human',
  };
  await post(page, { type: 'state', state });
  await post(page, {
    type: 'featureFinalizationResult',
    featureId: feature.id,
    finalizationId: 'reduced-1',
  });
  await expect(
    page.locator('.celebration-portrait, .celebration-card img').first(),
  ).toHaveAttribute('src', /approved\.png$/);
  await expect(page.getByRole('button', { name: 'Rejouer la célébration' })).toBeDisabled();
  await expect(page.locator('.celebration-confetti')).toHaveCount(0);
});

test('correction and report editor remain usable at narrow viewport without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 850 });
  await open(page);
  await page.getByRole('button', { name: 'Modifier le compte rendu' }).click();
  await page
    .getByRole('textbox', { name: 'Compte rendu modifié', exact: true })
    .fill('Un brouillon accessible');
  await page.getByRole('button', { name: 'Aperçu du compte rendu' }).click();
  await expect(page.locator('.report-preview')).toContainText('Un brouillon accessible');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
