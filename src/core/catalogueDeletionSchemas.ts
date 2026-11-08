import { z } from 'zod';
import { kitIdSchema } from './kitSchemas';
export const catalogueDeleteTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('agent'), id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,149}$/) })
    .strict(),
  z
    .object({ kind: z.literal('kit'), id: kitIdSchema, source: z.enum(['bundled', 'saved']) })
    .strict(),
]);
export const catalogueDeleteMessageVariants = [
  z
    .object({
      type: z.literal('catalogueDeletePreview'),
      requestId: z.string().uuid(),
      target: catalogueDeleteTargetSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('catalogueDeleteApply'),
      requestId: z.string().uuid(),
      token: z.string().uuid(),
    })
    .strict(),
] as const;
