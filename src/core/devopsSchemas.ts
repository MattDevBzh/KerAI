import { z } from 'zod';
export const devOpsConfigSchema = z
  .object({
    organization: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/),
    project: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\x00-\x1f/\\]/.test(v)),
    repository: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\x00-\x1f/\\]/.test(v)),
    remote: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/),
  })
  .strict();
const ticketId = z.number().int().positive(),
  featureId = z.string().min(1).max(150),
  fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const devOpsMessageVariants = [
  z
    .object({
      type: z.enum(['devopsRefresh', 'devopsAuthenticate', 'devopsDisconnect', 'deliveryInspect']),
    })
    .strict(),
  z.object({ type: z.literal('devopsConfigure'), config: devOpsConfigSchema }).strict(),
  z.object({ type: z.literal('devopsLoadTicket'), ticketId }).strict(),
  z.object({ type: z.literal('devopsLinkFeature'), ticketId, featureId }).strict(),
  z.object({ type: z.literal('devopsCreateFeature'), ticketId }).strict(),
  z
    .object({
      type: z.literal('devopsLinkPullRequest'),
      pullRequestId: ticketId,
      featureId,
      ticketId: ticketId.optional(),
      replaces: z.object({ featureId, ticketId: ticketId.optional() }).strict().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('devopsUnlinkPullRequest'),
      pullRequestId: ticketId,
      featureId,
      ticketId: ticketId.optional(),
    })
    .strict(),
  z.object({ type: z.literal('deliveryChat'), text: z.string().trim().min(1).max(4000) }).strict(),
  z
    .object({
      type: z.literal('deliveryPreviewCommit'),
      paths: z
        .array(z.string().min(1).max(4000))
        .min(1)
        .max(200)
        .refine((p) => new Set(p).size === p.length),
      title: z.string().trim().min(1).max(200).optional(),
      intent: z.string().max(1000).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal('deliveryPreviewPush'), remote: devOpsConfigSchema.shape.remote })
    .strict(),
  z
    .object({
      type: z.literal('deliveryPreviewPr'),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(20000),
      target: z.string().min(1).max(200),
      ticketId: ticketId.optional(),
      featureId: featureId.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('deliveryExecute'),
      kind: z.enum(['commit', 'push', 'pr']),
      fingerprint,
    })
    .strict(),
] as const;
export const devOpsMessageSchema = z.discriminatedUnion('type', devOpsMessageVariants);
export const deliveryRulesSchema = z
  .object({
    types: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,20}$/))
      .min(1)
      .max(20)
      .default(['feat', 'fix', 'docs', 'test', 'chore']),
    defaultType: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,20}$/)
      .default('chore'),
    scope: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{0,40}$/)
      .default(''),
    maxLength: z.number().int().min(30).max(200).default(100),
    summary: z.string().min(1).max(150).default('mettre à jour les fichiers sélectionnés'),
  })
  .strict();
