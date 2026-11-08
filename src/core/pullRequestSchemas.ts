import { z } from 'zod';
export const prReviewersSchema = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(300),
        required: z.boolean(),
      })
      .strict(),
  )
  .max(30)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'Relecteur en double.',
  );
export const pullRequestSettingsSchema = z
  .object({
    agentId: z.string().min(1).max(150),
    target: z.string().min(1).max(200),
    instructions: z.string().max(12000),
    isDraft: z.boolean(),
    reviewers: prReviewersSchema,
  })
  .strict();
export const prGeneratedTextSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(20000),
  })
  .strict();
