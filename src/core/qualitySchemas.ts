import { z } from 'zod';

export const qualityKindSchema = z.enum(['visual', 'counterexample']);
// Deliberately no aliases, traversal, drive names, arbitrary report locations or hidden siblings.
export const qualityReportPathSchema = z
  .string()
  .max(180)
  .regex(/^\.feature-studio\/quality\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.json$/);
export const qualityCommandSchema = z.object({
  kind: qualityKindSchema,
  reportPath: qualityReportPathSchema,
});
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const text = z.string().max(4000);
const attachment = z.object({
  id,
  name: z.string().min(1).max(160),
  kind: z.enum(['screenshot', 'trace']),
  path: z.string().regex(/^artifacts\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.(png|jpg|zip)$/),
});
export const qualityReportSchema = z.object({
  version: z.literal(1),
  nonce: z.string().uuid(),
  featureId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  commandId: z.string().min(1).max(128),
  kind: qualityKindSchema,
  runner: z.enum(['vscode-electron', 'playwright']),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  cases: z
    .array(
      z.object({
        id,
        title: z.string().min(1).max(400),
        criterionIds: z.array(z.string().min(1).max(128)).max(50),
        status: z.enum(['passed', 'failed', 'skipped']),
        steps: z.array(text).max(100),
        errors: z.array(text).max(20),
        expected: text.optional(),
        actual: text.optional(),
        reproduction: z.array(text).max(30).optional(),
        attachmentIds: z.array(id).max(30),
      }),
    )
    .max(200),
  attachments: z.array(attachment).max(60),
});
export type QualityReport = z.infer<typeof qualityReportSchema>;

export const qualityEvidenceSchema = z.object({
  version: z.literal(1),
  kind: qualityKindSchema,
  featureId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  commandId: z.string().min(1).max(128),
  evidenceId: z.string().min(1).max(128),
  collectedAt: z.string().max(80),
  status: z.enum(['passed', 'failed', 'incomplete', 'unavailable', 'invalid']),
  runner: z.string().max(80).optional(),
  reportPath: qualityReportPathSchema,
  reportSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  error: z.string().max(2000).optional(),
  cases: qualityReportSchema.shape.cases,
  attachments: z
    .array(
      z.object({
        id,
        name: z.string().max(160),
        kind: z.enum(['screenshot', 'trace']),
        mime: z.enum(['image/png', 'image/jpeg', 'application/zip']),
        sizeBytes: z
          .number()
          .int()
          .nonnegative()
          .max(16 * 1024 * 1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(60),
});
