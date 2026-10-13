import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CopilotLaunch, resolveCopilotPath } from '../src/host/CopilotLaunch';
import { CopilotCliAdapter } from '../src/host/CopilotCliAdapter';

const launcher = resolve('scripts/copilot-launcher.js');
const roots: string[] = [];
const launches: CopilotLaunch[] = [];
async function fixture(source: string, name = 'cli fixture.cjs') {
  const root = await mkdtemp(join(tmpdir(), 'studio cli & test-'));
  roots.push(root);
  const executable = join(root, name);
  await writeFile(executable, source);
  return { root, executable };
}
async function prepare(root: string, executable: string, secrets = new Set<string>()) {
  const launch = await CopilotLaunch.create(executable, root, undefined, secrets);
  launches.push(launch);
  return launch;
}
function execute(launch: CopilotLaunch, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [launcher, launch.configPath, ...args], {
    cwd: launch.directory,
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data;
  });
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  child.stdin.on('error', () => {}); // An intentionally failing fixture may close before the test writes.
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveDone, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolveDone({ code, stdout, stderr }));
    },
  );
  return { child, done };
}
afterEach(async () => {
  for (const launch of launches.splice(0)) {
    await launch.stop();
    await launch.dispose();
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('real CLI process launch, without a Copilot account or model calls', () => {
  it('resolves a short copilot command through PATH, including Windows shims', async () => {
    const { root, executable } = await fixture(
      '',
      process.platform === 'win32' ? 'copilot.cmd' : 'copilot',
    );
    await chmod(executable, 0o755);
    expect(await resolveCopilotPath('copilot', process.platform, { PATH: root })).toBe(executable);
    expect(await resolveCopilotPath(`"${executable}"`)).toBe(executable);
    await expect(
      resolveCopilotPath('missing-copilot', process.platform, { PATH: root }),
    ).rejects.toThrow('introuvable');
  });

  it('preserves JSON-RPC bytes, multiline prompts and metacharacters with no shell prompt argument', async () => {
    const { root, executable } = await fixture('process.stdin.pipe(process.stdout);');
    const launch = await prepare(root, executable);
    const run = execute(launch, ['--headless', '--stdio', '--no-auto-update']);
    const body = JSON.stringify({
      method: 'session.send',
      params: { prompt: 'Bonjour éè\n"quoted" & %PATH% ! ^ | < > $(anything)' },
    });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    run.child.stdin.end(frame);
    const result = await run.done;
    expect(result).toEqual({ code: 0, stdout: frame, stderr: '' });
    const { statusPath } = JSON.parse(await readFile(launch.configPath, 'utf8'));
    const status = JSON.parse(await readFile(statusPath, 'utf8'));
    expect(status).toMatchObject({
      exitCode: 0,
      args: ['--headless', '--stdio', '--no-auto-update'],
    });
    expect(status.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(status)).not.toContain('Bonjour');
  });

  it.skipIf(process.platform !== 'win32').each(['bat', 'cmd'])(
    'runs a Windows .%s with spaces and shell metacharacters in its path',
    async (extension) => {
      const { root, executable: script } = await fixture('process.stdin.pipe(process.stdout);');
      const executable = join(root, `copilot %name%! (${extension}).${extension}`);
      await writeFile(
        executable,
        '@echo off\r\n"%FEATURE_STUDIO_TEST_NODE%" "%FEATURE_STUDIO_TEST_SCRIPT%" %*\r\n',
      );
      const run = execute(await prepare(root, executable), ['--headless', '--stdio'], {
        FEATURE_STUDIO_TEST_NODE: process.execPath,
        FEATURE_STUDIO_TEST_SCRIPT: script,
      });
      run.child.stdin.end('RPC bytes & % !\r\n');
      expect(await run.done).toEqual({ code: 0, stdout: 'RPC bytes & % !\r\n', stderr: '' });
    },
  );

  it('reports a missing executable instead of an unexplained closed stream', async () => {
    const { root } = await fixture('');
    const launch = await prepare(root, join(root, 'does-not-exist.exe'));
    const run = execute(launch, ['--headless', '--stdio']);
    run.child.stdin.end();
    expect((await run.done).code).not.toBe(0);
    expect(
      (await launch.failure(new Error('Cannot call write after a stream was destroyed'))).message,
    ).toContain('ENOENT');
  });

  it('retains exit code and stderr with the real SDK and redacts credentials across chunks', async () => {
    const secret = 'private-fixture-credential';
    const { root, executable } = await fixture(
      `process.stderr.write('Diagnostic é: private-fixture-'); setTimeout(() => { process.stderr.write('credential'); process.exit(23); }, 10);`,
    );
    const launch = await prepare(root, executable, new Set([secret]));
    const run = execute(launch, ['--headless', '--stdio'], {
      FEATURE_STUDIO_REDACT_VALUES: JSON.stringify([secret]),
    });
    run.child.stdin.end();
    const result = await run.done;
    expect(result.code).toBe(23);
    expect(result.stderr).toContain('Diagnostic é: [secret masqué]');
    expect(result.stderr).not.toContain(secret);
    const { statusPath } = JSON.parse(await readFile(launch.configPath, 'utf8'));
    expect(await readFile(statusPath, 'utf8')).not.toContain(secret);

    const failing = await fixture("process.stderr.write('CLI startup failure'); process.exit(23);");
    const adapter = new CopilotCliAdapter({
      cliPath: failing.executable,
      launcherPath: launcher,
      storagePath: failing.root,
      checkTimeoutMs: 3000,
      getTools: async () => [],
    });
    try {
      const checked = await adapter.check();
      expect(checked.state).toBe('unavailable');
      expect(checked.error).toContain('CLI startup failure');
      expect(checked.error).toContain('23');
      expect(await readdir(join(failing.root, 'copilot-runtime'))).toEqual([]);
    } finally {
      await adapter.dispose();
    }
  });

  it('terminates the owned CLI on cancellation and removes transient diagnostics', async () => {
    const { root, executable } = await fixture(
      "process.stdout.write('READY'); setInterval(() => {}, 1000);",
    );
    const launch = await prepare(root, executable);
    const run = execute(launch, ['--headless', '--stdio']);
    await new Promise<void>((ready) => run.child.stdout.once('data', () => ready()));
    await launch.stop();
    expect((await run.done).code).not.toBe(0);
    await launch.dispose();
    await expect(readFile(launch.configPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
