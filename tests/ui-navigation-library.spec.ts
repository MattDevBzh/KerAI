import { test, expect, type Page } from '@playwright/test';
import { navigate } from './ui-navigation-helpers';
import { demoState } from '../webview/demo';
import type {
  NavigationCommand,
  NavigationJourney,
  NavigationSnapshot,
} from '../src/shared/navigation';
import type { ClientMessage } from '../src/shared/types';

// A deterministic message-contract host: these tests prove UI behavior, never browser runtime success.
const at = '2026-10-23T10:00:00.000Z';
const journey: NavigationJourney = {
  id: 'billing',
  applicationId: 'app',
  revision: 3,
  hash: 'abc123',
  parentHash: 'previous',
  title: 'Facturation du client',
  intent: 'Ouvrir la fiche puis son onglet Facturation',
  tags: ['facturation'],
  prerequisites: ['Compte Gestionnaire', 'Client de test existant'],
  parameters: [{ name: 'client', label: 'Référence client', type: 'string', required: true }],
  steps: [
    { id: 'open', action: 'navigate', url: 'http://localhost:3000', effect: 'read' },
    {
      id: 'tab',
      action: 'click',
      target: { strategy: 'role', value: 'tab', name: 'Facturation' },
      effect: 'read',
    },
  ],
  arrival: [
    { kind: 'visible', target: { strategy: 'role', value: 'heading', name: 'Facturation' } },
  ],
  status: 'draft',
  provenance: { mode: 'import' },
  createdAt: at,
  updatedAt: at,
};
const navigation: NavigationSnapshot = {
  navigationVersion: 1,
  applications: [
    {
      id: 'app',
      name: 'CRM de recette',
      origin: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
      projectIds: ['project'],
      role: 'Gestionnaire',
      interactionPolicy: 'confirm',
      createdAt: at,
      updatedAt: at,
    },
  ],
  journeys: [
    journey,
    {
      ...journey,
      id: 'notification',
      title: 'Depuis une notification',
      intent: 'Même écran, historique différent',
      variantOf: 'billing',
      revision: 1,
      status: 'available',
    },
  ],
  contributions: [],
  runs: [],
};
async function hosted(page: Page, initial = navigation) {
  const state = structuredClone(demoState);
  state.navigation = structuredClone(initial);
  state.projectCatalog = {
    dedicated: true,
    windows: false,
    projects: [{ id: 'project', name: 'CRM', path: '/workspace/crm' }],
    selectedProjectIds: ['project'],
    activeProjectId: 'project',
  };
  await page.addInitScript((data) => {
    const messages: ClientMessage[] = [];
    Object.assign(window, {
      navigationMessages: messages,
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState() {},
        postMessage(message: ClientMessage) {
          messages.push(message);
          if (message.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state: data }, '*'), 0);
          if (message.type !== 'navigation') return;
          const command = message.command;
          const nav = data.navigation!;
          let error: string | undefined;
          if (command.action === 'saveApplication')
            nav.applications = [
              ...nav.applications.filter((item) => item.id !== command.application.id),
              command.application,
            ];
          if (command.action === 'saveDraft')
            nav.journeys = [
              ...nav.journeys.filter((item) => item.id !== command.journey.id),
              { ...command.journey, revision: command.expectedRevision + 1, hash: 'updated-hash' },
            ];
          if (command.action === 'import') {
            const input = JSON.parse(command.json);
            if (input.steps?.some((step: { type: string }) => step.type === 'waitForExpression'))
              error = 'Action waitForExpression non prise en charge. Aucune exécution.';
            else
              nav.journeys.push({
                ...nav.journeys[0],
                id: 'imported',
                title: input.title ?? 'Parcours importé',
                revision: 1,
                status: 'draft',
              });
          }
          if (command.action === 'prepare')
            nav.browser = {
              id: 'browser',
              applicationId: command.applicationId,
              state: 'idle',
              generation: 1,
              recordedSteps: [],
              recordingPaused: true,
              warnings: [],
            };
          if (command.action === 'recordStart')
            nav.browser = {
              id: 'browser',
              applicationId: command.applicationId,
              state: 'recording',
              recordingActive: true,
              generation: 1,
              recordedSteps: [],
              recordingPaused: false,
              warnings: [],
            };
          if (command.action === 'authenticate' && nav.browser) {
            nav.browser.recordingPaused = true;
            nav.browser.state = 'human';
          }
          if (command.action === 'recordResume' && nav.browser) {
            nav.browser.recordingPaused = false;
            nav.browser.state = 'recording';
          }
          if (command.action === 'stop' && nav.browser) nav.browser.state = 'interrupted';
          if (command.action === 'recordFinish' && nav.browser) {
            nav.journeys.push({
              ...nav.journeys[0],
              id: 'shown',
              title: command.title,
              intent: command.intent,
              arrival: command.arrival,
              revision: 1,
              status: 'draft',
              provenance: { mode: 'demonstration' },
            });
            nav.browser.state = 'human';
            nav.browser.recordingPaused = false;
          }
          if (command.action === 'contribute') nav.contributions.push(command.contribution);
          if (command.action === 'resolveContribution') {
            const contribution = nav.contributions.find((item) => item.id === command.id)!;
            contribution.status = command.status;
          }
          if (command.action === 'history')
            nav.revisions = [
              {
                ...nav.journeys.find((item) => item.id === command.journeyId)!,
                revision: 2,
                title: 'Ancien titre',
              },
              nav.journeys.find((item) => item.id === command.journeyId)!,
            ];
          if (command.action === 'archive')
            nav.journeys.find((item) => item.id === command.journeyId)!.status = 'archived';
          setTimeout(
            () =>
              window.postMessage(
                { type: 'navigationState', requestId: message.requestId, state: nav, error },
                '*',
              ),
            0,
          );
        },
      }),
    });
  }, state);
  await page.goto('/');
  await navigate(page, 'Applications');
}
async function commands(page: Page): Promise<NavigationCommand[]> {
  return page.evaluate(() =>
    (Reflect.get(window, 'navigationMessages') as ClientMessage[])
      .filter(
        (message): message is Extract<ClientMessage, { type: 'navigation' }> =>
          message.type === 'navigation',
      )
      .map((message) => message.command),
  );
}
test('saves and reopens a complete remote application URL', async ({ page }) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Modifier le profil' }).click();
  const dialog = page.getByRole('dialog', { name: 'Profil d’application' });
  const url = 'https://recette.example.com/lms?tenant=demo#/tasks';
  await dialog.getByLabel('URL de l’application', { exact: true }).fill(url);
  await dialog
    .getByLabel('Origines supplémentaires autorisées (une par ligne)')
    .fill('https://api.example.com/v1');
  await dialog.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(dialog).not.toBeVisible();
  const saved = (await commands(page)).find((command) => command.action === 'saveApplication');
  expect(saved).toMatchObject({
    application: {
      origin: 'https://recette.example.com',
      startUrl: url,
      allowedOrigins: ['https://recette.example.com', 'https://api.example.com'],
    },
  });
  await page.getByRole('button', { name: 'Modifier le profil' }).click();
  await expect(dialog.getByLabel('URL de l’application', { exact: true })).toHaveValue(url);
});

test('bibliothèque search, independent statuses and immutable replay contract', async ({
  page,
}, testInfo) => {
  await hosted(page);
  await page.getByRole('searchbox', { name: /Rechercher par intention/ }).fill('facturation');
  await page.getByRole('button', { name: /Facturation du client/ }).click();
  const detail = page.getByRole('region', { name: 'Fiche de parcours' });
  await expect(detail.getByText('Brouillon', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Rendre disponible' })).toBeDisabled();
  await expect(detail.getByRole('button', { name: 'Lancer le rejeu' })).toBeDisabled();
  await detail.getByLabel('Référence client').fill('synthetic-001');
  await detail.getByRole('checkbox', { name: /Le rôle, les données/ }).check();
  await detail.getByRole('checkbox', { name: /J’autorise les interactions/ }).check();
  await detail.getByRole('button', { name: 'Lancer le rejeu' }).click();
  await expect
    .poll(() => commands(page))
    .toContainEqual({
      action: 'replay',
      journeyId: 'billing',
      parameters: { client: 'synthetic-001' },
      mode: 'verify',
      confirmInteractions: true,
      prerequisitesConfirmed: true,
    });
  await page.getByRole('heading', { name: 'Applications', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('applications-dark.png'), fullPage: true });
  // Sending a command never turns the draft into a successful replay.
  await expect(detail.getByText('Décrit', { exact: true })).toBeVisible();
});

test('editable draft preserves revision and records explicit steps and arrival', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: /Facturation du client/ }).click();
  await page.getByRole('button', { name: 'Corriger le brouillon' }).click();
  const dialog = page.getByRole('dialog', { name: 'Corriger le parcours' });
  await dialog.getByLabel('Titre du parcours', { exact: true }).fill('Facturation corrigée');
  await dialog.getByRole('button', { name: 'Ajouter une étape', exact: true }).click();
  await dialog.getByLabel('Nom accessible', { exact: true }).nth(1).fill('Modifier');
  await dialog.getByRole('button', { name: 'Enregistrer une nouvelle révision' }).click();
  await expect
    .poll(async () => (await commands(page)).find((command) => command.action === 'saveDraft'))
    .toMatchObject({
      action: 'saveDraft',
      expectedRevision: 3,
      journey: {
        title: 'Facturation corrigée',
        status: 'draft',
        steps: [{ id: 'open' }, { id: 'tab' }, { action: 'click', target: { name: 'Modifier' } }],
      },
    });
  await expect(page.getByRole('heading', { name: 'Facturation corrigée' })).toBeVisible();
  await page.getByText('Historique et différences de définition', { exact: true }).click();
  await page.getByRole('button', { name: 'Charger les révisions' }).click();
  await expect(page.getByText(/Champs modifiés depuis r2/)).toBeVisible();
});

test('import validates JSON locally and reports host incompatibilities without executing', async ({
  page,
}) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Importer un JSON' }).click();
  const dialog = page.getByRole('dialog', { name: 'Importer un parcours JSON' });
  await dialog.getByLabel('Contenu JSON').fill('{');
  await dialog.getByRole('button', { name: 'Importer comme brouillon' }).click();
  await expect(dialog.getByRole('alert')).toContainText('JSON invalide');
  expect((await commands(page)).filter((command) => command.action === 'import')).toHaveLength(0);
  await dialog.getByLabel('Contenu JSON').fill(
    JSON.stringify({
      title: 'Import incompatible',
      steps: [{ type: 'waitForExpression', expression: 'window.secret' }],
    }),
  );
  await dialog.getByRole('button', { name: 'Importer comme brouillon' }).click();
  await expect(page.getByRole('alert')).toContainText('waitForExpression non prise en charge');
  expect((await commands(page)).some((command) => command.action === 'replay')).toBe(false);
});

test('demonstration pauses for authentication and finishes as an observed draft', async ({
  page,
}, testInfo) => {
  await hosted(page);
  await page.getByRole('button', { name: 'Montrer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Montrer un parcours' });
  await dialog.getByRole('button', { name: 'Préparer le navigateur de démonstration' }).click();
  await dialog.getByRole('button', { name: 'Démarrer la démonstration' }).click();
  await expect(dialog.getByRole('status')).toContainText('À toi');
  await dialog.getByRole('button', { name: 'Pause pour connexion' }).click();
  await expect(dialog.getByRole('status')).toContainText('suspendu');
  await expect(dialog.getByRole('button', { name: 'Capturer cet état' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Reprendre l’enregistrement' }).click();
  await dialog.getByLabel('Nom de l’état final').fill('Facturation montrée');
  await dialog.getByRole('button', { name: 'Ajouter une condition d’arrivée' }).click();
  await dialog.getByLabel('Nom accessible', { exact: true }).fill('Facturation');
  await page.screenshot({
    path: testInfo.outputPath('applications-demonstration.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Terminer et créer le brouillon' }).click();
  await page.getByRole('button', { name: /Facturation montrée/ }).click();
  await expect(
    page.getByRole('region', { name: 'Fiche de parcours' }).getByText('Observé', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rendre disponible' })).toBeDisabled();
});

test('profile, contributions and responsive light keyboard remain available', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await hosted(page);
  await page.evaluate(() => window.postMessage({ type: 'themeState', theme: 'papier-clair' }, '*'));
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'papier-clair');
  const profileButton = page.getByRole('button', { name: 'Modifier le profil' });
  await profileButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Profil d’application' });
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Enregistrer le profil' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(profileButton).toBeFocused();
  await page.keyboard.press('Enter');
  await dialog.getByLabel('Rôle de connexion', { exact: true }).fill('Administrateur test');
  await dialog.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(page.getByRole('region', { name: 'Profil d’application' })).toContainText(
    'Administrateur test',
  );
  await page.getByRole('button', { name: /Facturation du client/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByText('Contributions au Navigateur', { exact: true }).click();
  await page
    .getByLabel('Observation ou détour rencontré')
    .fill('Le bouton est maintenant dans le menu.');
  await page.getByRole('button', { name: 'Conserver la contribution' }).click();
  await expect(page.getByText('Le bouton est maintenant dans le menu.')).toBeVisible();
  await page.getByRole('button', { name: 'Accepter pour consolidation' }).click();
  await expect(page.getByText('human · r3 · Acceptée')).toBeVisible();
  await page.getByRole('heading', { name: 'Applications', exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath('applications-light-narrow.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('published revision keeps its verified receipt and provider metrics expose missing values', async ({
  page,
}) => {
  const data = structuredClone(navigation);
  data.journeys[0] = {
    ...data.journeys[0],
    status: 'available',
    revision: 4,
    provenance: { mode: 'human', verifiedRunId: 'verified' },
  };
  data.runs = [
    {
      id: 'verified',
      journeyId: 'billing',
      revision: 3,
      definitionHash: 'abc123',
      applicationId: 'app',
      mode: 'verify',
      status: 'succeeded',
      startedAt: at,
      arrivalVerified: true,
      prerequisitesConfirmed: true,
      binding: {
        applicationId: 'app',
        origin: 'http://localhost:3000',
        projectIds: ['project'],
        roots: [],
        verification: 'unknown',
        reason: 'Serveur existant, version non attestée.',
      },
      events: [],
      evidencePaths: [],
      metrics: { actions: 2, durationMs: 450, outputChars: 128, providerCalls: 0 },
    },
  ];
  data.metrics = {
    phases: [
      {
        phase: 'learning-maintenance',
        attempts: 2,
        failed: 1,
        inputTokens: 340,
        measuredAttempts: 1,
        completeTokens: false,
        completeCost: false,
      },
    ],
    gain: null,
    note: 'Projection du registre.',
  };
  await hosted(page, data);
  await page.getByRole('button', { name: /Facturation du client/ }).click();
  const detail = page.getByRole('region', { name: 'Fiche de parcours' });
  await expect(detail.getByText('Rejoué avec succès', { exact: true })).toBeVisible();
  await expect(detail.getByText('À contrôler', { exact: true })).toBeVisible();
  await page.getByText('Consommation et couverture des mesures', { exact: true }).click();
  await expect(page.getByText('Apprentissage et entretien', { exact: true })).toBeVisible();
  await expect(page.getByText('340 / Inconnu · couverture partielle')).toBeVisible();
  await expect(page.getByText(/Gain économique : non établi/)).toBeVisible();
  await page.getByRole('button', { name: 'Exporter les mesures agrégées' }).click();
  await expect.poll(() => commands(page)).toContainEqual({ action: 'exportMetrics' });
});
