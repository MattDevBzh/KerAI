import { test, expect } from '@playwright/test';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NavigationService } from '../src/host/NavigationService';
import { BrowserSessionManager } from '../src/host/navigation/BrowserSessionManager';
import { navigationFixture } from './fixtures/navigation-application';
import { demoState } from '../webview/demo';
import { navigate } from './ui-navigation-helpers';
import type { ClientMessage } from '../src/shared/types';

const executablePath = [
  chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find(existsSync);
const workerPath = path.resolve('dist/navigation-runtime/worker.cjs');

test('UI réelle → service hôte → Chromium : importer, corriger, rejouer, publier et retrouver les preuves', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(10_000);
  test.skip(
    !executablePath || !existsSync(workerPath),
    'Chromium installé et worker construit requis, aucun téléchargement automatique.',
  );
  const fixture = await navigationFixture();
  const root = await mkdtemp(path.join(tmpdir(), 'kerai-navigation-live-'));
  const storageRoot = path.join(root, 'private');
  const projectPath = path.join(root, 'synthetic-project');
  await mkdir(projectPath);
  let service!: NavigationService;
  const createService = async () => {
    const browser = new BrowserSessionManager({
      storageRoot: path.join(storageRoot, 'browser'),
      workerPath,
      executablePath,
      headless: true,
      onChange: () => service.publish(),
    });
    service = new NavigationService({
      storageRoot,
      workerPath,
      browser,
      trusted: () => true,
      projects: () => [{ id: 'project', path: projectPath }],
    });
    await service.initialize();
    service.on('state', (state) => {
      void page
        .evaluate((state) => window.postMessage({ type: 'navigationState', state }, '*'), state)
        .catch(() => undefined);
    });
  };
  try {
    await createService();
    const state = structuredClone(demoState);
    state.features = [];
    state.projectCatalog = {
      dedicated: true,
      windows: false,
      projects: [{ id: 'project', name: 'Recette synthétique', path: projectPath }],
      selectedProjectIds: ['project'],
      activeProjectId: 'project',
    };
    await page.exposeFunction('navigationLiveHost', async (message: ClientMessage) => {
      if (message.type === 'ready') {
        await page.evaluate((state) => window.postMessage({ type: 'state', state }, '*'), {
          ...state,
          navigation: service.snapshot(),
        });
        return;
      }
      if (message.type !== 'navigation') return;
      let error: string | undefined;
      let notice: string | undefined;
      try {
        notice = (await service.handle(message.command)).message;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
        console.error('Live host command failed:', message.command.action, error);
      }
      await page.evaluate((message) => window.postMessage(message, '*'), {
        type: 'navigationState',
        state: service.snapshot(),
        requestId: message.requestId,
        error,
        message: notice,
      });
    });
    await page.addInitScript(() => {
      Object.assign(window, {
        acquireVsCodeApi: () => ({
          getState: () => ({}),
          setState() {},
          postMessage(message: ClientMessage) {
            void Reflect.get(window, 'navigationLiveHost')(message);
          },
        }),
      });
    });
    await page.goto('/');
    await navigate(page, 'Applications');
    await page.getByRole('button', { name: 'Ajouter une application' }).click();
    const profile = page.getByRole('dialog', { name: 'Profil d’application' });
    await profile
      .getByLabel('Nom de l’application', { exact: true })
      .fill('Recette navigateur réelle');
    await profile.getByLabel('Origine locale', { exact: true }).fill(fixture.origin);
    await profile.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(profile).not.toBeVisible();
    await page.getByRole('button', { name: 'Préparer le navigateur', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Contrôle du navigateur' })).toContainText(
      'Prêt',
    );
    await page.getByRole('button', { name: 'Capturer cet état', exact: true }).click();
    await expect.poll(() => service.snapshot().captures?.length).toBe(1);
    await page.getByRole('button', { name: 'Importer un JSON' }).click();
    const importer = page.getByRole('dialog', { name: 'Importer un parcours JSON' });
    await importer.getByLabel('Contenu JSON').fill(
      JSON.stringify({
        title: 'Afficher la commune',
        steps: [
          { type: 'navigate', url: fixture.origin },
          { type: 'change', selectors: [['#city']], value: 'Liffré' },
          { type: 'click', selectors: [['#go']] },
        ],
      }),
    );
    await importer.getByRole('button', { name: 'Importer comme brouillon' }).click();
    await expect(importer).not.toBeVisible();
    await page.getByRole('button', { name: /Afficher la commune/ }).click();
    await page.getByRole('button', { name: 'Corriger le brouillon' }).click();
    const editor = page.getByRole('dialog');
    await expect(editor.getByRole('heading', { name: 'Corriger le parcours' })).toBeVisible();
    await editor
      .getByRole('checkbox', { name: 'Valeur sensible · exclure du rejeu automatique' })
      .uncheck();
    await editor.getByRole('button', { name: 'Ajouter une condition d’arrivée' }).click();
    await editor.getByRole('combobox', { name: 'Condition 1', exact: true }).selectOption('text');
    const condition = editor.locator('.applications-condition');
    await condition.getByRole('combobox', { name: 'Repérage', exact: true }).selectOption('css');
    await condition.getByLabel('Cible', { exact: true }).fill('#result');
    await condition.getByLabel('Valeur attendue', { exact: true }).fill('Résultat Liffré');
    await editor.getByRole('button', { name: 'Enregistrer une nouvelle révision' }).click();
    await expect(editor).not.toBeVisible();
    const detail = page.getByRole('region', { name: 'Fiche de parcours' });
    await detail.getByLabel('Valeur de l’étape 2', { exact: false }).fill('Liffré');
    await detail.getByRole('checkbox', { name: /Le rôle, les données/ }).check();
    await detail.getByRole('checkbox', { name: /J’autorise les interactions/ }).check();
    await detail.getByRole('button', { name: 'Lancer le rejeu' }).click();
    await expect(detail.locator('.applications-status-grid')).toContainText('Rejoué avec succès', {
      timeout: 20_000,
    });
    const run = service.snapshot().runs.at(-1)!;
    expect(run.arrivalVerified).toBe(true);
    expect(run.metrics.providerCalls).toBe(0);
    expect(run.metrics.actions).toBe(4);
    expect(run.events[0]).toMatchObject({ stepId: 'browser-reset', status: 'succeeded' });
    await page.getByRole('button', { name: 'Capturer cet état', exact: true }).click();
    await expect.poll(() => service.snapshot().captures?.length).toBe(2);
    await detail.getByRole('button', { name: 'Rendre disponible' }).click();
    await expect(detail.locator('.applications-status-grid')).toContainText('Disponible');
    await expect(detail.locator('.applications-status-grid')).toContainText('Rejoué avec succès');
    const published = service.snapshot().journeys[0];
    expect(published.revision).toBe(3);
    expect(published.provenance.verifiedRunId).toBe(run.id);
    await page.getByText('Captures et comparaison avant / après (2)', { exact: true }).click();
    await expect(page.getByRole('img', { name: /^Avant :/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Après :/ })).toBeVisible();
    const captures = service.snapshot().captures!;
    expect(captures[0].sha256).not.toBe(captures[1].sha256);
    for (const capture of captures)
      expect((await service.verifiedCapture(capture)).length).toBe(capture.bytes);
    await page.getByRole('heading', { name: 'Applications', exact: true }).click();
    await mkdir(path.resolve('artifacts/navigation'), { recursive: true });
    await page.screenshot({
      path: path.resolve('artifacts/navigation/applications-live-replay.png'),
      fullPage: true,
    });
    for (const [index, capture] of captures.entries())
      await writeFile(
        path.resolve(`artifacts/navigation/live-${index ? 'after' : 'before'}.png`),
        await service.verifiedCapture(capture),
      );
    await writeFile(
      path.resolve('artifacts/navigation/live-ui-evidence.json'),
      JSON.stringify(
        {
          evidence:
            'UI + NavigationService + dedicated Chromium worker on synthetic local application',
          providerCalls: run.metrics.providerCalls,
          run,
          published,
          captures: captures.map(({ previewUrl: _, path: originalPath, ...capture }, index) => ({
            ...capture,
            artifact: `live-${index ? 'after' : 'before'}.png`,
          })),
          limitations: [
            'Local Chromium on macOS; no Windows or VSIX packaged runtime claim.',
            'Existing synthetic server build version remains unknown.',
            'No Copilot provider call and no commercial acceptance.',
          ],
        },
        null,
        2,
      ),
    );
    await testInfo.attach('rejeu-reel', {
      body: JSON.stringify(
        { run, published, captures: captures.map(({ previewUrl: _, ...capture }) => capture) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await service.dispose();
    await createService();
    await page.reload();
    await navigate(page, 'Applications');
    await page.getByRole('button', { name: /Afficher la commune/ }).click();
    await expect(
      page.getByRole('region', { name: 'Fiche de parcours' }).locator('.applications-status-grid'),
    ).toContainText('Rejoué avec succès');
    expect(service.snapshot().journeys[0].hash).toBe(published.hash);
    expect(service.snapshot().runs[0].definitionHash).toBe(run.definitionHash);
    expect(service.snapshot().captures?.length).toBe(2);

    // Real persisted journal; declared synthetic times are never provider evidence.
    const journal = page.getByRole('region', { name: 'Journal de campagne A et B' });
    await journal
      .getByText('Évaluer la qualité, le temps et la consommation', { exact: true })
      .click();
    await journal.getByRole('button', { name: 'Créer une campagne A/B' }).click();
    const campaignDialog = page.getByRole('dialog');
    await campaignDialog.getByLabel('Nom de campagne').fill('Campagne de recette synthétique');
    await campaignDialog
      .getByLabel('Profil et périmètre local')
      .fill('Fixture locale · temps synthétiques déclarés');
    await campaignDialog
      .getByLabel('Tickets comparables (un par ligne)')
      .fill('Ticket synthétique');
    await campaignDialog.getByRole('checkbox', { name: 'Développement', exact: true }).uncheck();
    await campaignDialog.getByRole('checkbox', { name: 'Recette', exact: true }).uncheck();
    await campaignDialog.getByRole('button', { name: 'Enregistrer la campagne' }).click();
    await expect(campaignDialog).not.toBeVisible();
    async function measure(
      condition: 'A' | 'B',
      phase: string,
      order: number,
      work: number,
      waiting: number,
    ) {
      await journal.getByRole('button', { name: 'Ajouter une mesure', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByRole('combobox', { name: 'Condition', exact: true })
        .selectOption(condition);
      await dialog.getByRole('combobox', { name: 'Phase', exact: true }).selectOption(phase);
      if (phase !== 'analysis')
        await dialog.getByRole('combobox', { name: 'Ticket mesuré', exact: true }).selectOption('');
      await dialog.getByLabel('Ordre dans la séquence').fill(String(order));
      await dialog.getByRole('checkbox', { name: /Qualité acceptée/ }).check();
      for (const [label, value] of Object.entries({
        Préparation: 0,
        Connexion: 0,
        Démonstration: 0,
        'Travail actif': work,
        'Attente humaine': waiting,
      }))
        await dialog.getByLabel(`${label} (s)`, { exact: true }).fill(String(value));
      for (const label of [
        'Modèle effectif',
        'Version du runtime',
        'Permissions',
        'Snapshot de code initial',
        'Snapshot de données initial',
        'Critères d’acceptation',
        'Rôle utilisateur',
        'Snapshot initial de bibliothèque',
        'Snapshot initial d’index',
      ])
        await dialog.getByLabel(label, { exact: true }).fill(`Synthétique ${label}`);
      await dialog.getByRole('button', { name: 'Enregistrer la mesure' }).click();
      await expect(dialog).not.toBeVisible();
    }
    await measure('A', 'analysis', 1, 120, 30);
    await measure('B', 'analysis', 1, 60, 10);
    let evaluation = service.snapshot().evaluation!;
    const campaignId = evaluation.campaigns[0].id;
    expect(evaluation.reports[campaignId].metrics.activeSeconds.medianPairedGain).toBe(0.5);
    expect(evaluation.reports[campaignId].metrics.activeSeconds.cumulativeGain).toBeNull();
    expect(evaluation.reports[campaignId].metrics.cost.totalA.value).toBeNull();
    for (const condition of ['A', 'B'] as const) {
      await measure(condition, 'learning', 0, condition === 'B' ? 20 : 0, 0);
      await measure(condition, 'maintenance', 2, condition === 'B' ? 10 : 0, 0);
    }
    evaluation = service.snapshot().evaluation!;
    const report = evaluation.reports[campaignId];
    expect(report.entries).toBe(6);
    expect(report.metrics.activeSeconds.cumulativeGain).toBe(0.25);
    expect(report.metrics.totalSeconds.cumulativeGain).toBeCloseTo(1 / 3);
    expect(report.metrics.tokens.cumulativeGain).toBeNull();
    expect(report.metrics.cost.cumulativeGain).toBeNull();
    await journal.scrollIntoViewIfNeeded();
    await journal.screenshot({
      path: path.resolve('artifacts/navigation/applications-evaluation.png'),
    });
    const exported = await service.handle({ action: 'evaluationExport', campaignId });
    expect(exported.exportText).not.toContain('Ticket synthétique');
    expect(exported.exportText).not.toContain('Campagne de recette synthétique');
    await writeFile(
      path.resolve('artifacts/navigation/evaluation-synthetic-evidence.json'),
      JSON.stringify(
        {
          evidence:
            'Real UI and persistent host journal; synthetic declared times, no provider usage or economic claim',
          report,
          export: JSON.parse(exported.exportText!),
        },
        null,
        2,
      ),
    );
    await service.dispose();
    await createService();
    await page.reload();
    await navigate(page, 'Applications');
    await journal
      .getByText('Évaluer la qualité, le temps et la consommation', { exact: true })
      .click();
    await expect(
      journal.getByRole('heading', { name: 'Campagne de recette synthétique' }),
    ).toBeVisible();
    expect(service.snapshot().evaluation!.reports[campaignId]).toEqual(report);
  } finally {
    await service!.dispose();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
