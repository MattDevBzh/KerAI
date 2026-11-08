import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { AgentRegistry } from '../src/core/registry';
import { WorkshopService } from '../src/host/WorkshopService';
import { CatalogueDeletionService } from '../src/host/CatalogueDeletionService';
import { KitService } from '../src/host/KitService';
import { WorkflowEngine } from '../src/core/workflow';
import { parseMessage } from '../src/host/messages';
import type { ClientMessage, HostMessage, StudioState, Feature } from '../src/shared/types';
import { demoState } from '../webview/demo';
import { navigate } from './ui-navigation-helpers';

const roots: string[] = [];
test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const original =
  '---\nname: Relecteur personnel\ndescription: Profil pour la révision\ntools: [read]\nskills: []\n---\n\nChercher les erreurs.\n';
async function hosted(page: Page, protectedSession = false) {
  const root = await mkdtemp(join(tmpdir(), 'workshop-ui-'));
  roots.push(root);
  const registry = new AgentRegistry(join(root, 'repo'), resolve('defaults'), join(root, 'user'));
  await mkdir(registry.workspacePath);
  await mkdir(join(registry.userPath, 'agents'), { recursive: true });
  const profile = join(registry.userPath, 'agents/personal.agent.md');
  await writeFile(profile, original);
  const service = new WorkshopService(registry);
  const kits = new KitService(registry),
    features: Feature[] = [];
  if (protectedSession) {
    const workflow = (await registry.load()).workflows.find((w) => w.id === 'single')!;
    features.push(
      new WorkflowEngine().createFeature(
        { ...workflow, steps: workflow.steps.map((step) => ({ ...step, agentId: 'personal' })) },
        { title: 'Session UI non terminée', description: 'Protection de la suppression' },
      ),
    );
    features[0].archived = true;
  }
  const removal = new CatalogueDeletionService(registry, async () => ({
    registries: [registry],
    features,
  }));
  const state = async (): Promise<StudioState> => ({
    ...structuredClone(demoState),
    ...(await registry.load()),
    features: structuredClone(features),
  });
  let exported: Buffer | undefined;
  await page.exposeFunction(
    'workshopHost',
    async (raw: ClientMessage): Promise<HostMessage | undefined> => {
      const message = parseMessage(raw);
      if (message.type === 'ready')
        return {
          type: 'state',
          state: await state(),
        };
      if (message.type === 'kitCatalog')
        return { type: 'kitResult', requestId: message.requestId, catalog: await kits.catalog() };
      if (message.type === 'catalogueDeletePreview' || message.type === 'catalogueDeleteApply') {
        try {
          if (message.type === 'catalogueDeletePreview')
            return {
              type: 'catalogueDeleteResult',
              requestId: message.requestId,
              preview: await removal.preview(message.target),
            };
          const result = await removal.apply(message.token);
          await page.evaluate(
            (next) => window.postMessage({ type: 'state', state: next }, '*'),
            await state(),
          );
          return { type: 'catalogueDeleteResult', requestId: message.requestId, message: result };
        } catch (error) {
          return {
            type: 'catalogueDeleteResult',
            requestId: message.requestId,
            error: (error as Error).message,
          };
        }
      }
      if (!message.type.startsWith('workshop')) return;
      const m = message as Extract<ClientMessage, { type: `workshop${string}` }>,
        requestId = m.requestId;
      try {
        if (m.type === 'workshopHistory')
          return { type: 'workshopResult', requestId, history: await service.history() };
        if (m.type === 'workshopExport') {
          exported = await service.exportArchive();
          return {
            type: 'workshopResult',
            requestId,
            message: 'Atelier exporté : archive lisible prête.',
          };
        }
        if (m.type === 'workshopImport') {
          if (!exported) throw Error('Exporter l’atelier d’abord.');
          const files = unzipSync(exported);
          files['personnel/agents/personal.agent.md'] = Buffer.from(
            original.replace(
              'Chercher les erreurs.',
              'Chercher les régressions et donner un exemple vérifiable.',
            ),
          );
          files['REVISION.md'] = Buffer.from(
            '# Révision externe\nLa relecture exige maintenant un exemple concret.',
          );
          return {
            type: 'workshopResult',
            requestId,
            preview: await service.previewImport(Buffer.from(zipSync(files))),
          };
        }
        if (m.type === 'workshopRestorePreview')
          return { type: 'workshopResult', requestId, preview: await service.previewRestore(m.id) };
        if (m.type === 'workshopApply')
          return {
            type: 'workshopResult',
            requestId,
            message: await service.apply(m.token),
            history: await service.history(),
          };
      } catch (error) {
        return { type: 'workshopResult', requestId, error: (error as Error).message };
      }
    },
  );
  await page.addInitScript(() => {
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        setState() {},
        postMessage(message: ClientMessage) {
          const host = Reflect.get(window, 'workshopHost') as (
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
  await expect(page.getByRole('heading', { name: 'Réviser tout l’atelier' })).toBeVisible();
  return { root, profile, service, features, registry };
}

test('atelier : exporter, comparer, appliquer et restaurer depuis l’historique après rechargement', async ({
  page,
}) => {
  const f = await hosted(page),
    panel = page.locator('.workshop-panel');
  await panel.getByRole('button', { name: 'Exporter tout l’atelier', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Atelier exporté');
  await panel.getByRole('button', { name: 'Comparer un atelier révisé' }).click();
  await expect(panel.getByRole('heading', { name: 'Changements proposés' })).toBeVisible();
  await panel.locator('.workshop-change summary').click();
  await expect(panel.locator('.workshop-diff')).toContainText('Chercher les erreurs.');
  await expect(panel.locator('.workshop-diff')).toContainText('un exemple vérifiable');
  await panel.getByText('Compte rendu de l’IA externe', { exact: true }).click();
  await expect(panel.locator('.workshop-report')).toContainText('exemple concret');
  await panel.screenshot({ path: 'test-results/workshop-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: 'test-results/workshop-mobile.png' });
  await panel.getByRole('button', { name: 'Appliquer le changement' }).click();
  await expect(panel.getByRole('status')).toContainText('fichier(s) appliqué(s)');
  expect(await readFile(f.profile, 'utf8')).toContain('un exemple vérifiable');
  await page.reload();
  await navigate(page, 'Kits');
  await panel.getByRole('button', { name: 'Historique et restauration' }).click();
  await panel.getByRole('button', { name: 'Comparer avant restauration' }).click();
  await expect(panel.getByRole('heading', { name: 'Restaurer l’état précédent' })).toBeVisible();
  await panel.getByRole('button', { name: 'Restaurer cet état' }).click();
  await expect(panel.getByRole('status')).toContainText('Atelier restauré');
  expect(await readFile(f.profile, 'utf8')).toBe(original);
});

test('atelier : un conflit reste visible et empêche le remplacement', async ({ page }) => {
  const f = await hosted(page),
    panel = page.locator('.workshop-panel');
  await panel.getByRole('button', { name: 'Exporter tout l’atelier', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Atelier exporté');
  await writeFile(f.profile, original + '\nModification locale à conserver.\n');
  await panel.getByRole('button', { name: 'Comparer un atelier révisé' }).click();
  await expect(panel.getByRole('alert')).toContainText('Les conflits bloquent');
  await expect(panel.getByRole('button', { name: /Appliquer le/ })).toBeDisabled();
  await panel.locator('.workshop-change summary').click();
  await expect(panel.locator('.workshop-diff')).toContainText('Modification locale à conserver');
  expect(await readFile(f.profile, 'utf8')).toContain('Modification locale à conserver');
});

test('atelier : suppression d’un agent bloquée par une session archivée non terminée', async ({
  page,
}) => {
  const f = await hosted(page, true);
  await navigate(page, 'Agents');
  await page
    .getByRole('button', { name: 'Supprimer l’agent Relecteur personnel', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Session UI non terminée');
  await expect(
    dialog.getByRole('button', { name: 'Supprimer définitivement', exact: true }),
  ).toBeDisabled();
  await dialog.screenshot({ path: 'test-results/catalogue-delete-blocked.png' });
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  f.features[0].status = 'completed';
  await page
    .getByRole('button', { name: 'Supprimer l’agent Relecteur personnel', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Supprimer l’agent Relecteur personnel', exact: true }),
  ).toHaveCount(0);
  await expect(readFile(f.profile)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('atelier : suppression explicite d’un kit fourni et de ses profils exclusifs', async ({
  page,
}) => {
  const f = await hosted(page);
  await page.getByRole('button', { name: 'Supprimer le kit DevOps', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('fs-devops-plan');
  await dialog.getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Supprimer le kit DevOps', exact: true }),
  ).toHaveCount(0);
  expect((await f.registry.load()).agents.some((agent) => agent.id === 'fs-devops-plan')).toBe(
    false,
  );
});
