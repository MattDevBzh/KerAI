import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
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
