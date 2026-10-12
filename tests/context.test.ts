import { describe, expect, it } from 'vitest';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import { buildPrompt, emptyLaunch, previewContext, selectMemory } from '../src/core/context';
import type { RunInput, MemoryEntry } from '../src/shared/types';

function input(): RunInput {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'single',
      name: 'Single',
      description: '',
      icon: '',
      steps: [
        {
          id: 'dev',
          name: 'Dev',
          description: 'Implement',
          agentId: 'dev',
          policy: 'workspace-write',
          skills: [],
          dependsOn: [],
          artifact: 'dev.md',
          maxAttempts: 5,
        },
      ],
    },
    { title: 'Export', description: 'Export as CSV' },
  );
  const attempt = engine.beginRun(feature.id, 'dev');
  return {
    feature,
    step: feature.steps[0],
    attempt,
    workspacePath: '/fixture',
    agent: {
      id: 'dev',
      name: 'Dev',
      description: '',
      instructions: 'Respect public API',
      tools: ['read', 'edit'],
      skills: [],
      source: 'bundled',
      path: '',
    },
    skills: [],
    settings: structuredClone(defaultSettings),
    launch: { ...emptyLaunch(), initialContext: 'US-42: accents conservés dans le CSV' },
  };
}
const entry: MemoryEntry = {
  id: 'architecture',
  title: 'Architecture',
  content: 'Use the existing store',
  category: 'architecture',
  enabled: true,
  agentIds: [],
  updatedAt: '2026-10-13T00:00:00Z',
};

describe('deterministic context compiler', () => {
  it('previews the exact business prompt with manually entered user story and source labels', () => {
    const data = input();
    const preview = previewContext(data);
    expect(preview.prompt).toBe(buildPrompt(data));
    expect(preview.sections.find((s) => s.id === 'initial-context')).toMatchObject({
      source: 'human',
      content: expect.stringContaining('US-42'),
    });
    expect(preview.prompt.match(/Respect public API/g)).toHaveLength(1);
    expect(preview.characters).toBe(preview.prompt.length);
    expect(preview.fingerprint).toHaveLength(64);
    expect(previewContext(data).fingerprint).toBe(preview.fingerprint);
    data.launch!.initialContext += ' avec UTF-8';
    expect(previewContext(data).fingerprint).not.toBe(preview.fingerprint);
  });
  it('makes memory opt-in and filters agent applicability without model calls', () => {
    expect(selectMemory([entry], emptyLaunch(), 'dev')).toEqual([]);
    expect(
      selectMemory(
        [entry, { ...entry, id: 'private', agentIds: ['review'] }],
        { ...emptyLaunch(), useProjectMemory: true, memoryIds: [entry.id, 'private'] },
        'dev',
      ),
    ).toEqual([entry]);
    expect(selectMemory([entry], { ...emptyLaunch(), useProjectMemory: true }, 'dev')).toEqual([]);
    expect(
      selectMemory(
        [{ ...entry, enabled: false }],
        { ...emptyLaunch(), useProjectMemory: true },
        'dev',
      ),
    ).toEqual([]);
    expect(
      selectMemory(
        [{ ...entry, enabled: false }],
        { ...emptyLaunch(), useProjectMemory: true, memoryIds: [entry.id] },
        'dev',
      ),
    ).toHaveLength(0);
  });
  it('blocks oversized memory and prompt instead of adding a summarizer call or truncating silently', () => {
    const data = input();
    data.memory = [{ ...entry, content: 'a'.repeat(4100) }];
    const preview = previewContext(data);
    expect(preview.errors.join(' ')).toContain('4000');
    expect(preview.prompt).toContain('a'.repeat(4100));
    data.feature.budget = { maxRuns: 2, maxPromptChars: 1000, modelProfile: 'current' };
    expect(previewContext(data).errors.join(' ')).toContain('limite de 1000');
  });
  it('invalidates fingerprints when model, permission policy or MCP allowlist changes', () => {
    const data = input();
    const first = previewContext(data).fingerprint;
    data.step.model = 'different-model';
    expect(previewContext(data).fingerprint).not.toBe(first);
    const second = previewContext(data).fingerprint;
    data.step.policy = 'read-only';
    expect(previewContext(data).fingerprint).not.toBe(second);
    const third = previewContext(data).fingerprint;
    data.mcpServers = [
      {
        id: 'ado',
        name: 'ADO',
        transport: 'stdio',
        command: 'fixture',
        args: [],
        envKeys: [],
        headers: {},
        tools: ['wit_work_item'],
        enabled: true,
        autoApproveReadOnly: true,
      },
    ];
    expect(previewContext(data).fingerprint).not.toBe(third);
    expect(previewContext(data).prompt).toContain('wit_work_item');
  });
});
