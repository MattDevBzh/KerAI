import { z } from 'zod';

export const boundedId = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const uniqueIds = z
  .array(boundedId)
  .max(256)
  .refine((ids) => new Set(ids).size === ids.length, 'Identifiants dupliqués.');
const shortText = z.string().max(2000);
const key = z
  .string()
  .min(1)
  .max(150)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const timestamp = z.string().min(1).max(64);
const path = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => !value.includes('\0'), 'Chemin invalide.');
export const launchSchema = z
  .object({
    initialContext: z.string().max(60000),
    mcpServerIds: uniqueIds,
    memoryIds: uniqueIds,
    useProjectMemory: z.boolean(),
    contextMode: z.enum(['all', 'empty']).optional(),
    contextBlocks: z
      .record(
        z
          .string()
          .max(160)
          .regex(
            /^(?:feature|agent|initial-context|feedback|answers|previous|criteria|review-comments|(?:skill|memory|artifact):[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/,
          ),
        z
          .object({ enabled: z.boolean().optional(), content: z.string().max(60000).optional() })
          .strict(),
      )
      .refine(
        (blocks) =>
          Object.keys(blocks).length <= 256 &&
          Object.values(blocks).reduce((sum, block) => sum + (block.content?.length ?? 0), 0) <=
            500000,
        'Trop de contexte personnalisé.',
      )
      .optional(),
  })
  .strict();
export const mcpServerSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
      .refine(
        (value) => !['constructor', 'prototype', 'github'].includes(value),
        'Identifiant MCP réservé.',
      ),
    name: z.string().trim().min(1).max(200),
    transport: z.enum(['stdio', 'http', 'sse']),
    command: z.string().trim().min(1).max(1000).optional(),
    args: z.array(z.string().max(4000)).max(100),
    url: z.string().max(4000).optional(),
    envKeys: z
      .array(key)
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        'Références de secrets dupliquées.',
      ),
    headers: z
      .record(z.string().regex(/^[A-Za-z0-9-]{1,128}$/), key)
      .refine((value) => Object.keys(value).length <= 100),
    tools: z
      .array(z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/))
      .max(256)
      .refine((values) => new Set(values).size === values.length, 'Outils MCP dupliqués.'),
    autoApproveReadOnly: z.boolean(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((server, context) => {
    if (server.transport === 'stdio') {
      if (!server.command || server.url)
        context.addIssue({
          code: 'custom',
          message: 'Un MCP stdio exige une commande et aucun URL.',
        });
    } else {
      try {
        const url = new URL(server.url ?? '');
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.hash ||
          server.command
        )
          throw new Error();
      } catch {
        context.addIssue({
          code: 'custom',
          message:
            'Un MCP HTTP/SSE exige un URL HTTP(S) sans identifiants intégrés et aucune commande.',
        });
      }
    }
  });
export const budgetSchema = z
  .object({
    maxRuns: z.number().int().min(1).max(1000),
    maxTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    maxNanoAiu: z.number().nonnegative().finite().max(Number.MAX_SAFE_INTEGER).optional(),
    maxPromptChars: z.number().int().min(1000).max(500000),
    modelProfile: z.enum(['current', 'economy', 'balanced', 'quality']),
  })
  .strict();
export const autopilotConfigSchema = z
  .object({
    checkpoints: uniqueIds,
    maxRuns: z.number().int().min(1).max(1000),
    maxCorrectionCycles: z.number().int().min(0).max(20),
    reviewStepId: boundedId.optional(),
    correctionStepId: boundedId.optional(),
    stepInputs: z
      .record(boundedId, launchSchema)
      .refine((value) => Object.keys(value).length <= 100),
  })
  .strict();
export const autopilotStateSchema = autopilotConfigSchema
  .extend({
    status: z.enum(['idle', 'running', 'paused', 'completed']),
    runs: z.number().int().nonnegative(),
    correctionCycles: z.number().int().nonnegative(),
    reason: shortText.optional(),
    updatedAt: timestamp,
  })
  .strict();
export const memorySchema = z
  .object({
    id: boundedId,
    title: z.string().trim().min(1).max(200),
    content: z
      .string()
      .max(40000)
      .refine((value) => !!value.trim(), 'Mémoire vide.'),
    category: z.enum(['convention', 'architecture', 'decision', 'context']),
    enabled: z.boolean(),
    agentIds: uniqueIds,
    updatedAt: timestamp,
    source: z
      .object({ featureId: boundedId, stepId: boundedId, attemptId: boundedId })
      .strict()
      .optional(),
  })
  .strict();
export const criterionSchema = z
  .object({
    id: boundedId,
    text: z.string().trim().min(1).max(4000),
    status: z.enum(['pending', 'passed', 'failed']),
    evidence: z.string().max(12000),
  })
  .strict();
export const commentSchema = z
  .object({
    id: boundedId,
    stepId: boundedId,
    attemptId: boundedId,
    file: path.optional(),
    line: z.number().int().min(1).max(10000000).optional(),
    text: z.string().trim().min(1).max(12000),
    blocking: z.boolean(),
    resolved: z.boolean(),
    createdAt: timestamp,
  })
  .strict();
export const reviewSchema = z
  .object({
    verdict: z.enum(['pass', 'changes_requested']),
    summary: z.string().max(12000),
    findings: z
      .array(
        z
          .object({
            id: boundedId,
            severity: z.enum(['info', 'warning', 'blocking']),
            message: z.string().trim().min(1).max(12000),
            file: path.optional(),
            line: z.number().int().min(1).max(10000000).optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .superRefine((review, context) => {
    if (new Set(review.findings.map((f) => f.id)).size !== review.findings.length)
      context.addIssue({ code: 'custom', message: 'Constats dupliqués.' });
    if (review.verdict === 'pass' && review.findings.some((f) => f.severity === 'blocking'))
      context.addIssue({
        code: 'custom',
        message: 'Une relecture bloquante ne peut pas être déclarée pass.',
      });
  });
export const evidenceSchema = z
  .object({
    id: boundedId,
    source: z.literal('host'),
    commandId: boundedId,
    name: z.string().max(200),
    command: z.string().min(1).max(1000),
    args: z.array(z.string().max(4000)).max(100),
    startedAt: timestamp,
    finishedAt: timestamp,
    exitCode: z.number().int().nullable(),
    stdout: z.string().max(300000),
    stderr: z.string().max(300000),
    truncated: z.boolean(),
    error: z.string().max(12000).optional(),
    fileHashes: z
      .record(path, z.string().min(1).max(128))
      .refine((value) => Object.keys(value).length <= 10000),
  })
  .strict();
