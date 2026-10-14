import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function redact(text: string): string {
  return text
    .replace(
      /("(?:authorization|api[_-]?key|access[_-]?token|password|secret)"\s*:\s*")((?:\\.|[^"\\])*)(")/gi,
      '$1[secret masqué]$3',
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})\b/g,
      '[secret masqué]',
    )
    .replace(
      /((?:authorization|api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
      '$1[secret masqué]',
    );
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}
export async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    onLine?: (line: string) => void;
    /** Machine-readable Git data must not be changed by log redaction. */
    rawOutput?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ProcessResult> {
  if (options.signal?.aborted) throw new Error('Exécution annulée.');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    });
    let stdout = '',
      stderr = '',
      lineBuffer = '',
      truncated = false,
      stopped: string | undefined;
    const max = options.maxBytes ?? 256_000;
    const stop = (reason: string) => {
      if (stopped) return;
      stopped = reason;
      if (child.pid) {
        if (process.platform === 'win32')
          spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore',
          }).unref();
        else {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill();
          }
        }
      }
      killTimer = setTimeout(() => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      }, 1500);
      killTimer.unref();
    };
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(
      () => stop('Délai d’exécution dépassé.'),
      options.timeoutMs ?? 120_000,
    );
    const abort = () => stop('Exécution annulée.');
    options.signal?.addEventListener('abort', abort, { once: true });
    const outDecoder = new StringDecoder('utf8'),
      errDecoder = new StringDecoder('utf8');
    const collectText = (text: string, error: boolean) => {
      if (error) {
        stderr += text;
        if (stderr.length > max) {
          stderr = stderr.slice(-max);
          truncated = true;
        }
      } else {
        stdout += text;
        if (stdout.length > max) {
          stdout = stdout.slice(-max);
          truncated = true;
        }
      }
      if (options.onLine) {
        lineBuffer += text;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) options.onLine(redact(line.slice(0, 4000)));
        if (lineBuffer.length > 8000) {
          options.onLine('[Ligne longue tronquée]');
          lineBuffer = '';
        }
      }
    };
    child.stdout.on('data', (data) => collectText(outDecoder.write(data), false));
    child.stderr.on('data', (data) => collectText(errDecoder.write(data), true));
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer && !stopped) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
    };
    child.on('error', (error) => {
      cleanup();
      reject(new Error(redact(error.message)));
    });
    child.on('close', (code) => {
      cleanup();
      collectText(outDecoder.end(), false);
      collectText(errDecoder.end(), true);
      if (lineBuffer) options.onLine?.(redact(lineBuffer));
      if (stopped) reject(new Error(stopped));
      else
        resolve({
          code: code ?? -1,
          stdout: options.rawOutput ? stdout : redact(stdout),
          stderr: redact(stderr),
          truncated,
        });
    });
  });
}
