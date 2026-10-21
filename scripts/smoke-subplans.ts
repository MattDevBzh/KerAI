/** Explicitly opted-in real Copilot test, using only a disposable repository. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/host/StudioService';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';
import { Store } from '../src/core/store';
import { runProcess } from '../src/host/process';
import { emptyLaunch } from '../src/core/context';
import { newSubplanStep, currentIteration, allFeatures } from '../src/shared/subplans';
import { agentStep } from '../src/shared/team';
import { featureStateKey } from '../src/shared/collaboration';
import { executionCallCount } from '../src/core/budgets';

const root = await mkdtemp(join(tmpdir(), 'feature-studio-subplan-live-'));
const repo = join(root, 'repo');
await mkdir(repo);
await runProcess('git', ['init', '-b', 'smoke'], repo);
await writeFile(join(repo, 'fixture.txt'), 'old\n');
const store = new Store(join(root, 'state'));
const previousCopilotDirectory = process.env.COPILOT_HOME;
process.env.COPILOT_HOME = join(root, 'isolated-profiles');
const service = new StudioService(repo, resolve('defaults'), store, () => true);
if (previousCopilotDirectory === undefined) delete process.env.COPILOT_HOME;
else process.env.COPILOT_HOME = previousCopilotDirectory;
const proof: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  runtime: 'Copilot CLI 1.0.102 / SDK 1.0.20',
  passed: false,
};
const proofPath = resolve(
  process.env.FEATURE_STUDIO_SMOKE_PROOF || '.vscode-test/subplan-live-proof.json',
);
service.on('errorNotice', (message) => console.error('Studio:', message));
const answered = new Set<string>();
service.on('state', (state: import('../src/shared/types').StudioState) => {
  for (const request of state.humanRequests ?? []) {
    if (answered.has(request.id)) continue;
    answered.add(request.id);
    console.log(JSON.stringify({ phase: 'fixture-human-question', question: request.question }));
    if (request.allowFreeform)
      service.answerHumanRequest(
        request.id,
        'Le périmètre et les critères sont entièrement définis : une seule tâche, fixture.txt doit contenir new, puis la commande node doit retourner zéro. Propose le découpage structuré ; sa validation sera faite séparément dans le cockpit.',
      );
    else throw new Error('Unexpected constrained question in the deterministic fixture');
  }
});
const deadline = setTimeout(() => {
  for (const f of service.engine.features) service.cancel(f.id);
}, 240000);
async function idle() {
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    if (
      !service.state.workspaceOperation &&
      !allFeatures(service.engine.features).some(
        (f) =>
          f.autopilot?.status === 'running' || f.steps.some((s) => s.attempts.at(-1)?.pair?.busy),
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timeout waiting for the native sub-team.');
}
try {
  await service.initialize();
  assert.equal(service.state.agents.find((a) => a.id === 'fs-tests')!.source, 'bundled');
  service.state.settings.timeoutMinutes = 2;
  service.adapter = new CopilotCliAdapter({
    cliPath:
      process.env.FEATURE_STUDIO_NATIVE_CLI ||
      resolve('.vscode-test/copilot-native/node_modules/.bin/copilot'),
    storagePath: join(root, 'runtime'),
    launcherPath: resolve('scripts/copilot-launcher.js'),
    getTools: async () => [],
  });
  await service.checkRuntime();
  assert.equal(service.state.runtime.state, 'ready');
  const feature = await service.createFeature({
    title: 'Isolated sub-team verification',
    description:
      "One tiny task only: change fixture.txt from old to new. The developer edits that single file and stops without running tests. After explicit code approval, the test agent must run node -e \"if(require('fs').readFileSync('fixture.txt','utf8').trim()!=='new')process.exit(1)\" and report the actual exit status. No network, no other files, no commits.",
    workflowId: 'single',
  });
  feature.execution = { mode: 'copilot-native', permissionMode: 'allow-all' };
  feature.budget!.maxRuns = 5;
  const card = newSubplanStep(),
    dev = agentStep(service.state.agents.find((a) => a.id === 'fs-dev')!),
    tests = agentStep(service.state.agents.find((a) => a.id === 'fs-tests')!);
  dev.name = 'Modify fixture only';
  dev.description =
    'Edit fixture.txt to contain new. Do not run any test or other command. Stop and report for human code review.';
  tests.name = 'Verify fixture after review';
  tests.description =
    'Run the node assertion in the feature brief and report its actual result. Do not change files.';
  tests.dependsOn = [dev.id];
  card.description =
    'Return exactly one task covering the tiny fixture mission, using the required structured format. The developer edits and the tester verifies in separate steps.';
  card.subplan = { mode: 'pair', teamName: 'Edit then test', steps: [dev, tests] };
  await service.saveFeatureTeam(feature.id, 0, [card]);
  const step = feature.steps[0];
  const preview = await service.previewRun(feature.id, step.id, '', false, emptyLaunch());
  assert.deepEqual(preview.errors, []);
  await service.runStep(feature.id, step.id, '', false, emptyLaunch(), preview.fingerprint);
  await idle();
  const a = step.attempts[0],
    pair = a.pair!;
  assert.equal(
    pair.phase,
    'planning',
    JSON.stringify({ error: pair.error, report: a.artifact?.content }),
  );
  assert.equal(pair.plans.at(-1)!.blocks.length, 1);
  assert.equal(step.subplanState, undefined);
  assert.equal((await readFile(join(repo, 'fixture.txt'), 'utf8')).trim(), 'old');
  await service.pairAction({
    type: 'pairAction',
    featureId: feature.id,
    stepId: step.id,
    attemptId: a.id,
    requestId: randomUUID(),
    expectedVersion: pair.version,
    action: 'approve-plan',
  });
  await idle();
  const child = currentIteration(step)!.feature,
    development = child.steps[0];
  assert.equal(
    development.status,
    'awaiting_review',
    JSON.stringify(development.attempts[0]?.pair?.error),
  );
  assert.equal((await readFile(join(repo, 'fixture.txt'), 'utf8')).trim(), 'new');
  assert.equal(child.steps[1].attempts.length, 0, 'Tests wait for explicit code approval');
  let latest = development.attempts.at(-1)!;
  await service.approveStep(child.id, development.id, latest.id, latest.revision ?? 0);
  await idle();
  const verification = child.steps[1];
  latest = verification.attempts.at(-1)!;
  assert.equal(verification.status, 'awaiting_review');
  const native = latest.nativeActivity ?? [];
  assert.ok(
    native.some((a) => a.exitCode === 0),
    'A real native command returned zero',
  );
  await service.approveStep(child.id, verification.id, latest.id, latest.revision ?? 0);
  await idle();
  await service.finalizeFeature(child.id, featureStateKey(child));
  await idle();
  assert.equal(step.status, 'awaiting_review');
  assert.equal(child.status, 'completed');
  assert.notEqual(
    feature.status,
    'completed',
    'The orchestrator result still requires human approval',
  );
  await service.approveStep(feature.id, step.id, a.id, a.revision ?? 0);
  await service.finalizeFeature(feature.id, featureStateKey(feature));
  assert.equal(feature.status, 'completed');
  const reloaded = await store.load();
  assert.equal(
    reloaded.features[0].steps[0].subplanState!.iterations[0].feature.status,
    'completed',
  );
  Object.assign(proof, {
    passed: true,
    model: a.model,
    calls: executionCallCount(feature),
    scenarios: [
      'native-read-only-orchestrator',
      'human-plan-approval',
      'native-file-edit',
      'human-code-approval-before-tests',
      'native-command-exit-zero',
      'child-final-approval',
      'parent-final-approval',
      'persisted-independent-history',
    ],
    limitations: [
      'Single task with two agents; recursive queues, revisions and interruption are verified by deterministic integration tests.',
    ],
  });
} catch (error) {
  proof.error = String(error);
  throw error;
} finally {
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n');
  clearTimeout(deadline);
  await service.dispose();
  console.log(JSON.stringify(proof));
}
