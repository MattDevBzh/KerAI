import { z } from 'zod';

export const workshopManifestSchema = z
  .object({
    format: z.literal('kerai-workshop'),
    schemaVersion: z.literal(1),
    exportId: z.string().uuid(),
    createdAt: z.string().datetime(),
    deleted: z.array(z.string().min(1).max(600)).max(2048),
  })
  .strict();

export const workshopMessageVariants = [
  z
    .object({
      type: z.enum(['workshopHistory', 'workshopExport', 'workshopImport']),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal('workshopRestorePreview'),
      requestId: z.string().uuid(),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal('workshopApply'),
      requestId: z.string().uuid(),
      token: z.string().uuid(),
    })
    .strict(),
] as const;
