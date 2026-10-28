import { navigate, openSessionSection } from './ui-navigation-helpers';
import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';

async function hosted(page: Page) {
  const state = structuredClone(demoState);
  state.features = [
    {
      ...state.features[0],
      id: 'team-draft',
      title: 'Feature sans équipe',
      steps: [],
      activeStepId: '',
      status: 'draft',
      teamRevision: 0,
      teamLockedAt: undefined,
    },
  ];
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    const publish = () => window.postMessage({ type: 'state', state: data }, '*');
    Object.assign(window, {
      teamState: data,
      teamMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({ featureId: 'team-draft', view: 'dashboard' }),
        setState() {},
        postMessage(message: ClientMessage) {
          messages.push(message);
          if (message.type === 'ready') setTimeout(publish, 0);
          if (message.type === 'saveFeatureTeam')
            setTimeout(() => {
              const feature = data.features[0];
              feature.steps = message.steps.map((step) => ({
                ...step,
                status: 'pending',
                attempts: [],
              }));
              feature.activeStepId = feature.steps[0]?.id ?? '';
              feature.teamRevision = message.expectedRevision + 1;
              publish();
              window.postMessage(
                {
                  type: 'featureTeamResult',
                  featureId: feature.id,
                  requestId: message.requestId,
                  revision: feature.teamRevision,
                },
                '*',
              );
            }, 0);
          if (message.type === 'setAgentFavorite')
            setTimeout(() => {
              data.favoriteAgentIds = message.favorite
                ? [...(data.favoriteAgentIds ?? []), message.agentId]
                : data.favoriteAgentIds?.filter((id) => id !== message.agentId);
              publish();
              window.postMessage(
                { type: 'agentFavoriteResult', requestId: message.requestId },
                '*',
              );
            }, 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
}

test('compose by avatar drag and inherit the profile without duplicating its settings', async ({
  page,
}) => {
  await hosted(page);
  await expect(page.getByRole('heading', { name: 'Aucune équipe constituée' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activer l’autopilot' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Composer mon équipe' }).click();
  const agent = page.locator('.team-agent').filter({ hasText: 'Comprendre' }).first();
  const first = (await agent.count()) ? agent : page.locator('.team-agent').first();
  await first.locator('.team-avatar-drag').dragTo(page.locator('.team-empty-target'));
  await expect(page.locator('.team-member')).toHaveCount(1);
  const name = await page.locator('.team-member dl dd').first().innerText();
  await expect(page.getByLabel('Rôle dans cette feature')).toHaveCount(0);
  await expect(page.getByLabel('Permissions de l’intervention')).toHaveCount(0);
  await expect(page.getByLabel('Modèle de l’intervention')).toHaveValue('');
  await expect(page.getByLabel('Niveau de réflexion')).toHaveValue('');
  await expect(page.getByLabel('Paramètres hérités de l’agent')).toContainText('Skills');
  await page.getByLabel(`Participation de ${name}`).selectOption('optional');
  await page.getByRole('button', { name: `Dupliquer ${name}`, exact: true }).click();
  await expect(page.locator('.team-member')).toHaveCount(2);
  await page.getByRole('button', { name: 'Valider l’équipe' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openSessionSection(page, 'Équipe et parcours');
  await expect(page.getByRole('button', { name: 'Modifier l’équipe' })).toBeVisible();
  const messages = await page.evaluate(() => Reflect.get(window, 'teamMessages'));
  const saved = messages.find((message: ClientMessage) => message.type === 'saveFeatureTeam');
  expect(saved.steps[0].id).not.toBe(saved.steps[1].id);
  expect(saved.steps[0].artifact).not.toBe(saved.steps[1].artifact);
  expect(saved.steps[1].dependsOn).toEqual([saved.steps[0].id]);
  expect(saved.steps[0].inheritAgent).toBe(true);
  expect(saved.steps[0].skills).toEqual([]);
  expect(saved.steps[0].model).toBe('');
  expect(saved.steps[0].reasoning).toBe('');
  expect(saved.steps[0].optional).toBe(true);
  expect(saved.steps[1].optional).toBe(true);
  expect(demoState.workflows[0].steps[0].optional).toBeUndefined();
  expect(messages.some((message: ClientMessage) => message.type === 'runStep')).toBe(false);
});

test('drop a complete team, favorite an agent, then cancel without changing the feature', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Composer mon équipe' }).click();
  const template = page.locator('.team-template').filter({ hasText: 'Feature complète' });
  await template.locator('.team-template-drag').dragTo(page.locator('.team-empty-target'));
  await expect(page.locator('.team-member')).toHaveCount(5);
  const last = page.locator('.team-agent').last();
  const id = await last.getAttribute('data-agent-id');
  await last.getByRole('button', { name: 'Ajouter aux favoris', exact: false }).click();
  await expect(page.locator('.team-agent').first()).toHaveAttribute('data-agent-id', id!);
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aucune équipe constituée' })).toBeVisible();
  await page.getByRole('button', { name: 'Composer mon équipe' }).click();
  await expect(page.locator('.team-member')).toHaveCount(0);
  await expect(page.locator('.team-agent').first()).toHaveAttribute('data-agent-id', id!);
});

test('a live execution keeps the composer available for queued edits', async ({ page }) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Composer mon équipe' }).click();
  await page
    .locator('.team-agent')
    .first()
    .getByRole('button', { name: /^Ajouter / })
    .last()
    .click();
  await page.evaluate(() => {
    const state = Reflect.get(window, 'teamState');
    state.features[0].teamLockedAt = new Date().toISOString();
    window.postMessage({ type: 'state', state }, '*');
  });
  await expect(page.getByRole('button', { name: 'Valider l’équipe' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Ajouter un sous-plan' })).toBeEnabled();
});

test('keyboard additions at small viewport and favorites in the main catalog', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await hosted(page);
  await page.getByRole('button', { name: 'Composer mon équipe' }).click();
  const add = page
    .locator('.team-agent')
    .first()
    .getByRole('button', { name: /^Ajouter / })
    .last();
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.team-member')).toHaveCount(1);
  await page.getByRole('button', { name: 'Valider l’équipe' }).click();
  await navigate(page, 'Agents');
  const last = page.locator('.agent-library-item').last();
  const button = last.getByRole('button', { name: /^Ajouter aux favoris/ });
  const label = await button.getAttribute('aria-label');
  await button.click();
  await expect(
    page
      .locator('.agent-library-item')
      .first()
      .getByRole('button', { name: label!.replace('Ajouter aux favoris', 'Retirer des favoris') }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('Mes équipes reuses the visual catalog and saves a reusable team without starting a feature', async ({
  page,
}) => {
  await hosted(page);
  await navigate(page, 'Mes équipes');
  await page.getByRole('button', { name: 'Nouvelle équipe', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Nom de l’équipe').fill('Mon atelier');
  await page.getByLabel('Description de l’équipe').fill('Une équipe réutilisable');
  const template = page.locator('.team-template').filter({ hasText: 'Feature complète' });
  await template.locator('.team-template-drag').dragTo(page.locator('.team-empty-target'));
  await expect(page.locator('.team-member')).toHaveCount(5);
  await page.getByRole('dialog').evaluate((dialog) => {
    const note = document.createElement('p');
    note.textContent = 'DÉMONSTRATION · équipe d’exemple · aucune exécution Copilot';
    note.className = 'muted';
    dialog.querySelector('.modal-heading > div')?.append(note);
    dialog.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/my-teams-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/my-teams-mobile.png' });
  const mobileAdd = page
    .locator('.team-agent')
    .first()
    .getByRole('button', { name: /^Ajouter (?!aux favoris)/ });
  await mobileAdd.scrollIntoViewIfNeeded();
  await mobileAdd.click();
  await expect(page.locator('.team-member')).toHaveCount(6);
  await page
    .locator('.team-member')
    .last()
    .getByRole('button', { name: /^Retirer / })
    .click();
  await expect(page.locator('.team-member')).toHaveCount(5);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const messages: ClientMessage[] = await page.evaluate(() => Reflect.get(window, 'teamMessages'));
  const saved = messages.find((message) => message.type === 'saveWorkflow');
  expect(saved?.type).toBe('saveWorkflow');
  if (saved?.type !== 'saveWorkflow') throw new Error('Team was not saved');
  expect(saved.workflow).toMatchObject({
    id: 'mon-atelier',
    name: 'Mon atelier',
    description: 'Une équipe réutilisable',
  });
  expect(saved.workflow.steps).toHaveLength(5);
  expect(new Set(saved.workflow.steps.map((step) => step.id)).size).toBe(5);
  expect(
    messages.some((message) =>
      ['createFeature', 'saveFeatureTeam', 'runStep'].includes(message.type),
    ),
  ).toBe(false);
});

test('saved team dependency settings reject cycles and retain valid links', async ({ page }) => {
  await hosted(page);
  await navigate(page, 'Mes équipes');
  await page.getByRole('button', { name: 'Nouvelle équipe', exact: true }).click();
  await page.getByLabel('Nom de l’équipe').fill('Dépendances');
  const [first, second] = demoState.agents;
  for (const agent of [first, second])
    await page
      .getByRole('button', { name: `Ajouter ${agent.nickname || agent.name}`, exact: true })
      .click();
  await page.getByRole('button', { name: `Régler ${first.name}`, exact: true }).click();
  await page
    .getByRole('group', { name: 'Doit attendre la validation de', exact: true })
    .getByLabel(second.name, { exact: true })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: 'dépendances' })).toBeVisible();
  await page.getByRole('button', { name: `Régler ${second.name}`, exact: true }).click();
  await page
    .getByRole('group', { name: 'Doit attendre la validation de', exact: true })
    .getByLabel(first.name, { exact: true })
    .uncheck();
  await page.getByRole('button', { name: `Régler ${first.name}`, exact: true }).click();
  await page
    .getByRole('group', { name: 'Doit attendre la validation de', exact: true })
    .getByLabel(second.name, { exact: true })
    .check();
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  const messages: ClientMessage[] = await page.evaluate(() => Reflect.get(window, 'teamMessages'));
  const saved = messages.find((message) => message.type === 'saveWorkflow');
  if (saved?.type !== 'saveWorkflow') throw new Error('Team was not saved');
  expect(saved.workflow.steps[0].agentId).toBe(second.id);
  expect(saved.workflow.steps[0].dependsOn).toEqual([]);
  expect(saved.workflow.steps[1].agentId).toBe(first.id);
  expect(saved.workflow.steps[1].dependsOn).toEqual([saved.workflow.steps[0].id]);
});
