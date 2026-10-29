import { expect, test, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import {
  normalizeSessionLayout,
  SESSION_MODULE_IDS,
  type SessionLayoutPreference,
} from '../src/shared/sessionLayout';
import type { ClientMessage, StudioState } from '../src/shared/types';

async function open(
  page: Page,
  layout = normalizeSessionLayout(null),
  state: StudioState = structuredClone(demoState),
) {
  state.features = [
    state.features[0],
    {
      ...structuredClone(state.features[0]),
      id: 'other-session',
      title: 'Autre session de travail',
    },
  ];
  await page.addInitScript(
    ({ state, layout }) => {
      const messages: ClientMessage[] = [];
      const saved = () =>
        JSON.parse(
          localStorage.getItem('fixture.layout') ?? JSON.stringify(layout),
        ) as SessionLayoutPreference;
      Object.assign(window, {
        layoutMessages: messages,
        failLayoutWrite: false,
        acquireVsCodeApi: () => ({
          getState: () =>
            JSON.parse(
              localStorage.getItem('fixture.view') ?? '{"view":"sessions","navigationVersion":2}',
            ),
          setState: (value: unknown) => localStorage.setItem('fixture.view', JSON.stringify(value)),
          postMessage: (message: ClientMessage) => {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                window.postMessage({ type: 'sessionLayoutState', layout: saved() }, '*');
              }, 0);
            if (message.type === 'setSessionLayout')
              setTimeout(() => {
                const fail = Reflect.get(window, 'failLayoutWrite');
                if (!fail) localStorage.setItem('fixture.layout', JSON.stringify(message.layout));
                window.postMessage(
                  {
                    type: 'sessionLayoutState',
                    layout: saved(),
                    requestId: message.requestId,
                    ...(fail ? { error: 'Préférence non enregistrée.' } : {}),
                  },
                  '*',
                );
              }, 30);
          },
        }),
      });
    },
    { state, layout },
  );
  await page.goto('/');
  await page
    .locator('.session-row')
    .filter({ hasText: state.features[0].title })
    .getByRole('button', { name: /^Ouvrir / })
    .click();
  await expect(
    page.getByRole('button', { name: 'Personnaliser l’affichage', exact: true }),
  ).toBeVisible();
  return state;
}
const editor = (page: Page) =>
  page.getByRole('dialog', { name: 'Personnaliser l’affichage de la session' });
const order = (page: Page) =>
  page
    .locator('.session-modules > [data-session-module]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-session-module')),
    );

for (const width of [1440, 390])
  test(`session modules retain their chosen order and visibility across sessions and reloads at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await open(page);
    await page.evaluate(() =>
      Reflect.set(window, 'originalWorkbench', document.querySelector('.feature-step-detail')),
    );
    await page.getByRole('button', { name: 'Personnaliser l’affichage', exact: true }).click();
    for (let index = 0; index < SESSION_MODULE_IDS.length - 1; index++)
      await editor(page)
        .getByRole('button', { name: 'Monter Équipe et parcours', exact: true })
        .click();
    await editor(page)
      .getByRole('checkbox', { name: 'Afficher Projet, Git et outils', exact: true })
      .uncheck();
    await editor(page)
      .getByRole('checkbox', { name: 'Afficher Autopilote et budget', exact: true })
      .uncheck();
    expect(
      await editor(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`session-layout-${width}.png`) });
    await editor(page).getByRole('button', { name: 'Appliquer l’affichage', exact: true }).click();
    await expect(editor(page)).toBeHidden();
    expect((await order(page))[0]).toBe('team');
    await expect(page.locator('[data-session-module="workspace"]')).toBeHidden();
    await expect(page.locator('[data-session-module="autopilot"]')).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          Reflect.get(window, 'originalWorkbench') ===
          document.querySelector('.feature-step-detail'),
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.locator('[data-session-module="workspace"]')).toBeHidden();
    await expect
      .poll(() => order(page))
      .toEqual(['team', ...SESSION_MODULE_IDS.filter((id) => id !== 'team')]);
    await page.getByRole('button', { name: 'Vos sessions', exact: true }).click();
    await page
      .locator('.session-row')
      .filter({ hasText: 'Autre session de travail' })
      .getByRole('button', { name: /^Ouvrir / })
      .click();
    await expect(page.locator('[data-session-module="autopilot"]')).toBeHidden();
    expect((await order(page))[0]).toBe('team');
    await page.getByRole('button', { name: 'Personnaliser l’affichage', exact: true }).click();
    await editor(page).getByRole('button', { name: 'Rétablir l’affichage par défaut' }).click();
    await editor(page).getByRole('button', { name: 'Appliquer l’affichage', exact: true }).click();
    await expect(editor(page)).toBeHidden();
    expect(await order(page)).toEqual([...SESSION_MODULE_IDS]);
    await expect(page.locator('[data-session-module="workspace"]')).toBeVisible();
    const messages = await page.evaluate(
      () => Reflect.get(window, 'layoutMessages') as ClientMessage[],
    );
    expect(
      messages.some((message) =>
        ['runStep', 'startAutopilot', 'approveStep'].includes(message.type),
      ),
    ).toBe(false);
  });

test('dragging a module changes order and a failed preference save keeps the editor and draft', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Personnaliser l’affichage', exact: true }).click();
  await editor(page)
    .getByRole('button', { name: 'Déplacer Détail de l’étape', exact: true })
    .dragTo(editor(page).locator('[data-layout-module="summary"]'));
  await expect(editor(page).locator('[data-layout-module]').first()).toHaveAttribute(
    'data-layout-module',
    'work',
  );
  await editor(page)
    .getByRole('checkbox', { name: 'Afficher Projet, Git et outils', exact: true })
    .uncheck();
  await page.evaluate(() => Reflect.set(window, 'failLayoutWrite', true));
  await editor(page).getByRole('button', { name: 'Appliquer l’affichage', exact: true }).click();
  await expect(editor(page).getByRole('alert')).toContainText('Préférence non enregistrée.');
  await expect(
    editor(page).getByRole('checkbox', { name: 'Afficher Projet, Git et outils', exact: true }),
  ).not.toBeChecked();
  expect((await order(page))[0]).toBe('summary');
  await page.evaluate(() => Reflect.set(window, 'failLayoutWrite', false));
  await editor(page).getByRole('button', { name: 'Appliquer l’affichage', exact: true }).click();
  await expect(editor(page)).toBeHidden();
  expect((await order(page))[0]).toBe('work');
  await expect(page.locator('[data-session-module="workspace"]')).toBeHidden();
});

test('hidden work and final validation remain reachable from an attention shortcut', async ({
  page,
}) => {
  const state = structuredClone(demoState),
    feature = state.features[0];
  state.humanRequests = [];
  const pendingStep = feature.steps.find((step) => step.attempts.length)!;
  pendingStep.status = 'waiting_input';
  pendingStep.attempts.at(-1)!.questions = [{ id: 'scope', text: 'Quel périmètre ?' }];
  pendingStep.attempts.at(-1)!.answers = {};
  feature.activeStepId = pendingStep.id;
  await open(page, normalizeSessionLayout({ hidden: ['work', 'summary'] }), state);
  await expect(page.locator('[data-session-module="work"]')).toBeHidden();
  await page.getByRole('button', { name: 'Afficher l’étape à débloquer' }).click();
  await expect(page.locator('[data-session-module="work"]')).toBeVisible();
  state.humanRequests = [];
  feature.status = 'awaiting_final_validation';
  for (const step of feature.steps) {
    step.status = 'skipped';
    step.optional = true;
    step.attempts = [];
    step.optionalDecision = {
      id: `skip-${step.id}`,
      at: feature.updatedAt,
      action: 'skip',
      author: 'human',
    };
  }
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
  await page.getByRole('button', { name: 'Afficher le bilan' }).click();
  await expect(page.locator('[data-session-module="summary"]')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Valider définitivement', exact: true }),
  ).toBeVisible();
});
