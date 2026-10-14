import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { AgentRegistry } from '../src/core/registry';
import { KitService, validateKit } from '../src/host/KitService';
import { parseMessage } from '../src/host/messages';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import { buildPrompt, previewContext } from '../src/core/context';
import type { RunInput } from '../src/shared/types';
import {
  ROAST_LEVELS,
  normalizeRoastLevel,
  roastInstructions,
  roastLabel,
  type RoastLevel,
} from '../src/shared/roast';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'studio-roast-'));
  roots.push(root);
  await mkdir(join(root, 'repo'));
  await mkdir(join(root, 'user'));
  const registry = new AgentRegistry(join(root, 'repo'), resolve('defaults'), join(root, 'user'));
  return { root, registry };
}
const agent = {
  id: 'roast-review',
  name: 'Reviewer',
  description: 'Find actionable problems',
  instructions: 'Be precise and substantiate every finding.',
  tools: ['read'],
  skills: [],
};
function runInput(): RunInput {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'roast',
      name: 'Review',
      description: '',
      icon: '',
      steps: [
        {
          id: 'review',
          name: 'Review',
          description: 'Review the changes',
          agentId: agent.id,
          policy: 'read-only',
          skills: [],
          dependsOn: [],
          artifact: 'review.md',
          maxAttempts: 3,
        },
      ],
    },
    { title: 'Review', description: '' },
  );
  return {
    feature,
    step: feature.steps[0],
    attempt: engine.beginRun(feature.id, 'review'),
    workspacePath: '/fixture',
    agent: { ...agent, source: 'user', path: '' },
    skills: [],
    settings: structuredClone(defaultSettings),
  };
}

describe('per-agent conversation roast', () => {
  it('leaves absent and disabled levels empty, with distinct actionable French levels', () => {
    for (const level of [undefined, null, 'off', 'unknown']) {
      expect(normalizeRoastLevel(level)).toBe('off');
      expect(roastInstructions(level)).toBe('');
    }
    const enabled = ROAST_LEVELS.filter((level) => level !== 'off');
    expect(new Set(enabled.map(roastInstructions)).size).toBe(3);
    for (const level of enabled) {
      const text = roastInstructions(level);
      expect(text).toContain(roastLabel(level));
      expect(text).toContain('En français');
      expect(text).toContain('diagnostic précis et une action utile');
      expect(text).toContain('jamais la personne');
      expect(text).toContain('commit');
      expect(text).toContain('pull request');
      expect(text).toContain('professionnels et sobres');
      expect(text).toContain('Respecte intégralement les schémas et formats');
    }
  });

  it('validates every host level strictly while preserving the legacy protocol', () => {
    const request = {
      type: 'saveAgent',
      requestId: 'save-roast',
      options: { scope: 'user', expectedRevision: null },
      agent,
    };
    expect(parseMessage(request)).toEqual(request);
    for (const roastLevel of ROAST_LEVELS)
      expect(parseMessage({ ...request, agent: { ...agent, roastLevel } })).toMatchObject({
        agent: { roastLevel },
      });
    for (const roastLevel of ['mild', 'LIGHT', true, 1, null, { level: 'light' }])
      expect(() => parseMessage({ ...request, agent: { ...agent, roastLevel } })).toThrow();
  });

  it('keeps off prompts unchanged and snapshot tone mandatory despite context exclusions and later profile changes', () => {
    const input = runInput();
    const legacyPrompt = buildPrompt(input);
    input.agent.roastLevel = 'off';
    expect(buildPrompt(input)).toBe(legacyPrompt);
    for (const level of ROAST_LEVELS) {
      input.attempt.roastLevel = level;
      input.agent.roastLevel = 'ruthless';
      input.launch = {
        initialContext: '',
        mcpServerIds: [],
        memoryIds: [],
        useProjectMemory: false,
        contextMode: 'empty',
        contextBlocks: { roast: { enabled: false, content: 'UNTRUSTED_REPLACEMENT' } },
      };
      const preview = previewContext(input);
      if (level === 'off') {
        expect(preview.sections.some((section) => section.id === 'roast')).toBe(false);
      } else {
        expect(preview.sections.find((section) => section.id === 'roast')).toMatchObject({
          source: 'system',
          enabled: true,
          editable: false,
        });
        expect(buildPrompt(input)).toContain(roastInstructions(level));
        expect(buildPrompt(input)).toContain('réponse finale lisible');
      }
      const frozenPrompt = buildPrompt(input);
      input.agent.roastLevel = 'light';
      expect(buildPrompt(input)).toBe(frozenPrompt);
    }
  });

  it('round trips personal/project levels without erasing instructions, extra YAML or stale edits', async () => {
    const { registry } = await fixture();
    await registry.saveAgent({ ...agent, roastLevel: 'light' });
    let personal = (await registry.load()).agents.find((a) => a.id === agent.id)!;
    await writeFile(
      personal.path,
      `---\n# Personal annotation\ncustom-policy: [retain, all]\nname: Reviewer\ndescription: Find actionable problems\ntools: [read]\nskills: []\nroastLevel: light\n---\n\n${agent.instructions}\n`,
    );
    const reloaded = await registry.load();
    expect(reloaded.notices).toEqual([]);
    personal = reloaded.agents.find((a) => a.id === agent.id)!;
    await registry.saveAgent(
      { ...personal, roastLevel: 'ruthless' },
      {
        scope: 'workspace',
        expectedRevision: null,
        sourceScope: 'user',
        sourceRevision: personal.revision,
      },
    );
    let active = (await registry.load()).agents.find((a) => a.id === agent.id)!;
    expect(active.roastLevel).toBe('ruthless');
    expect(active.versions?.map((v) => v.roastLevel)).toEqual(['light', 'ruthless']);
    expect(active.instructions).toBe(agent.instructions);
    expect(await readFile(active.path, 'utf8')).toContain('custom-policy:');
    expect(await readFile(active.path, 'utf8')).toContain('# Personal annotation');
    const stale = active;
    await registry.saveAgent(
      { ...active, roastLevel: 'spicy' },
      { scope: 'workspace', expectedRevision: active.revision! },
    );
    await expect(
      registry.saveAgent(
        { ...stale, roastLevel: 'off' },
        { scope: 'workspace', expectedRevision: stale.revision! },
      ),
    ).rejects.toThrow(/changé/);
    active = (await registry.load()).agents.find((a) => a.id === agent.id)!;
    // A legacy editor that omits roastLevel must preserve the existing customization.
    const { roastLevel: _roastLevel, ...legacy } = active;
    await registry.saveAgent(legacy, { scope: 'workspace', expectedRevision: active.revision! });
    active = (await registry.load()).agents.find((a) => a.id === agent.id)!;
    expect(active.roastLevel).toBe('spicy');
    await registry.saveAgent(
      { ...active, roastLevel: 'off' },
      { scope: 'workspace', expectedRevision: active.revision! },
    );
    expect((await registry.load()).agents.find((a) => a.id === agent.id)?.roastLevel).toBe('off');
    expect(
      (await registry.load()).agents.find((a) => a.id === agent.id)?.versions?.[0].roastLevel,
    ).toBe('light');
  });

  it('loads legacy profiles without inventing an enabled tone and rejects malformed saved metadata', async () => {
    const { registry } = await fixture();
    await registry.saveAgent(agent);
    const legacy = (await registry.load()).agents.find((a) => a.id === agent.id)!;
    expect(legacy.roastLevel).toBeUndefined();
    expect(roastInstructions(legacy.roastLevel)).toBe('');
    await expect(
      registry.saveAgent({ ...legacy, roastLevel: 'mild' as RoastLevel }),
    ).rejects.toThrow();
    await writeFile(
      legacy.path,
      `---\nname: Reviewer\ndescription: Review\nroastLevel: mild\n---\n${agent.instructions}`,
    );
    const data = await registry.load();
    expect(data.agents.some((a) => a.id === agent.id)).toBe(false);
    expect(data.notices.some((notice) => notice.includes('roastLevel'))).toBe(true);
  });

  it('preserves each exported/imported tone in portable kit metadata and actual installed files', async () => {
    for (const roastLevel of ROAST_LEVELS) {
      const source = await fixture();
      await source.registry.saveAgent({ ...agent, roastLevel });
      const kits = new KitService(source.registry);
      const bundle = await kits.compose(
        { id: 'roast-kit', name: 'Reviewer', description: '', version: '1' },
        [`agent:${agent.id}`],
      );
      expect(validateKit(bundle).nodes[0].roastLevel).toBe(roastLevel);
      const path = join(source.root, 'roundtrip.fskit.json');
      await writeFile(path, JSON.stringify(bundle));
      const destination = await fixture();
      const importer = new KitService(destination.registry);
      const imported = await importer.readBundle(path);
      const preview = await importer.preview(imported);
      expect(preview.nodes[0].roastLevel).toBe(roastLevel);
      await importer.install(preview.token);
      const installed = (await destination.registry.load()).agents.find((a) => a.id === agent.id)!;
      expect(installed.roastLevel).toBe(roastLevel);
      expect(installed.instructions).toBe(agent.instructions);
      const invalid = bundle.files.map((file) => {
        if (!file.path.startsWith('agents/')) return file;
        const content = Buffer.from(file.base64, 'base64')
          .toString()
          .replace(`roastLevel: ${roastLevel}`, 'roastLevel: mild');
        return {
          ...file,
          base64: Buffer.from(content).toString('base64'),
          sha256: createHash('sha256').update(content).digest('hex'),
        };
      });
      expect(() => validateKit({ ...bundle, files: invalid })).toThrow(/roastLevel/);
    }
  });
});
