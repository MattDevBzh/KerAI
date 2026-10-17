import { z } from 'zod';
const value = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !/[\x00-\x1f]/.test(v), 'Caractère de contrôle interdit.');
export const ticketFiltersSchema = z
  .object({
    query: value,
    types: z.array(value.min(1)).max(30),
    states: z.array(value.min(1)).max(50),
    assignment: z.enum(['me', 'unassigned', 'all', 'identity']),
    identity: value,
    tags: z.array(value.min(1)).max(20),
    areaPath: value,
    iterationPath: value,
  })
  .strict()
  .refine(
    (v) => v.assignment !== 'identity' || Boolean(v.identity),
    'Indique une identité Azure DevOps.',
  );
export const ticketDevelopmentPlanSchema = z
  .object({
    requestId: z.string().uuid(),
    sourceProjectKey: value.min(1),
    snapshotId: z.string().uuid(),
    targetProjectId: value.min(1),
    title: z.string().trim().min(1).max(500),
    isolated: z.boolean(),
    baseRef: z.string().max(1000).optional(),
    baseCommit: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
    branchName: z.string().max(200).optional(),
    commentIds: z.array(z.number().int().positive()).max(200),
    instructions: z.string().max(10000),
  })
  .strict();
export const ticketSourceSnapshotSchema = z
  .object({
    provider: z.literal('azure-devops'),
    projectKey: value.min(1),
    repositoryKey: z.string().max(700),
    ticketId: z.number().int().positive(),
    revision: z.number().int().positive(),
    url: z.string().url(),
    title: z.string().max(100000),
    fetchedAt: z.string(),
    importedAt: z.string(),
    snapshotId: z.string().uuid(),
    targetProjectId: value.min(1),
    commentIds: z.array(z.number().int().positive()).max(200),
    context: z.string().max(180000),
  })
  .strict();
