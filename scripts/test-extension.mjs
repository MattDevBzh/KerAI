import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, mkdir, access, writeFile, rm } from 'node:fs/promises';
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
  // Only this run's isolated fixture, user data and profile directory are removed.
  await rm(testRoot, { recursive: true, force: true });
}
