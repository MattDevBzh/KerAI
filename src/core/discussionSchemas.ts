import { z } from 'zod';
import { ROAST_LEVELS } from '../shared/roast';

const id = z.string().uuid();
const model = z.string().max(500).optional();
const reasoning = z.string().min(1).max(50).optional();
export const discussionFeatureMemberSchema = z
  .object({
    model,
    reasoning,
    optional: z.boolean().optional(),
    agentId: z.string().min(1).max(150),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4000),
    policy: z.enum(['read-only', 'workspace-write', 'tests']),
  })
  .strict();
export const discussionFeaturePlanSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(30000),
    criteria: z.array(z.string().trim().min(1).max(2000)).min(1).max(30),
    team: z.array(discussionFeatureMemberSchema).min(1).max(12),
  })
  .strict();
const featureDraftSchema = discussionFeaturePlanSchema.extend({
  requestId: id,
  createdAt: z.string().datetime(),
});
export const discussionAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  tools: z.array(z.string()),
  skills: z.array(z.string()),
  model,
  source: z.enum(['bundled', 'user', 'workspace']),
  path: z.string(),
  nickname: z.string().optional(),
  avatar: z.string().optional(),
  roastLevel: z.enum(ROAST_LEVELS).optional(),
});
export const discussionSourceSchema = z
  .object({
    featureId: z.string(),
    featureTitle: z.string(),
    stepId: z.string(),
    stepName: z.string(),
    attemptId: z.string(),
    revision: z.number().int().nonnegative(),
    capturedAt: z.string().datetime(),
    agent: discussionAgentSchema,
    model,
    reasoning,
    context: z.string(),
    output: z.string(),
    originalOutput: z.string().optional(),
    warnings: z.array(z.string()),
  })
  .strict();
export const discussionMessageVariants = [
  z.object({ type: z.literal('refreshDiscussions') }).strict(),
  z
    .object({
      type: z.literal('prepareDiscussionFeature'),
      requestId: id,
      discussionId: id,
      agentKey: z.string().min(1).max(400),
      model,
      reasoning,
    })
    .strict(),
  z
    .object({
      type: z.literal('openReportDiscussion'),
      requestId: id,
      featureId: z.string().min(1).max(200),
      stepId: z.string().min(1).max(200),
      attemptId: z.string().min(1).max(200),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ type: z.literal('returnToDiscussionReport'), discussionId: id, edit: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal('sendDiscussion'),
      requestId: id,
      discussionId: id,
      agentKey: z.string().min(1).max(400),
      content: z.string().trim().min(1).max(40000),
      model,
      reasoning,
    })
    .strict(),
  z.object({ type: z.literal('cancelDiscussion'), discussionId: id }).strict(),
  z.object({ type: z.literal('deleteDiscussion'), discussionId: id, requestId: id }).strict(),
] as const;

export const discussionStoreSchema = z
  .object({
    version: z.literal(1),
    discussions: z.array(
      z
        .object({
          id,
          title: z.string(),
          agentKey: z.string(),
          model,
          reasoning,
          createdAt: z.string().datetime(),
          updatedAt: z.string().datetime(),
          messages: z.array(
            z
              .object({
                id,
                requestId: id.optional(),
                role: z.enum(['user', 'assistant']),
                content: z.string(),
                createdAt: z.string().datetime(),
                status: z.enum(['complete', 'streaming', 'interrupted', 'error']),
                agent: z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    nickname: z.string().optional(),
                    avatar: z.string().optional(),
                  })
                  .optional(),
                model,
                reasoning,
                error: z.string().optional(),
                usage: z
                  .object({
                    inputTokens: z.number().optional(),
                    outputTokens: z.number().optional(),
                    model,
                    cost: z.number().optional(),
                    unit: z.string().optional(),
                    source: z.literal('measured'),
                    incompleteTokens: z.boolean().optional(),
                    incompleteCost: z.boolean().optional(),
                  })
                  .optional(),
              })
              .strict(),
          ),
          source: discussionSourceSchema.optional(),
          featureDraft: featureDraftSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();
