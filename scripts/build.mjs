import { build } from 'esbuild';
import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
});
await copyFile('scripts/copilot-launcher.js', 'dist/copilot-launcher.js');
await build({
  entryPoints: ['src/host/devopsCli.ts'],
  outfile: 'defaults/devops/skills/devops-inspect/scripts/ado-readonly.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/host/remoteReviewWorker.mjs'],
  outfile: 'dist/remote-review-worker.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'info',
});

// VSIX uses --no-dependencies: ship the complete pinned runtime, including browser
// registry, injected scripts and third-party assets. No browser is downloaded.
const navigationRuntime = 'dist/navigation-runtime';
await mkdir(`${navigationRuntime}/node_modules`, { recursive: true });
const require = createRequire(import.meta.url);
const playwrightRoot = path.dirname(require.resolve('playwright-core/package.json'));
await copyFile(
  path.join(path.dirname(require.resolve('pngjs/package.json')), 'LICENSE'),
  `${navigationRuntime}/PNGJS-LICENSE`,
);
await rm(`${navigationRuntime}/node_modules/playwright-core`, { recursive: true, force: true });
await cp(playwrightRoot, `${navigationRuntime}/node_modules/playwright-core`, { recursive: true });
await build({
  entryPoints: ['src/host/navigation/worker.ts'],
  outfile: `${navigationRuntime}/worker.cjs`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['playwright-core', 'playwright-core/package.json'],
  logLevel: 'info',
});
