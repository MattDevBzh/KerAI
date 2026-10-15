import { mkdir, writeFile, readFile, rename, readdir, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import path from 'node:path';
import { runProcess } from './process';

export const cockpitSettings = {
  'workbench.startupEditor': 'none',
  'workbench.editor.showTabs': 'none',
  'workbench.activityBar.location': 'hidden',
  'workbench.statusBar.visible': false,
  'workbench.editor.editorActionsLocation': 'hidden',
  'window.menuBarVisibility': 'hidden',
  'window.commandCenter': false,
  'workbench.layoutControl.enabled': false,
  'breadcrumbs.enabled': false,
  'window.title': 'Feature Studio',
};
const requestSchema = z
  .object({
    action: z.enum(['newFeature', 'installKit', 'migrateUserKit']),
    projectId: z.string().uuid().optional(),
    createdAt: z.number(),
  })
  .strict();
export type WindowRequest = z.infer<typeof requestSchema>;
export class DedicatedWindow {
  readonly workspace: string;
  readonly home: string;
  readonly requests: string;
  constructor(readonly directory: string) {
    this.workspace = path.join(directory, 'Feature Studio.code-workspace');
    this.home = path.join(directory, 'home');
    this.requests = path.join(directory, 'requests');
  }
  async prepare(): Promise<string> {
    await mkdir(this.home, { recursive: true });
    await mkdir(this.requests, { recursive: true });
    const content =
      JSON.stringify(
        { folders: [{ path: this.home, name: 'Feature Studio' }], settings: cockpitSettings },
        null,
        2,
      ) + '\n';
    // Preserve an existing user's window customization and avoid workspace reloads on every focus.
    try {
      await writeFile(this.workspace, content, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return this.workspace;
  }
  async enqueue(action: WindowRequest['action'], projectId?: string): Promise<void> {
    await this.prepare();
    const request = requestSchema.parse({ action, projectId, createdAt: Date.now() });
    const destination = path.join(this.requests, `${randomUUID()}.json`);
    await writeFile(destination + '.tmp', JSON.stringify(request), { flag: 'wx', mode: 0o600 });
    await rename(destination + '.tmp', destination);
  }
  async takeRequests(): Promise<WindowRequest[]> {
    const requests: WindowRequest[] = [];
    for (const name of (await readdir(this.requests)).sort()) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const file = path.join(this.requests, name),
        claimed = file + '.claimed';
      try {
        await rename(file, claimed);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      try {
        const info = await lstat(claimed);
        if (!info.isFile() || info.size > 1024) continue;
        const parsed = requestSchema.safeParse(JSON.parse(await readFile(claimed, 'utf8')));
        if (
          parsed.success &&
          Date.now() - parsed.data.createdAt < 5 * 60_000 &&
          parsed.data.createdAt <= Date.now()
        )
          requests.push(parsed.data);
      } catch {
        /* Ignore a malformed launcher request; never execute arbitrary content. */
      } finally {
        await unlink(claimed).catch(() => undefined);
      }
    }
    return requests;
  }
  isDedicated(file: string | undefined): boolean {
    if (!file) return false;
    const a = path.resolve(file),
      b = path.resolve(this.workspace);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
  async shortcut(executable: string): Promise<string> {
    if (process.platform !== 'win32')
      throw new Error(
        'La création du raccourci se fait depuis VS Code exécuté localement sous Windows.',
      );
    await this.prepare();
    const script = windowsShortcutScript(executable, this.workspace);
    const result = await runProcess(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      this.directory,
      { timeoutMs: 15000 },
    );
    if (result.code !== 0) throw new Error(`Création du raccourci impossible : ${result.stderr}`);
    return result.stdout.trim();
  }
}
export function windowsShortcutScript(executable: string, workspace: string): string {
  if (/["\r\n]/.test(executable + workspace)) throw new Error('Chemin de lancement invalide.');
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return `$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$destination = Join-Path $desktop 'Feature Studio.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($destination)
$shortcut.TargetPath = ${literal(executable)}
$shortcut.Arguments = ${literal(`--new-window "${workspace}"`)}
$shortcut.Description = 'Ouvrir le cockpit Feature Studio'
$shortcut.IconLocation = ${literal(executable + ',0')}
$shortcut.Save()
Write-Output $destination
`;
}
