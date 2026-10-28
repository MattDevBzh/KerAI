// Synthetic wire/decoder measurement: no provider, network or persisted user data.
import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { deepStrictEqual } from 'node:assert';
import { readFile, stat } from 'node:fs/promises';
const compiled = await build({
  stdin: {
    contents:
      "export { StateEncoder, StateReceiver } from './src/shared/stateTransfer'; export { demoState } from './webview/demo';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { StateEncoder, StateReceiver, demoState } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const count of [100, 1000]) {
  const state = structuredClone(demoState);
  state.features = Array.from({ length: count }, (_, i) => ({
    ...structuredClone(demoState.features[i % demoState.features.length]),
    id: `s-${i}`,
  }));
  const encoder = new StateEncoder(),
    receiver = new StateReceiver();
  const full = JSON.stringify(encoder.encode(state));
  receiver.receive(JSON.parse(full));
  const encoding = [],
    decoding = [];
  let delta;
  for (let i = 0; i < 31; i++) {
    state.features[0].steps[0].description = `Current work ${i}`;
    const start = performance.now();
    delta = JSON.stringify(encoder.encode(state));
    const encoded = performance.now();
    const received = receiver.receive(JSON.parse(delta));
    const decoded = performance.now();
    deepStrictEqual(received, JSON.parse(JSON.stringify(state)));
    if (i) {
      encoding.push(encoded - start);
      decoding.push(decoded - encoded);
    }
  }
  results.push({
    sessions: count,
    fullBytes: Buffer.byteLength(full),
    changedSessionBytes: Buffer.byteLength(delta),
    wireReductionPercent: +(100 * (1 - Buffer.byteLength(delta) / Buffer.byteLength(full))).toFixed(
      2,
    ),
    encodeMedianMs: +median(encoding).toFixed(2),
    decodeMedianMs: +median(decoding).toFixed(2),
  });
}
const assets = await Promise.all(
  ['app.js', 'index.css'].map(async (file) => ({
    file,
    bytes: (await stat(`dist/webview/assets/${file}`)).size,
  })),
);
console.log(
  JSON.stringify(
    {
      node: process.version,
      results,
      initialAssets: assets,
      scope:
        'Synthetic state transfer and initial entry assets. Excludes host assembly, VS Code transport, rendering and dynamically loaded screens.',
    },
    null,
    2,
  ),
);
