import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, mkdir, access } from 'node:fs/promises';
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
const workspace = path.join(testRoot, 'workspace');
await mkdir(workspace);
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
