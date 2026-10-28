// Synthetic host aggregation benchmark. No model, network, project writes or UI rendering.
// Compare against the last published implementation, rather than duplicating production code.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { deepStrictEqual } from 'node:assert';
import { resolve } from 'node:path';

const baseline = process.argv[2] ?? '78d1f97';
const previousSource = execFileSync('git', ['show', `${baseline}:src/host/StudioHub.ts`], {
  encoding: 'utf8',
});
async function load(contents) {
  const result = await build({
    stdin: { contents, resolveDir: resolve('src/host'), loader: 'ts' },
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
}
const [{ StudioHub: Before }, { StudioHub: After, demoState }] = await Promise.all([
  load(previousSource),
  load("export { StudioHub } from './StudioHub'; export { demoState } from '../../webview/demo';"),
]);
function fixture(Hub, total) {
  const projects = Array.from({ length: 4 }, (_, i) => ({
    id: i ? `p${i}` : 'empty',
    name: `Project ${i}`,
    path: `/synthetic/project-${i}`,
    storagePath: `/synthetic/store-${i}`,
  }));
  const catalog = { state: { projects, selectedProjectIds: ['empty'] } };
  const hub = new Hub(
    catalog,
    () => {
      throw new Error('Unexpected project loading');
    },
    false,
    false,
  );
  for (const project of projects) {
    const state = structuredClone(demoState);
    state.features = Array.from({ length: total / projects.length }, (_, i) => ({
      ...structuredClone(demoState.features[i % demoState.features.length]),
      id: `${project.id}-${i}`,
    }));
    hub.entries.set(project.id, {
      project,
      service: { state, snapshot: () => structuredClone(state) },
    });
  }
  let output;
  hub.on('state', (state) => {
    output = state;
  });
  return {
    publish(index = 0) {
      const entry = [...hub.entries.values()][index];
      // Both paths include the detached snapshot already created by the publishing service.
      hub.publish({ entry, state: entry.service.snapshot() });
      return output;
    },
  };
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(run) {
  const start = performance.now();
  for (let i = 0; i < 10; i++) run();
  return (performance.now() - start) / 10;
}
const results = [];
for (const total of [100, 1000]) {
  const before = fixture(Before, total),
    after = fixture(After, total);
  for (const [publisher, index] of [
    ['active', 0],
    ['inactive', 1],
  ]) {
    deepStrictEqual(after.publish(index), before.publish(index));
    for (let i = 0; i < 10; i++) {
      before.publish(index);
      after.publish(index);
    }
    const oldTimes = [],
      newTimes = [];
    for (let round = 0; round < 9; round++) {
      // Alternate order to reduce systematic warmup/GC bias. Timings are not a CI gate.
      for (const variant of round % 2 ? ['after', 'before'] : ['before', 'after']) {
        (variant === 'before' ? oldTimes : newTimes).push(
          measure(() => (variant === 'before' ? before : after).publish(index)),
        );
      }
    }
    const oldMs = median(oldTimes),
      newMs = median(newTimes);
    results.push({
      sessions: total,
      projects: 4,
      publisher,
      baselineMs: +oldMs.toFixed(2),
      optimizedMs: +newMs.toFixed(2),
      reductionPercent: +((1 - newMs / oldMs) * 100).toFixed(1),
      payloadBytes: Buffer.byteLength(JSON.stringify(after.publish(index))),
    });
  }
}
console.log(JSON.stringify({ baseline, node: process.version, results }, null, 2));
