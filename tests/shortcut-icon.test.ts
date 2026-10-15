import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DedicatedWindow, windowsShortcutScript } from '../src/host/DedicatedWindow';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('keeps the shortcut icon after an extension update and preserves it if refresh fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-shortcut-icon-'));
  roots.push(root);
  const source = join(root, 'extension-icon.ico');
  const window = new DedicatedWindow(join(root, 'persistent-cockpit'));
  await writeFile(source, 'first icon');
  const icon = await window.installShortcutIcon(source);
  await rm(source);
  expect(await readFile(icon, 'utf8')).toBe('first icon');
  await expect(window.installShortcutIcon(source)).rejects.toThrow();
  expect(await readFile(icon, 'utf8')).toBe('first icon');
  await writeFile(source, 'updated icon');
  expect(await window.installShortcutIcon(source)).toBe(icon);
  expect(await readFile(icon, 'utf8')).toBe('updated icon');
  const script = windowsShortcutScript('C:\\Code.exe', 'C:\\Feature Studio.code-workspace', icon);
  expect(script).toContain(`$shortcut.IconLocation = '${icon.replace(/'/g, "''")},0'`);
});
