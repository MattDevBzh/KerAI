import { describe, expect, it, vi } from 'vitest';
import type { CopilotSession, PermissionRequest, SessionEvent } from '@github/copilot-sdk';
import {
  applyNativePermissions,
  decideNativePermission,
  NativeActivityCollector,
  verifyNativeCatalog,
} from '../src/host/NativeCopilot';
import type { NativeActivity } from '../src/shared/native';
import { usesNativeTools } from '../src/shared/native';
import { nativeActivitySchema } from '../src/core/nativeSchemas';
import { observedNativeChanges } from '../src/host/NativeChanges';

const shell: PermissionRequest = {
  kind: 'shell',
  fullCommandText: 'npm test',
  intention: 'Run tests',
  commands: [{ identifier: 'npm', readOnly: false }],
  hasWriteFileRedirection: false,
  possiblePaths: [],
  possibleUrls: [],
  canOfferSessionApproval: true,
};

describe('native permissions and evidence', () => {
  it('keeps manual approvals single-use and honors refusals, including managed asks in allow-all', async () => {
    const ask = vi.fn(async () => false);
    expect(await decideNativePermission(shell, 'manual', ask, '/repo')).toMatchObject({
      kind: 'reject',
    });
    expect(ask.mock.calls).toHaveLength(1);
    ask.mockResolvedValue(true);
    expect(await decideNativePermission(shell, 'manual', ask, '/repo')).toEqual({
      kind: 'approve-once',
      approvedInteractively: true,
    });
    ask.mockResolvedValue(false);
    expect(
      await decideNativePermission(
        { ...shell, managedApprovalRequired: true },
        'allow-all',
        ask,
        '/repo',
      ),
    ).toMatchObject({ kind: 'reject' });
    expect(ask).toHaveBeenCalledTimes(3);
  });
  it('only follows assisted advice when it is actually present and no managed ask or sandbox escape applies', async () => {
    const ask = vi.fn(async () => false);
    const request = {
      kind: 'memory',
      fact: 'Fixture',
      assistedApproval: { recommendation: 'approve' },
    } as PermissionRequest;
    expect(await decideNativePermission(request, 'assisted', ask, '/repo')).toEqual({
      kind: 'approve-once',
    });
    expect(ask).not.toHaveBeenCalled();
    expect(
      await decideNativePermission(
        { ...request, managedApprovalRequired: true },
        'assisted',
        ask,
        '/repo',
      ),
    ).toMatchObject({ kind: 'reject' });
    expect(await decideNativePermission(shell, 'assisted', ask, '/repo')).toMatchObject({
      kind: 'reject',
    });
  });
  it('clears previous grants on resume and requires the runtime to acknowledge the exact mode', async () => {
    const session = {
      rpc: {
        managedSettings: { get: vi.fn(async () => ({ failClosed: false })) },
        permissions: {
          configure: vi.fn(async () => ({ success: true })),
          setMode: vi.fn(async () => ({ success: true, mode: 'manual' })),
          getMode: vi.fn(async () => ({ mode: 'manual' })),
        },
      },
    };
    await applyNativePermissions(session as unknown as CopilotSession, 'manual', '/repo');
    expect(session.rpc.permissions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: { approved: [], denied: [] },
        urls: { unrestricted: false, initialAllowed: [] },
      }),
    );
    await expect(
      applyNativePermissions(session as unknown as CopilotSession, 'allow-all', '/repo'),
    ).rejects.toThrow(/indisponible/);
    session.rpc.managedSettings.get.mockResolvedValue({ failClosed: true });
    session.rpc.permissions.configure.mockClear();
    await expect(
      applyNativePermissions(session as unknown as CopilotSession, 'manual', '/repo'),
    ).rejects.toThrow(/politique/);
    expect(session.rpc.permissions.configure).not.toHaveBeenCalled();
  });
  it('rejects extra native tools and never gives consultative discussions native execution', () => {
    const names = ['view', 'create', 'edit', 'grep', 'glob', 'bash', 'ask_user'];
    expect(() => verifyNativeCatalog(names)).not.toThrow();
    expect(() => verifyNativeCatalog([...names, 'task'])).toThrow(/inattendu/);
    expect(() => verifyNativeCatalog([...names, 'edit'])).toThrow(/dupliqué/);
    expect(() => verifyNativeCatalog(names.filter((n) => n !== 'ask_user'))).toThrow(/nécessaires/);
    expect(
      usesNativeTools({
        feature: { execution: { mode: 'copilot-native', permissionMode: 'allow-all' } },
        mode: 'discussion',
      }),
    ).toBe(false);
  });
  it('keeps shell completion facts distinct from text and marks incomplete tools interrupted', () => {
    const activities: NativeActivity[] = [];
    const collector = new NativeActivityCollector(
      'session',
      '/repo',
      (a) => activities.push(a),
      (s) => s.replaceAll('SECRET', '[masqué]'),
    );
    const event = (type: string, data: unknown) =>
      ({ type, data, id: type, timestamp: '2026-10-21T12:00:00Z' }) as SessionEvent;
    collector.receive(
      event('tool.execution_start', {
        toolCallId: 'shell1',
        toolName: 'bash',
        arguments: { command: 'echo SECRET' },
      }),
    );
    collector.receive(
      event('tool.execution_complete', {
        toolCallId: 'shell1',
        success: true,
        result: { content: 'Tests pass. Exit code: 0' },
      }),
    );
    expect(activities.at(-1)?.exitCode).toBeUndefined();
    collector.receive(
      event('tool.execution_start', {
        toolCallId: 'shell2',
        toolName: 'bash',
        arguments: { command: 'npm test' },
      }),
    );
    collector.receive(
      event('tool.execution_complete', {
        toolCallId: 'shell2',
        success: false,
        shellExecution: { exitCode: 7 },
        result: { content: 'failure' },
      }),
    );
    expect(activities.at(-1)).toMatchObject({ exitCode: 7, status: 'failed', source: 'copilot' });
    collector.receive(
      event('tool.execution_start', { toolCallId: 'shell3', toolName: 'bash', arguments: {} }),
    );
    collector.finish();
    expect(activities.at(-1)?.status).toBe('interrupted');
    expect(JSON.stringify(activities)).not.toContain('SECRET');
    for (const activity of activities)
      expect(nativeActivitySchema.safeParse(activity).success).toBe(true);
  });
  it('observes edits to already dirty files and reversions without claiming ownership', () => {
    expect(
      observedNativeChanges(
        new Map([
          ['old.txt', 'before'],
          ['reverted.txt', 'edited'],
        ]),
        new Map([
          ['old.txt', 'after'],
          ['new.txt', 'new'],
        ]),
      ),
    ).toEqual(['old.txt', 'reverted.txt', 'new.txt']);
  });
});
