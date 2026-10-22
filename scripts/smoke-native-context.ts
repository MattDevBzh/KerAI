/** Opt-in inference smoke. All files are disposable; catalogue profiles remain untouched. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import { nativeSkillName } from '../src/core/nativeSkills';
import type { RunInput } from '../src/shared/types';
import type { NativeContextLoad } from '../src/shared/native';

if (process.env.FEATURE_STUDIO_LIVE_TEST !== '1') throw new Error('Set FEATURE_STUDIO_LIVE_TEST=1 to authorize real inference.');
const root = await mkdtemp(join(tmpdir(), 'kerai-skills-live-'));
await mkdir(join(root, '.github/instructions'), { recursive: true });
await mkdir(join(root, 'src'), { recursive: true });
await writeFile(join(root, '.github/instructions/api.instructions.md'), '---\napplyTo: "src/**/*.ts"\n---\nFor this source code, report the marker INSTRUCTIONS_NATIVE_OK. Preserve human validation.');
await writeFile(join(root, 'src/code.ts'), 'export const fixture = true;\n');
const engine = new WorkflowEngine();
const feature = engine.createFeature({ id: 'fixture', name: 'Fixture', icon: '', description: '', steps: [{ id: 'review', name: 'Review', description: `Read src/code.ts, consult its applicable instruction file .github/instructions/api.instructions.md using view, and load the selected skill ${nativeSkillName('review')} using skill. Return the two exact markers found in the instructions and skill. Do not edit files or run commands.`, agentId: 'fixture', skills: ['review'], policy: 'read-only', dependsOn: [], artifact: 'review.md', maxAttempts: 2, model: 'gpt-6-luna' }] }, { title: 'Native context smoke', description: 'Verify lazy context loading and its receipts.' });
feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
const step = feature.steps[0], attempt = engine.beginRun(feature.id, step.id);
const input: RunInput = {
  feature, step, attempt, nativeReadOnly: true, workspacePath: root,
  agent: { id: 'fixture', name: 'Fixture', description: 'Read-only fixture', instructions: 'Follow the step exactly. Preserve human validation.', tools: [], skills: ['review'], source: 'bundled', path: '' },
  skills: [{ id: 'review', name: 'Native review', description: 'Required for this smoke review', content: '---\nname: review\ndescription: Native review\nallowed-tools: [bash]\n---\nReport the marker SKILL_NATIVE_OK. Do not execute commands.', source: 'bundled', path: '' }],
  settings: { ...defaultSettings, timeoutMinutes: 2 },
};
const loads: NativeContextLoad[] = [];
const adapter = new CopilotCliAdapter({ cliPath: process.env.FEATURE_STUDIO_NATIVE_CLI || resolve('.vscode-test/copilot-native/node_modules/.bin/copilot'), storagePath: join(root, 'state'), launcherPath: resolve('scripts/copilot-launcher.js'), getTools: async () => [] });
try {
  const status = await adapter.check();
  assert.equal(status.state, 'ready', status.error);
  console.log(JSON.stringify({ availableModels: status.models.map((m) => m.id) }));
  step.model = process.env.FEATURE_STUDIO_SMOKE_MODEL || status.models.find((m) => /luna|mini|haiku/i.test(m.id))?.id;
  assert.ok(step.model, 'No economical model available for the smoke');
  const result = await adapter.run(input, {
    onEvent: () => {}, onSession: () => {},
    onNativeContextLoad: (load) => { loads.push(load); },
    onNativePermission: async (request) => request.kind === 'read',
    onQuestion: async () => 'Follow the explicit read-only task; no changes or commands.',
  }, new AbortController().signal);
  assert.ok(loads.some((load) => load.kind === 'skill' && load.content.includes('SKILL_NATIVE_OK')));
  assert.ok(loads.some((load) => load.kind === 'instruction' && load.content.includes('INSTRUCTIONS_NATIVE_OK')));
  assert.ok(result.content.includes('SKILL_NATIVE_OK') && result.content.includes('INSTRUCTIONS_NATIVE_OK'));
  engine.finishRun(feature.id, step.id, result);
  assert.equal(step.status, 'awaiting_review');
  const proof = { checkedAt: new Date().toISOString(), cliVersion: status.version, sdkVersion: '1.0.20', status: 'passed', realInference: true, model: result.model, usage: result.usage, readOnly: true, validation: step.status, loads: loads.map(({ kind, trigger, digest }) => ({ kind, trigger, digest })) };
  await writeFile(resolve('docs/native-context-live-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally { await adapter.dispose(); }
