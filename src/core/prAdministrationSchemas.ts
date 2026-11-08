import { z } from 'zod';
const id = z.string().min(1).max(150);
export const prAdministrationSettingsSchema = z
  .object({
    agentId: id,
    instructions: z.string().max(12000),
    context: z.string().max(50000),
    threadStatus: z.enum(['byDesign', 'wontFix', 'active', 'closed']),
    comments: z.boolean(),
    title: z.boolean(),
    description: z.boolean(),
  })
  .strict();
export const prAdminProposalSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(4000).optional(),
    comments: z
      .array(
        z
          .object({
            blockId: id,
            rule: z.string().trim().max(200),
            explanation: z.string().trim().min(1).max(4000),
            reference: z.string().max(1000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export const prAdministrationRecordsSchema = z.record(
  z.string().max(900),
  z
    .object({
      settings: prAdministrationSettingsSchema,
      annotations: z.record(
        z.string().regex(/^\d+$/),
        z
          .array(
            z
              .object({
                key: z.string().regex(/^[a-f0-9]{64}$/),
                nonce: z.string().uuid(),
                actorId: id,
                threadId: z.number().int().positive().optional(),
                commentId: z.number().int().positive().optional(),
                body: z.string().max(6500),
                status: z.string().max(50),
                uncertain: z.boolean(),
              })
              .strict(),
          )
          .max(2000),
      ),
    })
    .strict(),
);
export const prAdministrationMessageVariants = [
  z
    .object({
      type: z.literal('deliveryPrAdminSettings'),
      settings: prAdministrationSettingsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('deliveryPrAdminPreview'),
      pullRequestId: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal('deliveryPrAdminCancel') }).strict(),
  z
    .object({
      type: z.literal('deliveryPrAdminApply'),
      previewId: z.string().uuid(),
      changes: z
        .array(z.object({ id, content: z.string().trim().min(1).max(6000) }).strict())
        .min(1)
        .max(52),
    })
    .strict(),
] as const;
