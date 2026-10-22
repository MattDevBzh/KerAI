import { z } from 'zod';
export const proofProposalSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    proofIds: z.array(z.string().min(1).max(700)).max(30),
    verdict: z.enum(['supported', 'contradicted', 'unverified']),
  })
  .strict();
export const proofClaimSchema = proofProposalSchema
  .extend({
    id: z.string().uuid(),
    supersedes: z.string().uuid().optional(),
    author: z.enum(['agent', 'human']),
    at: z.string(),
    reportRevision: z.number().int().nonnegative(),
  })
  .strict();
export const proofChecksSchema = z.record(
  z.string().max(700),
  z
    .object({
      at: z.string(),
      state: z.enum(['unchanged', 'changed', 'unavailable']),
      reason: z.string().max(4000),
    })
    .strict(),
);
export const proofMessageVariants = [
  z
    .object({
      type: z.literal('saveProofClaim'),
      featureId: z.string(),
      stepId: z.string(),
      attemptId: z.string(),
      requestId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      claimId: z.string().uuid().optional(),
      claim: proofProposalSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('checkProofDossier'),
      featureId: z.string(),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal('exportProofDossier'),
      featureId: z.string(),
      requestId: z.string().uuid(),
    })
    .strict(),
] as const;
