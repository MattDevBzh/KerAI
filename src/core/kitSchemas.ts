import { z } from 'zod';
export const kitIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const kitRefSchema = z
  .string()
  .regex(/^(workflow|agent|skill):[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const kitMetadataSchema = z
  .object({
    id: kitIdSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(1000),
    version: z.string().trim().min(1).max(40),
  })
  .strict();
export const KIT_LIMITS = {
  files: 512,
  fileBytes: 4 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  jsonBytes: 24 * 1024 * 1024,
};
export const kitBundleSchema = z
  .object({
    format: z.literal('feature-studio-kit'),
    schemaVersion: z.literal(1),
    metadata: kitMetadataSchema,
    roots: z.array(kitRefSchema).min(1).max(256),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(500),
            base64: z.string().max(Math.ceil(KIT_LIMITS.fileBytes / 3) * 4),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(KIT_LIMITS.files),
  })
  .strict();
export const kitMessageVariants = [
  z.object({ type: z.literal('kitCatalog'), requestId: kitIdSchema }).strict(),
  z
    .object({
      type: z.literal('kitPreview'),
      requestId: kitIdSchema,
      kitId: kitIdSchema,
      source: z.enum(['bundled', 'saved']),
    })
    .strict(),
  z
    .object({
      type: z.literal('kitCompose'),
      requestId: kitIdSchema,
      metadata: kitMetadataSchema,
      roots: z.array(kitRefSchema).min(1).max(256),
    })
    .strict(),
  z.object({ type: z.literal('kitImport'), requestId: kitIdSchema }).strict(),
  z
    .object({
      type: z.enum(['kitInstall', 'kitExport']),
      requestId: kitIdSchema,
      token: z.string().uuid(),
    })
    .strict(),
] as const;
