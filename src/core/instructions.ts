import { z } from 'zod';
export const instructionSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    text: z.string().trim().min(1).max(10000),
    active: z.boolean(),
    updatedAt: z.string().datetime(),
    history: z
      .array(
        z.object({
          revision: z.number().int().positive(),
          text: z.string().max(10000),
          active: z.boolean(),
          at: z.string().datetime(),
        }),
      )
      .max(200),
  })
  .strict();
export const instructionCommand = z
  .object({
    type: z.literal('pinInstruction'),
    featureId: z.string().min(1).max(150),
    scope: z.enum(['task', 'project']),
    id: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    text: z.string().trim().min(1).max(10000),
    active: z.boolean(),
    requestId: z.string().uuid(),
  })
  .strict();
