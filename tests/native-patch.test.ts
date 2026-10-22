import { describe, expect, it, vi } from 'vitest';
import type { CopilotClient } from '@github/copilot-sdk';
import { probeNativeCapabilities, verifyNativeCatalog } from '../src/host/NativeCopilot';

// Actual Windows catalog reported by the user, including the selected Studio host tool.
const reportedCatalog = [
  'view',
  'glob',
  'rg',
  'apply_patch',
  'powershell',
  'read_powershell',
  'stop_powershell',
  'list_powershell',
  'ask_user',
  'studio_read_personal_resource',
];
const hostTools = ['studio_read_personal_resource'];

it('accepts the reported Windows patch catalog only with its explicit host tool', () => {
  expect(() => verifyNativeCatalog(reportedCatalog, hostTools)).not.toThrow();
  expect(() => verifyNativeCatalog(reportedCatalog)).toThrow(/inattendu/);
});

describe.each(['bash', 'powershell'])('native write alternatives (%s)', (shell) => {
  const base = ['view', 'glob', 'rg', 'ask_user', shell];

  it.each([
    { write: ['apply_patch'] },
    { write: ['edit', 'create'] },
    { write: ['apply_patch', 'edit'] },
    { write: ['apply_patch', 'create'] },
    { write: ['apply_patch', 'edit', 'create'] },
  ])('accepts complete write capabilities $write', ({ write }) => {
    expect(() => verifyNativeCatalog([...base, ...write])).not.toThrow();
  });

  it.each([{ write: [] }, { write: ['edit'] }, { write: ['create'] }])(
    'rejects incomplete write capabilities $write without apply_patch',
    ({ write }) => {
      expect(() => verifyNativeCatalog([...base, ...write])).toThrow(/absents/);
    },
  );

  it.each(['view', 'glob', 'rg', 'ask_user', 'shell'])(
    'still requires %s with apply_patch',
    (capability) => {
      const missing = capability === 'shell' ? shell : capability;
      expect(() =>
        verifyNativeCatalog([...base.filter((name) => name !== missing), 'apply_patch']),
      ).toThrow(/absents/);
    },
  );

  it('still rejects unknown tools and duplicate patch tools', () => {
    expect(() => verifyNativeCatalog([...base, 'apply_patch', 'task'])).toThrow(/inattendu/);
    expect(() => verifyNativeCatalog([...base, 'apply_patch', 'apply_patch'])).toThrow(/dupliqué/);
  });
});

it.each([{ search: ['grep'] }, { search: ['rg'] }, { search: ['grep', 'rg'] }])(
  'accepts patch writing with search catalog $search',
  ({ search }) => {
    expect(() =>
      verifyNativeCatalog(['view', 'glob', ...search, 'ask_user', 'powershell', 'apply_patch']),
    ).not.toThrow();
  },
);

it.each(['apply_patch', 'edit', 'create', 'bash', 'powershell'])(
  'still forbids %s in read-only mode',
  (tool) => {
    expect(() => verifyNativeCatalog(['view', 'glob', 'rg', 'ask_user', tool], [], true)).toThrow(
      /inattendu/,
    );
  },
);

it('keeps the patch-session read-only catalog valid after removing write and shell tools', () => {
  expect(() =>
    verifyNativeCatalog(['view', 'glob', 'rg', 'ask_user', ...hostTools], hostTools, true),
  ).not.toThrow();
});

it.each([
  { write: ['apply_patch'], available: true },
  { write: [], available: false },
])(
  'probes a patch runtime without sending a prompt (available=$available)',
  async ({ write, available }) => {
    const names = ['view', 'glob', 'rg', ...write, 'powershell', 'ask_user'];
    let mode = 'manual';
    const session = {
      sessionId: 'patch-probe',
      send: vi.fn(),
      disconnect: vi.fn(async () => {}),
      rpc: {
        tools: {
          initializeAndValidate: vi.fn(async () => {}),
          getCurrentMetadata: vi.fn(async () => ({ tools: names.map((name) => ({ name })) })),
          execute: vi.fn(),
        },
        managedSettings: { get: vi.fn(async () => ({ failClosed: false })) },
        permissions: {
          configure: vi.fn(async () => ({ success: true })),
          setMode: vi.fn(async (input: { mode: string }) => {
            mode = input.mode;
            return { success: true, mode };
          }),
          getMode: vi.fn(async () => ({ mode })),
        },
      },
    };
    const client = {
      createSession: vi.fn(async () => session),
      deleteSession: vi.fn(async () => {}),
    };
    const result = await probeNativeCapabilities(client as unknown as CopilotClient, '/fixture');
    expect(result.available).toBe(available);
    expect(result.tools).toEqual(names);
    if (available) {
      expect(result.permissionModes).toContain('manual');
      expect(result.error).toBeUndefined();
    } else {
      expect(result.error).toMatch(/edit, create/);
      expect(session.rpc.permissions.configure).not.toHaveBeenCalled();
    }
    expect(session.send).not.toHaveBeenCalled();
    expect(session.rpc.tools.execute).not.toHaveBeenCalled();
    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(client.deleteSession).toHaveBeenCalledWith('patch-probe');
  },
);
