// Mechanical sprite extraction and GIF encoding. Artwork is generated with imagegen,
// not drawn by this script. Sources and prompt provenance live in design/avatars.
import sharp from 'sharp';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const ids = [
  'wizard',
  'hacker',
  'detective',
  'lumberjack',
  'scientist',
  'robot',
  'ninja',
  'captain',
  'devops-scout',
  'devops-architect',
  'devops-builder',
  'devops-sentinel',
  'devops-lab',
  'devops-controller',
];
for (const id of ids.filter(
  (id) => !process.argv.includes('--devops') || id.startsWith('devops-'),
)) {
  const source = await readFile(`design/avatars/${id}.png`);
  const meta = await sharp(source).metadata();
  if (meta.width !== 1536 || meta.height !== 1024)
    throw new Error(`Unexpected sprite grid for ${id}: ${meta.width}x${meta.height}`);
  const out = `webview/public/avatars/${id}`;
  await mkdir(out, { recursive: true });
  const cell = (index) =>
    sharp(source)
      .extract({
        left: (index % 3) * 512,
        top: Math.floor(index / 3) * 512,
        width: 512,
        height: 512,
      })
      .resize(192, 192, { kernel: 'nearest' });
  await cell(0).png().toFile(`${out}/idle.png`);
  await cell(5).png().toFile(`${out}/approved.png`);
  const gif = GIFEncoder();
  for (const index of [1, 2, 3, 4]) {
    const rgba = await cell(index).ensureAlpha().raw().toBuffer();
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, 192, 192, { palette, delay: 320, repeat: 0 });
  }
  gif.finish();
  await writeFile(`${out}/working.gif`, gif.bytes());
  console.log(`${id}: idle.png, working.gif (4 frames), approved.png`);
}
