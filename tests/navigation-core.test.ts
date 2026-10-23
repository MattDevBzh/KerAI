import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NavigationStore, navigationDefinitionHash } from '../src/host/NavigationStore';
import { importNavigationJSON, exportNavigationJourney } from '../src/host/ChromeRecorderImport';
import { navigationContext, searchNavigation } from '../src/host/NavigationSearch';
import {
  applicationProfileSchema,
  navigationJourneySchema,
  navigationCommandSchema,
  parseNavigationJson,
} from '../src/core/navigationSchemas';
import type {
  ApplicationProfile,
  NavigationJourney,
  NavigationRun,
} from '../src/shared/navigation';
const now = '2026-10-23T10:00:00.000Z';
const application: ApplicationProfile = {
  id: 'app',
  name: 'Application',
  projectIds: ['project'],
  origin: 'http://localhost:3210',
  allowedOrigins: ['http://localhost:3210'],
  ownerNavigatorId: 'fs-navigator',
  interactionPolicy: 'confirm',
  createdAt: now,
  updatedAt: now,
};
const draft = (patch: Partial<NavigationJourney> = {}): NavigationJourney => ({
  id: 'journey',
  applicationId: 'app',
  revision: 0,
  title: 'Clients facturation',
  intent: 'Ouvrir le formulaire de facturation',
  tags: ['facturation'],
  prerequisites: ['Rôle gestionnaire'],
  parameters: [],
  steps: [
    { id: 's1', action: 'navigate', url: '/' },
    { id: 's2', action: 'click', target: { strategy: 'role', value: 'tab', name: 'Facturation' } },
  ],
  arrival: [
    { kind: 'visible', target: { strategy: 'role', value: 'dialog', name: 'Modifier la facture' } },
  ],
  status: 'draft',
  provenance: { mode: 'human' },
  createdAt: now,
  updatedAt: now,
  ...patch,
});
const run = (journey: NavigationJourney, patch: Partial<NavigationRun> = {}): NavigationRun => ({
  id: 'run',
  journeyId: journey.id,
  applicationId: 'app',
  revision: journey.revision,
  definitionHash: journey.hash!,
  mode: 'verify',
  status: 'succeeded',
  startedAt: now,
  finishedAt: now,
  arrivalVerified: true,
  prerequisitesConfirmed: true,
  binding: {
    applicationId: 'app',
    origin: application.origin,
    projectIds: ['project'],
    roots: ['/synthetic'],
    verification: 'declared',
    reason: 'Association humaine ; build non attesté.',
  },
  events: journey.steps.map((step) => ({ stepId: step.id, status: 'succeeded', at: now })),
  evidencePaths: [],
  metrics: { actions: journey.steps.length, durationMs: 10, outputChars: 100, providerCalls: 0 },
  ...patch,
});
let root: string;
let store: NavigationStore;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'navigation-test-'));
  store = new NavigationStore(root);
  await store.load();
  await store.saveApplication(application);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('navigation schemas and import', () => {
  it('rejects remote origins, hidden script properties and missing semantic contracts', () => {
    expect(
      applicationProfileSchema.safeParse({
        ...application,
        origin: 'https://example.com',
        allowedOrigins: ['https://example.com'],
      }).success,
    ).toBe(false);
    expect(
      navigationJourneySchema.safeParse(draft({ steps: [{ id: 'x', action: 'fill' }] })).success,
    ).toBe(false);
    expect(
      navigationCommandSchema.safeParse({
        action: 'commit',
        journeyId: 'journey',
        expectedRevision: 1,
        actor: { kind: 'human' },
      }).success,
    ).toBe(false);
    expect(() => parseNavigationJson('{"__proto__":{"admin":true}}')).toThrow('interdite');
    expect(() => parseNavigationJson('['.repeat(22) + '0' + ']'.repeat(22))).toThrow('complexe');
    expect(() => parseNavigationJson(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('volumineux');
  });
  it('imports a supported Recorder preview with no value or raw source retained', () => {
    const result = importNavigationJSON(
      JSON.stringify({
        title: 'Rechercher',
        steps: [
          { type: 'navigate', url: 'http://localhost:3210/' },
          {
            type: 'change',
            target: 'main',
            selectors: [['#search']],
            value: 'secret-business-reference',
          },
          {
            type: 'click',
            target: 'main',
            selectors: [['aria/Chercher[role="button"]']],
            offsetX: 21,
            offsetY: 8,
          },
        ],
      }),
      'app',
    );
    expect(result.journey.status).toBe('draft');
    expect(result.journey.steps[1].value).toEqual({ parameter: 'value_2' });
    expect(result.journey.steps[2].target).toEqual({
      strategy: 'role',
      value: 'button',
      name: 'Chercher',
    });
    expect(JSON.stringify(result)).not.toContain('secret-business-reference');
    expect(result.warnings.join(' ')).toContain('coordonnées');
  });
  it.each(['waitForExpression', 'evaluate', 'download', 'customStep'])(
    'rejects unsupported %s without dropping it',
    (type) => {
      expect(() =>
        importNavigationJSON(
          JSON.stringify({ title: 'No', steps: [{ type, expression: 'fetch("/secret")' }] }),
          'app',
        ),
      ).toThrow('non pris en charge');
    },
  );
  it('rejects frame chains, held keys and unknown fields instead of silently changing behavior', () => {
    expect(() =>
      importNavigationJSON(
        JSON.stringify({
          title: 'No',
          steps: [{ type: 'click', selectors: [['iframe', '#inside']] }],
        }),
        'app',
      ),
    ).toThrow('shadow/frame');
    expect(() =>
      importNavigationJSON(
        JSON.stringify({ title: 'No', steps: [{ type: 'navigate', url: '/', execute: 'code' }] }),
        'app',
      ),
    ).toThrow('execute');
    expect(() =>
      importNavigationJSON(
        JSON.stringify({
          title: 'No',
          steps: [{ type: 'keyDown', key: 'Enter', selectors: [['#x']] }],
        }),
        'app',
      ),
    ).toThrow('relâchée');
  });
  it('exports a portable draft without author, replay, business defaults or form values', () => {
    const original = draft({
      steps: [
        {
          id: 's1',
          action: 'fill',
          target: { strategy: 'css', value: '#customer' },
          value: { literal: 'PRIVATE' },
        },
      ],
      parameters: [
        { name: 'other', label: 'Other', type: 'string', required: false, defaultValue: 'PRIVATE' },
      ],
      provenance: { mode: 'human', author: { kind: 'human' }, verifiedRunId: 'run' },
    });
    const exported = exportNavigationJourney(original);
    expect(exported).not.toContain('PRIVATE');
    expect(exported).not.toContain('verifiedRunId');
    expect(exported).not.toContain('author');
    const imported = importNavigationJSON(exported, 'other-app').journey;
    expect(imported.applicationId).toBe('other-app');
    expect(imported.id).not.toBe(original.id);
    expect(imported.status).toBe('draft');
  });
});
describe('immutable navigation library', () => {
  it('keeps history across edits, reload and archival and detects stale writes', async () => {
    const first = await store.saveDraft(draft(), 0, { kind: 'human' });
    const second = await store.saveDraft({ ...first, intent: 'Corriger la facture' }, 1, {
      kind: 'human',
    });
    expect(second.revision).toBe(2);
    await expect(store.saveDraft(first, 1, { kind: 'human' })).rejects.toThrow('Conflit');
    await store.archive(second.id, 2, { kind: 'human' });
    const fresh = new NavigationStore(root);
    await fresh.load();
    expect((await fresh.revision(first.id, 1)).intent).toBe(first.intent);
    expect((await fresh.history(first.id)).map((item) => item.revision)).toEqual([1, 2, 3]);
    expect(fresh.snapshot().journeys[0].status).toBe('archived');
  });
  it('denies consuming agents and wrong app author, while preserving human provenance', async () => {
    await expect(
      store.saveDraft(draft(), 0, {
        kind: 'navigator',
        agentId: 'fs-dev',
        attemptId: 'attempt',
        applicationId: 'app',
      }),
    ).rejects.toThrow('Navigateur');
    await expect(
      store.saveDraft(draft(), 0, {
        kind: 'navigator',
        agentId: 'fs-navigator',
        attemptId: 'attempt',
        applicationId: 'other',
      }),
    ).rejects.toThrow('Navigateur');
    const journey = await store.saveDraft(draft(), 0, { kind: 'human' });
    expect(journey.provenance.author).toEqual({ kind: 'human' });
    const contribution = await store.contribute({
      id: 'observation',
      journeyId: journey.id,
      revision: journey.revision,
      observation: 'Le bouton a changé.',
      author: 'fs-dev',
      status: 'accepted',
      createdAt: now,
    });
    expect(contribution.status).toBe('pending');
    expect(store.snapshot().journeys[0].revision).toBe(1);
  });
  it('requires a real matching host replay and arrival before publication', async () => {
    const journey = await store.saveDraft(draft(), 0, { kind: 'human' });
    await expect(store.commit(journey.id, 1, 'missing', { kind: 'human' })).rejects.toThrow(
      'rejeu',
    );
    await store.recordRun(run(journey, { id: 'failed', arrivalVerified: false }));
    await expect(store.commit(journey.id, 1, 'failed', { kind: 'human' })).rejects.toThrow('rejeu');
    await store.recordRun(run(journey));
    await expect(store.recordRun(run(journey))).resolves.toMatchObject({
      id: 'run',
      status: 'succeeded',
    });
    expect(store.snapshot().runs.filter((item) => item.id === 'run')).toHaveLength(1);
    const published = await store.commit(journey.id, 1, 'run', { kind: 'human' });
    expect(published.status).toBe('available');
    expect(published.hash).toBe(journey.hash);
    expect(published.revision).toBe(2);
    expect(published.provenance.verifiedRunId).toBe('run');
    await expect(store.recordRun(run(journey, { status: 'failed' }))).rejects.toThrow('immuable');
  });
  it('rejects a replay for a changed definition and retains unrelated orphan objects', async () => {
    const journey = await store.saveDraft(draft(), 0, { kind: 'human' });
    await expect(store.recordRun(run(journey, { definitionHash: 'f'.repeat(64) }))).rejects.toThrow(
      'figée',
    );
    const next = await store.saveDraft({ ...journey, intent: 'Different' }, 1, { kind: 'human' });
    await store.recordRun(run(journey));
    await expect(store.commit(next.id, 2, 'run', { kind: 'human' })).rejects.toThrow('rejeu');
    await writeFile(
      path.join(store.directory, 'revisions', `${'e'.repeat(64)}.json`),
      '{unfinished',
    );
    await store.load();
    expect(store.snapshot().journeys[0].revision).toBe(2);
    await store.rebuildIndex();
    expect(
      JSON.parse(await readFile(path.join(store.directory, 'indexes/search.json'), 'utf8'))
        .entries[0].revision,
    ).toBe(2);
  });
  it('detects revision tampering without replacing originals', async () => {
    await store.saveDraft(draft(), 0, { kind: 'human' });
    const file = (await readdir(path.join(store.directory, 'revisions')))[0];
    const original = JSON.parse(
      await readFile(path.join(store.directory, 'revisions', file), 'utf8'),
    );
    await writeFile(
      path.join(store.directory, 'revisions', file),
      JSON.stringify({ ...original, intent: 'tampered' }),
    );
    await expect(store.load()).rejects.toThrow('altérée');
    expect(await readFile(path.join(store.directory, 'revisions', file), 'utf8')).toContain(
      'tampered',
    );
  });
  it('serializes mutations with compare-and-swap, admitting one stale writer', async () => {
    const results = await Promise.allSettled([
      store.saveDraft(draft(), 0, { kind: 'human' }),
      store.saveDraft(draft(), 0, { kind: 'human' }),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(await store.history('journey')).toHaveLength(1);
  });
});
describe('local bounded navigation context', () => {
  it('distinguishes functional states at one URL and never serializes full library or defaults', async () => {
    const one = await store.saveDraft(draft(), 0, { kind: 'human' });
    await store.saveDraft(
      draft({
        id: 'journey-other',
        title: 'Historique des achats',
        intent: 'Voir les achats',
        tags: ['achats'],
        arrival: [{ kind: 'visible', target: { strategy: 'role', value: 'tab', name: 'Achats' } }],
      }),
      0,
      { kind: 'human' },
    );
    expect(searchNavigation(store.snapshot(), 'facturation', 'app')[0].id).toBe(one.id);
    const context = navigationContext([one], 12000);
    expect(context.refs[0].hash).toBe(navigationDefinitionHash(one));
    expect(context.text).toContain('Modifier la facture');
    expect(context.text).not.toContain('steps');
    expect(navigationContext([one], 5)).toMatchObject({ refs: [], text: '', chars: 0, omitted: 1 });
    expect(
      JSON.stringify(searchNavigation(store.snapshot(), '', 'app')).length,
    ).toBeLessThanOrEqual(6000);
  });
});
