import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';

async function hosted(page: Page, configured = false) {
  const state: StudioState = structuredClone(demoState);
  state.runtime = { state: 'ready', authenticated: true, models: [] };
  const feature = state.features[0];
  if (configured)
    feature.autopilot = {
      checkpoints: ['review'],
      maxRuns: 8,
      runs: 2,
      maxCorrectionCycles: 1,
      correctionCycles: 0,
      stepInputs: {},
      status: 'paused',
      reason: 'Validation humaine requise.',
      updatedAt: new Date().toISOString(),
      decisions: [
        {
          at: new Date().toISOString(),
          kind: 'pause',
          stepId: 'design',
          message: 'Relire le résultat.',
          runs: 2,
          correctionCycles: 0,
        },
      ],
    };
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      testMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState: () => {},
        postMessage: (message: ClientMessage) => {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
  await page
    .locator('.session-row')
    .first()
    .getByRole('button', { name: /^Ouvrir / })
    .click();
  await page.getByText('Pilotage automatique et budget', { exact: true }).click();
  return state;
}
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'testMessages') as ClientMessage[]);

for (const width of [1440, 390]) {
  test(`correction loop compares observations and renews only with human acknowledgement at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1400 });
    const state = await hosted(page, true);
    const feature = state.features[0];
    feature.criteria = [
      {
        id: 'criterion',
        text: 'Conserver la saisie après une erreur',
        status: 'pending',
        evidence: '',
      },
    ];
    feature.autopilot!.correctionLoop = { maxStagnantCycles: 1 };
    feature.autopilot!.correctionLoopState = {
      contract: {
        id: 'contract-1',
        createdAt: '2026-10-28T09:00:00Z',
        fingerprint: 'fixture',
        workflowFingerprint: 'fixture-workflow',
        description: 'Fiabiliser le formulaire',
        criteria: [{ id: 'criterion', text: 'Conserver la saisie après une erreur' }],
        commands: [],
      },
      stagnantCycles: 1,
      readiness: 'issues',
      pause: 'stagnation',
      observations: [
        {
          id: 'obs-1',
          stepId: 'review',
          attemptId: 'old-attempt',
          evidenceIds: [],
          checkKey: 'review',
          kind: 'review',
          problems: [
            { key: 'lost', message: 'La saisie est perdue' },
            { key: 'focus', message: 'Le focus est perdu' },
          ],
          resolved: [],
          persistent: [],
          introduced: ['lost', 'focus'],
          stagnantCycles: 0,
        },
        {
          id: 'obs-2',
          stepId: 'review',
          attemptId: 'new-attempt',
          evidenceIds: [],
          checkKey: 'review',
          kind: 'review',
          problems: [
            { key: 'focus', message: 'Le focus est perdu' },
            { key: 'error', message: 'L’erreur reste invisible' },
          ],
          resolved: ['lost'],
          persistent: ['focus'],
          introduced: ['error'],
          stagnantCycles: 1,
        },
      ],
    };
    await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
    const panel = page.getByRole('region', { name: 'Suivi de la boucle de correction' });
    await expect(panel).toContainText('Intervention humaine nécessaire');
    await expect(panel).toContainText('Ce suivi ne vaut pas validation finale');
    const observation = panel.locator('.correction-loop-observations > li').nth(1);
    await expect(observation).toContainText('1 nouveau');
    await expect(observation).toContainText('1 persistant');
    await expect(observation).toContainText('1 résolu');
    await observation.getByText('Problèmes résolus · 1', { exact: true }).click();
    await expect(observation).toContainText('La saisie est perdue');
    await panel.getByText('Lire le contrat de cette boucle', { exact: true }).click();
    await expect(panel).toContainText('Fiabiliser le formulaire');
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await panel.screenshot({ path: `test-results/loop-preview-${width}.png` });
    await panel.getByRole('button', { name: 'Démarrer une nouvelle boucle' }).click();
    const dialog = page.getByRole('dialog', { name: 'Démarrer une nouvelle boucle' });
    await expect(dialog).toContainText('2 / 8 exécutions');
    await expect(dialog).toContainText('sans lancer d’agent');
    expect((await messages(page)).some((message) => message.type === 'renewCorrectionLoop')).toBe(
      false,
    );
    await dialog.getByRole('button', { name: 'Confirmer le nouveau contrat' }).click();
    const renewal = (await messages(page)).at(-1) as Extract<
      ClientMessage,
      { type: 'renewCorrectionLoop' }
    >;
    expect(renewal.type).toBe('renewCorrectionLoop');
    expect(renewal.expectedContractId).toBe('contract-1');
    expect(renewal.expectedStateKey).toBeTruthy();
    await expect(dialog.getByRole('button', { name: 'Création du contrat…' })).toBeDisabled();
    await page.evaluate(
      (requestId) =>
        window.postMessage(
          {
            type: 'correctionLoopRenewed',
            requestId,
            error: 'Le cadre a changé. Relis les critères.',
          },
          '*',
        ),
      renewal.requestId,
    );
    await expect(dialog.getByRole('alert')).toContainText('Le cadre a changé.');
    await dialog.getByRole('button', { name: 'Confirmer le nouveau contrat' }).click();
    const retry = (await messages(page)).at(-1) as typeof renewal;
    await page.evaluate(
      (requestId) => window.postMessage({ type: 'correctionLoopRenewed', requestId }, '*'),
      retry.requestId,
    );
    await expect(dialog).toHaveCount(0);
    expect((await messages(page)).some((message) => message.type === 'startAutopilot')).toBe(false);
  });
}

test('progress tracking is opt-in and preserves checkpoints and model configuration', async ({
  page,
}) => {
  await hosted(page);
  await page.locator('.autopilot-bar').getByRole('button', { name: 'Configurer' }).click();
  await page.getByLabel('Cycles de correction maximum').fill('3');
  await page.getByLabel('Étape qui relit les changements').selectOption('review');
  await page.getByLabel('Étape qui applique les corrections').selectOption('design');
  const tracking = page.getByRole('checkbox', { name: 'Suivre les progrès de la boucle' });
  await expect(tracking).not.toBeChecked();
  await tracking.check();
  await expect(
    page.getByLabel('Arrêter après ce nombre de cycles comparables sans progrès'),
  ).toHaveValue('2');
  await page.getByRole('button', { name: 'Enregistrer l’autopilot' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveAutopilot' }>;
  expect(saved.config.correctionLoop).toEqual({ maxStagnantCycles: 2 });
  expect(saved.config.checkpoints).toContain('review');
  expect(Object.values(saved.config.stepInputs).every((input) => !('model' in input))).toBe(true);
});

test('first start previews current criteria and ready observations retain final human validation', async ({
  page,
}) => {
  const state = await hosted(page, true);
  const feature = state.features[0];
  feature.criteria = [
    { id: 'criterion', text: 'Le résultat reste vérifiable', status: 'pending', evidence: '' },
  ];
  feature.autopilot!.correctionLoop = { maxStagnantCycles: 2 };
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
  const panel = page.getByRole('region', { name: 'Suivi de la boucle de correction' });
  await expect(panel).toContainText('Les critères seront figés au démarrage');
  await panel.getByText('Voir le cadre du prochain démarrage', { exact: true }).click();
  await expect(panel).toContainText('Le résultat reste vérifiable');
  await expect(panel.getByRole('button', { name: 'Démarrer une nouvelle boucle' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reprendre l’autopilot' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confier la suite à l’autopilot ?' });
  await expect(dialog).toContainText('Les critères seront figés au démarrage');
  await expect(dialog).toContainText('Le résultat reste vérifiable');
  await dialog.getByRole('button', { name: 'Revenir', exact: true }).click();
  feature.autopilot!.correctionLoopState = {
    contract: {
      id: 'ready-contract',
      createdAt: '2026-10-28T09:00:00Z',
      fingerprint: 'fixture',
      workflowFingerprint: 'fixture-workflow',
      description: feature.description,
      criteria: feature.criteria,
      commands: [],
    },
    stagnantCycles: 0,
    readiness: 'ready_for_human',
    observations: [],
  };
  feature.autopilot!.correctionLoopHistory = [
    structuredClone(feature.autopilot!.correctionLoopState),
  ];
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
  await expect(panel).toContainText('Prête pour ta revue');
  await expect(panel).toContainText('Ce suivi ne vaut pas validation finale');
  await panel.getByText('Boucles précédentes · 1', { exact: true }).click();
  await panel.getByText('Boucle précédente 1', { exact: true }).click();
  await expect(panel).toContainText('Critères figés');
  expect(
    (await messages(page)).some(
      (message) => message.type === 'finalizeFeature' || message.type === 'startAutopilot',
    ),
  ).toBe(false);
});

test('full observation history explains the limit and requires explicit human renewal', async ({
  page,
}) => {
  const state = await hosted(page, true);
  const feature = state.features[0];
  feature.criteria = [
    { id: 'criterion', text: 'Conserver les preuves', status: 'pending', evidence: '' },
  ];
  feature.autopilot!.correctionLoop = { maxStagnantCycles: 2 };
  feature.autopilot!.correctionLoopState = {
    contract: {
      id: 'full-contract',
      createdAt: '2026-10-28T09:00:00Z',
      fingerprint: 'fixture',
      workflowFingerprint: 'fixture-workflow',
      description: 'Vérifier les corrections',
      criteria: feature.criteria,
      commands: [],
    },
    stagnantCycles: 0,
    readiness: 'unverified',
    pause: 'history_limit',
    observations: Array.from({ length: 80 }, (_, index) => ({
      id: `obs-${index}`,
      stepId: 'review',
      attemptId: `attempt-${index}`,
      evidenceIds: [],
      checkKey: 'review',
      kind: 'review' as const,
      problems: [],
      introduced: [],
      persistent: [],
      resolved: [],
      stagnantCycles: 0,
    })),
  };
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
  const panel = page.getByRole('region', { name: 'Suivi de la boucle de correction' });
  await expect(panel.getByRole('status')).toHaveText(
    'Limite de 80 observations atteinte. Relis le bilan et renouvelle le contrat pour poursuivre.',
  );
  await expect(panel).toContainText('Observations et progrès · 80');
  await expect(panel.getByRole('button', { name: 'Démarrer une nouvelle boucle' })).toBeEnabled();
  expect((await messages(page)).some((message) => message.type === 'renewCorrectionLoop')).toBe(
    false,
  );
});
