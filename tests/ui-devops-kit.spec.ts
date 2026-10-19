import { navigate } from './ui-navigation-helpers';
import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { demoState } from '../webview/demo';
import { AgentRegistry } from '../src/core/registry';
import { WorkflowEngine } from '../src/core/workflow';
import type { StudioState, ClientMessage } from '../src/shared/types';
import { target } from './fixtures/devops-kit';

async function state() {
  const data = await new AgentRegistry(
    '/fixture/project',
    resolve('defaults'),
    '/fixture/user',
  ).load();
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(data.workflows.find((item) => item.id === 'devops')!, {
    title: 'Test DevOps',
    description: 'Tester les changements de pipeline',
  });
  for (const step of feature.steps.slice(0, -1)) {
    engine.beginRun(feature.id, step.id);
    engine.finishRun(feature.id, step.id, {
      content: 'Livrable approuvé',
      questions: [],
      changedFiles: [],
      review: { verdict: 'pass', summary: 'Relu', findings: [] },
    });
    engine.approveStep(feature.id, step.id);
  }
  return {
    ...structuredClone(demoState),
    ...data,
    features: [feature],
    runtime: { state: 'ready', authenticated: true, version: 'fixture', models: [] },
  } as StudioState;
}
async function hosted(page: Page, value: StudioState) {
  await page.addInitScript((data) => {
    const messages: unknown[] = [];
    Object.assign(window, {
      kitMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState() {},
        postMessage(message: ClientMessage) {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
          if (message.type === 'previewRun')
            setTimeout(
              () =>
                window.postMessage(
                  {
                    type: 'runPreview',
                    requestId: message.requestId,
                    preview: {
                      featureId: message.featureId,
                      stepId: message.stepId,
                      fingerprint: 'a'.repeat(64),
                      prompt: 'Test manuel à vérifier',
                      sections: [],
                      characters: 22,
                      estimatedTokens: 6,
                      maxCharacters: 60000,
                      errors: [],
                    },
                  },
                  '*',
                ),
              0,
            );
        },
      }),
    });
  }, value);
  await page.goto('/');
  await expect(page.locator('.session-card').filter({ hasText: 'Test DevOps' })).toBeVisible();
}
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'kitMessages') as ClientMessage[]);

test('kit DevOps : parcours fourni, duplication et contrat de preuve conservé', async ({
  page,
}) => {
  const data = await state();
  const validator = data.agents.find((agent) => agent.id === 'fs-devops-validate')!;
  await hosted(page, data);
  await navigate(page, 'Parcours');
  const card = page
    .locator('.workflow-library-card')
    .filter({ hasText: 'DevOps — du besoin au test vérifié' });
  await expect(card).toContainText('6 étapes');
  await card.getByRole('button', { name: 'Dupliquer', exact: true }).click();
  await page.getByLabel('Nom du parcours').fill('Mon DevOps');
  await page
    .getByRole('button', { name: `Configurer l’étape ${validator.name}`, exact: true })
    .click();
  await expect(page.getByLabel('Exiger une preuve du test DevOps manuel')).toHaveCount(0);
  await expect(page.getByLabel('Paramètres hérités de l’agent')).toContainText(
    validator.description,
  );
  await page.getByRole('button', { name: 'Enregistrer le parcours' }).click();
  const saved = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'saveWorkflow' }>;
  expect(saved.workflow.steps.at(-1)).toMatchObject({
    agentId: validator.id,
    inheritAgent: true,
    requiredDevOpsEvidence: true,
    askBeforeRun: true,
  });
});

test('kit DevOps : références manuelles requises, aperçu invalidé après correction, aucune exécution automatique', async ({
  page,
}) => {
  await hosted(page, await state());
  await page.locator('.session-card').filter({ hasText: 'Test DevOps' }).click();
  await page.getByRole('button', { name: 'Exécuter cette étape', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Préparer l’aperçu' })).toBeDisabled();
  await page.getByLabel('ID du pipeline de test').fill(String(target.pipelineId));
  await page.getByLabel('ID de l’exécution (build)').fill(String(target.buildId));
  await page.getByLabel('Commit testé (SHA complet)').fill(target.commit);
  await page.getByLabel('Branche testée', { exact: true }).fill(target.branch);
  await page.getByLabel('Cible de test et isolation mise en place').fill(target.environment);
  await page.getByLabel('Stages attendus (séparés par une virgule)').fill('Validate');
  await page.getByLabel('Artefacts attendus (facultatif)').fill('report');
  await expect(page.getByRole('button', { name: 'Préparer l’aperçu' })).toBeDisabled();
  await page
    .getByLabel('J’ai mis en place et exécuté ce test hors production selon le guide')
    .check();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByRole('button', { name: 'Lancer cette étape', exact: true })).toBeEnabled();
  const preview = (await messages(page)).at(-1) as Extract<ClientMessage, { type: 'previewRun' }>;
  expect(preview.launch.devopsTest).toEqual(target);
  expect((await messages(page)).some((message) => message.type === 'runStep')).toBe(false);
  await page.getByLabel('ID de l’exécution (build)').fill('124');
  await expect(
    page.getByRole('button', { name: 'Lancer cette étape', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Préparer l’aperçu' }).click();
  await expect(page.getByRole('button', { name: 'Lancer cette étape', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Test DevOps exécuté manuellement', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/devops-kit-launch-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Lancer cette étape', exact: true }).click();
  expect((await messages(page)).at(-1)).toMatchObject({
    type: 'runStep',
    launch: { devopsTest: { buildId: 124 } },
  });
});
