import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--long', '--json'], {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
  }),
);
const seen = new Set();
const sections = [];
async function visit(node) {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    const key = `${name}@${dependency.version}`;
    if (!seen.has(key) && dependency.path) {
      seen.add(key);
      const entries = await readdir(dependency.path).catch((error) => {
        if (error.code === 'ENOENT') return []; // Optional packages for other platforms.
        throw error;
      });
      const files = entries.filter((f) => /^(license|licence|copying|notice)(\.|$)/i.test(f));
      for (const file of files)
        sections.push(
          `## ${key} — ${file}\n\n\`\`\`text\n${(await readFile(path.join(dependency.path, file), 'utf8')).replace(/\r\n/g, '\n')}\n\`\`\`\n`,
        );
      await visit(dependency);
    }
  }
}
await visit(tree);
await writeFile(
  'THIRD_PARTY_NOTICES.md',
  '# Third-party notices\n\nProduction dependencies used by the bundled extension and interface. Copilot CLI is installed separately by the user.\n\n' +
    sections.join('\n'),
);
