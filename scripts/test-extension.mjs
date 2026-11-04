import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, mkdir, access, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
await build({
  entryPoints: ['tests/extension-smoke.ts'],
  outfile: '.vscode-test/extension-smoke.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
});
const testRoot = await mkdtemp(path.join(tmpdir(), 'feature-studio-vscode-'));
try {
  const workspace = path.join(testRoot, 'workspace');
  await mkdir(workspace);
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
      cwd: workspace,
      stdio: 'pipe',
    });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Feature Studio Test');
  git('config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(workspace, 'story.txt'), 'Committed feature context\n');
  await writeFile(path.join(workspace, 'binary.bin'), Buffer.from([0xff, 0xfe]));
  git('add', '--', 'story.txt');
  git('add', '--', 'binary.bin');
  git('commit', '-m', 'Isolated fixture');
  await writeFile(path.join(workspace, 'story.txt'), 'Human staged source\n');
  git('add', '--', 'story.txt');
  await writeFile(path.join(workspace, 'story.txt'), 'Human unstaged source\n');
  const insiders = '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders';
  let installed =
    process.env.VSCODE_EXECUTABLE_PATH ||
    (await access(insiders)
      .then(() => insiders)
      .catch(() => undefined));
  if (!installed) {
    installed = await downloadAndUnzipVSCode('stable');
    if (process.platform === 'darwin') {
      const renamed = path.join(path.dirname(installed), 'Code');
      installed = await access(installed)
        .then(() => installed)
        .catch(async () => {
          await access(renamed);
          return renamed;
        });
    }
  }
  if (process.platform === 'win32' && process.env.FEATURE_STUDIO_TEST_BROWSER_PROBE === '1') {
    const probe = path.resolve('.vscode-test/navigation-launch-probe.cjs');
    await build({
      entryPoints: ['tests/navigation-launch-probe.ts'],
      outfile: probe,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['playwright-core'],
      logLevel: 'silent',
    });
    for (const [label, executable, headless, profileLength] of [
      ['node-headed-pipe', process.execPath, 'headed', 'pipe'],
      ['electron-headed-pipe', installed, 'headed', 'pipe'],
      ['node-long-profile', process.execPath, 'headed', 'long'],
      ['electron-long-profile', installed, 'headed', 'long'],
    ]) {
      try {
        execFileSync(executable, [probe, label, headless, profileLength], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: 'inherit',
          timeout: 20000,
        });
      } catch (error) {
        console.error('BROWSER_PROBE_PROCESS_ERROR', label, error.message);
      }
    }
  }
  await runTests({
    ...(installed ? { vscodeExecutablePath: installed } : { version: 'stable' }),
    extensionDevelopmentPath: path.resolve(
      process.env.FEATURE_STUDIO_EXTENSION_PATH || process.cwd(),
    ),
    extensionTestsPath: path.resolve('.vscode-test/extension-smoke.cjs'),
    extensionTestsEnv: { COPILOT_HOME: path.join(testRoot, 'copilot-user') },
    launchArgs: [
      workspace,
      '--new-window',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-extensions',
      '--user-data-dir',
      path.join(testRoot, 'user-data'),
      '--extensions-dir',
      path.join(testRoot, 'extensions'),
    ],
  });
} finally {
  if (process.env.FEATURE_STUDIO_TEST_NAVIGATION === '1') {
    // Only the curated navigation metadata from this run's isolated output channel.
    const logRoot = path.join(testRoot, 'user-data', 'logs');
    for (const file of await readdir(logRoot, { recursive: true }).catch(() => [])) {
      if (!file.endsWith('.log') || !file.includes('Feature Studio')) continue;
      const text = await readFile(path.join(logRoot, file), 'utf8').catch(() => '');
      for (const line of text
        .split('\n')
        .filter((line) => line.includes('[Navigateur]'))
        .slice(-80))
        console.log(line);
    }
  }
  // Only this run's isolated fixture, user data and profile directory are removed.
  await rm(testRoot, { recursive: true, force: true });
}
