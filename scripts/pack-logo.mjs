import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'design/logo-team/source.png');
const resources = path.join(root, 'resources');
await mkdir(resources, { recursive: true });
// Preserve the approved artwork and its alpha; only encode it at the target sizes.
await sharp(source).resize(512, 512).png().toFile(path.join(resources, 'icon.png'));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(path.join(resources, 'feature-studio.ico'), Buffer.concat([header, ...images]));
console.log('Feature Studio: transparent PNG 512px and Windows ICO 16–256px generated.');
