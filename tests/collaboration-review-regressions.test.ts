import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Tool } from '@github/copilot-sdk';
import { StudioService } from '../src/host/StudioService';
import { Store, defaultSettings } from '../src/core/store';
import { WorkflowEngine } from '../src/core/workflow';
import { buildPrompt } from '../src/core/context';
import { featureCompletionBlockers } from '../src/core/validation';
import { runProcess } from '../src/host/process';
import { featureStateKey } from '../src/shared/collaboration';
import type { RunInput, ReviewComment, Workflow } from '../src/shared/types';

const resources: { root: string; service?: StudioService }[] = [];
afterEach(async () => {
  for (const { root, service } of resources.splice(0)) {
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
const oldTest = "console.log('Placeholder test written by the developer');\n";
const completedTest =
  "const assert = require('node:assert/strict');\nconst fs = require('node:fs');\nassert.equal(fs.readFileSync('src/answer.txt', 'utf8'), '42');\nconsole.log('Real host assertion passed');\n";
const workflow: Workflow = {
  id: 'review-proof-regression',
  name: 'Developer and tests',
  description: '',
  icon: '',
  steps: [
    {
      id: 'dev',
      name: 'Developer',
      description: '',
      agentId: 'fs-dev',
      policy: 'workspace-write',
      skills: [],
      dependsOn: [],
      artifact: 'dev.md',
      maxAttempts: 5,
    },
    {
      id: 'tests',
      name: 'Tests',
      description: '',
      agentId: 'fs-tests',
      policy: 'tests',
      skills: [],
      dependsOn: ['dev'],
      artifact: 'tests.md',
      maxAttempts: 5,
    },
    {
      id: 'review',
      name: 'Review',
      description: '',
      agentId: 'fs-review',
      policy: 'read-only',
      skills: [],
      dependsOn: ['tests'],
      artifact: 'review.md',
      maxAttempts: 5,
    },
  ],
};
async function invoke(tools: Tool[], name: string, args: unknown) {
  const tool = tools.find((item) => item.name === name);
  if (!tool?.handler) throw new Error(`Tool missing: ${name}`);
  return (await tool.handler(args, {
    sessionId: 'fixture',
    toolCallId: 'fixture-call',
    toolName: name,
    arguments: args,
  })) as { resultType: string; textResultForLlm: string };
}
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'studio-independent-proof-regression-')),
  );
  const workspace = join(root, 'repo');
  await mkdir(workspace);
  const init = await runProcess('git', ['init', '-b', 'regression'], workspace);
  if (init.code !== 0) throw new Error(init.stderr);
  const service = new StudioService(
    workspace,
    resolve('defaults'),
    new Store(join(root, 'storage')),
    () => true,
  );
  resources.push({ root, service });
  await service.initialize();
  service.state.workflows.push(structuredClone(workflow));
  const inputs: RunInput[] = [];
  let failTests = false;
  service.adapter = {
    check: async () => ({ state: 'ready', authenticated: true, models: [] }),
    dispose: async () => {},
    run: async (input, callbacks, signal) => {
      inputs.push(structuredClone(input));
      const tools = await service.getTools(input, callbacks, signal);
      if (input.step.id === 'dev') {
        expect(
          (await invoke(tools, 'studio_write_file', { path: 'src/answer.txt', content: '42' }))
            .resultType,
        ).toBe('success');
        expect(
          (
            await invoke(tools, 'studio_write_file', {
              path: 'tests/answer.test.cjs',
              content: oldTest,
            })
          ).resultType,
        ).toBe('success');
      }
      if (input.step.id === 'tests') {
        const read = await invoke(tools, 'studio_read_file', { path: 'tests/answer.test.cjs' });
        expect(read.resultType).toBe('success');
        const text = await readFile(join(workspace, 'tests/answer.test.cjs'), 'utf8');
        if (text === oldTest) {
          expect(
            (
              await invoke(tools, 'studio_replace_text', {
                path: 'tests/answer.test.cjs',
                oldText: oldTest,
                newText: completedTest,
                expectedSha256: JSON.parse(read.textResultForLlm).sha256,
              })
            ).resultType,
          ).toBe('success');
        }
        const result = await invoke(tools, 'studio_run_test', {
          id: failTests ? 'fail' : 'assert-answer',
        });
        expect(result.textResultForLlm).toContain(
          failTests ? 'Intentional failing host check' : 'Real host assertion passed',
        );
      }
      return { content: `${input.step.id} report`, questions: [], changedFiles: [] };
    },
  };
  await service.checkRuntime();
  await service.saveSettings({
    ...service.state.settings,
    testCommands: [
      {
        id: 'assert-answer',
        name: 'Real answer assertion',
        command: process.execPath,
        args: ['tests/answer.test.cjs'],
      },
      {
        id: 'fail',
        name: 'Intentional failed check',
        command: process.execPath,
        args: ['-e', "console.error('Intentional failing host check'); process.exit(1)"],
      },
    ],
  });
  const feature = await service.createFeature({
    title: 'Proof ownership regression',
    description: 'Allow the tester to improve a test created by the developer.',
    workflowId: workflow.id,
  });
  return {
    root,
    workspace,
    service,
    feature,
    inputs,
    failTests: () => {
      failTests = true;
    },
  };
}
async function runAndApprove(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  await f.service.runStep(f.feature.id, id);
  const attempt = f.service.engine.getStep(f.feature.id, id).attempts.at(-1)!;
  await f.service.approveStep(f.feature.id, id, attempt.id, attempt.revision ?? 0);
}

describe('independent review regressions with host tools and real local checks', () => {
  it.each(['canonical', 'legacy'] as const)(
    'approves developer H1 then tester H2 with %s ownership, rejects external changes and finalizes with the current verified bytes',
    async (ownership) => {
      const f = await fixture();
      await runAndApprove(f, 'dev');
      const developerHash =
        f.feature.steps[0].attempts.at(-1)!.fileHashes!['tests/answer.test.cjs'];
      await runAndApprove(f, 'tests');
      const tests = f.feature.steps[1].attempts.at(-1)!;
      expect(tests.fileHashes!['tests/answer.test.cjs']).not.toBe(developerHash);
      expect(tests.evidence?.[0].exitCode).toBe(0);
      expect(tests.evidence?.[0].fileHashes['tests/answer.test.cjs']).toBe(
        tests.fileHashes!['tests/answer.test.cjs'],
      );
      if (ownership === 'legacy') {
        delete f.feature.workspaceFileHashes;
        f.feature.steps.reverse();
      }
      await runAndApprove(f, 'review');
      const key = featureStateKey(f.feature);
      await writeFile(
        join(f.workspace, 'tests/answer.test.cjs'),
        completedTest + '// External change\n',
      );
      await expect(f.service.finalizeFeature(f.feature.id, key)).rejects.toThrow(/obsolète|changé/);
      expect(f.feature.finalValidation).toBeUndefined();
      await writeFile(join(f.workspace, 'tests/answer.test.cjs'), completedTest);
      await writeFile(join(f.workspace, 'src/answer.txt'), '43');
      await expect(f.service.finalizeFeature(f.feature.id, key)).rejects.toThrow(/obsolète|changé/);
      await writeFile(join(f.workspace, 'src/answer.txt'), '42');
      const id = await f.service.finalizeFeature(f.feature.id, key);
      expect(f.feature.status).toBe('completed');
      expect((await f.service.store.load()).features[0].finalValidation?.id).toBe(id);
      expect(await readFile(join(f.workspace, 'tests/answer.test.cjs'), 'utf8')).toBe(
        completedTest,
      );
    },
  );

  it('does not use the global developer correction target after a failed test outside that selected correction route', async () => {
    const f = await fixture();
    await runAndApprove(f, 'dev');
    await runAndApprove(f, 'tests');
    await f.service.runStep(f.feature.id, 'review');
    await f.service.saveAutopilot(f.feature.id, {
      checkpoints: [],
      maxRuns: 10,
      maxCorrectionCycles: 3,
      reviewStepId: 'review',
      correctionStepId: 'dev',
      stepInputs: {},
    });
    const preservedDeveloper = structuredClone(f.feature.steps[0]);
    const priorRuns = f.inputs.length;
    f.failTests();
    await f.service.requestCorrection(f.feature.id, {
      expectedStateKey: featureStateKey(f.feature),
      sourceStepId: 'review',
      rootStepIds: ['tests'],
      feedback: 'Replay tests and review only; preserve the approved developer work.',
      findingIds: [],
      commentIds: [],
    });
    await expect.poll(() => f.feature.autopilot?.status, { timeout: 3000 }).toBe('paused');
    expect(f.inputs.slice(priorRuns).map((input) => input.step.id)).toEqual(['tests']);
    expect(f.feature.steps[0]).toEqual(preservedDeveloper);
    expect(f.feature.autopilot?.reason).toMatch(/correction|périmètre|route/i);
    expect(f.feature.steps[1].attempts.at(-1)?.evidence?.at(-1)?.exitCode).toBe(1);
  });

  it('sends selected comment snapshots only while preserving their original text across save and reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-independent-comments-'));
    resources.push({ root });
    const engine = new WorkflowEngine();
    const feature = engine.createFeature(workflow, {
      title: 'Comments',
      description: 'Selected comments only',
    });
    for (const step of feature.steps) {
      engine.beginRun(feature.id, step.id);
      engine.finishRun(feature.id, step.id, {
        content: `${step.id} report`,
        questions: [],
        changedFiles: [],
      });
      engine.approveStep(feature.id, step.id);
    }
    const reviewAttempt = feature.steps[2].attempts.at(-1)!;
    const comment = (id: string, stepId: string, text: string): ReviewComment => ({
      id,
      stepId,
      attemptId: reviewAttempt.id,
      text,
      blocking: false,
      resolved: false,
      createdAt: feature.updatedAt,
    });
    feature.reviewComments = [
      comment('selected', 'review', 'SELECTED_ORIGINAL_COMMENT'),
      { ...comment('excluded', 'review', 'EXCLUDED_ORIGINAL_COMMENT'), blocking: true },
    ];
    engine.requestCorrection(feature.id, {
      expectedStateKey: featureStateKey(feature),
      sourceStepId: 'review',
      rootStepIds: ['dev'],
      feedback: 'Use the selected comment only.',
      findingIds: [],
      commentIds: ['selected'],
    });
    const attempt = engine.beginRun(feature.id, 'dev');
    feature.reviewComments[0].text = 'SELECTED_MUTATED_AFTER_SNAPSHOT';
    feature.reviewComments[1].text = 'EXCLUDED_MUTATED_AFTER_SNAPSHOT';
    feature.reviewComments.push(comment('new-other', 'review', 'UNRELATED_NEW_COMMENT'));
    feature.reviewComments.push({
      ...comment('new-current', 'dev', 'NEW_CURRENT_ATTEMPT_COMMENT'),
      attemptId: attempt.id,
    });
    const store = new Store(root);
    await store.save(engine.features, structuredClone(defaultSettings));
    const restored = (await store.load()).features[0];
    const input: RunInput = {
      feature: restored,
      step: restored.steps[0],
      attempt: restored.steps[0].attempts.at(-1)!,
      workspacePath: '/fixture',
      agent: {
        id: 'fs-dev',
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
      launch: {
        initialContext: '',
        mcpServerIds: [],
        memoryIds: [],
        useProjectMemory: false,
        contextBlocks: {
          'review-comments': { enabled: true, content: 'EXCLUDED_ORIGINAL_COMMENT' },
        },
      },
    };
    expect(input.attempt.id).toBe(attempt.id);
    const prompt = buildPrompt(input);
    expect(prompt).toContain('SELECTED_ORIGINAL_COMMENT');
    for (const excluded of [
      'EXCLUDED_ORIGINAL_COMMENT',
      'SELECTED_MUTATED_AFTER_SNAPSHOT',
      'EXCLUDED_MUTATED_AFTER_SNAPSHOT',
      'UNRELATED_NEW_COMMENT',
    ])
      expect(prompt).not.toContain(excluded);
    expect(prompt.match(/SELECTED_ORIGINAL_COMMENT/g)).toHaveLength(1);
    expect(prompt.match(/NEW_CURRENT_ATTEMPT_COMMENT/g)).toHaveLength(1);
    expect(featureCompletionBlockers(restored)).toContain(
      'Des commentaires bloquants restent ouverts dans la feature.',
    );
    expect(
      restored.corrections?.[0].snapshot.comments.find((item) => item.id === 'excluded')?.text,
    ).toBe('EXCLUDED_ORIGINAL_COMMENT');
  });
});
