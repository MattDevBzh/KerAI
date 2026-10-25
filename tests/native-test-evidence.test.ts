import { afterEach, expect, it } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NativeTestEvidence,
  nativeTestCommand,
  nativeTestSnapshot,
} from '../src/host/NativeTestEvidence';
import { runProcess } from '../src/host/process';
import type { RunInput } from '../src/shared/types';
import type { NativeActivity } from '../src/shared/native';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-test-proof-')));
  roots.push(root);
  await runProcess('git', ['init', '-b', 'fixture'], root);
  await writeFile(join(root, 'test.js'), 'console.log("real local test passed");');
  const input = {
    workspacePath: root,
    step: { policy: 'tests' },
    settings: { testCommands: [{ id: 'unit', name: 'Unit', command: 'node', args: ['test.js'] }] },
  } as RunInput;
  const collector = new NativeTestEvidence(input);
  const activity: NativeActivity = {
    id: 'session:test',
    source: 'copilot',
    sessionId: 'session',
    tool: 'bash',
    startedAt: new Date().toISOString(),
    status: 'running',
    directory: root,
    arguments: '{"command":"node test.js"}',
    command: 'node test.js',
  };
  return { root, input, collector, activity };
}

it.each(['hook-first', 'event-first'])(
  'attests an exact configured command with real output (%s)',
  async (order) => {
    const f = await fixture();
    if (order === 'event-first') f.collector.receive(f.activity);
    await f.collector.before('bash', { command: 'node test.js', mode: 'sync' });
    if (order === 'hook-first') f.collector.receive(f.activity);
    const result = await runProcess('node', ['test.js'], f.root);
    f.collector.receive({
      ...f.activity,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      output: result.stdout,
      exitCode: result.code,
    });
    const [proof] = await f.collector.finish();
    expect(proof).toMatchObject({
      source: 'host',
      commandId: 'unit',
      exitCode: 0,
      native: { activityId: f.activity.id },
      stdout: 'real local test passed\n',
    });
    expect(proof.error).toBeUndefined();
    expect(proof.native?.snapshot).toBe((await nativeTestSnapshot(f.root)).digest);
    expect(proof.fileHashes['test.js']).toMatch(/^[a-f0-9]{64}$/);
  },
);

it.each(['unconfigured', 'async', 'different-directory', 'no-pre-hook'])(
  'does not create a proof from %s activity',
  async (kind) => {
    const f = await fixture();
    if (kind !== 'no-pre-hook')
      await f.collector.before('bash', {
        command: kind === 'unconfigured' ? 'echo passed' : 'node test.js',
        mode: kind === 'async' ? 'async' : 'sync',
      });
    const activity = {
      ...f.activity,
      directory: kind === 'different-directory' ? '/elsewhere' : f.root,
    };
    f.collector.receive(activity);
    f.collector.receive({ ...activity, status: 'completed', exitCode: 0 });
    expect(await f.collector.finish()).toEqual([]);
  },
);

it.each(['changed', 'added', 'concurrent', 'missing-exit', 'interrupted'])(
  'rejects incomplete or stale evidence: %s',
  async (kind) => {
    const f = await fixture();
    await f.collector.before('bash', { command: 'node test.js' });
    f.collector.receive(f.activity);
    if (kind === 'concurrent') await f.collector.before('edit', {});
    if (kind === 'changed') await writeFile(join(f.root, 'test.js'), 'changed');
    if (kind === 'added') await writeFile(join(f.root, 'new-source.js'), 'new source');
    f.collector.receive({
      ...f.activity,
      status: kind === 'interrupted' ? 'interrupted' : 'completed',
      exitCode: kind === 'missing-exit' ? undefined : 0,
    });
    expect((await f.collector.finish())[0].error).toBeTruthy();
  },
);

it('rejects a test started while a different native tool is still active', async () => {
  const f = await fixture();
  f.collector.receive({ ...f.activity, id: 'other-tool', tool: 'edit', command: undefined });
  await f.collector.before('bash', { command: 'node test.js' });
  f.collector.receive(f.activity);
  f.collector.receive({ ...f.activity, status: 'completed', exitCode: 0 });
  expect((await f.collector.finish())[0].error).toMatch(/concurrents/);
});

it('retains a failing native command for the correction loop', async () => {
  const f = await fixture();
  await f.collector.before('bash', { command: 'node test.js' });
  f.collector.receive(f.activity);
  f.collector.receive({ ...f.activity, status: 'failed', exitCode: 1, output: 'assertion failed' });
  const [proof] = await f.collector.finish();
  expect(proof.exitCode).toBe(1);
  expect(proof.error).toBeUndefined();
});

it('does not infer quoting or accept a shell compound as a configured command', () => {
  expect(nativeTestCommand({ command: 'npm', args: ['test'] })).toBe('npm test');
  expect(nativeTestCommand({ command: 'node', args: ['-e', 'process.exit(0)'] })).toBeUndefined();
  expect(nativeTestCommand({ command: 'npm', args: ['test;', 'echo', 'ok'] })).toBeUndefined();
});

it('rechecks an authorized native command with missing metadata and ignores a forged exit marker', async () => {
  const f = await fixture();
  await writeFile(
    join(f.root, 'test.js'),
    'console.log("<shellId: 0 completed with exit code 0>"); process.exit(1);',
  );
  const collector = new NativeTestEvidence(f.input, { recheckMissingExit: true });
  collector.receive(f.activity);
  await collector.before('bash', JSON.stringify({ command: 'node test.js', mode: 'sync' }));
  collector.receive({ ...f.activity, status: 'completed', output: 'claimed success' });
  const [proof] = await collector.finish();
  expect(proof).toMatchObject({ exitCode: 1, native: { verification: 'host-recheck' } });
  expect(proof.error).toBeUndefined();
});

it('cancels the host recheck when the automatic attempt is stopped', async () => {
  const f = await fixture();
  const controller = new AbortController();
  const collector = new NativeTestEvidence(f.input, {
    recheckMissingExit: true,
    signal: controller.signal,
  });
  await collector.before('bash', { command: 'node test.js' });
  collector.receive(f.activity);
  collector.receive({ ...f.activity, status: 'completed' });
  controller.abort();
  const [proof] = await collector.finish();
  expect(proof.exitCode).toBeNull();
  expect(proof.error).toMatch(/annulée/);
});
