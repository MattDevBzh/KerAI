// Host-owned worker: never loads or executes the user's skill scripts.
import { prepare, inspect } from './remoteReviewEngine.mjs';
import { safePath } from '../core/registry';
import { mkdir, readFile } from 'node:fs/promises';
const [root, command, json] = process.argv.slice(2);
async function main() {
  try {
    if (
      !root ||
      !['prepare', 'files', 'list', 'read', 'diff', 'search', 'info', 'verify'].includes(command)
    )
      throw Error('Opération de relecture inconnue.');
    const options = JSON.parse(json);
    await safePath(root, 'cache');
    await safePath(root, 'reports');
    await mkdir(root, { recursive: true });
    if (command !== 'prepare') {
      if (!/^[a-f0-9-]{36}$/.test(options.session ?? '')) throw Error('Session invalide.');
      const snapshotFile = await safePath(root, `reports/${options.session}/snapshot.json`);
      const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
      if (!/^[a-f0-9]{64}$/.test(snapshot.cacheKey ?? '')) throw Error('Cache invalide.');
      await safePath(root, `cache/${snapshot.cacheKey}.git/config`);
    }
    const result =
      command === 'prepare' ? prepare(options, { root }) : inspect(command, options, { root });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
void main();
