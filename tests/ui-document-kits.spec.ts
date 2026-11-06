import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';
import { demoState } from '../webview/demo';
import { AgentRegistry } from '../src/core/registry';
import { exportDocument } from '../src/host/DocumentExport';
import type { ClientMessage } from '../src/shared/types';

async function open(page: Page) {
  const registry = await new AgentRegistry('/empty', resolve('defaults'), '/empty-user').load();
  const state = { ...structuredClone(demoState), ...registry, features: [] };
  await page.addInitScript((state) => {
    const sent: ClientMessage[] = [];
    Object.assign(window, {
      documentMessages: sent,
      acquireVsCodeApi: () => ({
        getState: () => ({ view: 'sessions', navigationVersion: 2 }),
        setState() {},
        postMessage(m: ClientMessage) {
          sent.push(m);
          if (m.type === 'ready')
            setTimeout(() => window.postMessage({ type: 'state', state }, '*'), 0);
        },
      }),
    });
  }, state);
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle session', exact: true }).click();
  await page.getByLabel('Qu’allons-nous faire ?').fill('Mon document');
}
async function importFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByLabel('Document source à importer').setInputFiles({ name, mimeType, buffer });
}

test('imports text only after review and preserves edits made before applying it', async ({
  page,
}) => {
  await open(page);
  const context = page.getByLabel('Le contexte et le résultat souhaité');
  await context.fill('Présentation de 15 minutes.');
  await importFile(
    page,
    'source.md',
    'text/markdown',
    Buffer.from('# Contrat\n204 = demande transmise, pas synchronisée.'),
  );
  await expect(page.getByRole('region', { name: 'Document extrait' })).toContainText('source.md');
  await expect(context).toHaveValue('Présentation de 15 minutes.');
  await context.fill('Présentation de 20 minutes.');
  await page.getByRole('button', { name: 'Ajouter le texte au contexte' }).click();
  await expect(context).toHaveValue(/Présentation de 20 minutes.*Document source importé/s);
  await expect(context).toHaveValue(/204 = demande transmise, pas synchronisée/);
  await page.getByRole('radio', { name: /Préparer une présentation/ }).check();
  await page.getByRole('button', { name: 'Créer la session' }).click();
  const messages = await page.evaluate(
    () => Reflect.get(window, 'documentMessages') as ClientMessage[],
  );
  expect(messages.find((m) => m.type === 'createFeature')).toMatchObject({
    workflowId: 'presentation',
    description: expect.stringContaining('Empreinte SHA-256'),
  });
  expect(messages.some((m) => m.type === 'runStep')).toBe(false);
});

test('extracts DOCX paragraphs and inert HTML with explicit limits and no external requests', async ({
  page,
}) => {
  await open(page);
  let external = 0;
  await page.route('https://document-test.invalid/**', (route) => {
    external++;
    return route.abort();
  });
  const docx = await exportDocument(
    '# Réinitialisation\n\nTrois appels maximum par minute.\n\n## C01\n\nEspaces et casse ignorés.',
    'docx',
    'Contrat',
  );
  await importFile(
    page,
    'contrat.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docx,
  );
  await page.getByText('Vérifier le texte extrait', { exact: true }).click();
  await expect(page.getByLabel('Texte extrait du document')).toHaveValue(
    /Trois appels maximum par minute/,
  );
  await expect(page.getByRole('region', { name: 'Document extrait' })).toContainText(
    'Images, commentaires',
  );
  await page.getByRole('button', { name: 'Annuler l’import' }).click();
  await importFile(
    page,
    'contrat.html',
    'text/html',
    Buffer.from(
      '<h1>Contrat &amp; limites</h1><script>window.evil=true</script><img src="https://document-test.invalid/pixel"><p>Délai variable.</p><iframe src="https://document-test.invalid/frame"></iframe>',
    ),
  );
  await page.getByText('Vérifier le texte extrait', { exact: true }).click();
  await expect(page.getByLabel('Texte extrait du document')).toHaveValue(/Contrat & limites/);
  await expect(page.getByLabel('Texte extrait du document')).not.toHaveValue(/window.evil/);
  expect(await page.evaluate(() => Reflect.get(window, 'evil'))).toBeUndefined();
  expect(external).toBe(0);
});

test('imports a generated PDF locally with page references and rejects scans and malformed DOCX', async ({
  page,
}) => {
  await open(page);
  const pdf = await exportDocument(
    '# Audit ciblé\n\n## A001 — Priorité 2/10\n\nPréserver les appartenances.\n\nSource : src/Sync.cs:42.\n\n' +
      'Explication vérifiée. '.repeat(800),
    'pdf',
    'Audit',
    resolve('resources'),
  );
  await importFile(page, 'audit.pdf', 'application/pdf', pdf);
  await page.getByText('Vérifier le texte extrait', { exact: true }).click();
  await expect(page.getByLabel('Texte extrait du document')).toHaveValue(
    /Page 1[\s\S]*A001[\s\S]*Priorité 2\/10/,
  );
  await expect(page.getByLabel('Texte extrait du document')).toHaveValue(/Page 2/);
  await expect(page.getByLabel('Texte extrait du document')).toHaveValue(/src\/Sync.cs:42/);
  await expect(page.getByRole('region', { name: 'Document extrait' })).toContainText('graphiques');
  await page.getByRole('button', { name: 'Annuler l’import' }).click();
  const empty = await PDFDocument.create();
  empty.addPage();
  await importFile(page, 'scan.pdf', 'application/pdf', Buffer.from(await empty.save()));
  await expect(page.getByRole('alert')).toContainText('OCR');
  await importFile(
    page,
    'bad.docx',
    'application/zip',
    Buffer.from(zipSync({ 'unknown.xml': strToU8('not Word') })),
  );
  await expect(page.getByRole('alert')).toContainText('DOCX lisible');
  await expect(page.getByLabel('Le contexte et le résultat souhaité')).toHaveValue('');
});

test('exposes the audit starter and preserves the selected team in the creation request', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('radio', { name: /Auditer un projet/ }).check();
  await page.getByRole('button', { name: 'Créer la session' }).click();
  const messages = await page.evaluate(
    () => Reflect.get(window, 'documentMessages') as ClientMessage[],
  );
  expect(messages.find((m) => m.type === 'createFeature')).toMatchObject({
    workflowId: 'code-audit',
  });
});

test('refuses empty Word documents and oversized text without truncating the existing context', async ({
  page,
}) => {
  await open(page);
  const context = page.getByLabel('Le contexte et le résultat souhaité');
  await context.fill('Contexte à conserver');
  await importFile(
    page,
    'vide.docx',
    'application/zip',
    Buffer.from(
      zipSync({
        'word/document.xml': strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
        ),
      }),
    ),
  );
  await expect(page.getByRole('alert')).toContainText('Aucun texte exploitable');
  await importFile(page, 'long.txt', 'text/plain', Buffer.from('a'.repeat(480001)));
  await expect(page.getByRole('alert')).toContainText('aucun texte n’a été tronqué');
  await importFile(
    page,
    'long.docx',
    'application/zip',
    Buffer.from(
      zipSync({
        'word/document.xml': strToU8('a'.repeat(8 * 1024 * 1024 + 1)),
      }),
    ),
  );
  await expect(page.getByRole('alert')).toContainText('décompressé dépasse 8 Mio');
  await expect(context).toHaveValue('Contexte à conserver');
});
