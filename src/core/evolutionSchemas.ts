import { navigationSelectionSchema } from './navigationSchemas';
import { pairPreferencesSchema } from './pairPreferences';
import { z } from 'zod';
import { qualityEvidenceSchema } from './qualitySchemas';
import { devOpsEvidenceSchema, devOpsTestTargetSchema } from './devopsKitSchemas';

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
import { nativePermissionModeSchema } from './nativeSchemas';
export const launchSchema = z
  .object({
    navigation: navigationSelectionSchema.optional(),
    omitNavigation: z.boolean().optional(),
    permissionMode: nativePermissionModeSchema.optional(),
    pair: pairPreferencesSchema.optional(),
    devopsTest: devOpsTestTargetSchema.optional(),
    initialContext: z.string().max(60000),
    mcpServerIds: uniqueIds,
    memoryIds: uniqueIds,
    useProjectMemory: z.boolean(),
    editableExistingFiles: z
      .array(path)
      .max(100)
      .refine((files) => new Set(files).size === files.length, 'Fichiers dupliqués.')
      .optional(),
    contextMode: z.enum(['all', 'empty']).optional(),
    contextBlocks: z
      .record(
        z
          .string()
          .max(160)
          .regex(
            /^(?:feature|images|agent|initial-context|feedback|answers|previous|pair-history|criteria|review-comments|(?:skill|memory|artifact):[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/,
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
    maxRuns: z.number().int().min(0).max(1000),
    maxTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    maxNanoAiu: z.number().nonnegative().finite().max(Number.MAX_SAFE_INTEGER).optional(),
    maxPromptChars: z.number().int().min(1000).max(500000),
    modelProfile: z.enum(['current', 'economy', 'balanced', 'quality']),
  })
  .strict();
const correctionProblemSchema = z
  .object({ key: z.string().regex(/^[a-f0-9]{64}$/), message: z.string().max(2000) })
  .strict();
const problemKeys = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100);
export const correctionLoopStateSchema = z
  .object({
    contract: z
      .object({
        id: boundedId,
        createdAt: timestamp,
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        workflowFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        description: z.string().max(200000),
        criteria: z
          .array(z.object({ id: boundedId, text: z.string().max(30000) }).strict())
          .max(256),
        correctionStepId: boundedId.optional(),
        reviewStepId: boundedId.optional(),
        commands: z
          .array(
            z
              .object({
                projectId: boundedId.optional(),
                id: boundedId,
                name: z.string().max(2000),
                command: z.string().max(10000),
                args: z.array(z.string().max(10000)).max(256),
                quality: z
                  .object({
                    kind: z.enum(['visual', 'counterexample']),
                    reportPath: z.string().max(10000),
                  })
                  .strict()
                  .optional(),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    observations: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-f0-9]{64}$/),
            stepId: boundedId,
            attemptId: boundedId,
            evidenceIds: z.array(boundedId).max(100),
            workspaceFingerprint: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            checkKey: z.string().max(300),
            kind: z.enum(['review', 'test']),
            problems: z.array(correctionProblemSchema).max(100),
            resolved: problemKeys,
            persistent: problemKeys,
            introduced: problemKeys,
            stagnantCycles: z.number().int().min(0).max(1000),
          })
          .strict(),
      )
      .max(80),
    stagnantCycles: z.number().int().min(0).max(1000),
    pause: z.enum(['contract_changed', 'stagnation', 'oscillation', 'history_limit']).optional(),
    readiness: z.enum(['unverified', 'issues', 'ready_for_human']),
  })
  .strict();
export const autopilotConfigSchema = z
  .object({
    autoAnswerRecommended: z.boolean().optional(),
    correctionLoop: z
      .object({ maxStagnantCycles: z.number().int().min(1).max(10) })
      .strict()
      .optional(),
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
    correctionLoopState: correctionLoopStateSchema.optional(),
    correctionLoopHistory: z.array(correctionLoopStateSchema).max(20).optional(),
    decisions: z
      .array(
        z
          .object({
            at: timestamp,
            kind: z.enum([
              'run',
              'approve',
              'correct',
              'pause',
              'complete',
              'configure',
              'resume',
              'answer',
            ]),
            stepId: boundedId.optional(),
            message: shortText,
            runs: z.number().int().nonnegative(),
            correctionCycles: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    automaticAnswers: z
      .array(
        z
          .object({
            at: timestamp,
            stepId: boundedId,
            attemptId: boundedId,
            questionId: z.string().max(1000),
            question: z.string().max(30000),
            answer: z.string().max(30000),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    resumeAfterInteraction: z.boolean().optional(),
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
      .object({
        featureId: boundedId,
        stepId: boundedId,
        attemptId: boundedId,
        revision: z.number().int().nonnegative().optional(),
      })
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
    revision: z.number().int().nonnegative().optional(),
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
    native: z
      .object({
        activityId: z.string().min(1).max(1000),
        sessionId: z.string().min(1).max(300),
        snapshot: z.string().regex(/^[a-f0-9]{64}$/),
        verification: z.enum(['runtime', 'host-recheck']),
      })
      .strict()
      .optional(),
    projectId: z.string().min(1).max(150).optional(),
    devops: devOpsEvidenceSchema.optional(),
    quality: qualityEvidenceSchema.optional(),
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
