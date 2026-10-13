import { describe, expect, it } from 'vitest';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import { buildPrompt, emptyLaunch, previewContext, selectMemory } from '../src/core/context';
import type { RunInput, MemoryEntry } from '../src/shared/types';
import { launchSchema } from '../src/core/evolutionSchemas';

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
  it('compiles full question, choices, answer and original provenance without depending on a resumed session', () => {
    const data = input();
    data.attempt.questions = [];
    data.attempt.answers = { q1: 'Privé', orphan: 'Question perdue' };
    data.attempt.answerBindings = {
      q1: {
        question: { id: 'q1', text: 'Qui peut accéder au rapport ?', choices: ['Public', 'Privé'] },
        answer: 'Privé',
        origin: { stepId: data.step.id, attemptId: 'original-attempt' },
      },
    };
    const fresh = buildPrompt(data);
    expect(fresh).toContain('Qui peut accéder au rapport ?');
    expect(fresh).toContain('["Public","Privé"]');
    expect(fresh).toContain('Réponse humaine : Privé');
    expect(fresh).toContain('étape dev, tentative original-attempt');
    expect(fresh).not.toContain('Question perdue');
    data.resumeSessionId = 'existing-session';
    expect(buildPrompt(data)).toBe(fresh);
  });
  it('can exclude a spec, edit a plan for one run and retain execution rules without altering sources', () => {
    const data = input();
    for (const [id, content] of [
      ['specs', 'SPEC_ORIGINALE'],
      ['plan', 'PLAN_ORIGINAL'],
    ])
      data.feature.steps.push({
        ...structuredClone(data.step),
        id,
        name: id,
        dependsOn: [],
        status: 'approved',
        attempts: [
          {
            ...structuredClone(data.attempt),
            id,
            status: 'approved',
            artifact: { name: `${id}.md`, content, updatedAt: 'now' },
          },
        ],
      });
    const original = structuredClone(data.feature);
    const before = previewContext(data);
    data.launch!.contextBlocks = {
      'artifact:specs': { enabled: false },
      'artifact:plan': { enabled: true, content: 'PLAN_PERSONNALISÉ' },
    };
    const result = previewContext(data);
    expect(result.prompt).not.toContain('SPEC_ORIGINALE');
    expect(result.prompt).not.toContain('PLAN_ORIGINAL');
    expect(result.prompt).toContain('PLAN_PERSONNALISÉ');
    expect(result.sections.find((section) => section.id === 'artifact:specs')).toMatchObject({
      enabled: false,
      content: expect.stringContaining('SPEC_ORIGINALE'),
    });
    expect(result.prompt).toBe(buildPrompt(data));
    expect(result.fingerprint).not.toBe(before.fingerprint);
    expect(data.feature).toEqual(original);
    expect(result.characters).toBe(result.prompt.length);
    expect(
      result.sections
        .filter((section) => section.source === 'system')
        .every((section) => section.enabled && !section.editable),
    ).toBe(true);
  });
  it('starts all optional blocks unchecked for an empty-default agent and allows explicit selection', () => {
    const data = input();
    data.agent.emptyContextByDefault = true;
    data.memory = [{ ...entry, content: 'a'.repeat(4100) }];
    const empty = previewContext(data);
    expect(
      empty.sections
        .filter((section) => section.source !== 'system')
        .every((section) => !section.enabled),
    ).toBe(true);
    expect(empty.prompt).not.toContain('US-42');
    expect(empty.prompt).not.toContain('Respect public API');
    expect(empty.errors).toEqual([]);
    data.launch!.contextBlocks = { 'initial-context': { enabled: true } };
    expect(buildPrompt(data)).toContain('US-42');
    expect(buildPrompt(data)).not.toContain('Respect public API');
    data.launch!.contextMode = 'all';
    expect(buildPrompt(data)).toContain('Respect public API');
  });
  it('rejects attempts to change execution rules and bounds custom content at the host boundary', () => {
    for (const id of ['step', 'completion', 'tools', 'review-result'])
      expect(() =>
        launchSchema.parse({
          ...emptyLaunch(),
          contextBlocks: { [id]: { enabled: false, content: 'override' } },
        }),
      ).toThrow();
    expect(() =>
      launchSchema.parse({
        ...emptyLaunch(),
        contextBlocks: { agent: { content: 'x'.repeat(60001) } },
      }),
    ).toThrow();
    expect(launchSchema.parse(emptyLaunch())).toEqual(emptyLaunch());
  });
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
  it('invalidates fingerprints when model, permissions, MCP or execution root changes', () => {
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
    const fourth = previewContext(data).fingerprint;
    data.workspacePath = '/isolated-feature-worktree';
    expect(previewContext(data).fingerprint).not.toBe(fourth);
  });
});
