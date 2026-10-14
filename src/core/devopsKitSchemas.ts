import { z } from 'zod';
const id = z.number().int().positive().max(2147483647);
const names = z
  .array(z.string().trim().min(1).max(200))
  .max(50)
  .refine((items) => new Set(items).size === items.length, 'Valeurs dupliquées.');
export const devOpsTestTargetSchema = z
  .object({
    buildId: id,
    pipelineId: id,
    commit: z
      .string()
      .regex(/^[a-fA-F0-9]{40}$/)
      .transform((value) => value.toLowerCase()),
    branch: z
      .string()
      .regex(/^refs\/heads\/[^\s\x00-\x1f]+$/)
      .max(250),
    environment: z.string().trim().min(1).max(500),
    isolationConfirmed: z.boolean(),
    expectedStages: names.refine(
      (items) => items.length > 0,
      'Indique au moins une étape attendue.',
    ),
    expectedArtifacts: names,
    requireTestResults: z.boolean(),
  })
  .strict();
export const devOpsQuerySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('pipelines'),
      continuationToken: z.string().min(1).max(1000).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('pipeline'), pipelineId: id, revision: id.optional() }).strict(),
  z
    .object({
      kind: z.literal('builds'),
      pipelineId: id,
      continuationToken: z.string().min(1).max(1000).optional(),
    })
    .strict(),
  z.object({ kind: z.enum(['build', 'timeline', 'artifacts', 'test-runs']), buildId: id }).strict(),
]);
// Copilot CLI 1.0.96 silently omits custom tools whose input schema has a
// top-level oneOf instead of an object. Publish flat parameters, then validate
// each request with devOpsQuerySchema before accessing Azure DevOps.
export const devOpsQueryToolSchema = z
  .object({
    kind: z.enum([
      'pipelines',
      'pipeline',
      'builds',
      'build',
      'timeline',
      'artifacts',
      'test-runs',
    ]),
    pipelineId: id.optional().describe('Required for pipeline and builds only.'),
    revision: id.optional().describe('Optional for pipeline only.'),
    buildId: id.optional().describe('Required for build, timeline, artifacts and test-runs only.'),
    continuationToken: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe('Optional for pipelines and builds only; reuse the returned token unchanged.'),
  })
  .strict();
const observation = z
  .object({
    kind: z.enum([
      'pipelines',
      'pipeline',
      'builds',
      'build',
      'timeline',
      'artifacts',
      'test-runs',
    ]),
    projectKey: z.string().max(600),
    collectedAt: z.string().max(64),
    sourceUrl: z.string().max(3000),
    data: z.record(z.string(), z.unknown()),
    truncated: z.boolean(),
    continuationToken: z.string().max(1000).optional(),
  })
  .strict();
export const devOpsEvidenceSchema = z
  .object({
    target: devOpsTestTargetSchema,
    projectKey: z.string().max(600),
    buildUrl: z.string().max(2000),
    collectedAt: z.string().max(64),
    status: z.enum(['passed', 'failed', 'incomplete']),
    checks: z
      .array(
        z
          .object({ name: z.string().max(250), passed: z.boolean(), detail: z.string().max(2000) })
          .strict(),
      )
      .min(1)
      .max(150),
    observations: z.array(observation).max(10),
    featureId: z.string().max(150),
    attemptId: z.string().max(150),
  })
  .strict();
