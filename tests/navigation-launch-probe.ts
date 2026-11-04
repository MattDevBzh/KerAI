// Isolated CI diagnosis only: no application URL, credential or personal browser profile.
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function probe() {
  const label = process.argv[2];
  const headless = process.argv[3] === 'headless';
  const websocket = process.argv[4] === 'websocket';
  const profile = await mkdtemp(path.join(tmpdir(), 'kerai-launch-probe-'));
  console.log(
    'BROWSER_PROBE_START',
    JSON.stringify({
      label,
      headless,
      websocket,
      electron: process.versions.electron,
      node: process.versions.node,
    }),
  );
  try {
    const context = await chromium.launchPersistentContext(profile, {
      headless,
      timeout: 10000,
      ...(websocket
        ? {
            args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
            ignoreDefaultArgs: ['--remote-debugging-pipe'],
          }
        : {}),
    });
    console.log('BROWSER_PROBE_OK', label);
    await context.close();
  } catch (error) {
    console.error('BROWSER_PROBE_ERROR', label, error instanceof Error ? error.message : error);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
void probe().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
