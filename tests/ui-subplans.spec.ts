import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { demoState } from '../webview/demo';
import { newSubplanStep } from '../src/shared/subplans';
import { WorkflowEngine } from '../src/core/workflow';
import { acceptSubplan } from '../src/core/subplans';
import { createPair } from '../src/core/pair';
import { defaultPairPreferences } from '../src/shared/pair';
import { emptyLaunch } from '../src/core/context';
import { agentStep } from '../src/shared/team';
import type { ClientMessage, Feature, StudioState } from '../src/shared/types';
import { navigate } from './ui-navigation-helpers';

function scenario(nested = false) {
  const state = structuredClone(demoState);
  state.agents.push({
    ...state.agents[0],
    id: 'fs-orchestrator',
    name: 'Orchestrateur',
    nickname: '',
    skills: [],
  });
  const engine = new WorkflowEngine();
  const root = engine.createFeature(undefined, {
    title: 'Navigation des filtres',
    description: 'Développer les filtres de recherche avec une validation à chaque étape.',
  });
  state.features = [root];
  root.execution = { mode: 'copilot-native', permissionMode: 'manual' };
  state.runtime = {
    state: 'ready',
    authenticated: true,
    models: [],
    native: {
      available: true,
      tools: ['view', 'edit', 'bash'],
      permissionModes: ['manual', 'allow-all'],
    },
  };
  const card = newSubplanStep();
  card.name = 'Construire les filtres';
  card.subplan = {
    mode: 'pair',
    teamName: 'Conception et développement',
    steps: [agentStep(state.agents[0])],
  };
  root.steps = [{ ...card, status: 'pending', attempts: [] }];
  root.activeStepId = card.id;
  if (nested) {
    const inner = newSubplanStep();
    inner.name = 'Détailler chaque filtre';
    inner.subplan = {
      mode: 'pair',
      teamName: 'Équipe de réalisation',
      steps: [agentStep(state.agents[0])],
    };
    root.steps[0].subplan!.steps = [inner];
    const plan = (f: Feature) => {
      const step = f.steps[0],
        a = engine.beginRun(f.id, step.id);
      a.pair = createPair({
        feature: f,
        step,
        attempt: a,
        agent: state.agents.at(-1)!,
        skills: [],
        workspacePath: state.workspace.path,
        settings: state.settings,
        launch: { ...emptyLaunch(), pair: defaultPairPreferences },
        preparedPrompt: 'Découper la mission',
      });
      a.pair.plans = [
        {
          revision: 1,
          summary: 'Deux tâches concrètes et vérifiables',
          blocks: [
            {
              id: 'keyboard',
              title: 'Navigation au clavier',
              description: 'Conserver le focus et les raccourcis.',
            },
            {
              id: 'filters',
              title: 'Filtres combinés',
              description: 'Composer les filtres sans perdre le contexte.',
            },
          ],
        },
      ];
      a.pair.messages = [
        {
          id: 'intro',
          role: 'assistant',
          at: new Date().toISOString(),
          status: 'complete',
          content:
            'Je propose de traiter la navigation, puis les filtres combinés. Chaque tâche aura sa propre sous-équipe.',
        },
      ];
      a.status = step.status = 'waiting_input';
      acceptSubplan(f, step, state.agents);
      engine.refreshFeatureStatus(f.id);
      return step.subplanState!.iterations;
    };
    const iterations = plan(root);
    iterations[0].feature.status = 'completed';
    plan(iterations[1].feature);
  }
  return state;
}
async function open(page: Page, state: StudioState, theme = 'papier-sombre') {
  await page.addInitScript(
    ({ initial, theme }) => {
      let view: unknown = {
        navigationVersion: 2,
        view: 'sessions',
        featureId: initial.features[0].id,
      };
      const messages: ClientMessage[] = [];
      const publish = () => window.postMessage({ type: 'state', state: initial }, '*');
      Object.assign(window, {
        subplanState: initial,
        subplanMessages: messages,
        acquireVsCodeApi: () => ({
          getState: () => view,
          setState: (next: unknown) => {
            view = next;
          },
          postMessage: (m: ClientMessage) => {
            messages.push(m);
            if (m.type === 'ready')
              setTimeout(() => {
                publish();
                window.postMessage({ type: 'themeState', theme }, '*');
              }, 0);
            if (m.type === 'setLivingHq')
              window.postMessage(
                { type: 'livingHqState', enabled: m.enabled, requestId: m.requestId },
                '*',
              );
            if (m.type === 'saveFeatureTeam') {
              const f = initial.features[0];
              f.steps = m.steps.map((s) => ({ ...s, status: 'pending', attempts: [] }));
              f.teamRevision = m.expectedRevision + 1;
              f.activeStepId = f.steps[0]?.id ?? '';
              publish();
              window.postMessage(
                {
                  type: 'featureTeamResult',
                  featureId: f.id,
                  requestId: m.requestId,
                  revision: f.teamRevision,
                },
                '*',
              );
            }
          },
        }),
      });
    },
    { initial: state, theme },
  );
  await page.goto('/');
}
test('configures nested cards in the same composer and saves incomplete cards with a launch warning', async ({
  page,
}) => {
  const state = scenario();
  state.features[0].steps = [];
  state.features[0].activeStepId = '';
  await open(page, state);
  await page.getByRole('button', { name: 'Composer mon équipe', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter un sous-plan', exact: true }).click();
  await expect(page.getByText('Sous-équipe à configurer · lancement bloqué')).toBeVisible();
  await page.getByLabel('Organisation par défaut').selectOption('automatic');
  await page.getByRole('button', { name: 'Choisir une équipe', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Sous-équipe de Sous-plan', exact: true });
  await panel.getByRole('button', { name: 'Ajouter un sous-plan', exact: true }).click();
  await panel.getByLabel('Équipe à utiliser').selectOption('code-review');
  await panel.getByRole('button', { name: 'Valider l’équipe', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Valider l’équipe', exact: true }).click();
  const saved = await page.evaluate(() =>
    Reflect.get(window, 'subplanMessages').find((m: ClientMessage) => m.type === 'saveFeatureTeam'),
  );
  expect(saved.steps[0].subplan.mode).toBe('automatic');
  expect(saved.steps[0].subplan.steps[0].subplan.steps).toHaveLength(1);
  expect(saved.steps[0].agentId).toBe('fs-orchestrator');
  expect(
    (await page.evaluate(() => Reflect.get(window, 'subplanMessages'))).some(
      (m: ClientMessage) => m.type === 'runStep',
    ),
  ).toBe(false);
});
test('navigates arbitrary levels and historical iterations without changing execution', async ({
  page,
}) => {
  await open(page, scenario(true));
  await page.locator('.journey-step').filter({ hasText: 'Construire les filtres' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Filtres combinés' })).toBeVisible();
  await expect(page.getByLabel('Itération de la sous-équipe')).toContainText(
    '1 · Navigation au clavier · Validée',
  );
  await page.locator('.journey-step').filter({ hasText: 'Détailler chaque filtre' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation des sous-équipes' })).toContainText(
    'Navigation des filtres',
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Navigation au clavier' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Niveau précédent', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Filtres combinés' })).toBeVisible();
  const select = page.getByLabel('Itération de la sous-équipe');
  await select.selectOption({ label: '1 · Navigation au clavier · Validée' });
  await expect(
    page.getByText('Itération validée. Son historique est conservé', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Revenir à l’itération active' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Filtres combinés' })).toBeVisible();
  await page.getByRole('button', { name: 'Équipe de base', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Navigation des filtres' }),
  ).toBeVisible();
  const sent = await page.evaluate(() => Reflect.get(window, 'subplanMessages'));
  expect(
    sent.some((m: ClientMessage) =>
      ['runStep', 'approveStep', 'pairAction', 'finalizeFeature'].includes(m.type),
    ),
  ).toBe(false);
});
test('adds and configures a subplan in a saved team template', async ({ page }) => {
  await open(page, scenario());
  await navigate(page, 'Mes équipes');
  await page.getByRole('button', { name: 'Nouvelle équipe' }).click();
  await page.getByRole('button', { name: 'Ajouter un sous-plan', exact: true }).click();
  await expect(page.getByLabel('Orchestrateur dédié')).toHaveValue('fs-orchestrator');
  await page.getByLabel('Équipe à utiliser').selectOption('feature');
  await expect(
    page
      .locator('.team-settings')
      .getByRole('button', { name: 'Configurer la sous-équipe', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.team-member.subplan-card')).toHaveCount(1);
});
for (const theme of [
  'papier-clair',
  'papier-sombre',
  'jardin-sombre',
  'guilde-clair',
  'halloween',
  'dragonball',
])
  test(`subplan history remains readable in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await open(page, scenario(true), theme);
    await expect(page.locator('.subplan-overview')).toBeVisible();
    await expect(page.locator('.subplan-mark').first()).toBeVisible();
    const card = page.locator('.journey-step.subplan-card');
    await expect(card.locator('.subplan-card-visual')).toBeVisible();
    await expect(card.locator('img')).toHaveCount(0);
    await expect(card).not.toContainText('Orchestrateur');
    await card.click();
    await expect(
      page.getByRole('navigation', { name: 'Navigation des sous-équipes' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (theme === 'papier-sombre') {
      await mkdir(resolve('test-results/subplans'), { recursive: true });
      await page.screenshot({
        path: resolve('test-results/subplans/sous-equipe.png'),
        fullPage: true,
      });
    }
  });

test('shows a dedicated team card in the living HQ and keeps nested settings usable on mobile', async ({
  page,
}) => {
  await open(page, scenario(true));
  await page.getByRole('checkbox', { name: 'Afficher le QG vivant' }).click();
  const card = page.locator('.hq-station.subplan-card');
  await expect(card.locator('.subplan-card-visual')).toBeVisible();
  await expect(card.locator('.hq-avatar img')).toHaveCount(0);
  await expect(card).not.toContainText('Orchestrateur');
  await mkdir(resolve('test-results/subplans'), { recursive: true });
  await card.screenshot({ path: resolve('test-results/subplans/carte-sous-plan.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Modifier l’équipe', exact: true }).click();
  await page.getByRole('button', { name: 'Configurer la sous-équipe', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
