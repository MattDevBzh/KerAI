import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { NavigationStore, navigationDefinitionHash } from '../src/host/NavigationStore';
import { searchNavigation } from '../src/host/NavigationSearch';
import {
  NAVIGATION_LIMITS,
  type ApplicationProfile,
  type NavigationJourney,
} from '../src/shared/navigation';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const count = 5000;
const now = '2026-10-23T10:00:00.000Z';
let directory: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

// Mirror the immutable on-disk encoding, avoiding 5,000 full catalogue rewrites.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const percentile = (values: number[], quantile: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
};

it('loads 5,000 synthetic immutable journeys and measures bounded deterministic warm search', async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'kerai-navigation-scale-'));
  const store = new NavigationStore(directory);
  await fs.mkdir(path.join(store.directory, 'revisions'), { recursive: true });
  const application = (id: string): ApplicationProfile => ({
    id,
    name: `Synthetic ${id}`,
    projectIds: ['synthetic-project'],
    origin: 'http://localhost:3210',
    allowedOrigins: ['http://localhost:3210'],
    ownerNavigatorId: 'fs-navigator',
    interactionPolicy: 'confirm',
    createdAt: now,
    updatedAt: now,
  });
  const heads: Record<string, string> = {};
  const history: Record<string, string[]> = {};
  let fixtureBytes = 0;
  for (let start = 0; start < count; start += 32) {
    await Promise.all(
      Array.from({ length: Math.min(32, count - start) }, async (_, offset) => {
        const index = start + offset;
        const slug = String(index).padStart(5, '0');
        const journey: NavigationJourney = {
          id: `synthetic-${slug}`,
          applicationId: index % 2 ? 'secondary' : 'primary',
          revision: 1,
          title: `Facturation synthétique cible${slug}`,
          intent: `Consulter les éléments fictifs du dossier ${slug} et ouvrir son écran détail.`,
          tags: ['facturation', `groupe${index % 40}`],
          prerequisites: ['Compte synthétique connecté'],
          parameters: [],
          steps: [
            { id: 'open', action: 'navigate', url: `/synthetic/${slug}` },
            { id: 'details', action: 'click', target: { strategy: 'testId', value: 'details' } },
          ],
          arrival: [{ kind: 'visible', target: { strategy: 'testId', value: `screen-${slug}` } }],
          status: index % 11 === 0 ? 'archived' : 'draft',
          provenance: { mode: 'human' },
          createdAt: now,
          updatedAt: now,
        };
        journey.hash = navigationDefinitionHash(journey);
        const serialized = canonical(journey);
        const objectHash = createHash('sha256').update(serialized).digest('hex');
        heads[journey.id] = objectHash;
        history[journey.id] = [objectHash];
        fixtureBytes += Buffer.byteLength(serialized);
        await fs.writeFile(
          path.join(store.directory, 'revisions', `${objectHash}.json`),
          serialized,
        );
      }),
    );
  }
  await fs.writeFile(
    path.join(store.directory, 'catalog.json'),
    JSON.stringify({
      navigationVersion: 1,
      applications: [application('primary'), application('secondary')],
      heads,
      history,
      contributions: [],
      runs: [],
    }),
  );
  const beforeRss = process.memoryUsage().rss;
  const loadStarted = performance.now();
  const snapshot = await store.load();
  const coldLoadMs = performance.now() - loadStarted;
  const loadRssDeltaBytes = process.memoryUsage().rss - beforeRss;
  expect(snapshot.journeys).toHaveLength(count);
  expect(new Set(snapshot.journeys.map((journey) => journey.id)).size).toBe(count);

  // The actual tool path clones the store snapshot before lexical search.
  // Track disk reads during that path: no application source corpus is supplied.
  const reads = vi.mocked(fs.readFile);
  reads.mockClear();
  const search = (query: string, app = 'primary') => searchNavigation(store.snapshot(), query, app);
  expect(search('cible04998').map((result) => result.id)).toEqual(['synthetic-04998']);
  expect(search('cible04999')).toEqual([]); // A different application.
  expect(search('cible00000')).toEqual([]); // An archived journey.
  expect(search('aucunresultatunique')).toEqual([]);
  const queries = [
    'facturation',
    'groupe8',
    'cible04998',
    '',
    'écran détail',
    'aucunresultatunique',
  ];
  for (let index = 0; index < 18; index++) search(queries[index % queries.length]);
  const samples: number[] = [];
  let maxResultChars = 0;
  let maxResultCount = 0;
  for (let index = 0; index < 120; index++) {
    const query = queries[index % queries.length];
    const started = performance.now();
    const results = search(query);
    samples.push(performance.now() - started);
    const chars = JSON.stringify(results).length;
    maxResultChars = Math.max(maxResultChars, chars);
    maxResultCount = Math.max(maxResultCount, results.length);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(chars).toBeLessThanOrEqual(NAVIGATION_LIMITS.searchChars);
    expect(results.every((result) => result.status !== 'archived')).toBe(true);
    expect(results).toEqual(search(query));
  }
  expect(reads).not.toHaveBeenCalled();
  reads.mockRestore();
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    fixture: { kind: 'synthetic-only', journeys: count, revisionBytes: fixtureBytes },
    machine: {
      platform: platform(),
      release: release(),
      architecture: process.arch,
      node: process.version,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
    },
    coldLoad: {
      durationMs: coldLoadMs,
      rssDeltaBytes: loadRssDeltaBytes,
      definition:
        'First NavigationStore.load in a fresh store; filesystem cache is warm from fixture creation, not an OS cold-cache benchmark.',
    },
    warmSearch: {
      includes: 'store.snapshot structured clone + searchNavigation lexical ranking',
      samples: samples.length,
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      maxMs: Math.max(...samples),
      maxResultCount,
      maxResultChars,
      resultCharLimit: NAVIGATION_LIMITS.searchChars,
      filesystemReads: 0,
    },
    evidence: {
      applicationSourceFilesRead: 0,
      providerCalls: 0,
      tokenSavings: null,
      limitations:
        'No provider or application code reading evaluated; no claimed token savings. Timings are observations without CI latency thresholds.',
    },
  };
  const output = path.resolve('artifacts/navigation/search-scale.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
}, 120_000);
