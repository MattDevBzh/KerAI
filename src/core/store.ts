import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Feature, StudioSettings, MemoryEntry } from '../shared/types';
import { WorkflowEngine, workflowSchema } from './workflow';
import {
  autopilotStateSchema,
  budgetSchema,
  commentSchema,
  criterionSchema,
  evidenceSchema,
  launchSchema,
  mcpServerSchema,
  memorySchema,
  reviewSchema,
} from './evolutionSchemas';
import { defaultBudget } from './budgets';
import { checkpointSchema, worktreeSchema } from './workspaceSchemas';
import { qualityCommandSchema } from './qualitySchemas';
import { ROAST_LEVELS } from '../shared/roast';

export const defaultSettings: StudioSettings = {
  defaultModel: '',
  timeoutMinutes: 20,
  testCommands: [],
  testPaths: ['tests', 'test', '__tests__'],
  hooks: [],
  mcpServers: [],
  budgetDefaults: structuredClone(defaultBudget),
  modelProfiles: {},
};
const status = z.enum([
  'pending',
  'running',
  'waiting_input',
  'awaiting_review',
  'approved',
  'failed',
  'cancelled',
  'stale',
  'interrupted',
]);
const artifact = z.object({ name: z.string(), content: z.string(), updatedAt: z.string() });
const editorialVersion = z.object({
  revision: z.number().int().nonnegative(),
  content: z.string(),
  at: z.string(),
  author: z.enum(['agent', 'human']),
  reason: z.string().optional(),
});
const correctionCycle = z.object({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(['requested', 'running', 'interrupted', 'awaiting_review', 'completed']),
  expectedStateKey: z.string(),
  sourceStepId: z.string(),
  rootStepIds: z.array(z.string()),
  impactedStepIds: z.array(z.string()),
  feedback: z.string(),
  findingIds: z.array(z.string()),
  commentIds: z.array(z.string()),
  initialContext: z.string().optional(),
  artifactContext: z
    .record(
      z.string(),
      z.object({ enabled: z.boolean().optional(), content: z.string().optional() }),
    )
    .optional(),
  snapshot: z.object({
    description: z.string(),
    descriptionRevision: z.number().int().nonnegative(),
    sourceStepId: z.string(),
    sourceAttemptId: z.string(),
    sourceRevision: z.number().int().nonnegative(),
    review: reviewSchema.optional(),
    comments: z.array(commentSchema),
    artifacts: z.array(
      z.object({
        stepId: z.string(),
        stepName: z.string(),
        attemptId: z.string(),
        revision: z.number().int().nonnegative(),
        status: z.string(),
        artifact,
      }),
    ),
  }),
});
const attempt = z.object({
  roastLevel: z.enum(ROAST_LEVELS).optional(),
  artifactVersions: z.array(editorialVersion).optional(),
  descriptionRevision: z.number().int().nonnegative().optional(),
  correctionId: z.string().optional(),
  id: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status,
  sessionId: z.string().optional(),
  model: z.string().optional(),
  feedback: z.string(),
  logs: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      kind: z.enum(['info', 'tool', 'message', 'warning', 'error', 'usage']),
      message: z.string(),
    }),
  ),
  artifact: artifact.optional(),
  questions: z.array(
    z.object({ id: z.string(), text: z.string(), choices: z.array(z.string()).optional() }),
  ),
  answers: z.record(z.string(), z.string()),
  answerBindings: z
    .record(
      z.string(),
      z.object({
        question: z.object({
          id: z.string(),
          text: z.string(),
          choices: z.array(z.string()).optional(),
        }),
        answer: z.string(),
        origin: z.object({ stepId: z.string(), attemptId: z.string() }),
      }),
    )
    .optional(),
  changedFiles: z.array(z.string()),
  error: z.string().optional(),
  approvedAt: z.string().optional(),
  fileHashes: z.record(z.string(), z.string()).optional(),
  launch: launchSchema.optional(),
  existingChangesBackup: z.string().optional(),
  promptFingerprint: z.string().max(256).optional(),
  promptCharacters: z.number().int().nonnegative().max(5000000).optional(),
  memorySnapshot: z.array(memorySchema).max(256).optional(),
  evidence: z.array(evidenceSchema).max(1000).optional(),
  review: reviewSchema.optional(),
  revision: z.number().int().nonnegative().optional(),
  approvedBy: z.enum(['human', 'autopilot']).optional(),
  checkpointBeforeId: z.string().uuid().optional(),
  checkpointAfterId: z.string().uuid().optional(),
  usage: z
    .object({
      inputTokens: z.number().nonnegative().finite().optional(),
      outputTokens: z.number().nonnegative().finite().optional(),
      model: z.string().optional(),
      cost: z.number().nonnegative().finite().optional(),
      unit: z.string().optional(),
      source: z.literal('measured'),
      incompleteTokens: z.boolean().optional(),
      incompleteCost: z.boolean().optional(),
    })
    .optional(),
});
const feature = z
  .object({
    id: z.string(),
    teamRevision: z.number().int().nonnegative().optional(),
    teamLockedAt: z.string().optional(),
    descriptionRevision: z.number().int().nonnegative().optional(),
    descriptionVersions: z.array(editorialVersion).optional(),
    corrections: z.array(correctionCycle).optional(),
    activeCorrectionId: z.string().optional(),
    finalValidation: z
      .object({ id: z.string(), at: z.string(), stateKey: z.string(), author: z.literal('human') })
      .optional(),
    title: z.string(),
    description: z.string(),
    workflowId: z.string(),
    workflowName: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    branch: z.string(),
    status: z.enum(['draft', 'running', 'attention', 'awaiting_final_validation', 'completed']),
    activeStepId: z.string(),
    archived: z.boolean().optional(),
    autopilot: autopilotStateSchema.optional(),
    budget: budgetSchema.optional(),
    criteria: z.array(criterionSchema).max(200).optional(),
    reviewComments: z.array(commentSchema).max(1000).optional(),
    worktree: worktreeSchema.optional(),
    checkpoints: z.array(checkpointSchema).max(10000).optional(),
    workspaceFileHashes: z.record(z.string(), z.string()).optional(),
    steps: z.array(
      workflowSchema.shape.steps.element.extend({ status, attempts: z.array(attempt) }),
    ),
  })
  .superRefine((value, context) => {
    const { steps } = value;
    const parsed = workflowSchema.safeParse({
      id: value.workflowId,
      name: value.workflowName,
      description: '',
      icon: '',
      steps: steps.map(({ status: _status, attempts: _attempts, ...step }) => step),
    });
    if (steps.length && !parsed.success)
      context.addIssue({ code: 'custom', message: 'Dépendances de session invalides.' });
    if (
      !steps.length &&
      (value.activeStepId ||
        value.status !== 'draft' ||
        value.teamLockedAt ||
        value.autopilot ||
        value.finalValidation)
    )
      context.addIssue({
        code: 'custom',
        message: 'Une feature sans équipe doit rester un brouillon sans exécution.',
      });
    if (steps.length && !steps.some((step) => step.id === value.activeStepId))
      context.addIssue({ code: 'custom', message: 'Étape active inconnue.' });
    if (steps.some((step) => step.status !== 'pending' && !step.attempts.length))
      context.addIssue({ code: 'custom', message: 'État sans tentative.' });
    if (
      value.autopilot &&
      [
        ...value.autopilot.checkpoints,
        ...Object.keys(value.autopilot.stepInputs),
        ...(value.autopilot.reviewStepId ? [value.autopilot.reviewStepId] : []),
        ...(value.autopilot.correctionStepId ? [value.autopilot.correctionStepId] : []),
      ].some((id) => !steps.some((step) => step.id === id))
    )
      context.addIssue({
        code: 'custom',
        message: 'Configuration du pilote liée à une étape inconnue.',
      });
    if (value.criteria && new Set(value.criteria.map((c) => c.id)).size !== value.criteria.length)
      context.addIssue({ code: 'custom', message: 'Critères dupliqués.' });
    if (value.worktree && value.worktree.branch !== value.branch)
      context.addIssue({ code: 'custom', message: 'Branche de worktree incohérente.' });
    if (
      value.checkpoints &&
      new Set(value.checkpoints.map((c) => c.id)).size !== value.checkpoints.length
    )
      context.addIssue({ code: 'custom', message: 'Points de restauration dupliqués.' });
    if (
      value.reviewComments?.some(
        (comment) =>
          !steps.some(
            (step) =>
              step.id === comment.stepId &&
              step.attempts.some((attempt) => attempt.id === comment.attemptId),
          ),
      )
    )
      context.addIssue({ code: 'custom', message: 'Commentaire lié à une tentative inconnue.' });
  });
export const settingsSchema = z
  .object({
    defaultModel: z.string(),
    timeoutMinutes: z.number().min(1).max(120),
    testCommands: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        command: z.string().min(1),
        args: z.array(z.string()),
        quality: qualityCommandSchema.optional(),
      }),
    ),
    testPaths: z.array(z.string()),
    hooks: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        event: z.enum(['beforeRun', 'afterRun']),
        command: z.string().min(1),
        args: z.array(z.string()),
        enabled: z.boolean(),
      }),
    ),
    mcpServers: z
      .array(mcpServerSchema)
      .max(100)
      .refine(
        (servers) => new Set(servers.map((server) => server.id)).size === servers.length,
        'MCP dupliqués.',
      )
      .optional(),
    budgetDefaults: budgetSchema.optional(),
    modelProfiles: z
      .object({
        economy: z
          .object({ model: z.string().max(200), reasoning: z.string().max(100).optional() })
          .strict()
          .optional(),
        balanced: z
          .object({ model: z.string().max(200), reasoning: z.string().max(100).optional() })
          .strict()
          .optional(),
        quality: z
          .object({ model: z.string().max(200), reasoning: z.string().max(100).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const persistedSchema = z
  .object({
    schemaVersion: z.literal(4),
    features: z.array(feature),
    settings: settingsSchema,
    memory: z
      .array(memorySchema)
      .max(1000)
      .refine(
        (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
        'Mémoires dupliquées.',
      ),
  })
  .strict();
export interface PersistedStudio {
  schemaVersion: 4;
  features: Feature[];
  settings: StudioSettings;
  memory: MemoryEntry[];
}
const queues = new Map<string, Promise<unknown>>();

/** One process serializes all writes to the same file. Snapshots are captured when save is called. */
export class Store {
  readonly path: string;
  constructor(readonly rootPath: string) {
    this.path = join(resolve(rootPath), 'state.json');
  }
  async load(): Promise<PersistedStudio> {
    await queues.get(this.path)?.catch(() => undefined);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return {
          schemaVersion: 4,
          features: [],
          settings: structuredClone(defaultSettings),
          memory: [],
        };
      throw new Error(`Stockage illisible, original conservé : ${(error as Error).message}`);
    }
    if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw))
      throw new Error('Version de stockage absente.');
    const version = (raw as { schemaVersion: unknown }).schemaVersion;
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4)
      throw new Error(`Version de stockage inconnue : ${String(version)}. Original conservé.`);
    const migration = version !== 4;
    if (migration) {
      const old = raw as {
        features?: unknown;
        settings?: Partial<StudioSettings>;
        memory?: unknown;
      };
      raw = {
        schemaVersion: 4,
        features: old.features ?? [],
        settings: { ...structuredClone(defaultSettings), ...old.settings },
        memory: old.memory ?? [],
      };
    }
    const state = persistedSchema.parse(raw) as PersistedStudio;
    const engine = new WorkflowEngine(state.features);
    let recovered = false;
    for (const item of state.features) {
      if (item.status === 'completed' && !item.finalValidation) {
        engine.refreshFeatureStatus(item.id);
        recovered = true;
      }
      if (item.autopilot?.status === 'running') {
        item.autopilot.status = 'paused';
        item.autopilot.reason =
          'Pilote interrompu : reprise humaine explicite requise après redémarrage.';
        item.autopilot.updatedAt = new Date().toISOString();
        recovered = true;
      }
      for (const step of item.steps)
        if (step.status === 'running') {
          engine.interruptRun(item.id, step.id);
          recovered = true;
        }
    }
    if (migration || recovered) await this.save(state.features, state.settings, state.memory);
    return state;
  }
  save(features: Feature[], settings: StudioSettings, memory: MemoryEntry[] = []): Promise<void> {
    const snapshot =
      JSON.stringify(
        persistedSchema.parse({
          schemaVersion: 4,
          features: structuredClone(features),
          settings: structuredClone(settings),
          memory: structuredClone(memory),
        }),
        null,
        2,
      ) + '\n';
    const previous = queues.get(this.path) ?? Promise.resolve();
    const work = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.rootPath, { recursive: true });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(snapshot, 'utf8');
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporary, this.path);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      });
    queues.set(this.path, work);
    void work
      .finally(() => {
        if (queues.get(this.path) === work) queues.delete(this.path);
      })
      .catch(() => undefined);
    return work;
  }
}
