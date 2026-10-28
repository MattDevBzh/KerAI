import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, SessionObservation, StudioState } from '../src/shared/types';
import { featureStateKey } from '../src/shared/collaboration';

function scenario(): StudioState {
  const state = structuredClone(demoState);
  state.runtime = {
    state: 'ready',
    authenticated: true,
    models: [{ id: 'fixture-model', name: 'Modèle disponible' }],
  };
  state.features = [state.features[0]];
  const feature = state.features[0];
  feature.autopilot = undefined;
  feature.steps = feature.steps.slice(0, 2);
  feature.steps.forEach((s) => {
    s.status = 'approved';
    s.attempts.forEach((a) => {
      a.status = 'approved';
    });
  });
  const analysis = {
    summary: 'Le contexte transmis a permis de produire un résultat cohérent.',
    strengths: ['Le besoin était précis.'],
    findings: [
      {
        kind: 'recommendation' as const,
        title: 'Préciser les preuves attendues',
        detail: 'Ajouter les critères de validation avant le lancement de cette phase.',
        impact: 'high' as const,
        references: ['source-one'],
      },
    ],
  };
  const report: SessionObservation = {
    id: 'review-one',
    createdAt: '2026-10-14T18:00:00Z',
    finishedAt: '2026-10-14T18:01:30Z',
    status: 'completed',
    featureTitle: feature.title,
    snapshotKey: 'snapshot',
    snapshotStateKey: featureStateKey(feature),
    requestedModel: 'fixture-model',
    maxCalls: 20,
    coverage: { complete: true, warnings: [], analyzedParts: 2, totalParts: 2 },
    phases: feature.steps.map((s) => ({
      stepId: s.id,
      name: s.name,
      agent: 'Agent de phase',
      status: s.status,
      attempts: 2,
      durationMs: 30000,
      usage: {
        source: 'measured',
        inputTokens: 1000,
        outputTokens: 200,
        cost: 500000000,
        unit: 'nano-AIU',
        byModel: { 'Modèle de phase': { inputTokens: 1000, outputTokens: 200, cost: 500000000 } },
      },
      models: ['Modèle de phase'],
      analyzedParts: 1,
      totalParts: 1,
      analyses: [analysis],
    })),
    calls: [
      {
        id: 'call-one',
        startedAt: '2026-10-14T18:00:00Z',
        finishedAt: '2026-10-14T18:01:30Z',
        status: 'completed',
        model: 'Modèle réellement utilisé',
        usage: {
          source: 'measured',
          inputTokens: 4000,
          outputTokens: 800,
          cost: 200000000,
          unit: 'nano-AIU',
          byModel: {
            'Modèle réellement utilisé': { inputTokens: 3000, outputTokens: 600, cost: 100000000 },
            'Autre modèle observé': { inputTokens: 1000, outputTokens: 200, cost: 100000000 },
          },
        },
      },
    ],
    global: {
      ...analysis,
      summary: 'La priorité consiste à rendre les validations plus explicites.',
    },
    sourceIndex: [{ id: 'source-one', label: 'Échange de cadrage' }],
  };
  feature.observations = [report];
  return state;
}
async function hosted(page: Page, state = scenario()) {
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      observerMessages: messages,
      observerState: data,
      acquireVsCodeApi: () => ({
        getState: () => ({ view: 'dashboard', featureId: data.features[0].id }),
        setState: () => {},
        postMessage: (message: ClientMessage) => {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
          if (message.type === 'sessionStorage')
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'sessionStorage',
                    requestId: message.requestId,
                    storage: {
                      bytes: 10485760,
                      sharedBytes: 2097152,
                      traces: { bytes: 8388608, records: 4500, complete: true },
                      traceLimitBytes: 268435456,
                    },
                  },
                  '*',
                ),
              0,
            );
          if (message.type === 'previewObservation')
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'observationPreview',
                    requestId: message.requestId,
                    preview: {
                      featureId: message.featureId,
                      fingerprint: 'a'.repeat(64),
                      phases: 2,
                      parts: 3,
                      characters: 12000,
                      warnings: [],
                      options: message.options,
                    },
                  },
                  '*',
                ),
              0,
            );
          if (message.type === 'observationSource')
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'observationSource',
                    requestId: message.requestId,
                    label: 'Échange de cadrage',
                    content: 'Preuve exacte : le critère attendu était absent.',
                  },
                  '*',
                ),
              0,
            );
        },
      }),
    });
  }, state);
  await page.goto('/');
  await page.locator('summary').filter({ hasText: 'outils de la session' }).click();
  await page.getByRole('button', { name: 'Analyser cette session', exact: true }).click();
}
test('observateur : rapport par phase, modèles et coûts, sources et exports', async ({
  page,
}, testInfo) => {
  await hosted(page);
  const panel = page.getByRole('region', { name: 'Observateur de session' });
  await expect(panel).toContainText('4 500 événements');
  await expect(
    panel.getByRole('heading', { name: 'Commentaires globaux et améliorations prioritaires' }),
  ).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Bilan de l’Observateur' })).toBeVisible();
  await expect(panel).toContainText('Modèle réellement utilisé');
  await expect(panel).toContainText('Autre modèle observé');
  await expect(panel).toContainText('Modèle demandé : fixture-model');
  await expect(panel).toContainText('0,2 crédits');
  await panel.getByRole('button', { name: 'Voir la preuve 1' }).first().click();
  await expect(panel.getByRole('region', { name: 'Preuve de l’analyse' })).toContainText(
    'Preuve exacte',
  );
  await panel.getByRole('button', { name: 'Exporter en HTML' }).click();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, 'observerMessages') as ClientMessage[]).some(
        (m) => m.type === 'exportObservation' && m.format === 'html',
      ),
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('observateur-desktop.png'), fullPage: true });
});
test('observateur : préparation gratuite et lancement lié au modèle, budget et aperçu', async ({
  page,
}) => {
  await hosted(page);
  const panel = page.getByRole('region', { name: 'Observateur de session' });
  await panel.getByLabel('Budget en crédits (facultatif)').fill('2');
  await panel.getByRole('button', { name: 'Préparer l’analyse' }).click();
  await expect(panel).toContainText('au moins 3 appels');
  await panel.getByRole('button', { name: 'Lancer l’Observateur' }).click();
  const message = await page.evaluate(() =>
    (Reflect.get(window, 'observerMessages') as ClientMessage[]).find(
      (m) => m.type === 'runObservation',
    ),
  );
  expect(message).toMatchObject({
    fingerprint: 'a'.repeat(64),
    options: { model: 'fixture-model', maxCalls: 40, maxNanoAiu: 2000000000 },
  });
});
test('observateur : suppression explicite et retour après confirmation hôte', async ({ page }) => {
  await hosted(page);
  const panel = page.getByRole('region', { name: 'Observateur de session' });
  await panel.getByRole('button', { name: 'Supprimer définitivement la session' }).click();
  const id = await page.evaluate(() => {
    const messages = Reflect.get(window, 'observerMessages') as ClientMessage[];
    return messages.find((m) => m.type === 'deleteFeature' && 'featureId' in m)?.featureId;
  });
  expect(id).toBeTruthy();
  await page.evaluate(
    (featureId) =>
      window.postMessage({ type: 'deleteFeatureResult', featureId, freedBytes: 10485760 }, '*'),
    id,
  );
  await expect(page.getByRole('region', { name: 'Observateur de session' })).toHaveCount(0);
  await expect(page.getByText('Session supprimée · 10 Mio libérés.')).toBeVisible();
});
test('observateur : petit écran, revue partielle et session modifiée', async ({
  page,
}, testInfo) => {
  const state = scenario(),
    review = state.features[0].observations![0];
  review.status = 'cancelled';
  review.coverage.complete = false;
  review.coverage.warnings = ['Historique ancien incomplet.'];
  review.phases[1].analyzedParts = 0;
  state.features[0].description = 'Besoin changé depuis la revue';
  await page.setViewportSize({ width: 390, height: 844 });
  await hosted(page, state);
  const panel = page.getByRole('region', { name: 'Observateur de session' });
  await expect(panel).toContainText('Cette session a évolué');
  await expect(panel).toContainText('Historique ancien incomplet');
  await expect(panel).toContainText('Analyse annulée');
  await panel.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('observateur-mobile.png'), fullPage: true });
});

function scanningScenario() {
  const state = scenario();
  const review = state.features[0].observations![0];
  review.status = 'running';
  review.finishedAt = undefined;
  review.global = undefined;
  review.coverage.analyzedParts = 1;
  review.phases[1].analyzedParts = 0;
  review.calls[0].status = 'running';
  review.calls[0].phaseId = review.phases[1].stepId;
  return state;
}

test('scan : progression réelle, synthèse et arrêt, même avec le rapport fermé', async ({
  page,
}, testInfo) => {
  const state = scanningScenario();
  await hosted(page, state);
  const scan = page.getByRole('region', { name: 'Scan de l’Observateur' });
  await expect(scan).toContainText(`Analyse de la phase : ${state.features[0].steps[1].name}`);
  await expect(scan.getByRole('progressbar')).toHaveAttribute('value', '1');
  await expect(scan.locator('.pixel-avatar img')).toHaveAttribute('src', /working.gif$/);
  await page
    .getByRole('region', { name: 'Observateur de session' })
    .getByRole('button', { name: 'Fermer' })
    .click();
  await expect(scan).toBeVisible();
  await scan.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('scan-desktop.png'), fullPage: false });
  const review = state.features[0].observations![0];
  review.coverage.analyzedParts = 2;
  review.phases[1].analyzedParts = 1;
  review.calls[0].phaseId = undefined;
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
  await expect(scan.getByRole('status')).toHaveText('Synthèse des observations');
  await expect(scan).toBeVisible();
  await scan.getByRole('button', { name: 'Arrêter le scan' }).click();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, 'observerMessages') as ClientMessage[]).some(
        (m) => m.type === 'cancelObservation',
      ),
    ),
  ).toBe(true);
  for (const status of ['completed', 'cancelled', 'failed', 'interrupted'] as const) {
    review.status = status;
    await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
    await expect(scan).toHaveCount(0);
  }
});

test('scan : mouvements réduits et écran compact', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await hosted(page, scanningScenario());
  const scan = page.getByRole('region', { name: 'Scan de l’Observateur' });
  await expect(scan.locator('.pixel-avatar img')).toHaveAttribute('src', /idle.png$/);
  await expect(scan.locator('.observation-scan-document > span')).toHaveCSS(
    'animation-name',
    'none',
  );
  await expect(scan).toContainText('1 / 2 parties examinées');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await scan.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('scan-mobile.png') });
});
