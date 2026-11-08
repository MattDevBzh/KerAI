import { z } from 'zod';
export const sessionGitChoiceSchema = z
  .object({
    preparationId: z.string().uuid(),
    baseRef: z.string().min(1).max(1000),
    baseCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    branchName: z.string().min(1).max(200),
    allowCached: z.boolean(),
  })
  .strict();
