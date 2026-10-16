import { navigate } from './ui-navigation-helpers';
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

test('compose by avatar drag, duplicate an agent, change its role and validate', async ({
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
  await page.getByLabel('Rôle dans cette feature').fill('Cadrage personnalisé');
  await page.getByLabel('Permissions de l’intervention').selectOption('workspace-write');
  await page.getByRole('button', { name: 'Dupliquer Cadrage personnalisé', exact: true }).click();
  await expect(page.locator('.team-member')).toHaveCount(2);
  await page.getByRole('button', { name: 'Valider l’équipe' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Modifier l’équipe' })).toBeVisible();
  const messages = await page.evaluate(() => Reflect.get(window, 'teamMessages'));
  const saved = messages.find((message: ClientMessage) => message.type === 'saveFeatureTeam');
  expect(saved.steps[0].id).not.toBe(saved.steps[1].id);
  expect(saved.steps[0].artifact).not.toBe(saved.steps[1].artifact);
  expect(saved.steps[1].dependsOn).toEqual([saved.steps[0].id]);
  expect(saved.steps[0].policy).toBe('workspace-write');
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

test('a live execution locks an already open composer and disables submission', async ({
  page,
}) => {
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
  await expect(
    page.getByText('Une exécution a commencé : l’équipe est désormais verrouillée.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Valider l’équipe' })).toBeDisabled();
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
