/** Local MCP integration only: never sends a model prompt, never accesses Azure DevOps. */
import { CopilotClient, RuntimeConnection, type CopilotSession } from '@github/copilot-sdk';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';
import { ToolHost } from '../src/host/ToolHost';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import type { McpServerConfig, PolicyProfile, RunInput } from '../src/shared/types';

// From the repository root, bundle with esbuild (format: esm) and this banner:
// import { createRequire as createSmokeRequire } from 'node:module'; const require = createSmokeRequire(import.meta.url);
// Then run that temporary bundle with node. No SDK send implementation is called below.

const root = await mkdtemp(path.join(tmpdir(), 'feature-studio-mcp-smoke-'));
const cliPath =
  process.env.FEATURE_STUDIO_MCP_CLI_PATH ||
  process.env.COPILOT_CLI_PATH ||
  '/opt/homebrew/bin/copilot';
const bundledRuntime =
  cliPath.includes('@github/copilot-sdk-') && cliPath.endsWith('/copilot-runtime');
const fixture = path.resolve('tests/fixtures/mcp-server.mjs');
const baseServer: McpServerConfig = {
  id: 'fixture',
  name: 'Local deterministic fixture',
  transport: 'stdio',
  command: process.execPath,
  args: [fixture],
  envKeys: [],
  headers: {},
  tools: ['read_story'],
  enabled: true,
  autoApproveReadOnly: true,
};
const evidence: Record<string, unknown>[] = [];
let modelUsageEvents = 0;
const modelPromptsSent = 0;
const stopBeforeModel = 'MCP_SMOKE_EXPECTED_STOP_BEFORE_MODEL';

function runInput(policy: PolicyProfile, server: McpServerConfig): RunInput {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'mcp-smoke',
      name: 'MCP only',
      description: '',
      icon: 'test',
      steps: [
        {
          id: 'scope',
          name: 'Scope only',
          description: 'No model prompt',
          agentId: 'probe',
          policy,
          skills: [],
          maxAttempts: 1,
          artifact: 'scope.md',
          dependsOn: [],
        },
      ],
    },
    { title: 'MCP local preflight', description: 'No inference' },
  );
  const step = feature.steps[0],
    attempt = engine.beginRun(feature.id, step.id);
  return {
    feature,
    step,
    attempt,
    agent: {
      id: 'probe',
      name: 'Probe',
      description: 'Scope',
      instructions: 'No inference',
      tools: ['read'],
      source: 'bundled',
      path: '',
      skills: [],
    },
    skills: [],
    workspacePath: root,
    settings: { ...defaultSettings, timeoutMinutes: 1 },
    mcpServers: [server],
    preparedPrompt: 'LOCAL PREFLIGHT ONLY — session.send is intercepted; no prompt is transmitted.',
  };
}

async function scenario(
  label: string,
  policy: PolicyProfile,
  tool: string,
  autoApproveReadOnly: boolean,
  humanApproval: boolean | undefined,
) {
  let reached = false;
  let catalog: unknown;
  let outcome: unknown;
  let permission: unknown;
  let humanPermissionCallbacks = 0;
  const nativePermissionRequests: unknown[] = [];
  const server = { ...baseServer, tools: [tool], autoApproveReadOnly };
  const adapter = new CopilotCliAdapter({
    cliPath,
    storagePath: path.join(root, label),
    getTools: (input, callbacks, signal) => new ToolHost(input, callbacks, signal).createTools(),
    clientFactory: (options) => {
      // The SDK runtime wrapper has its own startup grammar, not the classic CLI-only flags.
      // Session restrictions and exact preflight remain unchanged in this fixture-only probe.
      const client = new CopilotClient(
          bundledRuntime
            ? { ...options, connection: RuntimeConnection.forStdio({ path: cliPath }) }
            : options,
        ),
        create = client.createSession.bind(client);
      client.createSession = async (config) => {
        const onPermissionRequest = config?.onPermissionRequest;
        if (config && onPermissionRequest)
          config = {
            ...config,
            onPermissionRequest: (request, invocation) => {
              nativePermissionRequests.push(request);
              return onPermissionRequest(request, invocation);
            },
          };
        const session = await create(config);
        session.on('assistant.usage', () => {
          modelUsageEvents++;
        });
        // Intercept the adapter's final send boundary; execute only an already-offered fixture tool.
        session.send = (async () => {
          reached = true;
          catalog = (await session.rpc.tools.getCurrentMetadata()).tools?.map((item) => ({
            name: item.name,
            server: item.mcpServerName,
            tool: item.mcpToolName,
          }));
          try {
            outcome = await session.rpc.tools.execute({
              name: `fixture-${tool}`,
              arguments: tool === 'read_story' ? { id: 42 } : { title: 'simulated, no disk write' },
            });
          } catch (error) {
            outcome = { error: error instanceof Error ? error.message : String(error) };
          }
          throw new Error(stopBeforeModel);
        }) as CopilotSession['send'];
        return session;
      };
      return client;
    },
  });
  try {
    await adapter.run(
      runInput(policy, server),
      {
        onSession() {},
        onEvent() {},
        onUsage() {},
        onMcpPermission:
          humanApproval === undefined
            ? undefined
            : async (request) => {
                permission = request;
                humanPermissionCallbacks++;
                return humanApproval;
              },
      },
      new AbortController().signal,
    );
    throw new Error('Unexpected adapter success: the intercepted send must stop the run');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== stopBeforeModel) throw error;
  } finally {
    await adapter.dispose();
  }
  if (!reached) throw new Error('Scope preflight did not reach the intercepted send boundary.');
  evidence.push({
    label,
    policy,
    tool,
    autoApproveReadOnly,
    humanApproval,
    catalog,
    permission,
    nativePermissionRequests,
    humanPermissionCallbacks,
    outcome,
  });
}

const discovery = new CopilotCliAdapter({
  cliPath,
  clientFactory: bundledRuntime
    ? (options) =>
        new CopilotClient({ ...options, connection: RuntimeConnection.forStdio({ path: cliPath }) })
    : undefined,
  storagePath: path.join(root, 'discovery'),
  getTools: async () => [],
});
let catalog, status;
try {
  status = await discovery.check();
  catalog = await discovery.discoverMcp(baseServer);
} finally {
  await discovery.dispose();
}
if (catalog.state !== 'ready' || catalog.tools.length !== 3)
  throw new Error(catalog.error ?? 'Fixture discovery incomplete.');
await scenario('auto-read', 'read-only', 'read_story', true, undefined);
await scenario('deny-write-readonly', 'read-only', 'write_story', true, true);
await scenario('deny-write-human', 'workspace-write', 'write_story', false, false);
await scenario('approve-write-human', 'workspace-write', 'write_story', false, true);
await scenario('deny-read-human', 'read-only', 'read_story', false, false);
await scenario('approve-read-human', 'read-only', 'read_story', false, true);
await scenario('deny-unknown-readonly', 'read-only', 'unknown_story', true, true);
if (modelUsageEvents || modelPromptsSent)
  throw new Error('The MCP-only smoke must never perform model inference.');
const executionUnavailable = evidence.every(
  (item) =>
    (item.outcome as { error?: string })?.error === 'Unhandled method session.tools.execute',
);
// Do not label the permission path validated when this runtime has no diagnostic execution endpoint.
if (!executionUnavailable) {
  const [read, readOnlyWrite, deniedWrite, approvedWrite, deniedRead, approvedRead, unknown] =
    evidence;
  const result = (item: Record<string, unknown>) =>
    item.outcome as { resultType?: string; textResultForLlm?: string };
  if (
    result(read).resultType !== 'success' ||
    !result(read).textResultForLlm?.includes('42') ||
    read.permission !== undefined ||
    !['denied', 'rejected'].includes(result(readOnlyWrite).resultType ?? '') ||
    readOnlyWrite.permission !== undefined ||
    !['denied', 'rejected'].includes(result(deniedWrite).resultType ?? '') ||
    !(deniedWrite.permission as { toolName?: string })?.toolName ||
    result(approvedWrite).resultType !== 'success' ||
    !result(approvedWrite).textResultForLlm?.includes('write_story') ||
    !(approvedWrite.permission as { toolName?: string })?.toolName ||
    !['denied', 'rejected'].includes(result(deniedRead).resultType ?? '') ||
    deniedRead.humanPermissionCallbacks !== 1 ||
    result(approvedRead).resultType !== 'success' ||
    approvedRead.humanPermissionCallbacks !== 1 ||
    !(
      approvedRead.nativePermissionRequests as {
        readOnly?: boolean;
        managedApprovalRequired?: boolean;
      }[]
    ).every((request) => request.readOnly === true && request.managedApprovalRequired === true) ||
    deniedWrite.humanPermissionCallbacks !== 1 ||
    approvedWrite.humanPermissionCallbacks !== 1 ||
    !['denied', 'rejected'].includes(result(unknown).resultType ?? '') ||
    unknown.humanPermissionCallbacks !== 0
  ) {
    console.error(JSON.stringify({ unexpectedExecutionResults: evidence }));
    throw new Error(
      'Native tool execution or permission assertions failed; no successful proof was saved.',
    );
  }
}
const proof = {
  checkedAt: new Date().toISOString(),
  cliVersion: status.version,
  sdkVersion: '1.0.20',
  authentication: { state: status.state, authenticated: status.authenticated },
  fixtureOnly: true,
  modelPromptsSent,
  modelUsageEvents,
  discoveryAndExactScopeValidated: true,
  runtimeKind: bundledRuntime ? 'SDK bundled runtime wrapper' : 'installed classic CLI',
  diagnosticToolExecution: executionUnavailable ? 'unsupported' : 'validated local fixture',
  nativePermissionExecutionValidated: !executionUnavailable,
  modelDrivenMcpExecutionValidated: false,
  permissionPolicyValidation: executionUnavailable
    ? 'injected-transport unit tests only'
    : 'native invocation pipeline and injected-transport unit tests',
  limitations: [
    ...(executionUnavailable
      ? [
          'This runtime rejects session.tools.execute before invoking the MCP fixture or permission callback.',
        ]
      : [
          'Only deterministic fixture tool calls were executed; write_story simulates a write and never changes disk.',
        ]),
    'This does not prove that model-driven MCP tool calls are unavailable; that separate path was not invoked.',
    ...(executionUnavailable
      ? [
          'Current SDK/docs prescribe approve-once; its acceptance by this CLI permission callback remains unverified.',
        ]
      : []),
    'No remote MCP, OAuth, Azure DevOps data, model invocation or credential exchange was tested.',
  ],
  sources: [
    'https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/hooks',
    'https://github.com/github/copilot-sdk/blob/main/nodejs/README.md',
  ],
  catalog,
  evidence,
};
await writeFile(
  path.resolve(bundledRuntime ? 'docs/mcp-smoke-bundled.json' : 'docs/mcp-smoke.json'),
  JSON.stringify(proof, null, 2) + '\n',
);
console.log(JSON.stringify(proof));
