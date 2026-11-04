import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NavigationStore } from '../src/host/NavigationStore';
import type { NavigationJourney } from '../src/shared/navigation';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('serializes public refreshes behind a pending save instead of restoring an older catalog', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'navigation-concurrency-'));
  roots.push(root);
  const store = new NavigationStore(root);
  const now = new Date().toISOString();
  await store.saveApplication({
    id: 'app',
    name: 'App',
    projectIds: [],
    origin: 'http://localhost:3000',
    allowedOrigins: ['http://localhost:3000'],
    interactionPolicy: 'confirm',
    createdAt: now,
    updatedAt: now,
  });
  const first = await store.saveDraft(
    {
      id: 'journey',
      applicationId: 'app',
      revision: 0,
      title: 'Initial',
      intent: 'Synthetic',
      tags: [],
      prerequisites: [],
      parameters: [],
      steps: [],
      arrival: [],
      status: 'draft',
      provenance: { mode: 'human' },
      createdAt: now,
      updatedAt: now,
    },
    0,
    { kind: 'human' },
  );
  // Hold the actual file publication after the save has read the current catalog.
  const internals = store as unknown as {
    publish(journey: NavigationJourney): Promise<NavigationJourney>;
    json(relative: string): Promise<unknown>;
  };
  const publish = internals.publish.bind(store);
  const entered = barrier(),
    resume = barrier();
  vi.spyOn(internals, 'publish').mockImplementationOnce(async (journey) => {
    entered.release();
    await resume.promise;
    return publish(journey);
  });
  const saving = store.saveDraft({ ...first, title: 'Saved' }, 1, { kind: 'human' });
  await entered.promise;
  const json = internals.json.bind(store);
  let readStarted = false;
  vi.spyOn(internals, 'json').mockImplementation(async (relative) => {
    if (relative === 'catalog.json') readStarted = true;
    return json(relative);
  });
  const refreshing = store.load();
  // An unqueued load starts reading immediately. Complete that old read while publication is held,
  // making the regression deterministic without elapsed-time assumptions.
  let refreshed: Awaited<ReturnType<NavigationStore['load']>> | undefined;
  try {
    if (readStarted) refreshed = await refreshing;
  } finally {
    resume.release();
  }
  const saved = await saving;
  refreshed ??= await refreshing;
  expect(saved.revision).toBe(2);
  expect(refreshed.journeys[0]).toMatchObject({ revision: 2, title: 'Saved' });
  expect(store.snapshot().journeys[0]).toMatchObject({ revision: 2, title: 'Saved' });
  expect((await new NavigationStore(root).load()).journeys[0]).toEqual(saved);
  await expect(store.saveDraft(first, 1, { kind: 'human' })).rejects.toThrow('Conflit');
  expect((await store.load()).journeys[0]).toEqual(saved);
});
