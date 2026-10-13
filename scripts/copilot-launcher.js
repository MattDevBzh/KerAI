// CommonJS on purpose: the SDK starts .js entry points with the extension's Node runtime.
// stdout and stdin belong exclusively to JSON-RPC. Never print diagnostics there.
const { spawn } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { StringDecoder } = require('node:string_decoder');

const [configPath, ...args] = process.argv.slice(2);
const { executable, statusPath } = JSON.parse(readFileSync(configPath, 'utf8'));
const started = Date.now();
const secrets = [
  ...JSON.parse(process.env.FEATURE_STUDIO_REDACT_VALUES || '[]'),
  ...Object.entries(process.env)
    .filter(([key, value]) => /token|secret|password|api_?key|authorization/i.test(key) && value)
    .map(([, value]) => value),
].sort((a, b) => b.length - a.length);
const redact = (text) => {
  for (const secret of secrets) text = text.split(secret).join('[secret masqué]');
  return text
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})\b/g,
      '[secret masqué]',
    )
    .replace(
      /((?:authorization|api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
      '$1[secret masqué]',
    );
};
const status = {
  command: executable,
  args,
  pid: undefined,
  exitCode: null,
  signal: null,
  durationMs: 0,
  stderr: '',
  error: '',
};
const save = () =>
  writeFileSync(statusPath, JSON.stringify({ ...status, durationMs: Date.now() - started }), {
    mode: 0o600,
  });
const finish = (code, signal, error) => {
  status.exitCode = code;
  status.signal = signal;
  status.stderr = redact(stderr + decoder.end()).slice(-16_000);
  status.error = error ? redact(error.message) : '';
  save();
  if (error || code !== 0) {
    process.stderr.write(
      `[Feature Studio CLI] code=${code ?? 'null'} signal=${signal ?? 'none'} durée=${Date.now() - started}ms\n${status.error}\n${status.stderr}\n`,
    );
  }
  process.exitCode = typeof code === 'number' && code !== 0 ? code : error || signal ? 1 : 0;
};
let stderr = '';
const decoder = new StringDecoder('utf8');
let child;
try {
  const env = { ...process.env };
  // Electron must act as Node for this launcher, but not change the CLI's own host.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.FEATURE_STUDIO_REDACT_VALUES;
  let command = executable;
  let commandArgs = args;
  let windowsVerbatimArguments = false;
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(executable)) {
    // Only SDK runtime flags travel through cmd.exe; prompts stay in JSON-RPC.
    // Use an env reference for the quoted path: spaces, &, parentheses and % stay data.
    if (/["\r\n\0]/.test(executable) || args.some((arg) => !/^[a-zA-Z0-9_./:=+-]+$/.test(arg))) {
      throw new Error('Arguments de lancement Copilot non pris en charge par cmd.exe.');
    }
    env.FEATURE_STUDIO_CLI_EXECUTABLE = executable;
    command = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    commandArgs = [
      '/d',
      '/s',
      '/v:off',
      '/c',
      `""%FEATURE_STUDIO_CLI_EXECUTABLE%" ${args.join(' ')}"`,
    ];
    windowsVerbatimArguments = true;
  } else if (/\.[cm]?js$/i.test(executable)) {
    command = process.execPath;
    commandArgs = [executable, ...args];
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  child = spawn(command, commandArgs, {
    cwd: process.cwd(),
    env,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments,
    detached: process.platform !== 'win32',
    stdio: ['inherit', 'inherit', 'pipe'],
  });
  status.pid = child.pid;
  save();
  child.stderr.on('data', (chunk) => {
    stderr += decoder.write(chunk);
    // Retain a bounded tail without exposing partial secrets in live log chunks.
    if (stderr.length > 64_000) stderr = redact(stderr).slice(-32_000);
  });
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.on('close', (code, signal) => finish(code, signal, spawnError));
} catch (error) {
  finish(null, null, error);
}
