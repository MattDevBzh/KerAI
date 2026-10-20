import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import { avatarOptions } from '../src/shared/avatars';
import { featureStateKey } from '../src/shared/collaboration';
import type { ClientMessage, StudioState } from '../src/shared/types';

const toggle = (page: Page) => page.getByRole('checkbox', { name: 'Afficher le QG vivant' });
const qg = (page: Page) => page.getByRole('navigation', { name: 'QG de la session' });
const detail = (page: Page) => page.locator('.workbench-heading h2');
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'hqMessages') as ClientMessage[]);
async function hosted(
  page: Page,
  { enabled = true, state = structuredClone(demoState), theme = 'jardin-sombre' } = {},
) {
  state.runtime.state = 'ready';
  await page.addInitScript(
    ({ state, enabled, theme }) => {
      const recorded: ClientMessage[] = [];
      if (localStorage.getItem('hq-test-preference') === null)
        localStorage.setItem('hq-test-preference', String(enabled));
      const preference = () => localStorage.getItem('hq-test-preference') === 'true';
      Object.assign(window, {
        hqMessages: recorded,
        hqState: state,
        acquireVsCodeApi: () => ({
          getState: () =>
            JSON.parse(sessionStorage.getItem('hq-test-view') ?? 'null') ?? {
              view: 'sessions',
              navigationVersion: 2,
              featureId: state.features[0].id,
              stepId: state.features[0].activeStepId,
            },
          setState: (value: unknown) =>
            sessionStorage.setItem('hq-test-view', JSON.stringify(value)),
          postMessage(message: ClientMessage) {
            recorded.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'themeState', theme }, '*');
                window.postMessage({ type: 'zoomState', zoom: 100 }, '*');
                window.postMessage({ type: 'livingHqState', enabled: preference() }, '*');
              }, 0);
            if (message.type === 'setLivingHq' && !Reflect.get(window, 'dropHqReply'))
              setTimeout(() => {
                const rejected = Reflect.get(window, 'rejectHq');
                if (!rejected) localStorage.setItem('hq-test-preference', String(message.enabled));
                window.postMessage(
                  {
                    type: 'livingHqState',
                    enabled: preference(),
                    requestId: message.requestId,
                    error: rejected ? 'Réglages personnels en lecture seule.' : undefined,
                  },
                  '*',
                );
              }, 10);
          },
        }),
      });
    },
    { state, enabled, theme },
  );
  await page.goto('/');
  await expect(toggle(page)).toBeVisible();
  if (enabled) await expect(qg(page)).toBeVisible();
}

test('le QG conserve le choix facultatif et distingue un passage de la validation finale', async ({
  page,
}, testInfo) => {
  const state = structuredClone(demoState);
  const feature = state.features[0];
  feature.steps = [feature.steps[0]];
  const step = feature.steps[0];
  step.optional = true;
  step.status = 'pending';
  step.attempts = [];
  feature.activeStepId = step.id;
  feature.status = 'attention';
  feature.optionalRequest = {
    id: 'hq-optional-choice',
    stepId: step.id,
    stateKey: featureStateKey(feature),
  };
  await hosted(page, { state });
  await expect(qg(page)).toContainText('Choix facultatif attendu');
  await expect(qg(page)).toContainText('1 en attente de toi');
  await page
    .getByRole('region', { name: 'Décision facultative attendue' })
    .getByRole('button', { name: 'Passer et continuer' })
    .click();
  await expect
    .poll(async () => (await messages(page)).filter((m) => m.type === 'resolveOptionalStep'))
    .toHaveLength(1);
  step.status = 'skipped';
  step.optionalDecision = {
    id: 'hq-skipped',
    action: 'skip',
    at: feature.updatedAt,
    author: 'human',
  };
  delete feature.optionalRequest;
  feature.status = 'awaiting_final_validation';
  await page.evaluate((data) => window.postMessage({ type: 'state', state: data }, '*'), state);
  await expect(qg(page)).toContainText('Passée · non exécutée');
  await expect(qg(page).locator('.status-approved')).toHaveCount(0);
  await expect(qg(page).locator('img[src$="approved.png"]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Interventions passées' })).toBeVisible();
  await expect(page.getByText('0 validée · 1 passée / 1 intervention').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Valider définitivement', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('hq-optional-skipped.png'), fullPage: true });
  await toggle(page).uncheck();
  await expect(page.locator('.journey-step')).toContainText('Passée · non exécutée');
  expect((await messages(page)).some((m) => ['runStep', 'approveStep'].includes(m.type))).toBe(
    false,
  );
});

test('la case remplace uniquement la bande, conserve le détail et persiste entre les sessions et au rechargement', async ({
  page,
}) => {
  await hosted(page, { enabled: false });
  await expect(page.locator('.journey')).toBeVisible();
  await expect(detail(page)).toHaveText('Conception');
  await toggle(page).check();
  await expect(qg(page)).toBeVisible();
  await expect(page.locator('.journey')).toHaveCount(0);
  await expect(detail(page)).toHaveText('Conception');
  await qg(page)
    .getByRole('button', { name: /Étape 3 · Développement/ })
    .click();
  await expect(detail(page)).toHaveText('Développement');
  await expect(qg(page).getByRole('button', { name: /Étape 3/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await toggle(page).uncheck();
  await expect(qg(page)).toHaveCount(0);
  await expect(page.locator('.journey-step.current')).toContainText('Développement');
  await expect(detail(page)).toHaveText('Développement');
  await toggle(page).check();
  await expect(toggle(page)).toBeEnabled();
  await page.reload();
  await expect(qg(page)).toBeVisible();
  await expect(detail(page)).toHaveText('Développement');
  await page.getByRole('button', { name: 'Vos sessions', exact: true }).click();
  await page
    .getByRole('button', { name: 'Ouvrir Un premier pas plus accueillant', exact: true })
    .click();
  await expect(qg(page)).toBeVisible();
  expect(
    (await messages(page)).some((m) =>
      ['runStep', 'approveStep', 'finalizeFeature', 'saveSettings'].includes(m.type),
    ),
  ).toBe(false);
});

test('un brouillon reste intact lors du changement de vue et empêche de sélectionner un autre poste', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Modifier le compte rendu' }).click();
  const report = page.getByRole('textbox', { name: 'Compte rendu modifié', exact: true });
  await report.fill('Mon brouillon non enregistré');
  await expect(qg(page).getByRole('button').first()).toBeDisabled();
  await toggle(page).uncheck();
  await expect(report).toHaveValue('Mon brouillon non enregistré');
  await expect(page.locator('.journey-step').first()).toBeDisabled();
  await toggle(page).check();
  await expect(report).toHaveValue('Mon brouillon non enregistré');
  await expect(qg(page).getByRole('button').first()).toBeDisabled();
  expect(
    (await messages(page)).some((m) => ['saveArtifact', 'runStep', 'approveStep'].includes(m.type)),
  ).toBe(false);
});

test('les états viennent du moteur, une question humaine suspend l’animation et le clic reste consultatif', async ({
  page,
}) => {
  await hosted(page);
  await page.evaluate(() => {
    const state = Reflect.get(window, 'hqState') as StudioState;
    const feature = state.features[0];
    feature.status = 'running';
    feature.steps[1].status = 'approved';
    feature.steps[2].status = 'running';
    feature.activeStepId = feature.steps[2].id;
    window.postMessage({ type: 'state', state }, '*');
  });
  const developer = qg(page).getByRole('button', { name: /Étape 3/ });
  await expect(developer).toContainText('Au travail');
  await expect(developer.locator('img')).toHaveAttribute('src', /working\.gif$/);
  await page.evaluate(() => {
    const state = Reflect.get(window, 'hqState') as StudioState;
    state.humanRequests = [
      {
        id: 'question',
        featureId: state.features[0].id,
        stepId: 'build',
        kind: 'question',
        question: 'Quelle cible ?',
        allowFreeform: true,
      },
    ];
    window.postMessage({ type: 'state', state }, '*');
  });
  await expect(developer).toContainText('Attend ta réponse');
  await expect(developer.locator('img')).toHaveAttribute('src', /idle\.png$/);
  await page.evaluate(() => {
    const state = Reflect.get(window, 'hqState') as StudioState;
    state.humanRequests = [];
    state.features[0].steps[2].status = 'failed';
    window.postMessage({ type: 'state', state }, '*');
  });
  await expect(developer).toContainText('En échec');
  await developer.click();
  await expect(detail(page)).toHaveText('Développement');
  expect((await messages(page)).some((m) => m.type === 'runStep')).toBe(false);
});

test('un refus de sauvegarde ou une absence de réponse conserve la préférence confirmée', async ({
  page,
}) => {
  await hosted(page, { enabled: false });
  await page.evaluate(() => Reflect.set(window, 'rejectHq', true));
  // A rejected change can be rolled back before check() observes its transient state.
  await toggle(page).click();
  await expect(page.getByRole('alert')).toContainText('lecture seule');
  await expect(toggle(page)).not.toBeChecked();
  await expect(qg(page)).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.set(window, 'rejectHq', false);
    Reflect.set(window, 'dropHqReply', true);
  });
  await page.clock.install();
  await toggle(page).check();
  await expect(toggle(page)).toBeDisabled();
  await page.clock.fastForward(16000);
  await expect(toggle(page)).not.toBeChecked();
  await expect(page.getByRole('alert')).toContainText('n’a pas confirmé');
});

test('les vingt avatars, les agents répétés et les profils supprimés gardent leurs postes', async ({
  page,
}) => {
  const state = structuredClone(demoState);
  state.agents = avatarOptions.map(({ id, name }) => ({
    ...state.agents[0],
    id,
    avatar: id,
    name,
    nickname: name,
  }));
  const feature = state.features[0];
  feature.steps = [
    ...state.agents,
    state.agents[0],
    { ...state.agents[0], id: 'removed-agent' },
  ].map((agent, i) => ({
    ...feature.steps[0],
    id: `step-${i}`,
    name: `Intervention ${i + 1}`,
    agentId: agent.id,
    dependsOn: [],
    status: 'pending',
    attempts: [],
  }));
  feature.activeStepId = feature.steps[0].id;
  await hosted(page, { state });
  await expect(qg(page).getByRole('button')).toHaveCount(22);
  for (const avatar of avatarOptions)
    await expect(qg(page).locator(`img[src*="/avatars/${avatar.id}/"]`).first()).toBeVisible();
  await qg(page)
    .getByRole('button', { name: /Étape 21 ·/ })
    .click();
  await expect(detail(page)).toHaveText('Intervention 21');
  await qg(page)
    .getByRole('button', { name: /Étape 22 ·/ })
    .click();
  await expect(detail(page)).toHaveText('Intervention 22');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('sans équipe, la case ne fabrique aucun poste et la composition reste disponible', async ({
  page,
}) => {
  const state = structuredClone(demoState);
  state.features[0].steps = [];
  state.features[0].activeStepId = '';
  state.features[0].status = 'draft';
  await hosted(page, { enabled: false, state });
  await toggle(page).check();
  await expect(qg(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Composer mon équipe', exact: true }),
  ).toBeEnabled();
});

for (const [width, theme] of [
  [1440, 'jardin-sombre'],
  [1100, 'papier-clair'],
  [390, 'halloween'],
] as const)
  test(`QG et détail lisibles à ${width}px, ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    await hosted(page, { theme });
    await expect(qg(page).getByRole('button')).toHaveCount(5);
    const images = qg(page).locator('img');
    await expect
      .poll(() =>
        images.evaluateAll((items) =>
          items.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await qg(page)
      .getByRole('button', { name: /Étape 4 · Tests/ })
      .click();
    await expect(detail(page)).toHaveText('Tests');
    await qg(page).screenshot({ path: testInfo.outputPath('qg.png') });
    await page.locator('.feature-page').screenshot({ path: testInfo.outputPath('session.png') });
    if (theme === 'halloween')
      await expect(qg(page).locator('img[src*="/avatar-events/halloween/"]')).toHaveCount(5);
  });

test('la réduction des animations et le contraste élevé restent prioritaires', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  const state = structuredClone(demoState);
  state.features[0].steps[1].status = 'running';
  await hosted(page, { state });
  await expect(qg(page).locator('.hq-backdrop')).not.toBeVisible();
  await expect(qg(page).locator('img[src$="working.gif"]')).toHaveCount(0);
  await expect(qg(page).locator('.hq-lamp').first()).toHaveCSS('animation-name', 'none');
  const station = qg(page).getByRole('button', { name: /Étape 4/ });
  await station.focus();
  await page.keyboard.press('Enter');
  await expect(station).toHaveAttribute('aria-current', 'step');
  await expect(detail(page)).toHaveText('Tests');
});
