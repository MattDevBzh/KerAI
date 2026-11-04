// Isolated CI diagnosis only: no application URL, credential or personal browser profile.
import { chromium } from 'playwright-core';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function probe() {
  const label = process.argv[2];
  const headless = process.argv[3] === 'headless';
  const longProfile = process.argv[4] === 'long';
  const root = await mkdtemp(path.join(tmpdir(), 'kerai-launch-probe-'));
  const profile = longProfile
    ? path.join(root, 'nested-profile-'.repeat(10), 'profile-'.repeat(10))
    : root;
  await mkdir(profile, { recursive: true });
  console.log(
    'BROWSER_PROBE_START',
    JSON.stringify({
      label,
      headless,
      longProfile,
      profilePathLength: profile.length,
      electron: process.versions.electron,
      node: process.versions.node,
    }),
  );
  try {
    const context = await chromium.launchPersistentContext(profile, {
      headless,
      timeout: 10000,
    });
    console.log('BROWSER_PROBE_OK', label);
    await context.close();
  } catch (error) {
    console.error('BROWSER_PROBE_ERROR', label, error instanceof Error ? error.message : error);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
void probe().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
