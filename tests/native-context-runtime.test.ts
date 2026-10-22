import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { CopilotClient } from '@github/copilot-sdk';
import { expect, it } from 'vitest';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings, Store } from '../src/core/store';
import type { RunInput } from '../src/shared/types';
import type { NativeContextLoad } from '../src/shared/native';
import { nativeSkillName } from '../src/core/nativeSkills';

const cliPath = process.env.FEATURE_STUDIO_CATALOG_CLI;

it.skipIf(!cliPath)(
  'real runtime injects selected skills and targeted instructions, records receipts, and refuses unapproved shell after loading a skill',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'kerai-native-context-'));
    await mkdir(join(root, '.github/instructions'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, '.github/instructions/api.instructions.md'),
      '---\napplyTo: "src/**/*.ts"\n---\nTARGETED_INSTRUCTION_BODY',
    );
    await writeFile(join(root, 'src/AGENTS.md'), 'NESTED_INSTRUCTION_BODY');
    await writeFile(join(root, 'src/code.ts'), 'export const value = true;');
    const requests: string[] = [];
    const calls = [
      { name: 'view', arguments: JSON.stringify({ path: join(root, 'src/code.ts') }) },
      {
        name: 'view',
        arguments: JSON.stringify({ path: join(root, '.github/instructions/api.instructions.md') }),
      },
      { name: 'skill', arguments: JSON.stringify({ skill: nativeSkillName('review') }) },
      {
        name: process.platform === 'win32' ? 'powershell' : 'bash',
        arguments: JSON.stringify({
          command: "node -e \"require('fs').writeFileSync('denied.txt','BAD')\"",
          description: 'Permission refusal fixture',
          mode: 'sync',
        }),
      },
    ];
    let turn = 0;
    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      requests.push(raw);
      const call = calls[turn++];
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          id: `response-${turn}`,
          object: 'chat.completion',
          created: 1,
          model: 'fixture',
          choices: [
            {
              index: 0,
              message: call
                ? {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{ id: `call-${turn}`, type: 'function', function: call }],
                  }
                : { role: 'assistant', content: 'Context inspected. No human validation granted.' },
              finish_reason: call ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const engine = new WorkflowEngine();
    const feature = engine.createFeature(
      {
        id: 'fixture',
        name: 'Fixture',
        description: '',
        icon: '',
        steps: [
          {
            id: 'work',
            name: 'Work',
            description: 'Inspect context',
            agentId: 'fixture',
            skills: ['review'],
            policy: 'workspace-write',
            dependsOn: [],
            artifact: 'result.md',
            maxAttempts: 3,
          },
        ],
      },
      {
        title: 'Native context',
        description: 'Read the instructions and skill, then request a command.',
      },
    );
    feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
    const step = feature.steps[0];
    const attempt = engine.beginRun(feature.id, step.id);
    const input: RunInput = {
      feature,
      step,
      attempt,
      workspacePath: root,
      settings: { ...defaultSettings, timeoutMinutes: 1 },
      agent: {
        id: 'fixture',
        name: 'Fixture',
        description: '',
        instructions: 'Follow the task',
        tools: [],
        skills: ['review'],
        source: 'bundled',
        path: '',
      },
      skills: [
        {
          id: 'manual',
          name: 'Explicit skill',
          description: 'Only selected by a human',
          content:
            '---\nname: manual\ndescription: Explicit\ndisable-model-invocation: true\nallowed-tools: [bash]\n---\nEXPLICIT_SKILL_BODY',
          path: '',
          source: 'bundled',
        },
        {
          id: 'review',
          name: 'API Review',
          description: 'Inspect an API',
          content:
            '---\nname: review\ndescription: Review\nallowed-tools: [bash, powershell]\n---\nSELECTED_SKILL_BODY',
          path: join(root, 'review/SKILL.md'),
          source: 'user',
        },
      ],
    };
    const loads: NativeContextLoad[] = [];
    let shellRequests = 0;
    const adapter = new CopilotCliAdapter({
      cliPath: cliPath!,
      storagePath: join(root, 'runtime'),
      launcherPath: resolve('scripts/copilot-launcher.js'),
      getTools: async () => [],
      clientFactory: (options) => {
        const client = new CopilotClient({
          ...options,
          useLoggedInUser: false,
          env: { ...options.env, COPILOT_HOME: join(root, 'home') },
        });
        client.getAuthStatus = async () => ({ isAuthenticated: true });
        client.listModels = async () => [];
        const original = client.createSession.bind(client);
        client.createSession = (config) =>
          original({
            ...config,
            model: 'fixture',
            provider: {
              type: 'openai',
              baseUrl: `http://127.0.0.1:${port}`,
              apiKey: 'unused-fixture',
            },
          });
        return client;
      },
    });
    try {
      const result = await adapter.run(
        input,
        {
          onEvent: () => {},
          onSession: () => {},
          onNativeContextLoad: (load) => {
            loads.push(load);
            attempt.nativeContextLoads = [...loads];
          },
          onNativePermission: async (request) => {
            if (request.kind === 'shell' || /denied\.txt/.test(request.details)) {
              shellRequests++;
              return false;
            }
            return true;
          },
        },
        new AbortController().signal,
      );
      expect(requests[0]).not.toContain('SELECTED_SKILL_BODY');
      expect(requests[0]).toContain('EXPLICIT_SKILL_BODY');
      expect(
        loads.some(
          (load) =>
            load.kind === 'skill' &&
            load.name === 'Explicit skill' &&
            load.content.includes('EXPLICIT_SKILL_BODY'),
        ),
      ).toBe(true);
      expect(requests[0]).toContain('api.instructions.md');
      expect(requests.at(-1)).toContain('SELECTED_SKILL_BODY');
      expect(requests.at(-1)).toContain('TARGETED_INSTRUCTION_BODY');
      expect(
        loads.some(
          (load) =>
            load.kind === 'skill' &&
            load.name === 'API Review' &&
            load.content.includes('SELECTED_SKILL_BODY'),
        ),
      ).toBe(true);
      expect(
        loads.some(
          (load) =>
            load.kind === 'instruction' && load.content.includes('TARGETED_INSTRUCTION_BODY'),
        ),
      ).toBe(true);
      expect(shellRequests).toBeGreaterThan(0);
      await expect(readFile(join(root, 'denied.txt'))).rejects.toThrow();
      engine.finishRun(feature.id, step.id, result);
      expect(step.status).toBe('awaiting_review');
      const store = new Store(join(root, 'saved'));
      await store.save([feature], input.settings, []);
      expect((await store.load()).features[0].steps[0].attempts[0].nativeContextLoads).toEqual(
        loads,
      );
    } finally {
      await adapter.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
