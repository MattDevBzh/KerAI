import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import type { ClientMessage } from '../src/shared/types';

async function sessions(page: Page) {
  const state = structuredClone(demoState);
  const projects = [
    { id: 'lms', name: 'LMS', path: '/dev/lms' },
    { id: 'lxp', name: 'LXP', path: '/dev/lxp' },
  ];
  state.projectCatalog = {
    projects,
    selectedProjectIds: ['lms'],
    activeProjectId: 'lms',
    dedicated: true,
    windows: false,
  };
  state.features = Array.from({ length: 25 }, (_, i) => ({
    ...structuredClone(demoState.features[0]),
    id: `session-${i}`,
    title: `Session ${String(i + 1).padStart(2, '0')}`,
    branch: `feature/${i}`,
    status: 'draft' as const,
    projects: (i === 2 ? projects : [projects[i % 2]]).map((p) => ({
      ...p,
      branch: `feature/${i}`,
    })),
    archived: i === 24,
    autopilot: undefined,
    steps: structuredClone(demoState.features[0].steps).map((step) => ({
      ...step,
      status: 'approved' as const,
    })),
  }));
  await page.addInitScript((data) => {
    const messages: unknown[] = [];
    let saved = { view: 'sessions', navigationVersion: 2 };
    Object.assign(window, {
      sessionMessages: messages,
      sessionState: data,
      acquireVsCodeApi: () => ({
        getState: () => saved,
        setState: (value: typeof saved) => {
          saved = value;
        },
        postMessage: (message: { type: string }) => {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sessions 25', exact: true })).toBeVisible();
  await page.getByLabel('Trier les sessions').selectOption('title');
}
async function lastBatch(page: Page) {
  return page.evaluate(
    () =>
      (Reflect.get(window, 'sessionMessages') as ClientMessage[])
        .filter((m) => m.type === 'manageSessions')
        .at(-1) as Extract<ClientMessage, { type: 'manageSessions' }>,
  );
}

test('compact list shows many sessions and range selection follows the visible order', async ({
  page,
}) => {
  await sessions(page);
  const rows = page.locator('.session-row');
  await expect(rows).toHaveCount(24);
  await page.screenshot({ path: test.info().outputPath('sessions-desktop.png') });
  expect(
    await rows.evaluateAll(
      (items) => items.filter((row) => row.getBoundingClientRect().bottom <= innerHeight).length,
    ),
  ).toBeGreaterThanOrEqual(8);
  await rows.nth(1).locator('h3').click();
  await rows
    .nth(5)
    .locator('h3')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.session-row.is-selected')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Supprimer (5)', exact: true })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Sélectionner les 24 sessions affichées' }),
  ).toHaveJSProperty('indeterminate', true);
  await rows
    .nth(0)
    .getByRole('checkbox')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.session-row.is-selected')).toHaveCount(6);
  expect(await lastBatch(page)).toBeUndefined();
});

test('multi-project filter, search and sort clear hidden selection and persist on returning', async ({
  page,
}) => {
  await sessions(page);
  await page.getByLabel('Filtrer par projet').selectOption('lxp');
  await expect(page.locator('.session-row')).toHaveCount(13);
  await expect(page.locator('.session-row').filter({ hasText: 'Session 03' })).toContainText('LMS');
  await page.getByRole('checkbox', { name: 'Sélectionner les 13 sessions affichées' }).check();
  await expect(page.locator('.session-row.is-selected')).toHaveCount(13);
  await page.getByLabel('Rechercher une session').fill('Session 03');
  await expect(page.locator('.session-row.is-selected')).toHaveCount(0);
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ouvrir Session 03', exact: true }).click();
  await page.getByRole('button', { name: 'Vos sessions', exact: true }).click();
  await expect(page.getByLabel('Filtrer par projet')).toHaveValue('lxp');
  await expect(page.getByLabel('Rechercher une session')).toHaveValue('Session 03');
  await expect(page.locator('.session-row')).toHaveCount(1);
});

test('bulk deletion sends one frozen request, cancellation retains selection', async ({ page }) => {
  await sessions(page);
  await page.locator('.session-row').nth(1).locator('h3').click();
  await page
    .locator('.session-row')
    .nth(3)
    .locator('h3')
    .click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Supprimer (3)', exact: true }).click();
  const batch = await lastBatch(page);
  expect(batch).toMatchObject({
    action: 'delete',
    featureIds: ['session-1', 'session-2', 'session-3'],
  });
  await expect(page.getByLabel('Filtrer par projet')).toBeDisabled();
  await page.evaluate(
    (request) =>
      window.postMessage(
        {
          type: 'sessionBatchResult',
          ...request,
          succeeded: [],
          failed: [],
          freedBytes: 0,
          cancelled: true,
        },
        '*',
      ),
    { requestId: batch.requestId, action: batch.action },
  );
  await expect(page.getByText('Suppression annulée. La sélection est conservée.')).toBeVisible();
  await expect(page.locator('.session-row.is-selected')).toHaveCount(3);
  await expect(page.getByLabel('Filtrer par projet')).toBeEnabled();
});

test('archive and restore are directly available and partial results retain failed rows', async ({
  page,
}) => {
  await sessions(page);
  await page.locator('.session-row').nth(0).locator('h3').click();
  await page.locator('.session-row').nth(1).locator('h3').click();
  await page.getByRole('button', { name: 'Archiver (2)', exact: true }).click();
  const batch = await lastBatch(page);
  await page.evaluate(
    (request) => {
      const state = Reflect.get(window, 'sessionState');
      state.features[0].archived = true;
      window.postMessage({ type: 'state', state }, '*');
      window.postMessage(
        {
          type: 'sessionBatchResult',
          ...request,
          succeeded: ['session-0'],
          failed: [{ featureId: 'session-1', title: 'Session 02', error: 'Projet indisponible' }],
          freedBytes: 0,
        },
        '*',
      );
    },
    { requestId: batch.requestId, action: batch.action },
  );
  await expect(page.locator('.session-row.is-selected')).toHaveCount(1);
  await expect(page.getByText('Projet indisponible')).toBeVisible();
  await page.getByRole('button', { name: 'Archives 2', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(2);
  await expect(page.locator('.session-row.is-selected')).toHaveCount(0);
  await page.getByRole('button', { name: 'Restaurer Session 01', exact: true }).click();
  expect(await lastBatch(page)).toMatchObject({ action: 'restore', featureIds: ['session-0'] });
});

test('390px keeps selection, project badges and actions within the window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await sessions(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Ouvrir Session 01', exact: true })).toBeVisible();
  await expect(page.locator('.session-row').first().locator('.session-project-tag')).toHaveText(
    'LMS',
  );
  await page.getByRole('checkbox', { name: 'Sélectionner Session 01', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('checkbox', { name: 'Sélectionner Session 03', exact: true }).focus();
  await page.keyboard.press('Shift+Space');
  await expect(page.locator('.session-row.is-selected')).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('sessions-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
