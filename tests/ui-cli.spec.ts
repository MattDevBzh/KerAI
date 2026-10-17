import { expect, test } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';

test('shows the resolved Windows CLI after an auth failure and offers automatic detection', async ({
  page,
}) => {
  const state = structuredClone(demoState);
  const executable = String.raw`C:\Users\MatthieuFERELLEC\AppData\Roaming\npm\copilot.cmd`;
  state.runtime = {
    state: 'unavailable',
    cliPath: executable,
    cliSource: 'path',
    models: [],
    error: 'Connexion GitHub nécessaire.',
  };
  await page.addInitScript(
    ({ state }) => {
      const messages: ClientMessage[] = [];
      Object.assign(window, {
        cliMessages: messages,
        acquireVsCodeApi: () => ({
          getState: () => ({ view: 'settings' }),
          setState() {},
          postMessage(message: ClientMessage) {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
          },
        }),
      });
    },
    { state },
  );
  await page.goto('/');
  await expect(page.locator('.runtime-location code')).toHaveText(executable);
  await expect(page.locator('.runtime-location')).toContainText('PATH de VS Code');
  await page.getByRole('button', { name: 'Détection automatique', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'cliMessages')))
    .toContainEqual({ type: 'autoDetectCli' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.runtime-location code')).toBeVisible();
  const bounds = await page.locator('.runtime-location code').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
});
