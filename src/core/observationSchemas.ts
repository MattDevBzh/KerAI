import { z } from 'zod';
export const usageSchema = z.object({
  source: z.literal('measured'),
  inputTokens: z.number().finite().nonnegative().optional(),
  outputTokens: z.number().finite().nonnegative().optional(),
  model: z.string().optional(),
  cost: z.number().finite().nonnegative().optional(),
  unit: z.string().optional(),
  incompleteTokens: z.boolean().optional(),
  incompleteCost: z.boolean().optional(),
  byModel: z
    .record(
      z.string(),
      z.object({
        inputTokens: z.number().finite().nonnegative().optional(),
        outputTokens: z.number().finite().nonnegative().optional(),
        cost: z.number().finite().nonnegative().optional(),
        incompleteTokens: z.boolean().optional(),
        incompleteCost: z.boolean().optional(),
      }),
    )
    .optional(),
});
export const traceInfoSchema = z.object({
  bytes: z.number().int().nonnegative(),
  records: z.number().int().nonnegative(),
  complete: z.boolean(),
  reason: z.string().optional(),
});
export const traceSchema = z.object({
  id: z.string(),
  at: z.string(),
  type: z.string(),
  stepId: z.string().optional(),
  attemptId: z.string().optional(),
  agentId: z.string().optional(),
  data: z.string(),
});
export const observationOptionsSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    maxCalls: z.number().int().min(2).max(10000),
    maxNanoAiu: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
export const analysisSchema = z
  .object({
    summary: z.string().trim().min(1).max(1000),
    strengths: z.array(z.string().max(1000)).max(8),
    findings: z
      .array(
        z
          .object({
            kind: z.enum(['fact', 'interpretation', 'recommendation']),
            title: z.string().trim().min(1).max(300),
            detail: z.string().trim().min(1).max(3000),
            impact: z.enum(['high', 'medium', 'low']),
            references: z.array(z.string().min(1).max(200)).min(1).max(8),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const observationSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  featureTitle: z.string(),
  snapshotKey: z.string(),
  dossierHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  snapshotStateKey: z.string().optional(),
  requestedModel: z.string(),
  maxCalls: z.number(),
  maxNanoAiu: z.number().optional(),
  coverage: z.object({
    complete: z.boolean(),
    warnings: z.array(z.string()),
    analyzedParts: z.number(),
    totalParts: z.number(),
  }),
  phases: z.array(
    z.object({
      stepId: z.string(),
      name: z.string(),
      agent: z.string(),
      status: z.string(),
      attempts: z.number(),
      durationMs: z.number(),
      usage: usageSchema.optional(),
      models: z.array(z.string()),
      analyzedParts: z.number(),
      totalParts: z.number(),
      analyses: z.array(analysisSchema),
    }),
  ),
  calls: z.array(
    z.object({
      id: z.string(),
      sessionId: z.string().optional(),
      phaseId: z.string().optional(),
      startedAt: z.string(),
      finishedAt: z.string().optional(),
      status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
      model: z.string().optional(),
      usage: usageSchema.optional(),
      error: z.string().optional(),
    }),
  ),
  global: analysisSchema.optional(),
  error: z.string().optional(),
  sourceIndex: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      stepId: z.string().optional(),
      attemptId: z.string().optional(),
    }),
  ),
});
