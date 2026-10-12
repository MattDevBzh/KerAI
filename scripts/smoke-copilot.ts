/** Opt-in integration check; consumes Copilot usage. Never included in npm test or CI. */
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';
import { ToolHost } from '../src/host/ToolHost';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import type { RunInput } from '../src/shared/types';

if (process.env.FEATURE_STUDIO_LIVE_TEST !== '1') throw new Error('Opt-in requis : FEATURE_STUDIO_LIVE_TEST=1. Ce test consomme un appel Copilot.');
const root = await mkdtemp(path.join(tmpdir(), 'feature-studio-live-'));
const marker = `STUDIO-${randomUUID()}`;
await writeFile(path.join(root, 'README.md'), `# Integration fixture\n\nMarker: ${marker}\n`);
const engine = new WorkflowEngine();
const feature = engine.createFeature({ id: 'smoke', name: 'Live transport smoke', description: '', icon: 'test', steps: [{ id: 'read', name: 'Read fixture', description: 'Read README.md using studio_read_file. Return only its Marker value, then stop. Do not ask questions or use other tools.', agentId: 'smoke', policy: 'read-only', skills: [], maxAttempts: 2, artifact: 'proof.md', dependsOn: [] }] }, { title: 'One minimal integration request', description: 'Check the host file tool with a real response.' });
const step = feature.steps[0], attempt = engine.beginRun(feature.id, step.id);
const input: RunInput = { feature, step, attempt, agent: { id: 'smoke', name: 'Smoke', description: 'Read-only integration check', instructions: 'Follow the current step exactly. Use studio_read_file to read README.md. No other task.', tools: ['read'], source: 'bundled', path: '', skills: [] }, skills: [], workspacePath: root, settings: { ...defaultSettings, timeoutMinutes: 1 } };
const adapter = new CopilotCliAdapter({ cliPath: process.env.COPILOT_CLI_PATH || 'copilot', storagePath: path.join(root, 'runtime'), getTools: async (i, c, s) => new ToolHost(i, c, s).createTools() });
const events: { kind: string; message: string }[] = [];
try {
  const status = await adapter.check(); console.log(JSON.stringify({ phase: 'check', state: status.state, version: status.version, authenticated: status.authenticated, models: status.models.map(m => m.id), error: status.error }));
  if (status.state !== 'ready') throw new Error(status.error);
  const result = await adapter.run(input, { onEvent: event => { events.push(event); console.log(JSON.stringify({ kind: event.kind, message: event.message })); }, onSession: id => console.log(JSON.stringify({ session: id })) }, new AbortController().signal);
  if (!result.content.includes(marker)) throw new Error('Response did not match fixture marker.');
  if (!(await readFile(path.join(root, 'README.md'), 'utf8')).includes(marker)) throw new Error('Fixture modified unexpectedly.');
  engine.finishRun(feature.id, step.id, result); engine.approveStep(feature.id, step.id);
  const proof = { checkedAt: new Date().toISOString(), cliVersion: status.version, sdkVersion: '1.0.20', status: 'passed', readOnly: true, toolCallObserved: events.some(e => e.message.includes('studio_read_file')), featureStatus: feature.status, usage: result.usage, model: result.model, sessionId: result.sessionId };
  await writeFile(path.join(process.cwd(), 'docs/live-smoke.json'), JSON.stringify(proof, null, 2) + '\n'); console.log(JSON.stringify(proof));
} finally { await adapter.dispose(); }
