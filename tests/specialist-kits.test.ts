import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentRegistry } from '../src/core/registry';
import { KitService, validateKit } from '../src/host/KitService';
import { WorkflowEngine } from '../src/core/workflow';
import { approvalBlockers } from '../src/core/validation';
import { resolveKitSelection, kitNodes } from '../src/shared/kits';
import { exportDocument } from '../src/host/DocumentExport';
import { PDFDocument } from 'pdf-lib';
import { parseMessage } from '../src/host/messages';

describe('presentation and code audit kits', () => {
  it.each([
    ['presentation', 5, 'fs-present-'],
    ['code-audit', 6, 'fs-audit-'],
  ] as const)(
    'installs %s with all shared dependencies in user scope and requires human acceptance',
    async (id, count, prefix) => {
      const root = await mkdtemp(join(tmpdir(), 'editorial-kits-'));
      try {
        const registry = new AgentRegistry(
          join(root, 'repo'),
          resolve('defaults'),
          join(root, 'user'),
        );
        await mkdir(registry.workspacePath);
        await mkdir(registry.userPath);
        const kits = new KitService(registry);
        const kit = await kits.preset(id);
        const nodes = validateKit(kit).nodes;
        expect(nodes.filter((n) => n.kind === 'agent')).toHaveLength(count);
        expect(nodes.filter((n) => n.kind === 'agent').every((n) => n.id.startsWith(prefix))).toBe(
          true,
        );
        const selected = resolveKitSelection(nodes, [`workflow:${id}`]);
        expect(selected.errors).toEqual([]);
        expect(selected.refs).toContain(
          `skill:${id === 'presentation' ? 'presentation' : 'audit'}-method`,
        );
        const preview = await kits.preview(kit);
        expect(preview.canInstall).toBe(true);
        await kits.install(preview.token);
        expect(await readdir(registry.workspacePath)).toEqual([]);
        const data = await registry.load();
        expect(data.notices).toEqual([]);
        const flow = data.workflows.find((w) => w.id === id)!;
        expect(flow.steps).toHaveLength(count);
        const engine = new WorkflowEngine();
        const feature = engine.createFeature(flow, {
          title: 'Évaluation',
          description: 'Sources et profils',
        });
        for (const step of feature.steps) {
          const agent = data.agents.find((a) => a.id === step.agentId)!;
          expect(agent.source).toBe('user');
          expect(agent.tools).toEqual(['read', 'search', 'documentation']);
          expect(agent.skills).toHaveLength(2);
          expect(step.inheritAgent).toBe(true);
          expect(step.askBeforeRun).toBe(true);
          expect(step.policy).toBe('read-only');
        }
        const first = feature.steps[0];
        engine.beginRun(feature.id, first.id);
        engine.finishRun(feature.id, first.id, {
          content: 'Profil à valider',
          changedFiles: [],
          questions: [],
        });
        expect(approvalBlockers(feature, first, 'autopilot')).toContain(
          'La documentation nécessite une validation humaine à chaque étape.',
        );
        expect(approvalBlockers(feature, first, 'human')).toEqual([]);
        const solo = await kits.compose(
          { id: 'solo', name: 'Solo', version: '1', description: '' },
          [`agent:${prefix}review`],
        );
        expect(validateKit(solo).nodes.filter((n) => n.kind === 'skill')).toHaveLength(2);
        const old = await kits.preset('copilot');
        expect(
          validateKit(old).nodes.some((n) =>
            /^(fs-present-|fs-audit-|presentation-|audit-)/.test(n.id),
          ),
        ).toBe(false);
        expect(resolveKitSelection(kitNodes(data), [`workflow:${id}`]).errors).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it('exports searchable PDF and readable plain text while preserving sources and explicit symbol fallbacks', async () => {
    const md =
      '# Audit de synchronisation\n\n## A001 — Priorité 2/10\n\nLes données ciblées doivent être préservées. 🔴\n\n- Fichier : `src/Sync.cs:42`\n- [Source](https://example.com/spec)\n\n```cs\nif (!isTargeted) RemoveRange();\n```\n\n| Critère | Statut |\n| --- | --- |\n| C01 | Vérifié statiquement |';
    const bytes = await exportDocument(md, 'pdf', 'Audit', resolve('resources'));
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getTitle()).toBe('Audit');
    const txt = (await exportDocument(md, 'txt', 'Audit')).toString();
    expect(txt).toContain('Priorité 2/10');
    expect(txt).toContain('src/Sync.cs:42');
    expect(txt).toContain('https://example.com/spec');
    expect(txt).not.toContain('```');
    for (const format of ['txt', 'pdf'])
      expect(
        parseMessage({
          type: 'exportAgentReport',
          requestId: 'x',
          featureId: 'f',
          stepId: 's',
          attemptId: 'a',
          revision: 0,
          format,
        }),
      ).toMatchObject({ format });
  });
});
