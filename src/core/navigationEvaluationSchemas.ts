import { usageSchema } from './observationSchemas';
import { z } from 'zod';
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const note = z.string().max(4000);
export const navigationCampaignSchema = z
  .object({
    id,
    name: z.string().min(1).max(200),
    profile: note,
    tickets: z
      .array(z.object({ id, label: z.string().min(1).max(200) }).strict())
      .min(1)
      .max(100),
    repetitions: z.number().int().min(1).max(10),
    phases: z
      .array(z.enum(['analysis', 'development', 'verification']))
      .min(1)
      .max(3),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.tickets.map((ticket) => ticket.id)).size !== value.tickets.length)
      ctx.addIssue({ code: 'custom', message: 'Identifiants de tickets dupliqués.' });
    if (new Set(value.phases).size !== value.phases.length)
      ctx.addIssue({ code: 'custom', message: 'Phases dupliquées.' });
  });
const ref = z.object({ featureId: id, stepId: id, attemptId: id }).strict();
const time = z
  .number()
  .finite()
  .nonnegative()
  .max(365 * 24 * 3600)
  .optional();
export const navigationEvaluationInputSchema = z
  .object({
    id,
    condition: z.enum(['A', 'B']),
    ticketId: id.optional(),
    repetition: z.number().int().min(1).max(10),
    order: z.number().int().min(0).max(10000),
    phase: z.enum([
      'learning',
      'maintenance',
      'analysis',
      'development',
      'verification',
      'unclassified',
    ]),
    outcome: z.enum(['succeeded', 'failed', 'blocked', 'cancelled']),
    qualityAccepted: z.boolean(),
    attemptRefs: z.array(ref).max(100),
    providerMode: z.enum(['linked-attempts', 'none-declared', 'unknown']),
    times: z
      .object({
        preparation: time,
        connection: time,
        demonstration: time,
        work: time,
        waiting: time,
      })
      .strict(),
    configuration: z
      .object({
        model: note,
        runtime: note,
        permissions: note,
        build: note,
        dataSnapshot: note,
        criteria: note,
        role: note,
        catalogueSnapshot: note,
        indexSnapshot: note,
      })
      .strict(),
    observations: note.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.providerMode === 'linked-attempts' && !value.attemptRefs.length)
      ctx.addIssue({ code: 'custom', message: 'Choisissez au moins une tentative.' });
    if (value.providerMode !== 'linked-attempts' && value.attemptRefs.length)
      ctx.addIssue({ code: 'custom', message: 'Une tentative liée exige le mode usages liés.' });
    if (!['learning', 'maintenance', 'unclassified'].includes(value.phase) && !value.ticketId)
      ctx.addIssue({ code: 'custom', message: 'Un ticket est requis pour cette phase.' });
  });
export const navigationEvaluationCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('evaluationLoad') }).strict(),
  z
    .object({ action: z.literal('evaluationSaveCampaign'), campaign: navigationCampaignSchema })
    .strict(),
  z
    .object({
      action: z.literal('evaluationSaveEntry'),
      campaignId: id,
      entry: navigationEvaluationInputSchema,
    })
    .strict(),
  z.object({ action: z.literal('evaluationDeleteEntry'), campaignId: id, entryId: id }).strict(),
  z.object({ action: z.literal('evaluationExport'), campaignId: id }).strict(),
]);

export const navigationEvaluationReceiptSchema = z
  .object({
    ref,
    status: z.string().min(1).max(60),
    model: z.string().max(300).optional(),
    usage: usageSchema.optional(),
  })
  .strict();
