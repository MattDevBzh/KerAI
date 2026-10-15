import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { z } from 'zod';
import { expect, it } from 'vitest';
import { devOpsQuerySchema, devOpsQueryToolSchema } from '../src/core/devopsKitSchemas';
import { CopilotLaunch } from '../src/host/CopilotLaunch';
import { verifyMcpCatalog } from '../src/host/McpRuntime';

// Explicit real-runtime regression. No send, tool execution, account or Azure API.
// CI pins the external CLI to 1.0.96 on both Linux and Windows.
const cliPath = process.env.FEATURE_STUDIO_CATALOG_CLI;
it.skipIf(!cliPath)(
  'CLI 1.0.96 retains the DevOps tool and enforces the empty Discussion tool catalogue',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-devops-catalog-'));
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
      baseDirectory: root,
      useLoggedInUser: false,
      logLevel: 'none',
    });
    try {
      await client.start();
      expect((await client.getStatus()).version).toBe('1.0.96');
      for (const [schema, included, discussion] of [
        [devOpsQuerySchema, false, false],
        [devOpsQueryToolSchema, true, false],
        [devOpsQueryToolSchema, true, true],
      ] as const) {
        const names = discussion ? [] : ['studio_read_file', 'studio_devops_inspect'];
        const session = await client.createSession({
          model: 'gpt-5-mini',
          provider: { type: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'unused-local-probe' },
          workingDirectory: root,
          tools: names.map((name) => ({
            name,
            description: 'Catalog inspection only. Never executed.',
            parameters: z.toJSONSchema(name === 'studio_devops_inspect' ? schema : z.object({})),
            skipPermission: true,
            defer: 'never' as const,
            handler: () => {
              throw new Error('Tool execution is forbidden in this probe.');
            },
          })),
          availableTools: names,
          enableConfigDiscovery: false,
          enableFileHooks: false,
          skipCustomInstructions: true,
          enableSkills: false,
          skillDirectories: [],
          pluginDirectories: [],
          mcpServers: {},
          memory: { enabled: false },
          remoteSession: 'off',
          customAgentsLocalOnly: true,
          onPermissionRequest: () => ({ kind: 'reject' }),
          customAgents: [
            { name: 'feature-studio', prompt: 'Catalog probe only.', tools: names, infer: false },
          ],
          agent: 'feature-studio',
        });
        try {
          await session.rpc.tools.initializeAndValidate();
          const { tools } = await session.rpc.tools.getCurrentMetadata();
          expect(tools?.map((tool) => tool.name)).toEqual(included ? names : ['studio_read_file']);
          if (included)
            verifyMcpCatalog(tools, new Set(names), {
              servers: {},
              grants: new Map(),
              secrets: new Set(),
            });
        } finally {
          await session.disconnect();
        }
      }
    } finally {
      try {
        await client.stop();
      } finally {
        await launch.dispose();
        await rm(root, { recursive: true, force: true });
      }
    }
  },
  60_000,
);
