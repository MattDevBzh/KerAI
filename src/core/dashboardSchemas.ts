import { z } from 'zod';
import { dashboardKinds } from '../shared/dashboard';
import { ticketFiltersSchema } from './devopsTicketSchemas';
const id = z.string().min(1).max(150);
const text = z.string().trim().max(500);
const projects = z.array(id).max(100);
export const dashboardConfigSchema = z
  .object({
    version: z.literal(1),
    refreshSeconds: z.union([
      z.literal(0),
      z.literal(15),
      z.literal(30),
      z.literal(60),
      z.literal(120),
      z.literal(300),
    ]),
    projectIds: projects,
    modules: z
      .array(
        z
          .object({
            id,
            kind: z.enum(dashboardKinds),
            title: z.string().trim().min(1).max(100),
            span: z.union([z.literal(4), z.literal(6), z.literal(12)]),
            controlSpan: z.union([z.literal(4), z.literal(6), z.literal(12)]),
            height: z.number().int().min(0).max(1600),
            filters: z
              .object({
                projectIds: projects,
                query: text,
                status: z.enum([
                  'all',
                  'active',
                  'running',
                  'attention',
                  'awaiting_final_validation',
                  'draft',
                  'completed',
                  'abandoned',
                ]),
                agentId: text,
                author: text,
                reviewer: text,
                draft: z.enum(['all', 'yes', 'no']),
                tickets: ticketFiltersSchema,
              })
              .strict(),
          })
          .strict(),
      )
      .max(24)
      .refine(
        (items) => new Set(items.map((i) => i.id)).size === items.length,
        'Identifiants de modules dupliqués.',
      ),
  })
  .strict();
export const dashboardMessageVariants = [
  z.object({ type: z.literal('dashboardVisible'), visible: z.boolean() }).strict(),
  z
    .object({ type: z.enum(['dashboardRefresh', 'dashboardDetach', 'dashboardFullscreen']) })
    .strict(),
  z
    .object({
      type: z.literal('dashboardSave'),
      config: dashboardConfigSchema,
      revision: z.number().int().nonnegative(),
      requestId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal('dashboardOpen'),
      featureId: id.optional(),
      stepId: id.optional(),
      projectId: id.optional(),
      page: z.enum(['devops-prs', 'devops-tickets', 'devops']).optional(),
      ticketId: z.number().int().positive().optional(),
    })
    .strict(),
] as const;
