import { spawn } from 'node:child_process';
import { redact } from './process';

export const WORKSPACE_GIT_TIMEOUTS = {
  read: 120_000,
  worktree: 600_000,
} as const;

export interface WorkspaceGitResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

/** Keep Git machine data byte-exact, with a separate deadline for a full checkout. */
export function runWorkspaceGit(
  root: string,
  args: string[],
  extraConfig: string[],
  maxBytes: number,
): Promise<WorkspaceGitResult> {
  const creatingWorktree = args[0] === 'worktree' && args[1] === 'add';
  const timeoutMs = creatingWorktree
    ? WORKSPACE_GIT_TIMEOUTS.worktree
    : WORKSPACE_GIT_TIMEOUTS.read;
  const operation = creatingWorktree ? 'git worktree add' : `git ${args[0]}`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_CONFIG_NOSYSTEM = '1';
  const command = [
    '--no-pager',
    '--no-optional-locks',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'submodule.recurse=false',
    ...extraConfig.flatMap((value) => ['-c', value]),
    ...args,
  ];
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const child = spawn('git', command, {
      cwd: root,
      shell: false,
      windowsHide: true,
      detached: !windows,
      env,
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0,
      stopped: 'timeout' | 'overflow' | undefined;
    const killChild = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may already have exited; its close event still settles the operation.
      }
    };
    const stop = (reason: 'timeout' | 'overflow') => {
      if (stopped) return;
      stopped = reason;
      // worktree add may run another Git process for checkout. Stop the whole tree
      // before close releases the workspace lease, including on Windows.
      if (!child.pid) killChild();
      else if (windows) {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('error', killChild);
        killer.once('exit', (code) => {
          if (code !== 0) killChild();
        });
        killer.unref();
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          killChild();
        }
      }
    };
    const timeout = setTimeout(() => stop('timeout'), timeoutMs);
    const collect = (chunks: Buffer[], data: Buffer) => {
      if (stopped) return;
      bytes += data.length;
      if (bytes > maxBytes) stop('overflow');
      else chunks.push(data);
    };
    child.stdout.on('data', (data: Buffer) => collect(stdout, data));
    child.stderr.on('data', (data: Buffer) => collect(stderr, data));
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(redact(error.message)));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (stopped === 'overflow')
        reject(new Error(`Sortie Git trop volumineuse : opération refusée (${operation}).`));
      else if (stopped === 'timeout') {
        const details = redact(Buffer.concat(stderr).toString('utf8')).trim().slice(-2000);
        reject(
          new Error(
            `Délai Git dépassé pendant « ${operation} » (${timeoutMs / 1000} s).` +
              (details ? ` Dernier message Git : ${details}` : ''),
          ),
        );
      } else if (code === null)
        reject(
          new Error(`Opération Git interrompue (${operation}${signal ? `, ${signal}` : ''}).`),
        );
      else resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}
