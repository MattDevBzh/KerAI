import { mkdir, readFile, rename, unlink, link, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  ApplicationProfile,
  NavigationActor,
  NavigationContribution,
  NavigationJourney,
  NavigationRun,
  NavigationSnapshot,
} from '../shared/navigation';
import {
  applicationProfileSchema,
  navigationActorSchema,
  navigationContributionSchema,
  navigationJourneySchema,
  navigationRunSchema,
} from '../core/navigationSchemas';
import { WorkspaceLease } from './WorkspaceLease';

const digest = (input: string) => createHash('sha256').update(input).digest('hex');
const opaque = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const catalogSchema = z
  .object({
    navigationVersion: z.literal(1),
    applications: z.array(applicationProfileSchema),
    heads: z.record(opaque, sha),
    history: z.record(opaque, z.array(sha)),
    contributions: z.array(opaque),
    runs: z.array(opaque),
  })
  .strict();
type Catalog = z.infer<typeof catalogSchema>;
const emptyCatalog = (): Catalog => ({
  navigationVersion: 1,
  applications: [],
  heads: {},
  history: {},
  contributions: [],
  runs: [],
});
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
/** Stable definition identity: publication metadata cannot manufacture a new browser observation. */
export function navigationDefinitionHash(journey: NavigationJourney): string {
  const {
    id,
    applicationId,
    title,
    intent,
    tags,
    prerequisites,
    parameters,
    steps,
    arrival,
    variantOf,
  } = journey;
  return digest(
    canonical({
      id,
      applicationId,
      title,
      intent,
      tags,
      prerequisites,
      parameters,
      steps,
      arrival,
      variantOf,
    }),
  );
}
/** Private project storage. Only host-resolved actor arguments may enter this API. */
export class NavigationStore {
  readonly directory: string;
  private catalog = emptyCatalog();
  private state: NavigationSnapshot = {
    navigationVersion: 1,
    applications: [],
    journeys: [],
    contributions: [],
    runs: [],
  };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(projectStorage: string) {
    this.directory = path.join(projectStorage, 'navigation');
  }
  snapshot(): NavigationSnapshot {
    return structuredClone(this.state);
  }
  private async json(relative: string): Promise<unknown> {
    return JSON.parse(await readFile(path.join(this.directory, relative), 'utf8'));
  }
  private async atomic(relative: string, value: unknown): Promise<void> {
    const destination = path.join(this.directory, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(value, null, 2) + '\n');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  private async object(objectHash: string): Promise<NavigationJourney> {
    sha.parse(objectHash);
    const value = await this.json(`revisions/${objectHash}.json`);
    if (digest(canonical(value)) !== objectHash)
      throw new Error('Révision de navigation altérée ; original conservé.');
    const journey = navigationJourneySchema.parse(value);
    if (journey.hash !== navigationDefinitionHash(journey))
      throw new Error('Empreinte de définition invalide.');
    return journey;
  }
  async load(): Promise<NavigationSnapshot> {
    let catalog: Catalog;
    try {
      catalog = catalogSchema.parse(await this.json('catalog.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      catalog = emptyCatalog();
    }
    const journeys = await Promise.all(
      Object.entries(catalog.heads).map(async ([id, objectHash]) => {
        const journey = await this.object(objectHash);
        if (journey.id !== id || !catalog.history[id]?.includes(objectHash))
          throw new Error('Tête de parcours incohérente.');
        return journey;
      }),
    );
    const contributions = await Promise.all(
      catalog.contributions.map(async (id) =>
        navigationContributionSchema.parse(await this.json(`contributions/${id}.json`)),
      ),
    );
    const runs = await Promise.all(
      catalog.runs.map(async (id) =>
        navigationRunSchema.parse(await this.json(`runs/${id}/manifest.json`)),
      ),
    );
    this.catalog = catalog;
    this.state = {
      navigationVersion: 1,
      applications: catalog.applications,
      journeys,
      contributions,
      runs,
    };
    return this.snapshot();
  }
  private change<T>(action: () => Promise<T>): Promise<T> {
    const work = this.queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const lease = new WorkspaceLease(path.join(this.directory, 'catalog.json'));
        await lease.acquire();
        try {
          await this.load();
          const result = await action();
          await this.atomic('catalog.json', catalogSchema.parse(this.catalog));
          await this.load();
          return result;
        } catch (error) {
          await this.load().catch(() => undefined);
          throw error;
        } finally {
          await lease.release();
        }
      });
    this.queue = work;
    return work;
  }
  private author(applicationId: string, actor: NavigationActor): ApplicationProfile {
    navigationActorSchema.parse(actor);
    const application = this.catalog.applications.find((app) => app.id === applicationId);
    if (!application) throw new Error('Application introuvable.');
    if (
      actor.kind !== 'human' &&
      (actor.applicationId !== applicationId || application.ownerNavigatorId !== actor.agentId)
    )
      throw new Error(
        'Seul le Navigateur désigné ou une commande humaine peut modifier ce parcours.',
      );
    return application;
  }
  private head(id: string, expectedRevision: number): NavigationJourney | undefined {
    opaque.parse(id);
    const journey = this.state.journeys.find((item) => item.id === id);
    if ((journey?.revision ?? 0) !== expectedRevision)
      throw new Error('Conflit de révision : recharge le parcours avant de sauvegarder.');
    return journey;
  }
  private async publish(journey: NavigationJourney): Promise<NavigationJourney> {
    journey.hash = navigationDefinitionHash(journey);
    const valid = navigationJourneySchema.parse(journey);
    const objectHash = digest(canonical(valid));
    await mkdir(path.join(this.directory, 'revisions'), { recursive: true, mode: 0o700 });
    const destination = path.join(this.directory, 'revisions', `${objectHash}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(valid, null, 2) + '\n');
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporary, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await this.object(objectHash);
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    this.catalog.heads[valid.id] = objectHash;
    this.catalog.history[valid.id] = [...(this.catalog.history[valid.id] ?? []), objectHash];
    return structuredClone(valid);
  }
  saveApplication(value: ApplicationProfile): Promise<ApplicationProfile> {
    const application = applicationProfileSchema.parse(value);
    return this.change(async () => {
      const old = this.catalog.applications.find((item) => item.id === application.id);
      const next = {
        ...application,
        createdAt: old?.createdAt ?? application.createdAt,
        updatedAt: new Date().toISOString(),
      };
      this.catalog.applications = [
        ...this.catalog.applications.filter((item) => item.id !== next.id),
        next,
      ];
      return structuredClone(next);
    });
  }
  saveDraft(
    value: NavigationJourney,
    expectedRevision: number,
    actor: NavigationActor,
  ): Promise<NavigationJourney> {
    const input = navigationJourneySchema.parse(value);
    return this.change(async () => {
      this.author(input.applicationId, actor);
      const previous = this.head(input.id, expectedRevision);
      if (previous && previous.applicationId !== input.applicationId)
        throw new Error('Un parcours ne peut changer d’application.');
      const now = new Date().toISOString();
      return this.publish({
        ...input,
        revision: expectedRevision + 1,
        parentHash: previous?.hash,
        status: 'draft',
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        provenance: { ...input.provenance, author: actor, verifiedRunId: undefined },
      });
    });
  }
  commit(
    id: string,
    expectedRevision: number,
    runId: string,
    actor: NavigationActor,
  ): Promise<NavigationJourney> {
    return this.change(async () => {
      const journey = this.head(id, expectedRevision);
      if (!journey || journey.status !== 'draft')
        throw new Error('Un brouillon courant est requis.');
      const app = this.author(journey.applicationId, actor);
      const run = this.state.runs.find((item) => item.id === runId);
      if (
        !run ||
        run.journeyId !== id ||
        run.revision !== expectedRevision ||
        run.definitionHash !== journey.hash ||
        run.applicationId !== journey.applicationId ||
        run.binding.origin !== app.origin ||
        run.mode !== 'verify' ||
        run.status !== 'succeeded' ||
        !run.arrivalVerified ||
        !run.prerequisitesConfirmed ||
        !run.finishedAt ||
        !journey.arrival.length ||
        !journey.steps.length ||
        journey.steps.some(
          (step) =>
            step.action === 'manual' ||
            !run.events.some((event) => event.stepId === step.id && event.status === 'succeeded'),
        ) ||
        run.events.some((event) => event.status !== 'succeeded')
      )
        throw new Error(
          'Un rejeu hôte réussi de cette révision, avec prérequis et arrivée vérifiés, est requis.',
        );
      return this.publish({
        ...journey,
        revision: expectedRevision + 1,
        parentHash: journey.hash,
        status: 'available',
        updatedAt: new Date().toISOString(),
        provenance: { ...journey.provenance, author: actor, verifiedRunId: runId },
      });
    });
  }
  archive(
    id: string,
    expectedRevision: number,
    actor: NavigationActor,
  ): Promise<NavigationJourney> {
    return this.change(async () => {
      const journey = this.head(id, expectedRevision);
      if (!journey) throw new Error('Parcours introuvable.');
      this.author(journey.applicationId, actor);
      return this.publish({
        ...journey,
        revision: expectedRevision + 1,
        parentHash: journey.hash,
        status: 'archived',
        updatedAt: new Date().toISOString(),
        provenance: { ...journey.provenance, author: actor },
      });
    });
  }
  async revision(id: string, revision: number): Promise<NavigationJourney> {
    opaque.parse(id);
    for (const objectHash of this.catalog.history[id] ?? []) {
      const journey = await this.object(objectHash);
      if (journey.revision === revision) return journey;
    }
    throw new Error('Révision introuvable.');
  }
  async history(id: string): Promise<NavigationJourney[]> {
    opaque.parse(id);
    return Promise.all((this.catalog.history[id] ?? []).map((value) => this.object(value)));
  }
  contribute(value: NavigationContribution): Promise<NavigationContribution> {
    const contribution = navigationContributionSchema.parse({ ...value, status: 'pending' });
    return this.change(async () => {
      await this.revision(contribution.journeyId, contribution.revision);
      if (this.catalog.contributions.includes(contribution.id))
        throw new Error('Contribution déjà enregistrée.');
      await this.atomic(`contributions/${contribution.id}.json`, contribution);
      this.catalog.contributions.push(contribution.id);
      return contribution;
    });
  }
  resolveContribution(
    id: string,
    status: 'accepted' | 'dismissed',
    actor: NavigationActor,
  ): Promise<NavigationContribution> {
    opaque.parse(id);
    return this.change(async () => {
      const contribution = this.state.contributions.find((item) => item.id === id);
      if (!contribution) throw new Error('Contribution introuvable.');
      const journey = await this.revision(contribution.journeyId, contribution.revision);
      this.author(journey.applicationId, actor);
      const updated = navigationContributionSchema.parse({ ...contribution, status });
      await this.atomic(`contributions/${id}.json`, updated);
      return updated;
    });
  }
  /** Trusted browser host only; tool/UI payloads must never call this with claimed outcomes. */
  recordRun(value: NavigationRun): Promise<NavigationRun> {
    const run = navigationRunSchema.parse(value);
    return this.change(async () => {
      const journey = await this.revision(run.journeyId, run.revision);
      if (
        journey.hash !== run.definitionHash ||
        journey.applicationId !== run.applicationId ||
        run.binding.applicationId !== run.applicationId
      )
        throw new Error('Le rejeu ne correspond pas à sa définition figée.');
      const old = this.state.runs.find((item) => item.id === run.id);
      // Recovery may replay the receipt after a crash between publication and journal acknowledgement.
      if (old && canonical(old) === canonical(run)) return structuredClone(old);
      if (
        old &&
        (old.status !== 'running' ||
          old.definitionHash !== run.definitionHash ||
          old.revision !== run.revision)
      )
        throw new Error('Une exécution terminée est immuable.');
      await this.atomic(`runs/${run.id}/manifest.json`, run);
      if (!this.catalog.runs.includes(run.id)) this.catalog.runs.push(run.id);
      return run;
    });
  }
  async rebuildIndex(): Promise<void> {
    await this.load();
    await this.atomic('indexes/search.json', {
      version: 1,
      entries: this.state.journeys.map((journey) => ({
        id: journey.id,
        revision: journey.revision,
        hash: journey.hash,
        applicationId: journey.applicationId,
        title: journey.title,
        intent: journey.intent,
        tags: journey.tags,
        status: journey.status,
      })),
    });
  }
}
