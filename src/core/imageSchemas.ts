import { z } from 'zod';
import { IMAGE_LIMITS } from '../shared/images';
export const imageSchema = z
  .object({
    id: z.string().uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\x00-\x1f\\/]+$/),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    data: z
      .string()
      .min(4)
      .max(Math.ceil(IMAGE_LIMITS.bytes / 3) * 4)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();
export const imagesSchema = z
  .array(imageSchema)
  .max(IMAGE_LIMITS.count)
  .refine(
    (images) => new Set(images.map((i) => i.id)).size === images.length,
    'Images dupliquées.',
  );
