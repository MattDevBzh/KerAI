import { expect, test, type Page } from '@playwright/test';
import { navigate } from './ui-navigation-helpers';
import { demoState } from '../webview/demo';
import type { ClientMessage, StudioState } from '../src/shared/types';

function fixture() {
  const state = structuredClone(demoState);
  const feature = state.features[0];
  const step = feature.steps[0];
  state.features = [feature];
  feature.title = 'Diagnostic lancement';
  feature.steps = [step];
  feature.activeStepId = step.id;
  feature.status = 'draft';
  feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
  delete feature.worktree;
  delete feature.autopilot;
  delete feature.archived;
  step.dependsOn = [];
  step.status = 'pending';
  step.maxAttempts = 0;
  step.attempts = [];
  state.workspace.trusted = true;
  state.runtime = {
    state: 'ready',
    models: [],
    native: {
      available: true,
      tools: ['view', 'glob', 'rg', 'edit', 'bash', 'ask_user'],
      permissionModes: ['manual'],
    },
  };
  return state;
}
async function open(page: Page, state = fixture(), starter?: string) {
  await page.addInitScript(
    ({ state, starter }) => {
      const messages: ClientMessage[] = [];
      let saved = {
        navigationVersion: 2,
        view: 'sessions',
        featureId: state.features[0].id,
        stepId: state.features[0].steps[0].id,
        sessionStarter: starter,
      };
      Object.assign(window, {
        startupMessages: messages,
        acquireVsCodeApi: () => ({
          getState: () => saved,
          setState: (value: typeof saved) => {
            saved = value;
          },
          postMessage(message: ClientMessage) {
            messages.push(message);
            if (message.type === 'ready')
              setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
          },
        }),
      });
    },
    { state, starter },
  );
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
}
async function previews(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(window, 'startupMessages') as ClientMessage[]).filter(
      (message): message is Extract<ClientMessage, { type: 'previewRun' }> =>
        message.type === 'previewRun',
    ),
  );
}
async function reply(
  page: Page,
  request: Extract<ClientMessage, { type: 'previewRun' }>,
  prompt: string,
) {
  await page.evaluate(
    ({ request, prompt }) =>
      window.postMessage(
        {
          type: 'runPreview',
          requestId: request.requestId,
          preview: {
            featureId: request.featureId,
            stepId: request.stepId,
            fingerprint: prompt,
            prompt,
            sections: [],
            characters: prompt.length,
            estimatedTokens: 1,
            maxCharacters: 60000,
            errors: [],
            resumesSession: false,
          },
        },
        '*',
      ),
    { request, prompt },
  );
}
async function launchDialog(page: Page) {
  await page.getByRole('button', { name: 'Exécuter cette étape', exact: true }).click();
  return page.getByRole('dialog');
}
test('preview updates automatically, coalesces edits and rejects stale replies and errors', async ({
  page,
}) => {
  await open(page);
  const dialog = await launchDialog(page);
  await expect.poll(async () => (await previews(page)).length).toBe(1);
  const first = (await previews(page))[0];
  await dialog.getByLabel('US, demande ou contexte initial').fill('Contexte intermédiaire');
  await dialog.getByLabel('US, demande ou contexte initial').fill('Contexte final');
  await expect.poll(async () => (await previews(page)).length).toBe(2);
  const latest = (await previews(page))[1];
  await reply(page, first, 'APERÇU PÉRIMÉ');
  await page.evaluate(
    (id) => window.postMessage({ type: 'error', requestId: id, message: 'ERREUR PÉRIMÉE' }, '*'),
    first.requestId,
  );
  await expect(dialog).not.toContainText('APERÇU PÉRIMÉ');
  await expect(dialog).not.toContainText('ERREUR PÉRIMÉE');
  await expect(dialog.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await reply(page, latest, 'APERÇU ACTUEL');
  await expect(dialog.getByRole('button', { name: 'Lancer cette étape' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Lancer cette étape' }).click();
  const sent = await page.evaluate(() => Reflect.get(window, 'startupMessages') as ClientMessage[]);
  expect(sent.find((message) => message.type === 'runStep')).toMatchObject({
    previewFingerprint: 'APERÇU ACTUEL',
    launch: { initialContext: 'Contexte final' },
  });
});
test('host changes invalidate an accepted preview before a launch', async ({ page }) => {
  const state = fixture();
  await open(page, state);
  const dialog = await launchDialog(page);
  await expect.poll(async () => (await previews(page)).length).toBe(1);
  await reply(page, (await previews(page))[0], 'VALIDE AVANT CHANGEMENT');
  await expect(dialog.getByRole('button', { name: 'Lancer cette étape' })).toBeEnabled();
  state.agents[0].instructions += '\nRègle modifiée';
  await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), state);
  await expect(dialog.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await expect.poll(async () => (await previews(page)).length).toBe(2);
});
test('a prior custom starter is retained after existing sessions and an explicit selection survives reopening', async ({
  page,
}) => {
  await open(page, fixture(), 'custom');
  await page.getByRole('button', { name: 'Vos sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await expect(dialog.getByRole('radio', { name: /Composer mon équipe/ })).toBeChecked();
  await dialog.getByRole('radio', { name: /Relire des changements/ }).check();
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await expect(dialog.getByRole('radio', { name: /Relire des changements/ })).toBeChecked();
});

test('restricted native permissions and excluded MCP connections are visible before launching', async ({
  page,
}) => {
  const state = fixture();
  const step = state.features[0].steps[0];
  state.agents.find((agent) => agent.id === step.agentId)!.tools = ['documentation'];
  state.settings.mcpServers = [
    {
      id: 'mcp',
      name: 'Mon MCP',
      enabled: true,
      transport: 'http',
      url: 'https://mcp.example',
      args: [],
      headers: {},
      envKeys: [],
      tools: ['read_document'],
      autoApproveReadOnly: false,
    },
  ];
  step.mcpServerIds = ['mcp'];
  await open(page, state);
  const dialog = await launchDialog(page);
  const scope = dialog.getByRole('region', {
    name: 'Capacités et autorisations de cette tentative',
  });
  await expect(scope).toContainText('Édition et terminal exclus');
  await expect(scope).toContainText('view, glob, rg, ask_user');
  await expect(scope).toContainText('exclues du catalogue');
  await expect(scope).not.toContainText('bash');
});
test('application diagnostics explain the missing Navigator and the profile only offers compatible agents', async ({
  page,
}) => {
  const state = fixture();
  const agent = state.agents[0];
  state.agents = [
    { ...agent, id: 'reader', name: 'Lecteur seul', tools: ['read'] },
    { ...agent, id: 'navigator', name: 'Navigateur compatible', tools: ['navigation'] },
  ];
  state.projectCatalog = {
    activeProjectId: 'project',
    selectedProjectIds: ['project'],
    projects: [{ id: 'project', name: 'Mon projet', path: state.workspace.path }],
    dedicated: false,
    windows: false,
  };
  state.navigation = {
    navigationVersion: 1,
    applications: [
      {
        id: 'app',
        name: 'Application distante',
        origin: 'https://private.example:8443',
        startUrl: 'https://private.example:8443/espace',
        allowedOrigins: [],
        projectIds: ['project'],
        interactionPolicy: 'confirm',
        createdAt: '',
        updatedAt: '',
      },
    ],
    journeys: [],
    contributions: [],
    runs: [],
  };
  await open(page, state);
  await navigate(page, 'Applications');
  const diagnostic = page.getByRole('region', { name: 'Diagnostic de navigation' });
  await expect(diagnostic).toContainText('https://private.example:8443/espace');
  await expect(diagnostic).toContainText('Choisissez un agent doté de la capacité navigation');
  await expect(diagnostic).toContainText(
    'Chaque interaction demandée par l’agent exige votre confirmation',
  );
  await page.getByRole('button', { name: 'Modifier le profil', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Profil d’application' });
  const owner = dialog.getByLabel('Navigateur propriétaire');
  await expect(owner.locator('option')).toHaveCount(2);
  await expect(owner.locator('option[value="navigator"]')).toHaveText('Navigateur compatible');
  await expect(owner.locator('option[value="reader"]')).toHaveCount(0);
  await expect(dialog.getByLabel('Adresse de l’application')).toHaveValue(
    'https://private.example:8443/espace',
  );
  await expect(
    dialog.getByLabel('Politique d’interaction').locator('option[value="confirm"]'),
  ).toHaveText('Confirmer chaque interaction demandée par l’agent');
});

async function replyCompactable(
  page: Page,
  request: Extract<ClientMessage, { type: 'previewRun' }>,
) {
  await page.evaluate((request) => {
    const applied = request.launch.contextSummary;
    window.postMessage(
      {
        type: 'runPreview',
        requestId: request.requestId,
        preview: {
          featureId: request.featureId,
          stepId: request.stepId,
          fingerprint: 'a'.repeat(64),
          prompt: applied ? applied.content : 'Ancien rapport complet',
          sections: [
            {
              id: 'previous',
              label: 'Livrable précédent',
              source: 'artifact',
              content: 'Ancien rapport complet',
              originalContent: 'Ancien rapport complet',
              enabled: !applied,
              compacted: Boolean(applied),
              editable: true,
            },
          ],
          characters: applied ? 4000 : 80000,
          estimatedTokens: applied ? 1000 : 20000,
          maxCharacters: 60000,
          errors: applied ? [] : ['Le contexte dépasse 60 000 caractères.'],
          compaction: applied ? undefined : { characters: 78000, calls: 5 },
          resumesSession: false,
        },
      },
      '*',
    );
  }, request);
}
async function compactionRequests(page: Page) {
  return page.evaluate(() =>
    (Reflect.get(window, 'startupMessages') as ClientMessage[]).filter(
      (m): m is Extract<ClientMessage, { type: 'compactRunContext' }> =>
        m.type === 'compactRunContext',
    ),
  );
}
test('compaction requires a reviewed summary and a new host preview, and restores the original context', async ({
  page,
}) => {
  await open(page);
  const dialog = await launchDialog(page);
  await expect.poll(async () => (await previews(page)).length).toBe(1);
  await replyCompactable(page, (await previews(page))[0]);
  await expect(dialog.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Générer une synthèse IA' }).click();
  await expect.poll(async () => (await compactionRequests(page)).length).toBe(1);
  const request = (await compactionRequests(page))[0];
  await page.evaluate(
    (request) =>
      window.postMessage(
        {
          type: 'contextCompactionResult',
          requestId: request.requestId,
          summary: {
            content: 'Préserver les utilisateurs non ciblés.',
            sources: [{ id: 'previous', digest: 'a'.repeat(64) }],
            discussionId: request.requestId,
          },
        },
        '*',
      ),
    request,
  );
  await dialog
    .getByLabel('Synthèse à relire avant application')
    .fill('Préserver les utilisateurs non ciblés. Corriger le nettoyage.');
  expect((await previews(page)).at(-1)!.launch.contextSummary).toBeUndefined();
  await dialog.getByRole('button', { name: 'Appliquer cette synthèse' }).click();
  await expect.poll(async () => (await previews(page)).length).toBe(2);
  const compacted = (await previews(page))[1];
  expect(compacted.launch.contextSummary?.content).toContain('Corriger le nettoyage');
  await expect(dialog.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
  await replyCompactable(page, compacted);
  await expect(dialog.getByRole('button', { name: 'Lancer cette étape' })).toBeEnabled();
  await expect(dialog.getByText('Remplacé par la synthèse')).toBeVisible();
  await dialog.getByRole('button', { name: 'Rétablir l’historique complet' }).click();
  await expect.poll(async () => (await previews(page)).length).toBe(3);
  expect((await previews(page))[2].launch.contextSummary).toBeUndefined();
  await replyCompactable(page, (await previews(page))[2]);
  await expect(dialog.getByRole('button', { name: 'Lancer cette étape' })).toBeDisabled();
});
test('discards a summary when context changed during generation and can cancel a new request', async ({
  page,
}) => {
  await open(page);
  const dialog = await launchDialog(page);
  await expect.poll(async () => (await previews(page)).length).toBe(1);
  await replyCompactable(page, (await previews(page))[0]);
  await dialog.getByRole('button', { name: 'Générer une synthèse IA' }).click();
  const request = (await compactionRequests(page))[0];
  await dialog.getByLabel('US, demande ou contexte initial').fill('Une nouvelle contrainte');
  await page.evaluate(
    (request) =>
      window.postMessage(
        {
          type: 'contextCompactionResult',
          requestId: request.requestId,
          summary: {
            content: 'Synthèse devenue périmée',
            sources: [{ id: 'previous', digest: 'a'.repeat(64) }],
            discussionId: request.requestId,
          },
        },
        '*',
      ),
    request,
  );
  await expect(dialog.getByText(/Le contexte a changé pendant la synthèse/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Appliquer cette synthèse' })).toHaveCount(0);
  await expect.poll(async () => (await previews(page)).length).toBe(2);
  await replyCompactable(page, (await previews(page))[1]);
  await dialog.getByRole('button', { name: 'Générer une synthèse IA' }).click();
  await dialog.getByRole('button', { name: 'Arrêter la compaction' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (Reflect.get(window, 'startupMessages') as ClientMessage[]).filter(
            (m) => m.type === 'cancelDiscussion',
          ).length,
      ),
    )
    .toBe(1);
});

test('session agent MCP defaults are visible, editable and used by manual launch', async ({
  page,
}) => {
  const state = fixture();
  state.settings.mcpServers = [
    {
      id: 'docs',
      name: 'Microsoft Learn',
      enabled: true,
      transport: 'http',
      url: 'https://learn.microsoft.com/api/mcp',
      envKeys: [],
      headers: {},
      args: [],
      tools: ['microsoft_docs_search'],
      autoApproveReadOnly: true,
    },
  ];
  state.features[0].steps[0].mcpServerIds = ['docs'];
  await open(page, state);
  await page.getByRole('button', { name: 'Configurer', exact: true }).click();
  const defaults = page.getByRole('group', { name: 'MCP par défaut de cet agent dans la session' });
  await expect(defaults.getByRole('checkbox')).toBeChecked();
  await expect(
    page.getByText(/actualise aussi les MCP de cette étape dans l’autopilote/),
  ).toBeVisible();
  await defaults.getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: 'Enregistrer la configuration' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, 'startupMessages') as ClientMessage[]).filter(
          (m) => m.type === 'configureStep',
        ),
      ),
    )
    .toMatchObject([{ mcpServerIds: [] }]);
  // No host state acknowledgement: the persisted defaults remain 'docs' in this fixture.
  await launchDialog(page);
  await expect.poll(async () => (await previews(page)).length).toBe(1);
  expect((await previews(page))[0].launch.mcpServerIds).toEqual(['docs']);
});
