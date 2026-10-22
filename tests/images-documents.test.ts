import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { validateImages, imageAttachments, assertVision } from '../src/host/Images';
import { parseMessage } from '../src/host/messages';
import { exportDocument } from '../src/host/DocumentExport';
import { screenshot } from './image-fixture';
import type { ModelInfo } from '@github/copilot-sdk';
import { AgentRegistry } from '../src/core/registry';
import { KitService } from '../src/host/KitService';
import { WorkflowEngine } from '../src/core/workflow';
import { approvalBlockers } from '../src/core/validation';
import { resolve } from 'node:path';

describe('explicit images and documentation', () => {
  it('validates actual image bytes, rejects forged types/paths/oversize and keeps blob inputs separate', () => {
    expect(validateImages([screenshot])).toEqual([screenshot]);
    for (const image of [
      { ...screenshot, mimeType: 'image/jpeg' },
      { ...screenshot, data: Buffer.from('<svg/>').toString('base64') },
      { ...screenshot, name: '../../secret' },
      { ...screenshot, data: 'A'.repeat(3_000_000) },
    ])
      expect(() => validateImages([image as typeof screenshot])).toThrow();
    expect(() => validateImages([screenshot, screenshot])).toThrow();
    expect(imageAttachments([screenshot])).toEqual([
      { type: 'blob', displayName: 'capture.png', mimeType: 'image/png', data: screenshot.data },
    ]);
    expect(
      parseMessage({
        type: 'createFeature',
        title: 'Bug',
        description: 'Capture',
        images: [screenshot],
      }),
    ).toMatchObject({ images: [screenshot] });
    expect(() => assertVision(undefined, [screenshot])).toThrow('compatible');
    expect(() =>
      assertVision({ capabilities: { supports: { vision: false } } } as ModelInfo, [screenshot]),
    ).toThrow('compatible');
  });
  it('bundles four roles, separate from old kits, with human gates and no write/execute capability', async () => {
    const registry = new AgentRegistry('/empty', resolve('defaults'), '/empty-user');
    const data = await registry.load();
    const kit = await new KitService(registry).preset('documentation');
    expect(kit.files.filter((f) => f.path.startsWith('agents/'))).toHaveLength(4);
    expect(kit.files.some((f) => f.path.includes('fs-devops'))).toBe(false);
    const flow = data.workflows.find((w) => w.id === 'documentation')!;
    expect(flow.steps).toHaveLength(4);
    const engine = new WorkflowEngine();
    const feature = engine.createFeature(flow, { title: 'Doc', description: 'API' });
    for (const step of feature.steps) {
      expect(step.policy).toBe('read-only');
      expect(step.askBeforeRun).toBe(true);
      expect(data.agents.find((a) => a.id === step.agentId)?.tools).toContain('documentation');
    }
    const step = feature.steps[0];
    engine.beginRun(feature.id, step.id);
    engine.finishRun(feature.id, step.id, {
      content: '# Recherche',
      changedFiles: [],
      questions: [],
    });
    expect(approvalBlockers(feature, step, 'autopilot')).toContain(
      'La documentation nécessite une validation humaine à chaque étape.',
    );
    expect(approvalBlockers(feature, step, 'human')).toEqual([]);
  });
  it('exports real Word/PowerPoint archives, exact Markdown and inert HTML with source links', async () => {
    const md =
      '# Contrat API\n\nUne **preuve** vérifiée.\n\n## Sources\n\n- [Documentation][api]\n- `src/api.ts:12`\n\n| Champ | Type |\n| --- | --- |\n| id | string |\n\n```ts\nconst x = "<test>";\n```\n\n<script>alert(1)</script>\n\n[Interdit](javascript:alert)\n\n[api]: https://example.com/api\n\nUne note[^preuve].\n\n[^preuve]: Source complémentaire [RFC](https://example.com/rfc)';
    expect((await exportDocument(md, 'md', 'API')).toString()).toBe(md);
    const html = (await exportDocument(md, 'html', 'API <test>')).toString();
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('https://example.com/api');
    expect(html).toContain('<table>');
    expect(html).toContain('https://example.com/rfc');
    expect(html).toContain('Notes et sources');
    const doc = await JSZip.loadAsync(await exportDocument(md, 'docx', 'API'));
    const xml = await doc.file('word/document.xml')!.async('string');
    expect(xml).toContain('Contrat API');
    expect(xml).toContain('w:tbl');
    expect(xml).toContain('src/api.ts:12');
    expect(await doc.file('word/_rels/document.xml.rels')!.async('string')).toContain(
      'https://example.com/api',
    );
    const slides = await JSZip.loadAsync(await exportDocument(md, 'pptx', 'API'));
    const names = Object.keys(slides.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    expect(names.length).toBeGreaterThan(0);
    const bodies = (await Promise.all(names.map((n) => slides.file(n)!.async('string')))).join(
      '\n',
    );
    expect(bodies).toContain('Contrat API');
    expect(bodies).toContain('https://example.com/api');
    expect(bodies).toContain('src/api.ts:12');
    await expect(exportDocument('x'.repeat(2_000_001), 'docx', 'T')).rejects.toThrow('limite');
    await expect(exportDocument('x'.repeat(200_000), 'pptx', 'T')).rejects.toThrow(
      '200 diapositives',
    );
  });
});
