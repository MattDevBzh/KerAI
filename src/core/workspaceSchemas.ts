import { z } from 'zod';

const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const short = z.string().min(1).max(500);
export const worktreeSchema = z
  .object({
    ownerFeatureId: z.string().uuid().optional(),
    path: z.string().min(1).max(4000),
    branch: short,
    baseBranch: short,
    baseCommit: commit,
    createdAt: z.string().min(1).max(64),
  })
  .strict();

export const checkpointSchema = z
  .object({
    id: z.string().uuid(),
    projectId: short.optional(),
    label: z.string().min(1).max(200),
    kind: z.enum(['before-run', 'after-run', 'manual', 'recovery']),
    createdAt: z.string().min(1).max(64),
    branch: short,
    head: z.union([commit, z.literal('')]),
    stepId: short.optional(),
    attemptId: short.optional(),
    fileCount: z.number().int().nonnegative().max(100000),
    totalBytes: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    excludedPaths: z.array(z.string().max(4000)).max(1000),
  })
  .strict();
