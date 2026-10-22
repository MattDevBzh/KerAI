import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const outfile = path.resolve('.vscode-test/native-context-smoke.mjs');
await build({
  entryPoints: ['scripts/smoke-native-context.ts'],
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
