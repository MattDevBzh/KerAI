// Mechanical extraction/encoding only. Artwork and gestures are drawn by imagegen.
import sharp from 'sharp';
import gifenc from 'gifenc';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { GIFEncoder, quantize, applyPalette } = gifenc;
const { avatars } = JSON.parse(await readFile('src/shared/avatar-catalog.json', 'utf8'));
const args = process.argv.slice(2);
const eventIndex = args.indexOf('--event');
const event = eventIndex >= 0 ? args.splice(eventIndex, 2)[1] : undefined;
if (eventIndex >= 0 && event !== 'halloween') throw new Error('Unknown bundled event pack');
const selected = args;
const size = 256;
async function writePng(pipeline, path) {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Normalize export rounding noise (0/255 or 1/255 alpha) and discard invisible RGB.
  // Keep all visible pixel artwork and its remaining alpha unchanged.
  for (let p = 0; p < data.length; p += 4) if (data[p + 3] <= 1) data.fill(0, p, p + 4);
  await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(path);
}
for (const { id } of avatars.filter(({ id }) => !selected.length || selected.includes(id))) {
  const source = await readFile(
    `design/avatars/${event ? `events/${event}` : 'professions'}/${id}.png`,
  );
  const meta = await sharp(source).metadata();
  if (meta.width !== 1536 || meta.height !== 1024 || !meta.hasAlpha)
    throw new Error(`Expected transparent 3×2 sprite sheet for ${id}`);
  const out = `webview/public/${event ? `avatar-events/${event}` : 'avatars'}/${id}`;
  await mkdir(out, { recursive: true });
  const cell = (index) =>
    sharp(source)
      .extract({
        left: (index % 3) * 512,
        top: Math.floor(index / 3) * 512,
        width: 512,
        height: 512,
      })
      .resize(size, size, { kernel: 'nearest' });
  // Keep the exact first portrait approved by the user as the architect's idle pose.
  const idle =
    !event && id === 'software-architect'
      ? sharp('design/avatars/professions/software-architect-idle.png').resize(size, size, {
          kernel: 'nearest',
        })
      : cell(0);
  await writePng(idle, `${out}/idle.png`);
  await writePng(cell(5), `${out}/approved.png`);
  const gif = GIFEncoder();
  for (const index of [1, 2, 3, 4]) {
    const rgba = await cell(index).ensureAlpha().raw().toBuffer();
    // GIF has binary alpha. Clear RGB in transparent pixels before quantization
    // so invisible source colors cannot create a colored background or halo.
    for (let p = 0; p < rgba.length; p += 4) {
      if (rgba[p + 3] < 128) rgba.fill(0, p, p + 4);
      else rgba[p + 3] = 255;
    }
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    if (transparentIndex < 0)
      throw new Error(`Missing transparent background: ${id}, frame ${index}`);
    const indexed = applyPalette(rgba, palette, 'rgba4444');
    gif.writeFrame(indexed, size, size, {
      palette,
      delay: 320,
      repeat: 0,
      transparent: true,
      transparentIndex,
      dispose: 2,
    });
  }
  gif.finish();
  await writeFile(`${out}/working.gif`, gif.bytes());
  console.log(`${id}: idle.png, working.gif (4 frames, transparent), approved.png`);
}
