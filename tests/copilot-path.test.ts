import { access, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCopilotExecutable, resolveCopilotPath } from '../src/host/CopilotLaunch';

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
    files.add(String.raw`C:\Programs\Copilot\copilot.cmd`);
    expect(await resolveCopilotPath('copilot', 'win32', { Path: 'C:\\Programs\\Copilot' })).toBe(
      String.raw`C:\Programs\Copilot\copilot.cmd`,
    );
  });

  it('rejects directories masquerading as CLI executables', async () => {
    files.add(`${base}.bat`);
    vi.mocked(stat).mockResolvedValue({ isFile: () => false } as Stats);
    await expect(resolveCopilotPath(base, 'win32', {})).rejects.toThrow('introuvable');
  });
});

describe('automatic CLI discovery', () => {
  it.each(['auto', '', 'copilot'])('skips the VS Code bootstrapper in %s mode', async (mode) => {
    files.add(`${base}.bat`);
    const executable = String.raw`C:\Program Files\Copilot\copilot.exe`;
    files.add(executable);
    files.add(String.raw`C:\User\AppData\Roaming\npm\copilot.cmd`);
    expect(
      await resolveCopilotExecutable(mode, 'win32', {
        Path: `${base.slice(0, -8)};"C:\\Program Files\\Copilot"`,
        APPDATA: 'C:\\User\\AppData\\Roaming',
      }),
    ).toEqual({ cliPath: executable, cliSource: 'path' });
  });

  it.each([
    ['APPDATA', 'C:\\Roaming', 'C:\\Roaming\\npm\\copilot.cmd'],
    ['LOCALAPPDATA', 'C:\\Local', 'C:\\Local\\Microsoft\\WinGet\\Links\\copilot.exe'],
    ['LOCALAPPDATA', 'C:\\Local', 'C:\\Local\\GitHubCopilotCLI\\copilot.exe'],
    ['USERPROFILE', 'C:\\User', 'C:\\User\\.local\\bin\\copilot.exe'],
  ])(
    'finds a user installation using %s when VS Code has an older PATH',
    async (key, root, file) => {
      files.add(file);
      expect(await resolveCopilotExecutable('auto', 'win32', { [key]: root })).toEqual({
        cliPath: file,
        cliSource: 'user-install',
      });
    },
  );

  it('ignores profile-specific terminal shims and relative PATH entries', async () => {
    const shim = String.raw`C:\User\profiles\abc\globalStorage\github.copilot-chat\copilotCli`;
    files.add(`${shim}\\copilot.bat`);
    await expect(
      resolveCopilotPath('auto', 'win32', {
        PATH: `;.;tools;C:relative;${shim}`,
        APPDATA: '.',
      }),
    ).rejects.toThrow('Copilot CLI introuvable');
    expect(access).not.toHaveBeenCalled();
  });

  it('bypasses the new native Insiders shim even when it precedes npm in PATH', async () => {
    const shim = String.raw`C:\Users\MatthieuFERELLEC\AppData\Local\Programs\Microsoft VS Code Insiders\bin\copilot-shim`;
    const npm = String.raw`C:\Users\MatthieuFERELLEC\AppData\Roaming\npm`;
    files.add(`${shim}\\copilot.exe`);
    files.add(`${npm}\\copilot.ps1`);
    files.add(`${npm}\\copilot.cmd`);
    files.add(`${npm}\\copilot`);
    expect(await resolveCopilotExecutable('auto', 'win32', { Path: `${shim};${npm}` })).toEqual({
      cliPath: `${npm}\\copilot.cmd`,
      cliSource: 'path',
    });
  });

  it('uses only host paths on Linux and detects the user installation', async () => {
    files.add('/home/matt/.local/bin/copilot');
    expect(
      await resolveCopilotExecutable('auto', 'linux', {
        HOME: '/home/matt',
        PATH: 'C:\\Windows;.;./bin',
        APPDATA: 'C:\\Roaming',
      }),
    ).toEqual({ cliPath: '/home/matt/.local/bin/copilot', cliSource: 'user-install' });
  });

  it('finds Homebrew on macOS when not inherited by the extension host', async () => {
    files.add('/opt/homebrew/bin/copilot');
    expect(await resolveCopilotPath('auto', 'darwin', {})).toBe('/opt/homebrew/bin/copilot');
  });

  it('does not replace an explicitly missing .bat with an available user installation', async () => {
    files.add(String.raw`C:\Roaming\npm\copilot.cmd`);
    await expect(
      resolveCopilotPath(`${base}.bat`, 'win32', { APPDATA: 'C:\\Roaming' }),
    ).rejects.toThrow('Détection automatique');
  });
});
