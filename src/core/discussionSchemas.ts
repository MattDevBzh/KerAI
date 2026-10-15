import { z } from 'zod';

const id = z.string().uuid();
const model = z.string().max(500).optional();
const reasoning = z.string().min(1).max(50).optional();
export const discussionMessageVariants = [
  z.object({ type: z.literal('refreshDiscussions') }).strict(),
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
        })
        .strict(),
    ),
  })
  .strict();
