import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../webview/demo';
import { defaultPrAdministrationSettings } from '../src/shared/prAdministration';
import type { DevOpsState } from '../src/shared/devops';
import type { ClientMessage } from '../src/shared/types';
async function open(page: Page) {
  const state = structuredClone(demoState),
    feature = state.features[0];
  state.agents.push({
    ...state.agents[0],
    id: 'fs-devops-pr-admin',
    name: 'Pull Request Administrator',
    nickname: '',
    model: 'chosen-model',
  });
  const pr = {
    id: 42,
    title: 'PR existante',
    description: 'Description initiale',
    status: 'active' as const,
    isDraft: true,
    sourceBranch: 'refs/heads/codex/session',
    targetBranch: 'refs/heads/main',
    url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/42',
    repository: 'repo',
    createdBy: 'Matt',
    reviewers: [],
  };
  const devops: DevOpsState = {
    config: { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' },
    authenticated: true,
    busy: false,
    notices: [],
    tickets: [],
    pullRequests: [pr],
    links: [],
    history: [],
    existingPr: pr,
    deliverySession: {
      featureId: feature.id,
      title: feature.title,
      path: '/isolated/session',
      branch: 'codex/session',
    },
    prAdministration: { settings: defaultPrAdministrationSettings },
    snapshot: {
      head: 'a'.repeat(40),
      branch: 'codex/session',
      fingerprint: 'b'.repeat(64),
      files: [],
      diff: '',
      diffTruncated: false,
    },
  };
  await page.addInitScript(
    ({ state, devops }) => {
      let active = devops,
        serial = 0;
      const messages: ClientMessage[] = [];
      const publish = () => window.postMessage({ type: 'devopsState', state: active }, '*');
      Object.assign(window, {
        adminMessages: messages,
        acquireVsCodeApi: () => ({
          getState: () => ({}),
          setState: () => {},
          postMessage: (message: ClientMessage) => {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => {
                window.postMessage({ type: 'state', state }, '*');
                publish();
                window.postMessage({ type: 'navigate', view: 'delivery' }, '*');
              }, 0);
            if (message.type === 'deliveryPrAdminSettings') {
              active.prAdministration = { settings: message.settings };
              publish();
            }
            if (message.type === 'deliveryPrAdminPreview') {
              active.prAdministration!.preview = {
                id: 'preview-' + ++serial,
                featureId: active.deliverySession!.featureId,
                summary: 'Explications associées aux règles fournies.',
                snapshot: {
                  ...active.existingPr!,
                  description: active.existingPr!.description ?? '',
                  sourceHead: 'a'.repeat(40),
                  targetHead: 'b'.repeat(40),
                  baseHead: 'b'.repeat(40),
                  iteration: 1,
                },
                model: 'chosen-model',
                blockCount: 3,
                annotatedBlocks: 2,
                warnings: ['1 bloc sans annotation proposée.'],
                threadStatus: active.prAdministration!.settings.threadStatus,
                completed: [],
                actions: [
                  {
                    id: 'title',
                    kind: 'title',
                    operation: 'update',
                    before: 'PR existante',
                    content: 'Titre proposé',
                  },
                  {
                    id: 'comment',
                    kind: 'comment',
                    operation: 'create',
                    rule: 'SEC-01',
                    content: 'SEC-01 : accès vérifié avant lecture.',
                    block: {
                      id: 'block',
                      stableKey: 'stable',
                      path: 'src/authorization.ts',
                      side: 'right',
                      startLine: 12,
                      endLine: 14,
                      changeTrackingId: 1,
                      code: '@@ -12 +12 @@\n+ checkAccess();',
                    },
                  },
                  {
                    id: 'protected',
                    kind: 'comment',
                    operation: 'protected',
                    reason: 'Un humain a repris ce fil. Intervention manuelle requise.',
                    content: 'Explication conservée',
                    block: {
                      id: 'old',
                      stableKey: 'old',
                      path: 'src/login.ts',
                      side: 'right',
                      startLine: 2,
                      endLine: 2,
                      changeTrackingId: 2,
                      code: '+ verify();',
                    },
                  },
                ],
              };
              publish();
            }
            if (message.type === 'deliveryPrAdminApply') {
              active.prAdministration!.preview!.completed.push(
                ...message.changes.map((change) => change.id),
              );
              active.prAdministration!.result = `${message.changes.length} intervention(s) publiée(s).`;
              publish();
            }
          },
        }),
      });
    },
    { state, devops },
  );
  await page.goto('/');
  await expect(
    page.getByText('Intervenir sur une PR avec un agent', { exact: true }),
  ).toBeVisible();
}
const messages = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'adminMessages') as ClientMessage[]);
test('session mission, editable proposals and explicitly selected publication preserve human threads', async ({
  page,
}) => {
  await open(page);
  expect((await messages(page)).some((m) => m.type === 'deliveryPrAdminPreview')).toBe(false);
  await expect(page.getByLabel('Numéro de la PR à accompagner')).toHaveValue('42');
  await page.getByLabel('Instructions pour cette intervention').fill('Explique SEC-01');
  await page.getByLabel('Règles et contexte de la session').fill('SEC-01 : vérifier les droits');
  await page.getByLabel('Proposer un titre', { exact: true }).check();
  await page.getByLabel('Statut des nouveaux fils').selectOption('wontFix');
  await expect(
    page.getByRole('button', { name: 'Préparer les interventions', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Enregistrer la mission de PR' }).click();
  expect(
    (await messages(page)).filter((m) => m.type === 'deliveryPrAdminSettings').at(-1),
  ).toMatchObject({
    settings: {
      agentId: 'fs-devops-pr-admin',
      threadStatus: 'wontFix',
      title: true,
      context: 'SEC-01 : vérifier les droits',
    },
  });
  await page.getByRole('button', { name: 'Préparer les interventions', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Aperçu des interventions' })).toContainText(
    '2 / 3 blocs',
  );
  await expect(
    page.getByRole('button', { name: 'Publier la sélection (0)', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('Publier la proposition 3', { exact: true })).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Proposition 2', exact: true })
    .fill('SEC-01 : explication corrigée par Matt.');
  await page.getByLabel('Publier la proposition 2', { exact: true }).check();
  await page.getByRole('button', { name: 'Publier la sélection (1)', exact: true }).click();
  expect((await messages(page)).filter((m) => m.type === 'deliveryPrAdminApply')).toEqual([
    {
      type: 'deliveryPrAdminApply',
      previewId: 'preview-1',
      changes: [{ id: 'comment', content: 'SEC-01 : explication corrigée par Matt.' }],
    },
  ]);
  await expect(page.getByLabel('Publier la proposition 2', { exact: true })).toBeDisabled();
  await expect(page.locator('.pr-administration').getByRole('status')).toContainText(
    '1 intervention(s)',
  );
  await page.screenshot({ path: test.info().outputPath('pr-administration.png'), fullPage: true });
});
test('mobile review fits, and a changed PR selection disables publication of the previous preview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: 'Préparer les interventions', exact: true }).click();
  await page.getByLabel('Publier la proposition 1', { exact: true }).check();
  await page.getByLabel('Numéro de la PR à accompagner').fill('43');
  await expect(
    page.getByRole('button', { name: 'Publier la sélection (1)', exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('pr-administration-mobile.png'),
    fullPage: true,
  });
});
