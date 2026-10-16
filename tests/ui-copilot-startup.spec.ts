import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';
import { navigate } from './ui-navigation-helpers';

async function hosted(page: Page, trusted = true) {
  const state = structuredClone(demoState);
  state.workspace.trusted = trusted;
  await page.addInitScript((state) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      startupMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState() {},
        postMessage(message: ClientMessage) {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
          if (message.type === 'checkRuntime') {
            state.runtime = { state: 'checking', models: [] };
            window.postMessage({ type: 'state', state }, '*');
          }
        },
      }),
    });
  }, state);
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  return state;
}
async function checks(page: Page) {
  return page.evaluate(
    () =>
      (Reflect.get(window, 'startupMessages') as ClientMessage[]).filter(
        (message) => message.type === 'checkRuntime',
      ).length,
  );
}
async function publish(page: Page, state: StudioState) {
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
}

test('connects automatically on startup, stays usable while checking and does not check again on navigation', async ({
  page,
}) => {
  const state = await hosted(page);
  await expect.poll(() => checks(page)).toBe(1);
  await expect(page.locator('.connection')).toContainText('Vérification');
  await navigate(page, 'Agents');
  await expect(page.getByRole('button', { name: 'Nouvel agent' })).toBeEnabled();
  state.runtime = {
    state: 'ready',
    authenticated: true,
    models: [{ id: 'fixture-model', name: 'Modèle du compte' }],
  };
  await publish(page, state);
  await expect(page.locator('.connection')).toContainText('Copilot connecté');
  await navigate(page, 'Réglages');
  await navigate(page, 'Dashboard');
  expect(await checks(page)).toBe(1);
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, 'startupMessages') as ClientMessage[]).filter(
        (message) => !['ready', 'checkRuntime'].includes(message.type),
      ),
    ),
  ).toEqual([]);
  await page.reload();
  await expect.poll(() => checks(page)).toBe(1);
});

test('waits for workspace trust and connects when a previously unchecked project becomes active', async ({
  page,
}) => {
  const state = await hosted(page, false);
  await navigate(page, 'Réglages');
  expect(await checks(page)).toBe(0);
  state.workspace.trusted = true;
  await publish(page, state);
  await expect.poll(() => checks(page)).toBe(1);
  state.workspace.path += '-other';
  state.runtime = { state: 'unchecked', models: [] };
  await publish(page, state);
  await expect.poll(() => checks(page)).toBe(2);
});

test('keeps a failed connection available for an explicit retry without automatic loops', async ({
  page,
}) => {
  const state = await hosted(page);
  await expect.poll(() => checks(page)).toBe(1);
  state.runtime = { state: 'unavailable', models: [], error: 'Connectez votre compte Copilot.' };
  await publish(page, state);
  await navigate(page, 'Réglages');
  await expect(page.getByText('Connectez votre compte Copilot.', { exact: true })).toBeVisible();
  await navigate(page, 'Dashboard');
  expect(await checks(page)).toBe(1);
  await page.getByRole('button', { name: 'Vérifier Copilot', exact: true }).click();
  await expect.poll(() => checks(page)).toBe(2);
});
