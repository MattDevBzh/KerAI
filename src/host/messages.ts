import { z } from 'zod';
import { settingsSchema } from '../core/store';
import { avatarSchema } from '../core/registry';
import type { ClientMessage } from '../shared/types';

const id = z.string().min(1).max(150),
  short = z.string().max(500),
  text = z.string().max(500_000);
const step = { featureId: id, stepId: id };
export const messageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.enum([
        'ready',
        'refresh',
        'checkRuntime',
        'installKit',
        'openSettings',
        'createWorkflow',
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal('createFeature'),
      title: short.min(1),
      description: text,
      workflowId: id,
      agentId: id.optional(),
      model: short.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('runStep'),
      ...step,
      feedback: text.optional(),
      resume: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('cancelRun'), featureId: id }).strict(),
  z.object({ type: z.literal('approveStep'), ...step }).strict(),
  z.object({ type: z.literal('answerQuestions'), ...step, answers: z.record(id, text) }).strict(),
  z.object({ type: z.literal('saveArtifact'), ...step, content: text }).strict(),
  z
    .object({
      type: z.literal('configureStep'),
      ...step,
      agentId: id,
      model: short.optional(),
      reasoning: short.optional(),
      skills: z.array(id).max(50),
      maxAttempts: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z.object({ type: z.literal('archiveFeature'), featureId: id, archived: z.boolean() }).strict(),
  z.object({ type: z.literal('openDiff'), path: short }).strict(),
  z.object({ type: z.literal('openFile'), path: short }).strict(),
  z.object({ type: z.literal('exportFeature'), featureId: id }).strict(),
  z
    .object({
      type: z.literal('saveAgent'),
      agent: z
        .object({
          id,
          name: short.min(1),
          description: short,
          instructions: text.min(1),
          tools: z.array(short).max(30),
          model: short.optional(),
          skills: z.array(id).max(50),
          nickname: z.string().max(80).optional(),
          avatar: avatarSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('saveSkill'), id, content: text }).strict(),
  z.object({ type: z.literal('saveSettings'), settings: settingsSchema }).strict(),
]);
export function parseMessage(input: unknown): ClientMessage {
  return messageSchema.parse(input) as ClientMessage;
}
