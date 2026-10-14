import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Tool } from '@github/copilot-sdk';
import { AgentRegistry } from '../src/core/registry';
import { WorkflowEngine } from '../src/core/workflow';
import { Store, defaultSettings } from '../src/core/store';
import { approvalBlockers } from '../src/core/validation';
import { nextAutopilotAction } from '../src/core/autopilot';
import { emptyLaunch, previewContext, promptSections } from '../src/core/context';
import { ToolHost } from '../src/host/ToolHost';
import { sha256 } from '../src/host/PolicyEngine';
import { runProcess } from '../src/host/process';
import type { RunInput, TestEvidence } from '../src/shared/types';
import { mockDevOps, target } from './fixtures/devops-kit';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function git(root: string, ...args: string[]) {
  const result = await runProcess('git', args, root);
  if (result.code) throw new Error(result.stderr);
  return result.stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'studio-devops-kit-'));
  roots.push(root);
  const workspace = join(root, 'repo');
  await mkdir(workspace);
  const registry = new AgentRegistry(workspace, resolve('defaults'), join(root, 'user'));
  const data = await registry.load();
  const workflow = data.workflows.find((item) => item.id === 'devops')!;
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(workflow, {
    title: 'Tester un pipeline',
    description: 'Fixture',
  });
  for (const step of feature.steps.slice(0, -1)) {
    engine.beginRun(feature.id, step.id);
    engine.finishRun(feature.id, step.id, {
      content: 'Livrable approuvé',
      questions: [],
      changedFiles: [],
      review: { verdict: 'pass', summary: 'Relu', findings: [] },
    });
    engine.approveStep(feature.id, step.id);
  }
  await git(workspace, 'init', '-b', 'test/devops');
  await git(workspace, 'config', 'user.name', 'Fixture');
  await git(workspace, 'config', 'user.email', 'fixture@example.invalid');
  await mkdir(join(workspace, 'pipelines'));
  await writeFile(join(workspace, 'pipelines/test.yml'), 'trigger: none\nstages: []\n');
  await git(workspace, 'add', 'pipelines/test.yml');
  await git(workspace, 'commit', '-m', 'fixture');
  const commit = await git(workspace, 'rev-parse', 'HEAD');
  const step = feature.steps.at(-1)!;
  const attempt = engine.beginRun(feature.id, step.id);
  const agent = data.agents.find((agent) => agent.id === step.agentId)!;
  const input: RunInput = {
    feature,
    step,
    attempt,
    agent,
    skills: data.skills.filter((skill) => [...agent.skills, ...step.skills].includes(skill.id)),
    workspacePath: workspace,
    settings: structuredClone(defaultSettings),
    launch: { ...emptyLaunch(), devopsTest: { ...target, commit } },
    devopsProjectKey: 'org/project/repo',
  };
  attempt.launch = structuredClone(input.launch);
  const mock = mockDevOps();
  mock.state.run.sourceVersion = commit;
  const evidence: TestEvidence[] = [];
  const host = new ToolHost(
    input,
    { onEvent: () => {}, onSession: () => {}, onEvidence: (proof) => evidence.push(proof) },
    new AbortController().signal,
    () => mock.inspector,
  );
  const tools = await host.createTools();
  const finish = () => {
    attempt.evidence = structuredClone(evidence);
    engine.finishRun(feature.id, step.id, {
      content: 'Critères relus sur les preuves',
      questions: [],
      changedFiles: [],
      review: { verdict: 'pass', summary: 'Critères vérifiés', findings: [] },
    });
  };
  return {
    root,
    workspace,
    registry,
    data,
    workflow,
    engine,
    feature,
    step,
    attempt,
    input,
    mock,
    evidence,
    tools,
    finish,
  };
}
async function invoke(tools: Tool[], name: string, args: unknown) {
  const handler = tools.find((tool) => tool.name === name)!.handler!;
  return (await handler(args, {
    sessionId: 'session',
    toolCallId: 'call',
    toolName: name,
    arguments: args,
  })) as { resultType: string; textResultForLlm: string };
}

describe('DevOps kit integration', () => {
  it('publishes object parameters while rejecting invalid query combinations before any API call', async () => {
    const f = await fixture();
    const tool = f.tools.find((item) => item.name === 'studio_devops_inspect')!;
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['kind'],
      additionalProperties: false,
      properties: { kind: { enum: expect.arrayContaining(['pipeline', 'build']) } },
    });
    expect(tool.parameters).not.toHaveProperty('oneOf');
    for (const args of [
      { kind: 'pipeline' },
      { kind: 'builds' },
      { kind: 'timeline', pipelineId: 42 },
      { kind: 'build', buildId: 1, revision: 2 },
      { kind: 'pipelines', buildId: 1 },
      { kind: 'pipeline', pipelineId: -1 },
      { kind: 'pipeline', pipelineId: 42, url: 'https://example.invalid' },
    ]) {
      expect((await invoke(f.tools, tool.name, args)).resultType).toBe('failure');
    }
    expect(f.mock.calls).toHaveLength(0);
    expect(
      (await invoke(f.tools, tool.name, { kind: 'pipeline', pipelineId: 42, revision: 3 }))
        .resultType,
    ).toBe('success');
    expect(f.mock.calls.length).toBeGreaterThan(0);
    expect(f.mock.calls.every((call) => call.init?.method === 'GET')).toBe(true);
  });
  it('loads six steps and installs agents, skills and the runnable script without overwriting personal files', async () => {
    const f = await fixture();
    expect(f.data.notices).toEqual([]);
    expect(f.workflow.steps.map((step) => step.id)).toEqual([
      'challenge',
      'plan',
      'implement',
      'review',
      'test-guide',
      'validate',
    ]);
    expect(
      f.workflow.steps.filter((step) => step.policy !== 'read-only').map((step) => step.id),
    ).toEqual(['implement']);
    const report = await f.registry.installKit();
    expect(report.installed).toContain(join('skills/devops-inspect/scripts/ado-readonly.cjs'));
    expect(report.installed).toContain(join('skills/devops-azure-preflight/LICENSE'));
    expect(report.installed).toContain(join('skills/devops-azure-preflight/sources.json'));
    const installed = await f.registry.load();
    for (const data of [f.data, installed]) {
      for (const id of ['plan', 'review', 'test-guide', 'validate']) {
        const step = f.feature.steps.find((step) => step.id === id)!;
        const agent = data.agents.find((agent) => agent.id === step.agentId)!;
        const sections = promptSections({
          ...f.input,
          step,
          agent,
          skills: data.skills.filter((skill) =>
            [...agent.skills, ...step.skills].includes(skill.id),
          ),
        });
        const preflight = sections.filter(
          (section) => section.id === 'skill:devops-azure-preflight',
        );
        expect(preflight).toHaveLength(1);
        expect(preflight[0].content).toContain('azure-validate de Microsoft');
        expect(agent.tools).not.toContain('execute');
      }
    }
    const script = join(f.registry.userPath, 'skills/devops-inspect/scripts/ado-readonly.cjs');
    expect((await runProcess(process.execPath, [script, '--help'], f.workspace)).code).toBe(0);
    const skill = join(f.registry.userPath, 'skills/devops-plan/SKILL.md');
    await writeFile(skill, 'Personal instructions');
    expect((await f.registry.installKit()).conflicts).toContain(
      join('skills/devops-plan/SKILL.md'),
    );
    expect(await readFile(skill, 'utf8')).toBe('Personal instructions');
  });
  it('exposes only explicit read capabilities and rejects model-supplied test references', async () => {
    const f = await fixture();
    expect(f.tools.map((tool) => tool.name)).toContain('studio_devops_verify_test');
    expect(f.tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(['studio_run_test', 'studio_write_file']),
    );
    expect((await invoke(f.tools, 'studio_devops_verify_test', { buildId: 999 })).resultType).toBe(
      'failure',
    );
    expect(f.mock.calls).toHaveLength(0);
    f.input.agent = { ...f.input.agent, tools: ['read'] };
    const plain = await new ToolHost(
      f.input,
      { onEvent: () => {}, onSession: () => {} },
      new AbortController().signal,
      () => f.mock.inspector,
    ).createTools();
    expect(plain.some((tool) => tool.name.startsWith('studio_devops_'))).toBe(false);
  });
  it('requires a host proof plus a review, persists exact provenance and accepts a verified manual test', async () => {
    const f = await fixture();
    await invoke(f.tools, 'studio_read_file', { path: 'pipelines/test.yml' });
    expect((await invoke(f.tools, 'studio_devops_verify_test', {})).resultType).toBe('success');
    f.finish();
    expect(f.evidence[0].devops?.status).toBe('passed');
    expect(f.evidence[0].fileHashes['pipelines/test.yml']).toBe(
      sha256('trigger: none\nstages: []\n'),
    );
    expect(approvalBlockers(f.feature, f.step, 'human')).toEqual([]);
    const store = new Store(join(f.root, 'store'));
    await store.save([f.feature], defaultSettings);
    const restored = (await store.load()).features[0].steps.at(-1)!;
    expect(restored.attempts[0].evidence?.[0].devops).toEqual(f.evidence[0].devops);
    const proof = f.attempt.evidence!;
    f.attempt.evidence = [];
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toMatch(/vérification hôte/);
    f.attempt.evidence = proof;
    f.attempt.review = undefined;
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toMatch(/structurée/);
  });
  it('rejects local edits not included in the tested commit and mismatched proof provenance', async () => {
    const f = await fixture();
    await writeFile(join(f.workspace, 'pipelines/test.yml'), 'trigger: [main]\n');
    await invoke(f.tools, 'studio_read_file', { path: 'pipelines/test.yml' });
    await invoke(f.tools, 'studio_devops_verify_test', {});
    f.finish();
    expect(f.evidence[0].devops?.status).toBe('failed');
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toMatch(/vérification hôte/);
    f.attempt.evidence![0].devops!.status = 'passed';
    f.attempt.evidence![0].devops!.attemptId = 'another-attempt';
    expect(approvalBlockers(f.feature, f.step, 'human').join(' ')).toMatch(/vérification hôte/);
  });
  it('always pauses the pilot before the test gate and pins human target and connection into previews', async () => {
    const f = await fixture();
    f.step.status = 'pending';
    f.step.attempts = [];
    f.step.askBeforeRun = false;
    f.feature.autopilot = {
      status: 'running',
      checkpoints: [],
      maxRuns: 10,
      runs: 0,
      maxCorrectionCycles: 0,
      correctionCycles: 0,
      stepInputs: {},
      updatedAt: 'now',
    };
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringContaining('test hors production'),
    });
    const before = previewContext(f.input);
    f.input.launch!.devopsTest!.buildId = 124;
    expect(previewContext(f.input).fingerprint).not.toBe(before.fingerprint);
    f.input.launch!.contextMode = 'empty';
    expect(
      previewContext(f.input).sections.find((section) => section.id === 'devops-test'),
    ).toMatchObject({ enabled: true, editable: false });
    const targetPreview = previewContext(f.input);
    f.input.devopsProjectKey = 'another/project/repo';
    expect(previewContext(f.input).fingerprint).not.toBe(targetPreview.fingerprint);
  });
});
