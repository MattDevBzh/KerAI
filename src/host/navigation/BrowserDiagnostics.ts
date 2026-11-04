import type { BrowserPhase } from './BrowserErrors';

export interface BrowserDiagnostic {
  at: string;
  requestId: number;
  phase: BrowserPhase;
  outcome: 'started' | 'ok' | 'error';
  elapsedMs: number;
  platform: string;
  arch: string;
  runtime: string;
  transport: 'pipe' | 'loopback-websocket';
  systemCode?: string;
  networkCode?: string;
  exitCode?: number;
  signal?: string;
}

/** Extract only allowlisted machine evidence, never logs, URLs, paths or arguments. */
export function browserFailureEvidence(
  error: unknown,
): Pick<BrowserDiagnostic, 'systemCode' | 'networkCode' | 'exitCode' | 'signal'> {
  const raw = error instanceof Error ? error.message : '';
  const systemCode = raw.match(/\b(EACCES|EPERM|ENOENT|ENOEXEC|EBUSY)\b/)?.[1];
  const networkCode = raw.match(
    /net::(ERR_(?:CERT_(?:AUTHORITY_INVALID|COMMON_NAME_INVALID|DATE_INVALID|REVOKED|INVALID)|SSL_PROTOCOL_ERROR|SSL_VERSION_OR_CIPHER_MISMATCH|CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|NAME_NOT_RESOLVED|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|NO_SUPPORTED_PROXIES|TIMED_OUT|ABORTED))\b/,
  )?.[1];
  const exit = raw.match(/\bexitCode=(-?\d{1,10})\b/)?.[1];
  const signal = raw.match(/\bsignal=(SIGABRT|SIGKILL|SIGTERM|SIGSEGV|SIGILL|SIGTRAP)\b/)?.[1];
  return {
    ...(systemCode ? { systemCode } : {}),
    ...(networkCode ? { networkCode } : {}),
    ...(exit === undefined ? {} : { exitCode: Number(exit) }),
    ...(signal ? { signal } : {}),
  };
}

class BrowserDiagnostics {
  private sink?: (row: BrowserDiagnostic) => void;
  configure(sink?: (row: BrowserDiagnostic) => void) {
    this.sink = sink;
  }
  record(row: BrowserDiagnostic) {
    // Diagnostics must never break the browser lifecycle if its output channel is disposed.
    try {
      this.sink?.(row);
    } catch {
      /* Best effort local output. */
    }
  }
}
export const browserDiagnostics = new BrowserDiagnostics();
