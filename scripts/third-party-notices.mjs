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
const sections = [
  '## Caveat — handwritten HQ font\n\nCopyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat).\nDistributed under the SIL Open Font License 1.1. The unmodified variable font and full license\nare bundled in `dist/webview/fonts/Caveat.ttf` and `dist/webview/fonts/Caveat-OFL.txt`.\nSource: https://github.com/google/fonts/tree/main/ofl/caveat.\n',
  '## DejaVu Sans — PDF export fonts\n\nThe unmodified regular and bold fonts are bundled in `resources/fonts`.\nTheir full copyright and license notice follows and is also included as `LICENSE-DejaVu.txt`.\n\n```text\n' +
    (await readFile('resources/fonts/LICENSE-DejaVu.txt', 'utf8')) +
    '\n```\n',
];
async function visit(node) {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    const key = `${name}@${dependency.version}`;
    if (!seen.has(key) && dependency.path) {
      seen.add(key);
      const entries = await readdir(dependency.path).catch((error) => {
        if (error.code === 'ENOENT') return []; // Optional packages for other platforms.
        throw error;
      });
      const files = entries.filter((f) => /^(license|licence|copying|notice)([._-]|$)/i.test(f));
      for (const file of files)
        sections.push(
          `## ${key} — ${file}\n\n\`\`\`text\n${(await readFile(path.join(dependency.path, file), 'utf8')).replace(/\r\n/g, '\n')}\n\`\`\`\n`,
        );
      await visit(dependency);
    }
  }
}
await visit(tree);
sections.push(await readFile('resources/licenses/unicode.md', 'utf8'));
await writeFile(
  'THIRD_PARTY_NOTICES.md',
  (
    '# Third-party notices\n\nProduction dependencies used by the bundled extension and interface. Copilot CLI is installed separately by the user.\n\n' +
    sections.join('\n')
  ).trimEnd() + '\n',
);
