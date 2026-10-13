import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Store, defaultSettings } from '../src/core/store';
import { WorkflowEngine } from '../src/core/workflow';
import { nextAutopilotAction } from '../src/core/autopilot';
import { approvalBlockers } from '../src/core/validation';
import { ToolHost } from '../src/host/ToolHost';
import { StudioService } from '../src/host/StudioService';
import { runProcess } from '../src/host/process';
import { parseMessage } from '../src/host/messages';
import { installQualityKit } from '../src/host/QualityRunner';
import type { RunInput, TestEvidence } from '../src/shared/types';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'studio-quality-integration-')));
  roots.push(root);
  const workspace = path.join(root, 'repo');
  await mkdir(workspace);
  await runProcess('git', ['init', '-b', 'main'], workspace);
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'quality-feature',
      name: 'Quality',
      description: '',
      icon: '',
      steps: ['dev', 'counterexamples', 'review'].map((id, index, ids) => ({
        id,
        name: id,
        description: '',
        agentId: 'agent',
        policy: id === 'dev' ? 'workspace-write' : id === 'review' ? 'read-only' : 'tests',
        skills: [],
        artifact: `${id}.md`,
        maxAttempts: 3,
        dependsOn: index ? [ids[index - 1]] : [],
      })),
    },
    { title: 'Quality', description: '' },
  );
  engine.beginRun(feature.id, 'dev');
  engine.finishRun(feature.id, 'dev', { content: 'Development', questions: [], changedFiles: [] });
  engine.approveStep(feature.id, 'dev');
  feature.criteria = [{ id: 'C1', text: 'Reject empty name', status: 'pending', evidence: '' }];
  feature.steps[1].requiredQuality = 'counterexample';
  const attempt = engine.beginRun(feature.id, 'counterexamples');
  const input: RunInput = {
    feature,
    attempt,
    step: feature.steps[1],
    agent: {
      id: 'agent',
      name: 'agent',
      description: '',
      instructions: '',
      tools: ['read', 'edit', 'execute'],
      skills: [],
      source: 'bundled',
      path: '',
    },
    skills: [],
    workspacePath: workspace,
    qualityStoragePath: path.join(root, 'private'),
    settings: structuredClone(defaultSettings),
  };
  const proofs: TestEvidence[] = [];
  input.settings.testCommands = [
    {
      id: 'quality',
      name: 'Quality',
      command: process.execPath,
      args: ['-e', "console.log('No report')"],
      quality: { kind: 'counterexample', reportPath: '.feature-studio/quality/report.json' },
    },
  ];
  const invoke = async () => {
    const host = new ToolHost(
      input,
      {
        onEvent() {},
        onSession() {},
        onEvidence(proof) {
          proofs.push(proof);
        },
      },
      new AbortController().signal,
    );
    const tool = (await host.createTools()).find((t) => t.name === 'studio_run_test')!;
    return tool.handler!(
      { id: 'quality' },
      {
        sessionId: 'session',
        toolCallId: 'call',
        toolName: 'studio_run_test',
        arguments: { id: 'quality' },
      },
    );
  };
  return { root, workspace, engine, feature, attempt, input, proofs, invoke };
}
describe('quality integration with approved tools and bounded correction', () => {
  it('missing report sets authoritative error despite process exit zero', async () => {
    const f = await fixture();
    await f.invoke();
    expect(f.proofs[0]).toMatchObject({
      exitCode: 0,
      error: expect.stringContaining('unavailable'),
      quality: { status: 'unavailable' },
    });
    f.attempt.evidence = f.proofs;
    f.engine.finishRun(f.feature.id, 'counterexamples', {
      content: 'Agent claims pass',
      questions: [],
      changedFiles: [],
    });
    expect(approvalBlockers(f.feature, f.feature.steps[1], 'human').join(' ')).toContain('échec');
  });
  it('host report links reproducible counterexamples and bounded correction, then persists the proof', async () => {
    const f = await fixture();
    f.input.settings.testCommands[0].args = [
      '-e',
      `const fs=require('node:fs');const e=process.env;fs.writeFileSync(e.FEATURE_STUDIO_QUALITY_REPORT, JSON.stringify({version:1,nonce:e.FEATURE_STUDIO_QUALITY_NONCE,featureId:e.FEATURE_STUDIO_QUALITY_FEATURE,attemptId:e.FEATURE_STUDIO_QUALITY_ATTEMPT,commandId:e.FEATURE_STUDIO_QUALITY_COMMAND,kind:e.FEATURE_STUDIO_QUALITY_KIND,runner:'playwright',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),cases:[{id:'empty',title:'Empty name',criterionIds:['C1'],status:'failed',steps:['Submit empty name'],errors:['Accepted invalid name'],expected:'Validation error',actual:'Saved',reproduction:['Open form','Clear name','Save'],attachmentIds:[]}],attachments:[]}));`,
    ];
    await f.invoke();
    expect(f.proofs[0].quality?.status).toBe('failed');
    expect(f.proofs[0].error).toBeUndefined();
    f.attempt.evidence = f.proofs;
    f.engine.finishRun(f.feature.id, 'counterexamples', {
      content: 'Counterexample',
      questions: [],
      changedFiles: [],
    });
    f.feature.criteria = [{ id: 'C1', text: 'Reject empty name', status: 'pending', evidence: '' }];
    f.feature.autopilot = {
      status: 'running',
      checkpoints: ['review'],
      maxRuns: 8,
      maxCorrectionCycles: 1,
      correctionStepId: 'dev',
      reviewStepId: 'review',
      runs: 0,
      correctionCycles: 0,
      stepInputs: {},
      updatedAt: new Date().toISOString(),
    };
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'correct',
      stepId: 'dev',
      feedback: expect.stringContaining('Open form → Clear name → Save'),
    });
    expect(f.feature.criteria[0].status).toBe('pending');
    f.feature.autopilot.correctionCycles = 1;
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringContaining('cycles'),
    });
    f.feature.autopilot.correctionCycles = 0;
    f.attempt.fileHashes = { 'changed.ts': 'new-version' };
    expect(nextAutopilotAction(f.feature)).toMatchObject({
      kind: 'pause',
      reason: expect.stringContaining('obsolète'),
    });
    const store = new Store(path.join(f.root, 'storage'));
    await store.save([f.feature], f.input.settings, []);
    expect(
      (await store.load()).features[0].steps[1].attempts[0].evidence?.[0].quality?.cases[0]
        .reproduction,
    ).toEqual(['Open form', 'Clear name', 'Save']);
  });
  it('ToolHost rejects a nominal pass referencing criteria added after the attempt snapshot', async () => {
    const f = await fixture();
    f.input.settings.testCommands[0].args = [
      '-e',
      `const fs=require('node:fs');const e=process.env;fs.writeFileSync(e.FEATURE_STUDIO_QUALITY_REPORT,JSON.stringify({version:1,nonce:e.FEATURE_STUDIO_QUALITY_NONCE,featureId:e.FEATURE_STUDIO_QUALITY_FEATURE,attemptId:e.FEATURE_STUDIO_QUALITY_ATTEMPT,commandId:e.FEATURE_STUDIO_QUALITY_COMMAND,kind:e.FEATURE_STUDIO_QUALITY_KIND,runner:'playwright',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),cases:[{id:'unknown',title:'Unknown criterion',criterionIds:['LATER'],status:'passed',steps:['Assert'],errors:[],attachmentIds:[]}],attachments:[]}));`,
    ];
    const host = new ToolHost(
      f.input,
      {
        onEvent() {},
        onSession() {},
        onEvidence(proof) {
          f.proofs.push(proof);
        },
      },
      new AbortController().signal,
    );
    f.feature.criteria!.push({
      id: 'LATER',
      text: 'Added after snapshot',
      status: 'pending',
      evidence: '',
    });
    const tool = (await host.createTools()).find((tool) => tool.name === 'studio_run_test')!;
    await tool.handler!(
      { id: 'quality' },
      {
        sessionId: 'session',
        toolCallId: 'call',
        toolName: 'studio_run_test',
        arguments: { id: 'quality' },
      },
    );
    expect(f.proofs[0]).toMatchObject({
      exitCode: 0,
      quality: { status: 'invalid' },
      error: expect.stringContaining('critère inconnu'),
    });
    f.attempt.evidence = f.proofs;
    f.engine.finishRun(f.feature.id, 'counterexamples', {
      content: 'Nominal pass',
      questions: [],
      changedFiles: [],
    });
    expect(approvalBlockers(f.feature, f.feature.steps[1], 'autopilot').join(' ')).toContain(
      'contre-exemples',
    );
    const store = new Store(path.join(f.root, 'snapshot-storage'));
    await store.save([f.feature], f.input.settings, []);
    const persisted = (await store.load()).features[0];
    expect(persisted.steps[1].requiredQuality).toBe('counterexample');
    expect(persisted.steps[1].attempts[0].evidence?.[0].quality?.status).toBe('invalid');
    expect(approvalBlockers(persisted, persisted.steps[1], 'human').join(' ')).toContain(
      'contre-exemples',
    );
  });
  it('installs reporter explicitly without overwriting customization or following links', async () => {
    const f = await fixture(),
      bundled = path.resolve('defaults/quality');
    expect((await installQualityKit(f.workspace, bundled)).installed).toHaveLength(2);
    expect((await installQualityKit(f.workspace, bundled)).unchanged).toHaveLength(2);
    const file = path.join(f.workspace, '.feature-studio/quality-kit/playwright-reporter.cjs');
    await writeFile(file, 'customized');
    expect((await installQualityKit(f.workspace, bundled)).conflicts).toHaveLength(1);
    expect(await readFile(file, 'utf8')).toBe('customized');
    await rm(file);
    await symlink(path.join(f.root, 'outside'), file);
    await expect(installQualityKit(f.workspace, bundled)).rejects.toThrow('symbolique');
  });
  it('parses attachment ids only and service rejects another feature or untrusted installs', async () => {
    const f = await fixture();
    expect(() =>
      parseMessage({
        type: 'openQualityAttachment',
        featureId: 'f',
        evidenceId: 'e',
        attachmentId: 'a',
        path: '/etc/passwd',
      }),
    ).toThrow();
    let trusted = false;
    const service = new StudioService(
      f.workspace,
      path.resolve('defaults'),
      new Store(path.join(f.root, 'service')),
      () => trusted,
    );
    try {
      await service.initialize();
      await expect(service.installQualityKit()).rejects.toThrow('Approuve');
      trusted = true;
      await expect(service.qualityAttachment('unknown', 'proof', 'image')).rejects.toThrow();
      expect((await service.installQualityKit()).installed).toHaveLength(2);
    } finally {
      await service.dispose();
    }
  });
});
