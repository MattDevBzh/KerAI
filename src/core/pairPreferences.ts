import { z } from 'zod';
export const pairPreferencesSchema = z
  .object({
    pace: z.enum(['small', 'blocks', 'oneshot']),
    explanation: z.enum(['concise', 'detailed']),
    instructions: z.string().max(10000),
  })
  .strict();
