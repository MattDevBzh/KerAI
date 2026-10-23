// pngjs is pure JavaScript and bundled into the worker (no platform-specific image runtime).
const { PNG } = require('pngjs') as {
  PNG: { sync: { read(data: Buffer): Raster; write(image: Raster): Buffer } };
};
type Raster = { width: number; height: number; data: Buffer };
export type CaptureRectangle = { x: number; y: number; width: number; height: number };
/** Redact in memory before IPC or disk writes; never insert an overlay into the application. */
export function redactPng(
  bytes: Buffer,
  rectangles: CaptureRectangle[],
  crop?: CaptureRectangle,
): Buffer {
  const image = PNG.sync.read(bytes);
  if (image.width > 3840 || image.height > 2160)
    throw new Error('Capture dimensions exceed the supported viewport.');
  for (const rectangle of rectangles) {
    const left = Math.max(0, Math.floor(rectangle.x) - 3),
      top = Math.max(0, Math.floor(rectangle.y) - 3);
    const right = Math.min(image.width, Math.ceil(rectangle.x + rectangle.width) + 3),
      bottom = Math.min(image.height, Math.ceil(rectangle.y + rectangle.height) + 3);
    for (let y = top; y < bottom; y++)
      for (let x = left; x < right; x++) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = 32;
        image.data[offset + 1] = 32;
        image.data[offset + 2] = 32;
        image.data[offset + 3] = 255;
      }
  }
  if (!crop) return PNG.sync.write(image);
  const left = Math.max(0, Math.floor(crop.x)),
    top = Math.max(0, Math.floor(crop.y));
  const width = Math.min(image.width, Math.ceil(crop.x + crop.width)) - left;
  const height = Math.min(image.height, Math.ceil(crop.y + crop.height)) - top;
  if (width < 1 || height < 1) throw new Error('Capture target is outside the viewport.');
  const result: Raster = { width, height, data: Buffer.alloc(width * height * 4) };
  for (let y = 0; y < height; y++)
    image.data.copy(
      result.data,
      y * width * 4,
      ((y + top) * image.width + left) * 4,
      ((y + top) * image.width + left + width) * 4,
    );
  return PNG.sync.write(result);
}
