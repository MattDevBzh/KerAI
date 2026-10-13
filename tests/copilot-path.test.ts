import { access, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCopilotPath } from '../src/host/CopilotLaunch';

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  access: vi.fn(),
  stat: vi.fn(),
}));

const base = String.raw`C:\Users\MatthieuFERELLEC\AppData\Roaming\Code - Insiders\User\globalStorage\github.copilot-chat\copilotCli\copilot`;
const files = new Set<string>();
beforeEach(() => {
  files.clear();
  vi.mocked(access)
    .mockReset()
    .mockImplementation(async (path) => {
      if (!files.has(String(path))) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
  vi.mocked(stat)
    .mockReset()
    .mockResolvedValue({ isFile: () => true } as Stats);
});

describe('Windows CLI path resolution', () => {
  it.each(['bat', 'cmd', 'exe'])(
    'resolves an absolute extensionless path to the existing .%s',
    async (extension) => {
      files.add(`${base}.${extension}`);
      expect(await resolveCopilotPath(base, 'win32', {})).toBe(`${base}.${extension}`);
      expect(await resolveCopilotPath(`"${base}"`, 'win32', {})).toBe(`${base}.${extension}`);
    },
  );

  it('preserves an explicitly selected script even if another extension exists', async () => {
    files.add(`${base}.bat`);
    files.add(`${base}.exe`);
    expect(await resolveCopilotPath(`${base}.bat`, 'win32', {})).toBe(`${base}.bat`);
  });

  it('does not substitute a PATH command when an explicit path is missing', async () => {
    files.add(String.raw`C:\other\copilot.exe`);
    await expect(resolveCopilotPath(base, 'win32', { Path: 'C:\\other' })).rejects.toThrow(
      'Copilot CLI introuvable au chemin configuré',
    );
  });

  it('resolves a short command through the case-insensitive Windows Path variable', async () => {
    files.add(`${base}.cmd`);
    expect(await resolveCopilotPath('copilot', 'win32', { Path: base.slice(0, -8) })).toBe(
      `${base}.cmd`,
    );
  });

  it('rejects directories masquerading as CLI executables', async () => {
    files.add(`${base}.bat`);
    vi.mocked(stat).mockResolvedValue({ isFile: () => false } as Stats);
    await expect(resolveCopilotPath(base, 'win32', {})).rejects.toThrow('introuvable');
  });
});
