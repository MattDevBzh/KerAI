import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Feature, StudioSettings } from '../shared/types';
import { WorkflowEngine, workflowSchema } from './workflow';

export const defaultSettings: StudioSettings = {
  defaultModel: '',
  timeoutMinutes: 20,
  testCommands: [],
  testPaths: ['tests', 'test', '__tests__'],
  hooks: [],
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
const attempt = z.object({
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
  changedFiles: z.array(z.string()),
  error: z.string().optional(),
  approvedAt: z.string().optional(),
  fileHashes: z.record(z.string(), z.string()).optional(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      model: z.string().optional(),
      cost: z.number().optional(),
      unit: z.string().optional(),
      source: z.literal('measured'),
    })
    .optional(),
});
const feature = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    workflowId: z.string(),
    workflowName: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    branch: z.string(),
    status: z.enum(['draft', 'running', 'attention', 'completed']),
    activeStepId: z.string(),
    archived: z.boolean().optional(),
    steps: z
      .array(workflowSchema.shape.steps.element.extend({ status, attempts: z.array(attempt) }))
      .min(1),
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
    if (!parsed.success)
      context.addIssue({ code: 'custom', message: 'Dépendances de session invalides.' });
    if (!steps.some((step) => step.id === value.activeStepId))
      context.addIssue({ code: 'custom', message: 'Étape active inconnue.' });
    if (steps.some((step) => step.status !== 'pending' && !step.attempts.length))
      context.addIssue({ code: 'custom', message: 'État sans tentative.' });
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
  })
  .strict();
const persistedSchema = z
  .object({ schemaVersion: z.literal(1), features: z.array(feature), settings: settingsSchema })
  .strict();
export interface PersistedStudio {
  schemaVersion: 1;
  features: Feature[];
  settings: StudioSettings;
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
        return { schemaVersion: 1, features: [], settings: structuredClone(defaultSettings) };
      throw new Error(`Stockage illisible, original conservé : ${(error as Error).message}`);
    }
    if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw))
      throw new Error('Version de stockage absente.');
    const version = (raw as { schemaVersion: unknown }).schemaVersion;
    if (version !== 0 && version !== 1)
      throw new Error(`Version de stockage inconnue : ${String(version)}. Original conservé.`);
    const migration = version === 0;
    if (migration) {
      const old = raw as { features?: unknown; settings?: Partial<StudioSettings> };
      raw = {
        schemaVersion: 1,
        features: old.features ?? [],
        settings: { ...structuredClone(defaultSettings), ...old.settings },
      };
    }
    const state = persistedSchema.parse(raw) as PersistedStudio;
    const engine = new WorkflowEngine(state.features);
    let recovered = false;
    for (const item of state.features)
      for (const step of item.steps)
        if (step.status === 'running') {
          engine.interruptRun(item.id, step.id);
          recovered = true;
        }
    if (migration || recovered) await this.save(state.features, state.settings);
    return state;
  }
  save(features: Feature[], settings: StudioSettings): Promise<void> {
    const snapshot =
      JSON.stringify(
        persistedSchema.parse({
          schemaVersion: 1,
          features: structuredClone(features),
          settings: structuredClone(settings),
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
