import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { expect, it } from 'vitest';
import { CopilotLaunch } from '../src/host/CopilotLaunch';
import { NativeActivityCollector } from '../src/host/NativeCopilot';
import { NativeTestEvidence } from '../src/host/NativeTestEvidence';
import { runProcess } from '../src/host/process';
import type { RunInput } from '../src/shared/types';

const cliPath = process.env.FEATURE_STUDIO_CATALOG_CLI;
it.skipIf(!cliPath)(
  'attests a real native shell command from a local scripted provider without paid inference',
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'kerai-native-proof-runtime-')));
    const workspace = join(root, 'repo');
    await mkdir(workspace);
    await runProcess('git', ['init', '-b', 'fixture'], workspace);
    await writeFile(join(workspace, 'test.js'), 'console.log("native receipt verified");');
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
      workingDirectory: workspace,
      baseDirectory: join(root, 'runtime'),
      useLoggedInUser: false,
      env: { ...process.env, COPILOT_HOME: join(root, 'home') },
      logLevel: 'none',
    });
    const shell = process.platform === 'win32' ? 'powershell' : 'bash';
    let turn = 0;
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* consume request locally */
      }
      const useTool = turn++ === 0;
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
              message: useTool
                ? {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'test-call',
                        type: 'function',
                        function: {
                          name: shell,
                          arguments: JSON.stringify({
                            command: 'node test.js',
                            description: 'Execute approved fixture test',
                            mode: 'sync',
                          }),
                        },
                      },
                    ],
                  }
                : { role: 'assistant', content: 'Local test finished.' },
              finish_reason: useTool ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const observed: unknown[] = [];
      const proofs = new NativeTestEvidence(
        {
          workspacePath: workspace,
          step: { policy: 'tests' },
          settings: {
            testCommands: [{ id: 'unit', name: 'Unit', command: 'node', args: ['test.js'] }],
          },
        } as RunInput,
        { recheckMissingExit: true },
      );
      await client.start();
      const session = await client.createSession({
        model: 'fixture-model',
        provider: {
          type: 'openai',
          baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
          apiKey: 'unused-local-fixture',
        },
        workingDirectory: workspace,
        availableTools: [shell],
        enableConfigDiscovery: false,
        enableFileHooks: false,
        skipCustomInstructions: true,
        enableSkills: false,
        skillDirectories: [],
        pluginDirectories: [],
        memory: { enabled: false },
        remoteSession: 'off',
        onPermissionRequest: () => ({ kind: 'approve-once' }),
        hooks: {
          onPostToolUse: (input) => {
            observed.push({ post: input.toolResult });
          },
          onPreToolUse: async (input) => {
            observed.push({ hook: input.toolName, args: input.toolArgs });
            await proofs.before(input.toolName, input.toolArgs);
            return {};
          },
        },
      });
      const activities = new NativeActivityCollector(
        session.sessionId,
        workspace,
        (activity) => {
          observed.push(activity);
          proofs.receive(activity);
        },
        (value) => value,
      );
      session.on((event) => {
        if (event.type === 'tool.execution_complete') observed.push({ completion: event.data });
        activities.receive(event);
      });
      await session.sendAndWait(
        { prompt: 'Run the approved fixture test and report the result.' },
        30000,
      );
      const [proof] = await proofs.finish();
      expect(proof, JSON.stringify(observed)).toMatchObject({ commandId: 'unit', exitCode: 0 });
      expect(proof.stdout).toContain('native receipt verified');
      expect(proof.error).toBeUndefined();
      expect(proof.native?.sessionId).toBe(session.sessionId);
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
