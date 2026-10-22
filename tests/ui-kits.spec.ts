import { navigate } from './ui-navigation-helpers';
import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AgentRegistry } from '../src/core/registry';
import { KitService, validateKit } from '../src/host/KitService';
import { parseMessage } from '../src/host/messages';
import type { ClientMessage, HostMessage, StudioState } from '../src/shared/types';
import { demoState } from '../webview/demo';

const roots: string[] = [];
test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function hosted(page: Page) {
  const root = await mkdtemp(join(tmpdir(), 'kits-ui-'));
  roots.push(root);
  const registry = new AgentRegistry(join(root, 'repo'), resolve('defaults'), join(root, 'user'));
  await mkdir(registry.workspacePath);
  await mkdir(registry.userPath);
  const kits = new KitService(registry),
    exported = join(root, 'export.fskit.json'),
    imported = join(root, 'import.fskit.json');
  const bundle = await kits.compose(
    {
      id: 'imported-devops',
      name: 'Équipe importée',
      description: 'Depuis un fichier local',
      version: '1.0',
    },
    ['agent:fs-devops-plan'],
  );
  await writeFile(imported, JSON.stringify(bundle));
  const state: StudioState = {
    ...structuredClone(demoState),
    ...(await registry.load()),
    features: [],
  };
  await page.exposeFunction(
    'kitHost',
    async (raw: ClientMessage): Promise<HostMessage | undefined> => {
      const message = parseMessage(raw);
      if (message.type === 'ready') return { type: 'state', state };
      if (!message.type.startsWith('kit')) return;
      const m = message as Extract<ClientMessage, { type: `kit${string}` }>,
        requestId = m.requestId;
      try {
        if (m.type === 'kitCatalog')
          return { type: 'kitResult', requestId, catalog: await kits.catalog() };
        if (m.type === 'kitPreview')
          return {
            type: 'kitResult',
            requestId,
            preview: await kits.preview(
              m.source === 'bundled' ? await kits.preset(m.kitId) : await kits.saved(m.kitId),
            ),
          };
        if (m.type === 'kitCompose')
          return {
            type: 'kitResult',
            requestId,
            preview: await kits.preview(await kits.compose(m.metadata, m.roots)),
          };
        if (m.type === 'kitImport')
          return {
            type: 'kitResult',
            requestId,
            preview: await kits.preview(await kits.readBundle(imported)),
          };
        if (m.type === 'kitInstall') {
          const result = await kits.install(m.token);
          return {
            type: 'kitResult',
            requestId,
            message: result,
            preview: await kits.preview(kits.bundle(m.token)),
            catalog: await kits.catalog(),
          };
        }
        if (m.type === 'kitExport') {
          const bundle = kits.bundle(m.token);
          await writeFile(exported, JSON.stringify(bundle));
          await kits.remember(bundle);
          return {
            type: 'kitResult',
            requestId,
            message: 'Kit exporté',
            catalog: await kits.catalog(),
          };
        }
      } catch (e) {
        return { type: 'kitResult', requestId, error: (e as Error).message };
      }
    },
  );
  await page.addInitScript(() => {
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState() {},
        postMessage(message: ClientMessage) {
          const host = Reflect.get(window, 'kitHost') as (
            message: ClientMessage,
          ) => Promise<HostMessage | undefined>;
          void host(message).then((result) => {
            if (result) window.postMessage(result, '*');
          });
        },
      }),
    });
  });
  await page.goto('/');
  await navigate(page, 'Kits');
  await expect(page.locator('.kit-card')).toHaveCount(3);
  return { root, kits, registry, exported, imported };
}

test('kits : bibliothèque, six avatars distincts et aperçu complet du kit prédéfini', async ({
  page,
}) => {
  await hosted(page);
  const card = page.locator('.kit-card.devops');
  await expect(card).toContainText('6 agents');
  await expect(card).toContainText('8 skills');
  const avatars = card.locator('.kit-team img');
  await expect(avatars).toHaveCount(6);
  expect(
    await avatars.evaluateAll(
      (images) => new Set(images.map((img) => (img as HTMLImageElement).src)).size,
    ),
  ).toBe(6);
  await expect
    .poll(() =>
      avatars.evaluateAll((images) =>
        images.every(
          (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: 'docs/images/kits-library.png', fullPage: true });
  await card.getByRole('button', { name: 'Voir le kit' }).click();
  await expect(page.getByRole('button', { name: 'Installer ce kit' })).toBeEnabled();
  await page.getByText('Voir tous les fichiers', { exact: true }).click();
  await expect(page.locator('.kit-files')).toContainText('ado-readonly.cjs');
  await expect(page.locator('.kit-files')).toContainText('devops-azure-preflight/LICENSE');
});

test('kits : sélection transitive, retrait, export puis installation du fichier local', async ({
  page,
}) => {
  const f = await hosted(page);
  await page.getByRole('button', { name: 'Créer un kit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Préparer l’export' })).toBeDisabled();
  const flow = page.getByRole('checkbox', {
    name: 'Inclure DevOps — du besoin au test vérifié',
    exact: true,
  });
  await flow.check();
  const architect = page.getByRole('checkbox', { name: 'Inclure Architecte', exact: true });
  await expect(architect).toBeChecked();
  await expect(architect).toBeDisabled();
  await expect(page.getByLabel('Contenu de votre kit')).toContainText('14 dépendances ajoutées');
  await flow.uncheck();
  await expect(architect).not.toBeChecked();
  await expect(architect).toBeEnabled();
  await architect.check();
  await expect(page.getByLabel('Contenu de votre kit')).toContainText('3 dépendances ajoutées');
  await page.getByLabel('Nom du kit', { exact: true }).fill('Mon DevOps');
  await page.getByLabel('Identifiant', { exact: true }).fill('mon-devops');
  await page.getByRole('button', { name: 'Agents', exact: true }).last().click();
  await page.getByPlaceholder('Rechercher un parcours, un agent…').fill('Architecte');
  await page.screenshot({ path: 'docs/images/kits-composer.png', fullPage: true });
  await page.getByRole('button', { name: 'Préparer l’export' }).click();
  await page.getByRole('button', { name: 'Exporter le fichier' }).click();
  await expect(page.getByRole('status')).toContainText('Kit exporté');
  const output = JSON.parse(await readFile(f.exported, 'utf8'));
  expect(validateKit(output).nodes).toHaveLength(4);
  await writeFile(f.imported, JSON.stringify(output));
  await page.getByRole('button', { name: 'Retour', exact: true }).click();
  await page.getByRole('button', { name: 'Retour', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mes kits enregistrés' })).toBeVisible();
  await page.getByRole('button', { name: 'Importer un fichier' }).click();
  await expect(page.locator('.kit-manifest')).toContainText('Mon DevOps');
  await page.getByRole('button', { name: 'Installer ce kit' }).click();
  await expect(page.getByRole('status')).toContainText('fichiers installés');
  expect((await f.registry.load()).agents.find((a) => a.id === 'fs-devops-plan')?.source).toBe(
    'user',
  );
});

test('kits : conflit préservé, import invalide et mise en page mobile', async ({ page }) => {
  const f = await hosted(page);
  await mkdir(join(f.registry.userPath, 'agents'));
  await writeFile(join(f.registry.userPath, 'agents/fs-devops-plan.agent.md'), 'Personal content');
  await page.getByRole('button', { name: 'Importer un fichier' }).click();
  await expect(page.getByRole('button', { name: 'Installer ce kit' })).toBeDisabled();
  await expect(page.locator('.kit-install-counts .conflict')).toContainText('1');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/kits-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Retour', exact: true }).click();
  await writeFile(f.imported, '{"schemaVersion":99}');
  await page.getByRole('button', { name: 'Importer un fichier' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await readFile(join(f.registry.userPath, 'agents/fs-devops-plan.agent.md'), 'utf8')).toBe(
    'Personal content',
  );
});

test('documentation : quatre rôles et ressources installables sans écraser le catalogue', async ({
  page,
}) => {
  await hosted(page);
  const card = page
    .locator('.kit-card')
    .filter({ has: page.getByRole('heading', { name: 'Documentation technique', exact: true }) });
  await expect(card).toContainText('4 agents');
  await card.getByRole('button', { name: 'Voir le kit' }).click();
  await expect(page.getByText('Recherche code et web', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Installer ce kit', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'docs/screenshots/kit-documentation.png', fullPage: true });
});
