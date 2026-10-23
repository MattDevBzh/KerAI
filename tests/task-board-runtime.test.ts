import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { CopilotLaunch } from '../src/host/CopilotLaunch';
import { taskBoardTools } from '../src/host/TaskBoardTools';
import { updateTaskBoard } from '../src/core/taskBoard';
import type { TaskBoard } from '../src/shared/taskBoard';

const cliPath = process.env.FEATURE_STUDIO_CATALOG_CLI;
it.skipIf(!cliPath)(
  'the real CLI executes board updates from a local scripted model without a repository write permission',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'kerai-board-runtime-'));
    const launch = await CopilotLaunch.create(cliPath!, root);
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({
        path: resolve('scripts/copilot-launcher.js'),
        args: [
          launch.configPath,
          '--no-remote',
          '--no-custom-instructions',
          '--disable-builtin-mcps',
        ],
      }),
      workingDirectory: root,
      baseDirectory: join(root, 'runtime'),
      useLoggedInUser: false,
      env: { COPILOT_HOME: join(root, 'home') },
      logLevel: 'none',
    });
    let board: TaskBoard | undefined;
    let permissions = 0;
    let turn = 0;
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push(body);
      const status = ['in_progress', 'done'][turn++];
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          id: `response-${turn}`,
          object: 'chat.completion',
          created: 1,
          model: 'fixture-model',
          choices: [
            {
              index: 0,
              message: status
                ? {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: `call-${turn}`,
                        type: 'function',
                        function: {
                          name: 'studio_update_task_board',
                          arguments: JSON.stringify({
                            mode: 'plan',
                            title: 'Parcours de connexion',
                            items: [{ id: 'login', text: 'Vérifier la connexion', status }],
                          }),
                        },
                      },
                    ],
                  }
                : { role: 'assistant', content: 'Le tableau est à jour.' },
              finish_reason: status ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const controller = new AbortController();
    try {
      await client.start();
      const session = await client.createSession({
        model: 'fixture-model',
        provider: {
          type: 'openai',
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: 'unused-no-inference',
        },
        workingDirectory: root,
        availableTools: ['studio_update_task_board'],
        tools: taskBoardTools(
          {
            onEvent() {},
            onSession() {},
            onTaskBoard: async (update) => {
              board = updateTaskBoard(board, update);
              return board;
            },
          },
          controller.signal,
        ),
        enableConfigDiscovery: false,
        enableFileHooks: false,
        skipCustomInstructions: true,
        enableSkills: false,
        skillDirectories: [],
        pluginDirectories: [],
        memory: { enabled: false },
        remoteSession: 'off',
        onPermissionRequest: () => {
          permissions++;
          return { kind: 'denied-no-approval-rule-and-could-not-request-from-user' };
        },
      });
      await session.rpc.tools.initializeAndValidate();
      expect((await session.rpc.tools.getCurrentMetadata()).tools?.map((t) => t.name)).toContain(
        'studio_update_task_board',
      );
      await session.sendAndWait(
        { prompt: 'Mettre à jour le tableau avec les outils disponibles.' },
        30000,
      );
      expect(requests[0]).toContain('studio_update_task_board');
      expect(requests.at(-1)).toContain('initialPlan');
      expect(board).toMatchObject({
        revision: 2,
        items: [{ status: 'done' }],
        initialPlan: [{ id: 'login', text: 'Vérifier la connexion' }],
      });
      expect(permissions).toBe(0);
    } finally {
      await client.stop().catch(() => {});
      await client.forceStop().catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await launch.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
