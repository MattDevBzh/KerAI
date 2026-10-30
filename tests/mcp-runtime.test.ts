import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { expect, it } from 'vitest';
import { CopilotLaunch } from '../src/host/CopilotLaunch';
import { resolveMcpPlan, verifyMcpCatalog } from '../src/host/McpRuntime';

const cliPath = process.env.FEATURE_STUDIO_CATALOG_CLI;
it.skipIf(!cliPath)(
  'real CLI preserves selected long MCP identities in the model catalog without inference',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-mcp-runtime-'));
    const launch = await CopilotLaunch.create(cliPath!, root);
    const serverId = 'mcp-8864feca-a7c4-4060-b239-055dda4b0b1d';
    const toolName = 'repo_pull_request_thread';
    const runtimeName = `${serverId}-${toolName}`.slice(0, 64);
    const plan = await resolveMcpPlan(
      [
        {
          id: serverId,
          name: 'Local fixture',
          transport: 'stdio',
          command: process.execPath,
          args: [resolve('tests/fixtures/mcp-server.mjs')],
          envKeys: ['FEATURE_STUDIO_FIXTURE_READ_TOOL'],
          headers: {},
          tools: [toolName],
          enabled: true,
          autoApproveReadOnly: false,
        },
      ],
      () => toolName,
    );
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
      logLevel: 'none',
    });
    try {
      await client.start();
      const session = await client.createSession({
        model: 'fixture-model',
        provider: { type: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'unused-local-probe' },
        workingDirectory: root,
        availableTools: [...plan.grants.keys()],
        mcpServers: plan.servers,
        enableConfigDiscovery: false,
        skipCustomInstructions: true,
        enableFileHooks: false,
        enableSkills: false,
        memory: { enabled: false },
        remoteSession: 'off',
        onPermissionRequest: () => ({ kind: 'reject' }),
        customAgents: [
          {
            name: 'probe',
            description: 'Local catalog probe',
            prompt: 'No inference',
            tools: [runtimeName, `${serverId}/${toolName}`],
          },
        ],
        agent: 'probe',
      });
      await session.rpc.tools.initializeAndValidate();
      const { tools } = await session.rpc.tools.getCurrentMetadata();
      expect(tools).toHaveLength(1);
      expect(tools![0]).toMatchObject({
        name: runtimeName,
        mcpServerName: serverId,
        mcpToolName: toolName,
      });
      verifyMcpCatalog(tools, new Set(), plan);
      await session.disconnect();
    } finally {
      await client.stop();
      await launch.stop();
      await launch.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
