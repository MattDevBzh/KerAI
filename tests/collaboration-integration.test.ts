import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { WorkflowEngine } from '../src/core/workflow';
import { nextAutopilotAction } from '../src/core/autopilot';
import { buildPrompt } from '../src/core/context';
import { defaultSettings, Store } from '../src/core/store';
import { StudioService } from '../src/host/StudioService';
import { runProcess } from '../src/host/process';
import { featureStateKey, previewCorrection } from '../src/shared/collaboration';
import type { CorrectionRequest } from '../src/shared/collaboration';
import type { RunInput } from '../src/shared/types';

const resources: { root: string; service: StudioService }[] = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.service.dispose();
    await rm(resource.root, { recursive: true, force: true });
  }
});
async function hosted() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-collaboration-independent-')));
  const workspace = join(root, 'repo');
  await mkdir(workspace);
  const git = await runProcess('git', ['init', '-b', 'validation'], workspace);
  if (git.code !== 0) throw new Error(git.stderr);
  const service = new StudioService(
    workspace,
    resolve('defaults'),
    new Store(join(root, 'storage')),
    () => true,
  );
  resources.push({ root, service });
  await service.initialize();
  const data = fixture();
  data.feature.branch = 'validation';
  service.engine = data.engine;
  service.state.features = data.engine.features;
  service.adapter = {
    check: async () => ({ state: 'ready', authenticated: true, models: [] }),
    run: async () => ({ content: 'New report', questions: [], changedFiles: [] }),
    dispose: async () => {},
  };
  return { ...data, service, workspace };
}

function fixture() {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'independent-review',
      name: 'Review route',
      description: '',
      icon: '',
      steps: [
        {
          id: 'dev',
          name: 'Dev',
          description: '',
          agentId: 'dev',
          policy: 'workspace-write',
          skills: [],
          dependsOn: [],
          artifact: 'dev.md',
          maxAttempts: 5,
        },
        {
          id: 'review',
          name: 'Review',
          description: '',
          agentId: 'review',
          policy: 'read-only',
          skills: [],
          dependsOn: ['dev'],
          artifact: 'review.md',
          maxAttempts: 5,
        },
        {
          id: 'notes',
          name: 'Independent notes',
          description: '',
          agentId: 'notes',
          policy: 'read-only',
          skills: [],
          dependsOn: [],
          artifact: 'notes.md',
          maxAttempts: 5,
        },
      ],
    },
    { title: 'Change', description: 'Original brief' },
  );
  for (const id of ['dev', 'review', 'notes']) {
    engine.beginRun(feature.id, id);
    engine.finishRun(feature.id, id, { content: `${id} report`, questions: [], changedFiles: [] });
    if (id !== 'notes') engine.approveStep(feature.id, id);
  }
  const request = (): CorrectionRequest => ({
    expectedStateKey: featureStateKey(feature),
    sourceStepId: 'review',
    rootStepIds: ['dev'],
    feedback: 'Use the revised API contract and recheck the callers.',
    findingIds: [],
    commentIds: [],
  });
  return { engine, feature, request };
}

describe('independent collaboration regression paths', () => {
  it('allows a correction route from the retained review after changing the initial brief', () => {
    const { engine, feature, request } = fixture();
    const review = feature.steps.find((step) => step.id === 'review')!.attempts.at(-1)!;
    engine.saveArtifact(feature.id, 'review', review.artifact!.content, {
      expectedAttemptId: review.id,
      expectedRevision: review.revision ?? 0,
      expectedStateKey: featureStateKey(feature),
      description: 'Revised brief',
    });
    expect(feature.steps.find((step) => step.id === 'review')?.status).toBe('stale');
    expect(previewCorrection(feature, request()).errors).toEqual([]);
  });

  it('does not approve an unrelated awaiting report while running a selected correction route', () => {
    const { engine, feature, request } = fixture();
    engine.requestCorrection(feature.id, request());
    feature.autopilot = {
      checkpoints: ['review'],
      maxRuns: 20,
      maxCorrectionCycles: 3,
      stepInputs: {},
      status: 'running',
      runs: 0,
      correctionCycles: 0,
      updatedAt: new Date().toISOString(),
    };
    const unrelated = structuredClone(feature.steps.find((step) => step.id === 'notes'));
    expect(nextAutopilotAction(feature)).toEqual({ kind: 'run', stepId: 'dev' });
    expect(feature.steps.find((step) => step.id === 'notes')).toEqual(unrelated);
  });

  it('includes explicitly requested correction feedback even for an agent with empty default context', () => {
    const { engine, feature, request } = fixture();
    const requested = request();
    engine.requestCorrection(feature.id, requested);
    const attempt = engine.beginRun(feature.id, 'dev');
    const input: RunInput = {
      feature,
      step: feature.steps[0],
      attempt,
      workspacePath: '/fixture',
      agent: {
        id: 'dev',
        name: 'Dev',
        description: '',
        instructions: 'Implement',
        tools: ['read', 'edit'],
        skills: [],
        path: '',
        source: 'user',
        emptyContextByDefault: true,
      },
      skills: [],
      settings: structuredClone(defaultSettings),
    };
    expect(buildPrompt(input)).toContain(requested.feedback);
    expect(buildPrompt(input)).toContain('Rapport historique avant correction');
  });

  it('does not bind answers from the previous brief to a new run after a brief revision', () => {
    const { engine, feature } = fixture();
    const review = feature.steps.find((step) => step.id === 'review')!.attempts.at(-1)!;
    const old = feature.steps[0].attempts.at(-1)!;
    old.answerBindings = {
      audience: {
        question: { id: 'audience', text: 'Old audience?' },
        answer: 'OLD_DECISION',
        origin: { stepId: 'dev', attemptId: old.id },
      },
    };
    old.answers = { audience: 'OLD_DECISION' };
    engine.saveArtifact(feature.id, 'review', review.artifact!.content, {
      expectedAttemptId: review.id,
      expectedRevision: review.revision ?? 0,
      expectedStateKey: featureStateKey(feature),
      description: 'Revised audience and security requirements',
    });
    const current = engine.beginRun(feature.id, 'dev');
    expect(current.descriptionRevision).toBe(1);
    expect(current.answers).toEqual({});
    expect(current.answerBindings).toEqual({});
  });

  it('does not reintroduce unaffected approved originals that the human excluded or adjusted in correction context', () => {
    const { engine, feature, request } = fixture();
    engine.approveStep(feature.id, 'notes');
    const cycle = engine.requestCorrection(feature.id, {
      ...request(),
      artifactContext: { notes: { enabled: false } },
    });
    const attempt = engine.beginRun(feature.id, 'dev');
    const input: RunInput = {
      feature,
      step: feature.steps[0],
      attempt,
      workspacePath: '/fixture',
      agent: {
        id: 'dev',
        name: 'Dev',
        description: '',
        instructions: 'Implement',
        tools: ['read'],
        skills: [],
        path: '',
        source: 'user',
      },
      skills: [],
      settings: structuredClone(defaultSettings),
    };
    expect(buildPrompt(input)).not.toContain('notes report');
    cycle.artifactContext!.notes = { content: 'ADJUSTED_INDEPENDENT_COPY' };
    expect(buildPrompt(input)).toContain('ADJUSTED_INDEPENDENT_COPY');
    expect(buildPrompt(input)).not.toContain('notes report');
  });

  it('continues downstream after a human approves an intermediate correction report', () => {
    const { engine, feature, request } = fixture();
    engine.requestCorrection(feature.id, { ...request(), sourceStepId: 'dev' });
    feature.autopilot = {
      checkpoints: [],
      maxRuns: 20,
      maxCorrectionCycles: 3,
      stepInputs: {},
      status: 'running',
      runs: 0,
      correctionCycles: 0,
      updatedAt: new Date().toISOString(),
    };
    engine.beginRun(feature.id, 'dev');
    engine.finishRun(feature.id, 'dev', {
      content: 'REVISED_DEV',
      questions: [],
      changedFiles: [],
    });
    expect(nextAutopilotAction(feature).kind).toBe('pause');
    engine.approveStep(feature.id, 'dev');
    expect(nextAutopilotAction(feature)).toEqual({ kind: 'run', stepId: 'review' });
    engine.beginRun(feature.id, 'review');
    engine.finishRun(feature.id, 'review', {
      content: 'REVISED_REVIEW',
      questions: [],
      changedFiles: [],
    });
    engine.approveStep(feature.id, 'review');
    expect(feature.corrections?.[0].status).toBe('completed');
    expect(feature.activeCorrectionId).toBeUndefined();
    expect(nextAutopilotAction(feature)).toEqual({ kind: 'approve', stepId: 'notes' });
  });
});

describe('host collaboration persistence and final decision', () => {
  it('executes only the selected route, sends chosen historical copies and stops for the new human review', async () => {
    const { service, feature, request } = await hosted();
    service.state.runtime = { state: 'ready', authenticated: true, models: [] };
    const template = service.state.agents[0];
    service.state.agents = ['dev', 'review', 'notes'].map((id) => ({
      ...template,
      id,
      instructions: 'Use selected context',
      skills: [],
      tools: ['read'],
    }));
    const agentFolder = join(service.workspacePath, '.github/agents');
    await mkdir(agentFolder, { recursive: true });
    for (const agent of service.state.agents)
      await writeFile(
        join(agentFolder, `${agent.id}.agent.md`),
        `---\nname: ${agent.id}\ndescription: Fixture agent\ntools: [read]\nskills: []\n---\nUse selected context\n`,
      );
    const inputs: RunInput[] = [];
    service.adapter.run = async (input) => {
      inputs.push(structuredClone(input));
      return { content: `NEW_${input.step.id}`, questions: [], changedFiles: [] };
    };
    const unrelated = structuredClone(feature.steps.find((step) => step.id === 'notes'));
    const correctionId = await service.requestCorrection(feature.id, {
      ...request(),
      artifactContext: {
        dev: { enabled: false },
        review: { content: 'SELECTED_REVIEW_COPY' },
        notes: { enabled: false },
      },
    });
    await expect.poll(() => feature.autopilot?.status, { timeout: 3000 }).toBe('paused');
    expect(inputs.map((input) => input.step.id)).toEqual(['dev', 'review']);
    expect(feature.steps.find((step) => step.id === 'notes')).toEqual(unrelated);
    for (const input of inputs) {
      expect(buildPrompt(input)).toContain('SELECTED_REVIEW_COPY');
      expect(buildPrompt(input)).not.toContain('dev report');
      expect(buildPrompt(input)).not.toContain('notes report');
    }
    const review = feature.steps.find((step) => step.id === 'review')!;
    expect(review.status).toBe('awaiting_review');
    expect(review.attempts.at(-1)?.artifact?.content).toBe('NEW_review');
    expect(feature.corrections?.find((cycle) => cycle.id === correctionId)?.status).toBe(
      'awaiting_review',
    );
    expect(feature.finalValidation).toBeUndefined();
    expect(
      (await service.store.load()).features[0].corrections?.[0].snapshot.artifacts.find(
        (source) => source.stepId === 'review',
      )?.artifact.content,
    ).toBe('review report');
  });

  it('preserves editorial versions and rejects a stale save before it can overwrite the winning draft', async () => {
    const { service, feature } = await hosted();
    const review = feature.steps.find((step) => step.id === 'review')!.attempts.at(-1)!;
    const options = {
      expectedAttemptId: review.id,
      expectedRevision: review.revision ?? 0,
      expectedStateKey: featureStateKey(feature),
      reason: 'Precise human correction',
    };
    await service.saveArtifact(feature.id, 'review', 'Winning revised report', options);
    await expect(
      service.saveArtifact(feature.id, 'review', 'Stale losing report', options),
    ).rejects.toThrow(/obsolète/);
    const saved = await service.store.load();
    const report = saved.features[0].steps.find((step) => step.id === 'review')!.attempts.at(-1)!;
    expect(report.artifact?.content).toBe('Winning revised report');
    expect(report.artifactVersions?.map((version) => [version.author, version.content])).toEqual([
      ['agent', 'review report'],
      ['human', 'Winning revised report'],
    ]);
    expect(report.artifactVersions?.at(-1)?.reason).toBe(options.reason);
    expect(feature.finalValidation).toBeUndefined();
  });

  it('checks current source files before final validation and persists an explicit human decision only', async () => {
    const { service, feature, workspace } = await hosted();
    service.engine.approveStep(feature.id, 'notes');
    expect(feature.status).toBe('awaiting_final_validation');
    expect(feature.finalValidation).toBeUndefined();
    const source = join(workspace, 'source.txt');
    await writeFile(source, 'Current source');
    feature.steps[0].attempts.at(-1)!.fileHashes = {
      'source.txt': createHash('sha256').update('Current source').digest('hex'),
    };
    await service.persist();
    const key = featureStateKey(feature);
    await writeFile(source, 'External modification');
    await expect(service.finalizeFeature(feature.id, key)).rejects.toThrow(/obsolète/);
    expect(feature.finalValidation).toBeUndefined();
    expect((await service.store.load()).features[0].finalValidation).toBeUndefined();
    await writeFile(source, 'Current source');
    const finalId = await service.finalizeFeature(feature.id, key);
    expect(feature.status).toBe('completed');
    expect(feature.finalValidation?.author).toBe('human');
    expect((await service.store.load()).features[0].finalValidation?.id).toBe(finalId);
    expect(await readFile(source, 'utf8')).toBe('Current source');
    await expect(service.finalizeFeature(feature.id, key)).rejects.toThrow(/changé|déjà/);
  });
});
