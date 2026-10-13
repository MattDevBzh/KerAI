import { z } from 'zod';
import { settingsSchema } from '../core/store';
import { avatarSchema } from '../core/registry';
import type { ClientMessage } from '../shared/types';
import { workflowSchema } from '../core/workflow';
import {
  launchSchema,
  autopilotConfigSchema,
  budgetSchema,
  memorySchema,
  criterionSchema,
  commentSchema,
} from '../core/evolutionSchemas';

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
      isolated: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('runStep'),
      ...step,
      feedback: text.optional(),
      resume: z.boolean().optional(),
      launch: launchSchema.optional(),
      previewFingerprint: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal('cancelRun'), featureId: id }).strict(),
  z
    .object({
      type: z.literal('approveStep'),
      ...step,
      expectedAttemptId: id.optional(),
      expectedRevision: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('previewRun'),
      requestId: id,
      ...step,
      feedback: text.optional(),
      resume: z.boolean().optional(),
      launch: launchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('answerHumanRequest'),
      requestId: id,
      answer: z.string().min(1).max(30000),
    })
    .strict(),
  z.object({ type: z.literal('testMcp'), serverId: id }).strict(),
  z
    .object({
      type: z.literal('setMcpSecret'),
      serverId: id,
      key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,100}$/),
      value: z.string().max(16000),
    })
    .strict(),
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
      initialContext: launchSchema.shape.initialContext.optional(),
      mcpServerIds: z.array(id).max(20).optional(),
      askBeforeRun: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('archiveFeature'), featureId: id, archived: z.boolean() }).strict(),
  z.object({ type: z.literal('openDiff'), path: short, featureId: id.optional() }).strict(),
  z.object({ type: z.literal('openFile'), path: short, featureId: id.optional() }).strict(),
  z.object({ type: z.literal('openFeatureWorkspace'), featureId: id }).strict(),
  z
    .object({
      type: z.literal('createCheckpoint'),
      featureId: id,
      label: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal('compareCheckpoint'),
      requestId: id,
      featureId: id,
      checkpointId: z.string().uuid(),
      targetCheckpointId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('openCheckpointDiff'),
      featureId: id,
      checkpointId: z.string().uuid(),
      targetCheckpointId: z.string().uuid().optional(),
      path: z.string().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      type: z.literal('restoreCheckpoint'),
      featureId: id,
      checkpointId: z.string().uuid(),
      paths: z
        .array(z.string().min(1).max(4000))
        .min(1)
        .max(200)
        .refine((paths) => new Set(paths).size === paths.length, 'Fichiers dupliqués.'),
      expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
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
  z.object({ type: z.literal('saveWorkflow'), workflow: workflowSchema }).strict(),
  z
    .object({ type: z.literal('saveAutopilot'), featureId: id, config: autopilotConfigSchema })
    .strict(),
  z.object({ type: z.enum(['startAutopilot', 'pauseAutopilot']), featureId: id }).strict(),
  z.object({ type: z.literal('saveBudget'), featureId: id, budget: budgetSchema }).strict(),
  z
    .object({
      type: z.literal('saveCriteria'),
      featureId: id,
      criteria: z.array(criterionSchema).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal('addReviewComment'),
      featureId: id,
      comment: commentSchema.omit({ id: true, createdAt: true, resolved: true }),
    })
    .strict(),
  z
    .object({
      type: z.literal('resolveReviewComment'),
      featureId: id,
      commentId: id,
      resolved: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('saveMemory'), entry: memorySchema }).strict(),
  z.object({ type: z.literal('deleteMemory'), id }).strict(),
]);
export function parseMessage(input: unknown): ClientMessage {
  return messageSchema.parse(input) as ClientMessage;
}
