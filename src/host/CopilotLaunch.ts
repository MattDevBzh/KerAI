import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, extname, isAbsolute, join, resolve, win32 } from 'node:path';
import { spawn } from 'node:child_process';
import { redact } from './process';

export interface CopilotExecutable {
  cliPath: string;
  cliSource: 'configured' | 'path' | 'user-install';
}

/** The terminal integration is an interactive bootstrapper, not the headless CLI. */
function isVSCodeBootstrapper(path: string): boolean {
  return /[\\/]github\.copilot-chat[\\/]copilotCli[\\/]|[\\/]bin[\\/]copilot-shim[\\/]/i.test(path);
}

export async function resolveCopilotExecutable(
  configured: string,
  platform = process.platform,
  env = process.env,
): Promise<CopilotExecutable> {
  const selected = configured.trim().replace(/^"(.*)"$/, '$1');
  if (selected && selected !== 'auto' && selected !== 'copilot')
    return {
      cliPath: await resolveConfiguredPath(selected, platform, env),
      cliSource: 'configured',
    };

  const windows = platform === 'win32';
  const paths = windows ? win32 : { isAbsolute, join, resolve };
  const variable = (name: string) =>
    Object.entries(env).find(([key]) =>
      windows ? key.toLowerCase() === name.toLowerCase() : key === name,
    )?.[1];
  const candidates: { directory: string; source: CopilotExecutable['cliSource'] }[] = (
    variable('PATH') ?? ''
  )
    .split(windows ? ';' : ':')
    .map((directory) => ({ directory: directory.replace(/^"(.*)"$/, '$1'), source: 'path' }));
  const add = (root: string | undefined, ...segments: string[]) => {
    if (root && paths.isAbsolute(root))
      candidates.push({ directory: paths.join(root, ...segments), source: 'user-install' });
  };
  if (windows) {
    add(variable('APPDATA'), 'npm');
    add(variable('LOCALAPPDATA'), 'GitHubCopilotCLI');
    add(variable('LOCALAPPDATA'), 'Microsoft', 'WinGet', 'Links');
    add(variable('USERPROFILE'), '.local', 'bin');
  } else {
    add(variable('HOME'), '.local', 'bin');
    if (platform === 'darwin') add('/opt/homebrew', 'bin');
    add('/usr/local', 'bin');
    add('/usr', 'bin');
  }
  const visited = new Set<string>();
  for (const { directory, source } of candidates) {
    // Never discover a project-local binary from an empty/relative PATH entry.
    if (!paths.isAbsolute(directory) || /[\r\n\0]/.test(directory)) continue;
    const key = windows ? paths.resolve(directory).toLowerCase() : paths.resolve(directory);
    if (visited.has(key)) continue;
    visited.add(key);
    if (isVSCodeBootstrapper(paths.join(directory, 'copilot'))) continue;
    try {
      const cliPath = await resolveConfiguredPath('copilot', platform, { PATH: directory });
      return { cliPath, cliSource: source };
    } catch {
      /* Try the next installation without executing an installer. */
    }
  }
  throw new Error(
    'Copilot CLI introuvable : détection dans le PATH de VS Code et les emplacements utilisateur usuels. Installe GitHub Copilot CLI puis redémarre VS Code, ou renseigne featureStudio.cliPath avec son chemin complet. Les lanceurs VS Code copilotCli et copilot-shim ne constituent pas une installation du CLI.',
  );
}

export async function resolveCopilotPath(
  configured: string,
  platform = process.platform,
  env = process.env,
): Promise<string> {
  return (await resolveCopilotExecutable(configured, platform, env)).cliPath;
}

async function resolveConfiguredPath(
  configured: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const path = configured.trim().replace(/^"(.*)"$/, '$1');
  if (!path || /[\r\n\0]/.test(path)) throw new Error('Chemin Copilot CLI invalide.');
  const windows = platform === 'win32';
  const paths = windows ? win32 : { extname, isAbsolute, join, resolve };
  const isExplicitPath = paths.isAbsolute(path) || /[\\/]/.test(path);
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const extensions =
    windows && !paths.extname(path)
      ? isExplicitPath
        ? ['', '.exe', '.cmd', '.bat']
        : ['.exe', '.cmd', '.bat', '']
      : [''];
  const entries = isExplicitPath
    ? ['']
    : pathValue.split(windows ? ';' : delimiter).filter(Boolean);
  for (const entry of entries) {
    for (const extension of extensions) {
      const candidate = paths.resolve(entry.replace(/^"(.*)"$/, '$1'), path + extension);
      try {
        await access(
          candidate,
          windows || /\.[cm]?js$/i.test(candidate) ? constants.F_OK : constants.X_OK,
        );
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
        /* Try the next extension or PATH entry. */
      }
    }
  }
  throw new Error(
    `Copilot CLI introuvable ${isExplicitPath ? 'au chemin configuré' : 'dans le PATH'} : ${path}. Choisis « Détection automatique » dans les réglages Feature Studio, ou renseigne featureStudio.cliPath avec le chemin complet de copilot, copilot.exe, copilot.cmd ou copilot.bat.`,
  );
}

interface LaunchStatus {
  command: string;
  args: string[];
  pid?: number;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stderr: string;
  error: string;
}

export class CopilotLaunch {
  private constructor(
    readonly executable: string,
    readonly source: CopilotExecutable['cliSource'],
    readonly directory: string,
    readonly configPath: string,
    private readonly statusPath: string,
    private readonly log?: (message: string) => void,
    private readonly secrets: string[] = [],
  ) {}

  static async create(
    configured: string,
    storagePath: string,
    log?: (message: string) => void,
    secrets: Set<string> = new Set(),
  ) {
    const { cliPath: executable, cliSource } = await resolveCopilotExecutable(configured);
    const directory = await mkdtemp(join(storagePath, 'launch-'));
    const configPath = join(directory, 'config.json'),
      statusPath = join(directory, 'status.json');
    await writeFile(configPath, JSON.stringify({ executable, statusPath }), { mode: 0o600 });
    const values = [
      ...secrets,
      ...Object.entries(process.env)
        .filter(
          ([key, value]) => /token|secret|password|api_?key|authorization/i.test(key) && value,
        )
        .map(([, value]) => value!),
    ]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return new CopilotLaunch(executable, cliSource, directory, configPath, statusPath, log, values);
  }

  safe(text: string): string {
    for (const secret of this.secrets) text = text.split(secret).join('[secret masqué]');
    return redact(text);
  }

  private async status(): Promise<LaunchStatus | undefined> {
    try {
      return JSON.parse(await readFile(this.statusPath, 'utf8'));
    } catch {
      return undefined;
    }
  }

  async failure(error: unknown): Promise<Error> {
    const message = error instanceof Error ? error.message : String(error);
    const status = await this.status();
    const details =
      status && (status.error || status.stderr || status.exitCode !== null)
        ? `\nCopilot CLI : code=${status.exitCode ?? 'null'}, durée=${status.durationMs}ms.\n${status.error}\n${status.stderr}`
        : '';
    return new Error(this.safe(message + details));
  }

  async stop(): Promise<void> {
    const status = await this.status();
    if (status?.pid && status.exitCode === null && !status.signal && !status.error) {
      if (process.platform === 'win32') {
        await new Promise<void>((resolveDone) => {
          const killer = spawn('taskkill.exe', ['/pid', String(status.pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.once('error', () => resolveDone());
          killer.once('close', () => resolveDone());
          const timeout = setTimeout(() => {
            killer.kill();
            resolveDone();
          }, 1500);
          timeout.unref();
          killer.once('close', () => clearTimeout(timeout));
        });
      } else {
        try {
          process.kill(-status.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
    }
  }

  async dispose(): Promise<void> {
    const final = await this.status();
    if (final)
      this.log?.(
        this.safe(
          `CLI ${final.command} ${JSON.stringify(final.args)} ; code=${final.exitCode ?? 'interrompu'} ; durée=${final.durationMs}ms${final.stderr ? `\nstderr : ${final.stderr}` : ''}${final.error ? `\nerreur : ${final.error}` : ''}`,
        ),
      );
    await rm(this.directory, { recursive: true, force: true });
  }
}
