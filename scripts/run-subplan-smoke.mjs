import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
if (process.env.FEATURE_STUDIO_LIVE_TEST !== '1') {
  throw new Error('This isolated Copilot test requires FEATURE_STUDIO_LIVE_TEST=1.');
}
const outfile = path.resolve('.vscode-test/subplan-smoke.mjs');
await build({
  entryPoints: ['scripts/smoke-subplans.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    js: "import { createRequire as createSmokeRequire } from 'node:module'; const require = createSmokeRequire(import.meta.url);",
  },
});
await import(pathToFileURL(outfile).href);
