import { pairActionSchema } from '../core/pairSchemas';
import { ZOOM_LEVELS } from '../shared/zoom';
import { dashboardMessageVariants } from '../core/dashboardSchemas';
import { devOpsMessageVariants } from '../core/devopsSchemas';
import { discussionMessageVariants, discussionFeaturePlanSchema } from '../core/discussionSchemas';
import { z } from 'zod';
import { observationOptionsSchema } from '../core/observationSchemas';
import { settingsSchema } from '../core/store';
import { avatarSchema } from '../core/registry';
import type { ClientMessage } from '../shared/types';
import { THEME_IDS } from '../shared/themes';
import { REWARD_IDS } from '../shared/rewards';
import { DRAGON_BALL_CODE } from '../shared/dragonBall';
import { workflowSchema } from '../core/workflow';
import { kitMessageVariants } from '../core/kitSchemas';
import { ROAST_LEVELS } from '../shared/roast';
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
  pairActionSchema,
  z.object({ type: z.literal('refreshSecretThemes') }).strict(),
  z
    .object({
      type: z.literal('unlockDragonBall'),
      sequence: z
        .array(z.string().max(20))
        .length(8)
        .refine((keys) => keys.every((key, index) => key === DRAGON_BALL_CODE[index])),
      requestId: id,
    })
    .strict(),
  ...dashboardMessageVariants,
  z.object({ type: z.literal('refreshQuests') }).strict(),
  z.object({ type: z.literal('refreshRewards') }).strict(),
  z
    .object({
      type: z.literal('setReward'),
      rewardId: z.enum(REWARD_IDS),
      enabled: z.boolean(),
      requestId: id,
    })
    .strict(),
  ...discussionMessageVariants,
  ...kitMessageVariants,
  z
    .object({
      type: z.enum(['addProjects', 'openDedicatedWindow', 'createWindowsShortcut']),
      requestId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal('renameProject'),
      projectId: id,
      name: z.string().trim().min(1).max(100),
      requestId: id,
    })
    .strict(),
  z
    .object({ type: z.literal('hideProject'), projectId: id, hidden: z.boolean(), requestId: id })
    .strict(),
  z.object({ type: z.literal('selectProjects'), projectIds: z.array(id), requestId: id }).strict(),
  z.object({ type: z.literal('activateFeature'), featureId: id }).strict(),
  z.object({ type: z.literal('activateProject'), projectId: id }).strict(),
  z
    .object({
      type: z.literal('saveFeatureTeam'),
      featureId: id,
      requestId: id,
      expectedRevision: z.number().int().nonnegative(),
      steps: z.array(workflowSchema.shape.steps.element),
    })
    .strict(),
  z
    .object({
      type: z.literal('setAgentFavorite'),
      agentId: id,
      favorite: z.boolean(),
      requestId: id,
    })
    .strict(),
  ...devOpsMessageVariants,
  z
    .object({
      type: z.literal('setZoom'),
      zoom: z.union([z.literal('auto'), z.union(ZOOM_LEVELS.map((level) => z.literal(level)))]),
      requestId: id,
    })
    .strict(),
  z.object({ type: z.literal('setTheme'), theme: z.enum(THEME_IDS), requestId: id }).strict(),
  z.object({ type: z.literal('setLivingHq'), enabled: z.boolean(), requestId: id }).strict(),
  z.object({ type: z.literal('installQualityKit'), featureId: id.optional() }).strict(),
  z
    .object({
      type: z.literal('openQualityAttachment'),
      featureId: id,
      evidenceId: id,
      attachmentId: id,
    })
    .strict(),
  z
    .object({
      type: z.enum([
        'ready',
        'refresh',
        'checkRuntime',
        'autoDetectCli',
        'manageWorkspaceTrust',
        'installKit',
        'migrateUserKit',
        'openSettings',
        'createWorkflow',
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal('createFeature'),
      requestId: z.string().uuid().optional(),
      discussionId: z.string().uuid().optional(),
      criteria: discussionFeaturePlanSchema.shape.criteria.optional(),
      team: discussionFeaturePlanSchema.shape.team.optional(),
      projectIds: z.array(id).min(1).optional(),
      title: short.min(1),
      description: text,
      workflowId: id.optional(),
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
  z
    .object({
      type: z.literal('saveArtifact'),
      ...step,
      content: text,
      expectedAttemptId: id.optional(),
      expectedRevision: z.number().int().nonnegative().optional(),
      expectedStateKey: z.string().min(1).max(1_000_000).optional(),
      description: text.optional(),
      reason: z.string().max(5000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('requestCorrection'),
      featureId: id,
      expectedStateKey: z.string().min(1).max(1_000_000),
      sourceStepId: id,
      rootStepIds: z.array(id).min(1).max(100),
      feedback: z.string().trim().min(1).max(30000),
      findingIds: z.array(id).max(1000),
      commentIds: z.array(id).max(1000),
      initialContext: z.string().max(60000).optional(),
      artifactContext: z
        .record(
          id,
          z.object({ enabled: z.boolean().optional(), content: text.optional() }).strict(),
        )
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('finalizeFeature'),
      featureId: id,
      expectedStateKey: z.string().min(1).max(1_000_000),
    })
    .strict(),
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
  z
    .object({
      type: z.literal('previewObservation'),
      featureId: id,
      requestId: id,
      options: observationOptionsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('runObservation'),
      featureId: id,
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      options: observationOptionsSchema,
    })
    .strict(),
  z.object({ type: z.literal('cancelObservation'), featureId: id }).strict(),
  z
    .object({
      type: z.literal('exportObservation'),
      featureId: id,
      observationId: id,
      format: z.enum(['html', 'markdown']),
    })
    .strict(),
  z
    .object({
      type: z.literal('observationSource'),
      featureId: id,
      observationId: id,
      sourceId: id,
      requestId: id,
      offset: z.number().int().nonnegative().max(1000000000).optional(),
    })
    .strict(),
  z.object({ type: z.literal('sessionStorage'), featureId: id, requestId: id }).strict(),
  z
    .object({
      type: z.literal('sessionJournal'),
      featureId: id,
      attemptId: id,
      requestId: id,
      offset: z.number().int().nonnegative().max(1000000000).optional(),
    })
    .strict(),
  z.object({ type: z.literal('deleteFeature'), featureId: id }).strict(),
  z.object({ type: z.literal('openDiff'), path: short, featureId: id.optional() }).strict(),
  z.object({ type: z.literal('openFile'), path: short, featureId: id.optional() }).strict(),
  z
    .object({ type: z.literal('openFeatureWorkspace'), featureId: id, projectId: id.optional() })
    .strict(),
  z
    .object({
      type: z.literal('createCheckpoint'),
      featureId: id,
      projectId: id.optional(),
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
      requestId: z.string().min(1).max(100),
      options: z
        .object({
          scope: z.enum(['user', 'workspace']),
          expectedRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
          sourceScope: z.enum(['bundled', 'user', 'workspace']).optional(),
          sourceRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict(),
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
          emptyContextByDefault: z.boolean().optional(),
          discussionAgent: z.boolean().optional(),
          roastLevel: z.enum(ROAST_LEVELS).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('saveSkill'),
      id,
      content: text,
      requestId: z.string().min(1).max(100),
      options: z
        .object({
          scope: z.enum(['user', 'workspace']),
          expectedRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
          sourceScope: z.enum(['bundled', 'user', 'workspace']).optional(),
          sourceRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ type: z.literal('saveSettings'), settings: settingsSchema, projectId: id.optional() })
    .strict(),
  z.object({ type: z.literal('saveWorkflow'), workflow: workflowSchema }).strict(),
  z.object({ type: z.literal('deleteWorkflow'), workflowId: id, requestId: id }).strict(),
  z
    .object({ type: z.literal('saveAutopilot'), featureId: id, config: autopilotConfigSchema })
    .strict(),
  z.object({ type: z.enum(['startAutopilot', 'pauseAutopilot']), featureId: id }).strict(),
  z
    .object({
      type: z.literal('resolveOptionalStep'),
      requestId: id.optional(),
      featureId: id,
      stepId: id,
      expectedStateKey: z.string().max(5000000),
      decisionId: id.optional(),
      choice: z.enum(['run', 'skip']),
      continueAutopilot: z.boolean().optional(),
    })
    .strict(),
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
