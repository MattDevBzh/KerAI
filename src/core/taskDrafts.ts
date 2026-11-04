import { z } from 'zod';
import { imagesSchema } from './imageSchemas';
import { nativePermissionModeSchema } from './nativeSchemas';
import { discussionFeaturePlanSchema } from './discussionSchemas';
export const taskDraftSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    title: z.string().max(200),
    description: z.string().max(500000),
    starter: z.enum(['bugfix', 'feature', 'code-review', 'custom']),
    projectIds: z.array(z.string().min(1).max(150)).max(30),
    isolated: z.boolean(),
    permissionMode: nativePermissionModeSchema,
    pair: z.boolean().optional(),
    progression: z.enum(['guided', 'balanced']).optional(),
    images: imagesSchema,
    origin: z
      .object({
        discussionId: z.string().uuid(),
        draft: discussionFeaturePlanSchema.extend({
          title: z.string().max(200),
          description: z.string().max(500000),
          criteria: z.array(z.string().max(2000)).max(30),
          team: discussionFeaturePlanSchema.shape.team.element
            .extend({ name: z.string().max(300), description: z.string().max(30000) })
            .array()
            .max(40),
          requestId: z.string().uuid(),
          createdAt: z.string().datetime(),
        }),
      })
      .optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const taskDraftMessages = [
  z.object({ type: z.literal('listTaskDrafts') }).strict(),
  z
    .object({
      type: z.literal('saveTaskDraft'),
      draft: taskDraftSchema,
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal('deleteTaskDraft'),
      id: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      requestId: z.string().uuid(),
    })
    .strict(),
] as const;
