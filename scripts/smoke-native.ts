/** Isolated real-runtime tools/permissions check. No model call unless explicitly opted in. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CopilotClient, type CopilotSession } from '@github/copilot-sdk';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import type { RunInput, RunCallbacks } from '../src/shared/types';
import type { NativeActivity } from '../src/shared/native';

const root = await mkdtemp(join(tmpdir(), 'feature-studio-native-'));
const cliPath =
  process.env.FEATURE_STUDIO_NATIVE_CLI ||
  resolve('.vscode-test/copilot-native/node_modules/.bin/copilot');
const live = process.env.FEATURE_STUDIO_LIVE_TEST === '1';
const conversation = process.env.FEATURE_STUDIO_CONVERSATION_TEST === '1';
const stop = 'NATIVE_SMOKE_STOP_BEFORE_MODEL';
const proof: Record<string, unknown> = {
  root,
  cliPath,
  live,
  sdk: '1.0.20',
  checkedAt: new Date().toISOString(),
  scenarios: [],
};
const scenarios = proof.scenarios as Record<string, unknown>[];
const engine = new WorkflowEngine();
const feature = engine.createFeature(
  {
    id: 'native',
    name: 'Native',
    icon: 'test',
    description: '',
    steps: [
      {
        id: 'work',
        name: 'Work',
        description: '',
        agentId: 'fixture',
        policy: 'workspace-write',
        skills: [],
        maxAttempts: 10,
        artifact: 'result.md',
        dependsOn: [],
      },
    ],
  },
  {
    title: 'Native fixture',
    description:
      'Read fixture.txt, replace old with new, execute node -e "process.exit(0)" and report what happened.',
    agentId: 'fixture',
  },
);
feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
const step = feature.steps[0];
step.description = feature.description;
step.maxAttempts = 10;
const attempt = engine.beginRun(feature.id, step.id);
const input: RunInput = {
  feature,
  step,
  attempt,
  workspacePath: root,
  settings: { ...defaultSettings, timeoutMinutes: 2 },
  skills: [],
  agent: {
    id: 'fixture',
    name: 'Fixture',
    description: 'Test',
    instructions: 'Follow the request exactly. Only work with fixture.txt. No network.',
    tools: [],
    skills: [],
    source: 'bundled',
    path: '',
  },
};
await writeFile(join(root, 'fixture.txt'), 'old\n');
let permissionCalls = 0,
  deny = false,
  userQuestions = 0,
  sessionId = '';
const activities: NativeActivity[] = [];
const nativeEvents: string[] = [],
  nativeMessages: unknown[] = [],
  receipts: string[] = [];
let steering = false,
  steeringPromise: Promise<string | undefined> | undefined;
const callbacks: RunCallbacks = {
  onEvent: (event) => {
    if (event.kind !== 'message')
      console.log(JSON.stringify({ kind: event.kind, message: event.message.slice(0, 300) }));
  },
  onSession: (id) => {
    sessionId = id;
  },
  onNativePermission: async (request) => {
    permissionCalls++;
    scenarios.push({ permission: request.kind, allowed: !deny });
    return !deny;
  },
  onQuestion: async () => {
    userQuestions++;
    return 'Blue';
  },
  onNativeEventId: (id) => {
    nativeEvents.push(id);
  },
  onNativeMessage: (message) => {
    nativeMessages.push(message);
  },
  onNativeMessageReceived: (id) => {
    receipts.push(id);
  },
  onNativeActivity: (activity) => {
    activities.push(activity);
    if (
      steering &&
      !steeringPromise &&
      activity.status === 'running' &&
      ['bash', 'powershell'].includes(activity.tool)
    )
      steeringPromise = adapter.sendMessage(
        sessionId,
        'Continue the approved work. End your final reply with the exact marker STEERING_CONFIRMED.',
      );
  },
};
let intercept: ((session: CopilotSession) => Promise<void>) | undefined;
const adapter = new CopilotCliAdapter({
  cliPath,
  storagePath: join(root, 'runtime'),
  launcherPath: resolve('scripts/copilot-launcher.js'),
  getTools: async () => [],
  clientFactory: (options) => {
    const client = new CopilotClient(options);
    for (const name of ['createSession', 'resumeSession'] as const) {
      const original = client[name].bind(client) as (...args: unknown[]) => Promise<CopilotSession>;
      (client[name] as unknown) = async (...args: unknown[]) => {
        const session = await original(...args);
        if (!live)
          session.send = async () => {
            if (intercept) await intercept(session);
            throw new Error(stop);
          };
        return session;
      };
    }
    return client;
  },
});
async function runIntercept(action: (session: CopilotSession) => Promise<void>, resume = false) {
  intercept = action;
  input.resumeSessionId = resume ? sessionId : undefined;
  await assert.rejects(
    adapter.run(input, callbacks, new AbortController().signal),
    new RegExp(stop),
  );
}
try {
  const status = await adapter.check();
  proof.runtime = status;
  console.log(JSON.stringify({ phase: 'capabilities', status }));
  assert.equal(status.state, 'ready');
  assert.equal(status.native?.available, true);
  if (live && conversation) {
    const turns: unknown[] = [];
    Object.assign(proof, { conversation: true, turns, nativeMessages, receipts, activities });
    input.nativeReadOnly = true;
    input.preparedPrompt =
      'Read fixture.txt with view. Briefly explain its current contents. Do not modify anything or propose a tool call outside the read catalog.';
    turns.push(await adapter.run(input, callbacks, new AbortController().signal));
    assert.equal(await readFile(join(root, 'fixture.txt'), 'utf8'), 'old\n');
    const original = sessionId;
    input.nativeReadOnly = false;
    input.resumeSessionId = original;
    input.previousEventIds = [...nativeEvents];
    input.preparedPrompt =
      'Work is now approved: first run node -e "setTimeout(() => console.log(42), 12000)" synchronously in the shell. Then edit fixture.txt from old to new. Do not touch any other file. Report the change and command result.';
    steering = true;
    const worked = await adapter.run(input, callbacks, new AbortController().signal);
    const sent = await steeringPromise;
    turns.push(worked);
    assert.equal(sessionId, original);
    assert.ok(sent, 'Steering was not sent during the tool execution.');
    assert.ok(receipts.includes(sent), 'Native user.message did not acknowledge steering.');
    assert.match(worked.content, /STEERING_CONFIRMED/);
    const written = await readFile(join(root, 'fixture.txt'), 'utf8');
    assert.equal(written.trim(), 'new');
    input.nativeReadOnly = true;
    input.previousEventIds = [...nativeEvents];
    input.preparedPrompt =
      'Explain why the file now contains new. Read it if useful. Do not modify it. Keep the answer to two short sentences.';
    steering = false;
    turns.push(await adapter.run(input, callbacks, new AbortController().signal));
    assert.equal(sessionId, original);
    assert.equal(await readFile(join(root, 'fixture.txt'), 'utf8'), written);
    Object.assign(proof, { conversation: true, turns, nativeMessages, receipts, activities });
    scenarios.push({ phase: 'read-work-steer-explain-same-session', passed: true });
  } else if (live) {
    const result = await adapter.run(input, callbacks, new AbortController().signal);
    assert.match(await readFile(join(root, 'fixture.txt'), 'utf8'), /new/);
    assert.ok(activities.some((activity) => activity.tool === 'view'));
    assert.ok(activities.some((activity) => activity.exitCode === 0));
    Object.assign(proof, {
      model: result.model,
      usage: result.usage,
      content: result.content,
      activities,
    });
  } else {
    await runIntercept(async (session) => {
      const read = await session.rpc.tools.execute({
        name: 'view',
        arguments: { path: join(root, 'fixture.txt') },
      });
      assert.match(JSON.stringify(read), /old/);
      const before = permissionCalls;
      const edit = await session.rpc.tools.execute({
        name: 'edit',
        arguments: { path: join(root, 'fixture.txt'), old_str: 'old', new_str: 'new' },
      });
      assert.match(await readFile(join(root, 'fixture.txt'), 'utf8'), /new/);
      scenarios.push({ phase: 'edit-permissions', before, after: permissionCalls, edit });
      const shell = process.platform === 'win32' ? 'powershell' : 'bash';
      const result = await session.rpc.tools.execute({
        name: shell,
        arguments: {
          command: 'node -e "console.log(42)"',
          description: 'Fixture command',
          mode: 'sync',
        },
      });
      assert.match(JSON.stringify(result), /42/);
      const question = await session.rpc.tools.execute({
        name: 'ask_user',
        arguments: { question: 'Choose a color', choices: ['Blue', 'Red'], allow_freeform: true },
      });
      assert.equal(userQuestions, 1);
      assert.match(JSON.stringify(question), /Blue/);
      deny = true;
      await session.rpc.tools
        .execute({
          name: shell,
          arguments: {
            command: `node -e "require('fs').writeFileSync('denied.txt','must not exist')"`,
            description: 'Denied fixture command',
            mode: 'sync',
          },
        })
        .catch(() => {});
      await assert.rejects(readFile(join(root, 'denied.txt')));
      deny = false;
      scenarios.push({ phase: 'native-tools', edit, command: result, question });
      await adapter.setPermissionMode(session.sessionId, 'allow-all');
      const count = permissionCalls;
      await session.rpc.tools.execute({
        name: 'create',
        arguments: { path: join(root, 'all.txt'), file_text: 'allowed' },
      });
      await session.rpc.tools.execute({
        name: shell,
        arguments: {
          command: 'node -e "console.log(45)"',
          description: 'Allow-all command',
          mode: 'sync',
        },
      });
      assert.equal(await readFile(join(root, 'all.txt'), 'utf8'), 'allowed');
      assert.equal(permissionCalls, count);
      await adapter.setPermissionMode(session.sessionId, 'manual');
      await session.rpc.tools.execute({
        name: shell,
        arguments: {
          command: 'node -e "console.log(43)"',
          description: 'Manual again',
          mode: 'sync',
        },
      });
      assert.ok(permissionCalls > count);
      scenarios.push({ phase: 'live-mode-change', passed: true });
    });
    await runIntercept(async (session) => {
      assert.equal((await session.rpc.permissions.getMode()).mode, 'manual');
      const count = permissionCalls;
      await session.rpc.tools.execute({
        name: process.platform === 'win32' ? 'powershell' : 'bash',
        arguments: {
          command: 'node -e "console.log(44)"',
          description: 'Resumed command',
          mode: 'sync',
        },
      });
      assert.ok(permissionCalls > count);
      scenarios.push({ phase: 'resume-manual', passed: true });
    }, true);
    const controller = new AbortController();
    let pid: number | undefined;
    intercept = async (session) => {
      const shell = process.platform === 'win32' ? 'powershell' : 'bash';
      const response = await session.rpc.tools.execute({
        name: shell,
        arguments: {
          command: `node -e "require('fs').writeFileSync('running.pid',String(process.pid));setInterval(()=>{},1000)"`,
          description: 'Isolated cancellation fixture',
          mode: 'async',
        },
      });
      for (let i = 0; i < 50 && !pid; i++) {
        pid = await readFile(join(root, 'running.pid'), 'utf8')
          .then(Number)
          .catch(() => undefined);
        if (!pid) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(pid, JSON.stringify(response));
      controller.abort();
      await new Promise<void>(() => {});
    };
    input.resumeSessionId = undefined;
    try {
      await assert.rejects(adapter.run(input, callbacks, controller.signal), /annulée/);
      let alive = true;
      for (let i = 0; i < 50 && alive; i++) {
        try {
          process.kill(pid!, 0);
        } catch {
          alive = false;
        }
        if (alive) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(alive, false, 'Native shell process survived cancellation.');
      scenarios.push({ phase: 'cancel-process', passed: true });
    } finally {
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* Already stopped. */
        }
      }
    }
  }
  proof.status = 'passed';
  proof.permissionCalls = permissionCalls;
} finally {
  await adapter.dispose();
  await writeFile(join(root, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(
    JSON.stringify({ proof: join(root, 'proof.json'), status: proof.status ?? 'failed' }),
  );
}
