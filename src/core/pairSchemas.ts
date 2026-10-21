import { z } from 'zod';
import { discussionAgentSchema } from './discussionSchemas';
import { mcpServerSchema } from './evolutionSchemas';
import { workflowSchema } from './workflow';
import { pairPreferencesSchema } from './pairPreferences';
import type { StudioSettings } from '../shared/types';

const id = z.string().min(1).max(150);
export const pairPlanProposalSchema = z
  .object({
    summary: z.string().trim().min(1).max(10000),
    blocks: z
      .array(
        z
          .object({
            id,
            title: z.string().trim().min(1).max(300),
            description: z.string().trim().min(1).max(10000),
            corrects: id.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(40)
      .refine(
        (blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length,
        'Blocs dupliqués.',
      ),
  })
  .strict();
export const pairResultSchema = z
  .object({
    blockId: id,
    outcome: z.enum(['completed', 'blocked']),
    decisions: z.array(z.string().trim().min(1).max(4000)).max(50).default([]),
  })
  .strict();
export const pairActionSchema = z
  .object({
    type: z.literal('pairAction'),
    featureId: id,
    stepId: id,
    attemptId: id,
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    action: z.enum([
      'message',
      'approve-plan',
      'continue',
      'solo',
      'pair',
      'pause',
      'resume',
      'reorganize',
      'preferences',
      'retry-message',
      'keep-message',
      'revise',
    ]),
    content: z.string().trim().min(1).max(30000).optional(),
    messageId: id.optional(),
    preferences: pairPreferencesSchema.optional(),
  })
  .strict();

export function createPairStateSchema(settings: z.ZodType<StudioSettings>) {
  return z
    .object({
      nativeConversation: z.boolean().optional(),
      origin: z.enum(['solo', 'pair']).optional(),
      engaged: z.boolean().optional(),
      soloResultReady: z.boolean().optional(),
      contextDelivered: z.boolean().optional(),
      requestedMode: z.enum(['solo', 'pair']).optional(),
      nativeEventIds: z.array(z.string()).max(100000).optional(),
      deliveredMessageIds: z.array(z.string()).optional(),
      sourceKey: z.string().max(1000000).optional(),
      approvedRevision: z.number().int().positive().optional(),
      version: z.number().int().nonnegative(),
      mode: z.enum(['pair', 'solo']),
      phase: z.enum(['planning', 'working', 'checkpoint', 'review', 'paused', 'interrupted']),
      preferences: pairPreferencesSchema,
      snapshot: z
        .object({
          prompt: z.string().max(5000000),
          agent: discussionAgentSchema,
          step: workflowSchema.shape.steps.element,
          settings,
          skills: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string(),
              content: z.string(),
              path: z.string(),
              source: z.enum(['bundled', 'user', 'workspace']),
            }),
          ),
          projects: z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                path: z.string(),
                branch: z.string(),
                hidden: z.boolean().optional(),
                settings,
                devopsProjectKey: z.string().optional(),
              }),
            )
            .optional(),
          mcpServers: z.array(mcpServerSchema).optional(),
          devopsProjectKey: z.string().optional(),
          workspacePath: z.string(),
          qualityStoragePath: z.string().optional(),
          existingChangeGrants: z.record(z.string(), z.string()).optional(),
        })
        .strict(),
      plans: z.array(
        pairPlanProposalSchema.extend({
          revision: z.number().int().positive(),
          acceptedAt: z.string().optional(),
        }),
      ),
      messages: z.array(
        z.object({
          id: z.string(),
          role: z.enum(['user', 'assistant', 'system']),
          content: z.string(),
          at: z.string(),
          status: z.enum(['complete', 'streaming', 'interrupted']),
          requestId: z.string().optional(),
          kind: z.enum(['text', 'reasoning']).optional(),
          delivery: z.enum(['pending', 'sent', 'received', 'uncertain', 'skipped']).optional(),
          nativeId: z.string().optional(),
        }),
      ),
      results: z.array(
        z.object({
          planRevision: z.number().int().positive(),
          blockId: id,
          title: z.string(),
          content: z.string(),
          at: z.string(),
        }),
      ),
      decisions: z.array(z.string()),
      requests: z.array(z.string()),
      pendingMessages: z.array(z.string()),
      turn: z
        .object({ kind: z.enum(['planning', 'chat', 'work', 'solo']), blockId: id.optional() })
        .strict()
        .optional(),
      busy: z.boolean(),
      pauseRequested: z.boolean().optional(),
      error: z.string().optional(),
      calls: z.number().int().nonnegative(),
      sessionIds: z.array(z.string()).default([]),
    })
    .strict();
}
