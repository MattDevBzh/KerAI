import { describe, expect, it, vi } from 'vitest';
import type { PermissionRequest } from '@github/copilot-sdk';
import type { McpServerConfig, RunCallbacks } from '../src/shared/types';
import {
  decideMcpPermission,
  McpStreamRedactor,
  redactMcp,
  resolveMcpPlan,
  verifyMcpCatalog,
} from '../src/host/McpRuntime';

const server = (changes: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'ado',
  name: 'Azure DevOps',
  transport: 'stdio',
  command: 'node',
  args: ['fixture.mjs'],
  envKeys: [],
  headers: {},
  tools: ['read_story'],
  enabled: true,
  autoApproveReadOnly: false,
  ...changes,
});
const callbacks = (approve = false): RunCallbacks => ({
  onEvent: vi.fn(),
  onSession: vi.fn(),
  onMcpPermission: vi.fn(async () => approve),
});
const permission = (changes: Record<string, unknown> = {}): PermissionRequest =>
  ({
    kind: 'mcp',
    serverName: 'ado',
    toolName: 'read_story',
    readOnly: true,
    toolTitle: 'Read story',
    args: { id: 42 },
    ...changes,
  }) as PermissionRequest;

describe('MCP scope and credentials', () => {
  it('identifies missing, unexpected and duplicate tools without permitting a prompt', () => {
    const plan = { servers: {}, grants: new Map(), secrets: new Set<string>() };
    expect(() =>
      verifyMcpCatalog(
        [
          { name: 'studio_read_file', description: '' },
          { name: 'bash', description: '' },
          { name: 'bash', description: '' },
        ],
        new Set(['studio_read_file', 'studio_devops_inspect']),
        plan,
      ),
    ).toThrow('Manquants : "studio_devops_inspect". Inattendus : "bash". Doublons : "bash".');
    expect(() => verifyMcpCatalog(null, new Set(['studio_read_file']), plan)).toThrow(
      'renvoyé null',
    );
  });
  it('uses the CLI 64-character name without losing the full MCP identity', async () => {
    const id = 'mcp-8864feca-a7c4-4060-b239-055dda4b0b1d';
    const name = 'repo_pull_request_thread';
    const runtimeName = `${id}-${name}`.slice(0, 64);
    const plan = await resolveMcpPlan([server({ id, tools: [name] })]);
    expect(plan.servers[id].tools).toEqual([name]);
    expect(plan.grants.get(runtimeName)).toMatchObject({ serverId: id, toolName: name });
    const metadata = { name: runtimeName, description: '', mcpServerName: id, mcpToolName: name };
    expect(() => verifyMcpCatalog([metadata], new Set(), plan)).not.toThrow();
    expect(() => verifyMcpCatalog([], new Set(), plan)).toThrow('Manquants');
    expect(() =>
      verifyMcpCatalog([{ ...metadata, mcpToolName: name.slice(0, -1) }], new Set(), plan),
    ).toThrow('Provenance');
    const cb = callbacks(true);
    expect(
      await decideMcpPermission(
        plan,
        permission({ serverName: id, toolName: name }),
        'read-only',
        cb,
      ),
    ).toMatchObject({ kind: 'approve-once' });
    expect(cb.onMcpPermission).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: id, toolName: name }),
    );
  });
  it('rejects ambiguous truncated MCP names before starting the runtime', async () => {
    const id = 'mcp-8864feca-a7c4-4060-b239-055dda4b0b1d';
    await expect(
      resolveMcpPlan([
        server({ id, tools: ['repo_pull_request_thread', 'repo_pull_request_thread_write'] }),
      ]),
    ).rejects.toThrow('Collision');
    await expect(
      resolveMcpPlan([
        server({ id: 'a'.repeat(63), tools: ['one'] }),
        server({ id: 'a'.repeat(63) + '-', tools: ['two'] }),
      ]),
    ).rejects.toThrow('Collision');
  });
  it('resolves secret references only into a transient SDK plan, without changing saved configuration', async () => {
    const config = server({
      transport: 'http',
      command: undefined,
      url: 'https://mcp.example.test/api',
      headers: { Authorization: 'MCP_AUTH' },
    });
    const plan = await resolveMcpPlan([config], async () => 'Bearer never-persist-this');
    expect(plan.servers.ado).toMatchObject({
      type: 'http',
      headers: { Authorization: 'Bearer never-persist-this' },
      tools: ['read_story'],
    });
    expect(JSON.stringify(config)).not.toContain('never-persist-this');
    expect(redactMcp('Failure: Bearer never-persist-this', plan.secrets)).not.toContain(
      'never-persist-this',
    );
  });
  it('fails before connection when a credential is absent', async () => {
    await expect(
      resolveMcpPlan(
        [server({ envKeys: ['FEATURE_STUDIO_MISSING_SECRET_FIXTURE'] })],
        async () => undefined,
      ),
    ).rejects.toThrow('absent');
  });
  it('allows wildcard tool discovery but never execution with wildcard, empty, disabled or duplicate selection', async () => {
    const plan = await resolveMcpPlan([server({ enabled: false, tools: [] })], undefined, true);
    expect(plan.servers.ado.tools).toEqual(['*']);
    expect(plan.grants.size).toBe(0);
    await expect(resolveMcpPlan([server({ tools: ['*'] })])).rejects.toThrow('jokers');
    await expect(resolveMcpPlan([server({ tools: [] })])).rejects.toThrow('outils MCP précis');
    await expect(resolveMcpPlan([server({ enabled: false })])).rejects.toThrow('désactivé');
    await expect(resolveMcpPlan([server(), server()])).rejects.toThrow('dupliqué');
  });
  it('requires exact MCP provenance and rejects foreign tools or native tools', async () => {
    const plan = await resolveMcpPlan([server()]),
      hosts = new Set(['studio_read_file', 'studio_ask_human']);
    const catalog = [
      { name: 'studio_read_file', description: '' },
      { name: 'studio_ask_human', description: '' },
      { name: 'ado-read_story', description: '', mcpServerName: 'ado', mcpToolName: 'read_story' },
    ];
    expect(() => verifyMcpCatalog(catalog, hosts, plan)).not.toThrow();
    expect(() =>
      verifyMcpCatalog(
        catalog.map((t) => (t.name === 'ado-read_story' ? { ...t, mcpServerName: 'evil' } : t)),
        hosts,
        plan,
      ),
    ).toThrow('Provenance');
    expect(() =>
      verifyMcpCatalog([...catalog, { name: 'bash', description: '' }], hosts, plan),
    ).toThrow('Catalogue');
    expect(() =>
      verifyMcpCatalog(
        catalog.map((t) => (t.name === 'studio_read_file' ? { ...t, mcpServerName: 'ado' } : t)),
        hosts,
        plan,
      ),
    ).toThrow('usurpe');
  });
  it('never emits credentials split across token deltas', () => {
    const secrets = new Set(['Bearer SECRET_VALUE', 'SECRET_VALUE']);
    const stream = new McpStreamRedactor(secrets);
    const output = [
      stream.push('Before Bearer SEC'),
      stream.push('RET_'),
      stream.push('VALUE after'),
      stream.finish(),
    ].join('');
    expect(output).toContain('Before');
    expect(output).toContain('after');
    expect(output).not.toContain('SECRET_VALUE');
  });
});

describe('MCP permissions', () => {
  it('auto-approves only explicit server flag and exact whitelist with runtime readOnly === true', async () => {
    const plan = await resolveMcpPlan([server({ autoApproveReadOnly: true })]),
      cb = callbacks();
    expect(await decideMcpPermission(plan, permission(), 'read-only', cb)).toEqual({
      kind: 'approve-once',
    });
    expect(cb.onMcpPermission).not.toHaveBeenCalled();
    expect(
      await decideMcpPermission(
        plan,
        permission({ toolName: 'write_story' }),
        'workspace-write',
        cb,
      ),
    ).toMatchObject({ kind: 'reject' });
    expect(
      await decideMcpPermission(plan, permission({ readOnly: 'true' }), 'read-only', cb),
    ).toMatchObject({ kind: 'reject' });
  });
  it('accepts canonical MCP names only with their verified server, and respects managed asks', async () => {
    const plan = await resolveMcpPlan([server({ autoApproveReadOnly: true })]);
    expect(
      await decideMcpPermission(
        plan,
        permission({ toolName: 'ado-read_story' }),
        'read-only',
        callbacks(),
      ),
    ).toMatchObject({ kind: 'approve-once' });
    expect(
      await decideMcpPermission(
        plan,
        permission({ toolName: 'ado-read_story', serverName: 'other' }),
        'read-only',
        callbacks(true),
      ),
    ).toMatchObject({ kind: 'reject' });
    const cb = callbacks(true);
    expect(
      await decideMcpPermission(
        plan,
        permission({ toolName: 'ado-read_story', managedApprovalRequired: true }),
        'read-only',
        cb,
      ),
    ).toMatchObject({ kind: 'approve-once', approvedInteractively: true });
    expect(cb.onMcpPermission).toHaveBeenCalledTimes(1);
  });
  it('read-only refuses writes and unknown access even after human approval', async () => {
    const plan = await resolveMcpPlan([server()]),
      cb = callbacks(true);
    expect(
      await decideMcpPermission(plan, permission({ readOnly: false }), 'read-only', cb),
    ).toMatchObject({ kind: 'reject' });
    expect(
      await decideMcpPermission(plan, permission({ readOnly: undefined }), 'read-only', cb),
    ).toMatchObject({ kind: 'reject' });
    expect(cb.onMcpPermission).not.toHaveBeenCalled();
  });
  it('workspace-write requires actual human permission for selected write/unknown calls', async () => {
    const plan = await resolveMcpPlan([
        server({ tools: ['write_story'], autoApproveReadOnly: true }),
      ]),
      cb = callbacks(true);
    expect(
      await decideMcpPermission(
        plan,
        permission({ toolName: 'write_story', readOnly: false }),
        'workspace-write',
        cb,
      ),
    ).toMatchObject({ kind: 'approve-once', approvedInteractively: true });
    expect(cb.onMcpPermission).toHaveBeenCalledWith({
      serverId: 'ado',
      toolName: 'write_story',
      args: '{"id":42}',
      readOnly: false,
    });
    expect(
      await decideMcpPermission(
        plan,
        permission({ toolName: 'write_story', readOnly: false }),
        'workspace-write',
        callbacks(false),
      ),
    ).toMatchObject({ kind: 'reject' });
  });
  it('does not treat a broad callback or absent dialog as authorization for native tools', async () => {
    const plan = await resolveMcpPlan([server()]);
    expect(
      await decideMcpPermission(plan, permission(), 'read-only', { onEvent() {}, onSession() {} }),
    ).toMatchObject({ kind: 'reject' });
    expect(
      await decideMcpPermission(
        plan,
        { kind: 'shell', fullCommandText: 'git push' } as PermissionRequest,
        'workspace-write',
        callbacks(true),
      ),
    ).toMatchObject({ kind: 'reject' });
  });
});
