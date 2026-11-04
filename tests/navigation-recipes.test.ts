import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importNavigationJSON } from '../src/host/ChromeRecorderImport';
import { NavigationStore } from '../src/host/NavigationStore';
import { freezeNavigationContext } from '../src/host/NavigationContext';
import { CodeAnchorIndex } from '../src/host/CodeAnchorIndex';
import {
  navigationPlan,
  publishedJourneys,
  resolveNavigationStep,
  resolveNavigationConditions,
} from '../src/shared/navigationRecipes';
import type {
  ApplicationProfile,
  NavigationJourney,
  NavigationRun,
  NavigationSnapshot,
} from '../src/shared/navigation';

const now = '2026-11-04T10:00:00.000Z';
const app: ApplicationProfile = {
  id: 'app',
  name: 'Garage',
  projectIds: ['project'],
  origin: 'http://localhost:3000',
  allowedOrigins: ['http://localhost:3000'],
  interactionPolicy: 'authorized',
  createdAt: now,
  updatedAt: now,
};
const journey = (patch: Partial<NavigationJourney> = {}): NavigationJourney => ({
  id: 'garage',
  applicationId: app.id,
  revision: 1,
  title: 'Garage Oula',
  intent: 'Ouvrir le garage Oula',
  tags: [],
  prerequisites: [],
  parameters: [],
  steps: [{ id: 'open', action: 'navigate', url: '/' }],
  arrival: [{ kind: 'visible', target: { strategy: 'text', value: 'Garage' } }],
  status: 'available',
  provenance: { mode: 'human' },
  createdAt: now,
  updatedAt: now,
  ...patch,
});
const snapshot = (journeys: NavigationJourney[]): NavigationSnapshot => ({
  navigationVersion: 1,
  applications: [app],
  journeys,
  runs: [],
  contributions: [],
});
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('daily navigation recipes', () => {
  it('reports incompatibilities from every step without discarding actions', () => {
    expect(() =>
      importNavigationJSON(
        JSON.stringify({
          title: 'Edge',
          steps: [
            { type: 'click', selectors: [['#open']], unexpectedA: true, unexpectedB: true },
            { type: 'unknownAction' },
          ],
        }),
        app.id,
      ),
    ).toThrow(/unexpectedA.*unexpectedB[\s\S]*Étape 2/);
  });
  it.each(['doubleClick', 'doubleclick'])('imports %s with real double-click semantics', (type) => {
    const result = importNavigationJSON(
      JSON.stringify({ title: 'Edge', steps: [{ type, selectors: [['#car']] }] }),
      app.id,
    );
    expect(result.journey.steps[0]).toMatchObject({ action: 'doubleClick' });
  });
  it('escapes substituted URLs and CSS, and refuses missing values', () => {
    const values = { car: 'a"],button', garage: 'Oula Rennes' };
    expect(
      resolveNavigationStep({ id: 's', action: 'navigate', url: '/garages/{{garage}}' }, values)
        .url,
    ).toBe('/garages/Oula%20Rennes');
    const resolved = resolveNavigationStep(
      { id: 's', action: 'click', target: { strategy: 'css', value: '[data-id="{{car}}"]' } },
      values,
    );
    expect(resolved.target?.value).toBe('[data-id="a\\22 \\5d \\2c button"]');
    expect(
      resolveNavigationConditions(
        [{ kind: 'text', target: { strategy: 'text', value: '{{garage}}' }, value: '{{car}}' }],
        values,
      )[0].value,
    ).toBe(values.car);
    expect(() =>
      resolveNavigationStep(
        { id: 's', action: 'click', target: { strategy: 'text', value: '{{missing}}' } },
        values,
      ),
    ).toThrow('missing');
  });
  it('compiles pinned blocks, their arrival checks, prerequisites and parameters', () => {
    const block = journey({
      parameters: [{ name: 'garage', label: 'Garage', type: 'string', required: true }],
      prerequisites: ['Connecté'],
    });
    const car = journey({ id: 'car', blocks: [{ journeyId: block.id, revision: 1 }] });
    const plan = navigationPlan(car, snapshot([block, car]));
    expect(plan.steps.map((s) => s.id)).toEqual(['b0-open', 'b0-arrival', 'open']);
    expect(plan.prerequisites).toEqual(['Connecté']);
    expect(plan.parameters[0].name).toBe('garage');
    expect(plan.dependencies).toEqual([{ journeyId: 'garage', revision: 1, hash: undefined }]);
    expect(() => navigationPlan(car, snapshot([journey({ revision: 2 }), car]))).toThrow(
      'introuvable',
    );
  });
  it('rejects cycles, foreign applications and archived dependencies', () => {
    const a = journey({ blocks: [{ journeyId: 'car', revision: 1 }] });
    const b = journey({ id: 'car', blocks: [{ journeyId: a.id, revision: 1 }] });
    expect(() => navigationPlan(a, snapshot([a, b]))).toThrow('cyclique');
    expect(() => navigationPlan(b, snapshot([journey({ applicationId: 'foreign' }), b]))).toThrow(
      'introuvable',
    );
    expect(() =>
      navigationPlan(b, {
        ...snapshot([journey({ status: 'archived' }), b]),
        blockRevisions: [journey()],
      }),
    ).toThrow('archivé');
  });
  it('keeps published access available while a draft is edited, including after reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kerai-published-'));
    directories.push(root);
    const store = new NavigationStore(root);
    await store.load();
    await store.saveApplication(app);
    const draft = await store.saveDraft(journey({ revision: 0, status: 'draft' }), 0, {
      kind: 'human',
    });
    const run: NavigationRun = {
      id: 'verify',
      journeyId: draft.id,
      applicationId: app.id,
      revision: draft.revision,
      definitionHash: draft.hash!,
      mode: 'verify',
      status: 'succeeded',
      startedAt: now,
      finishedAt: now,
      arrivalVerified: true,
      prerequisitesConfirmed: true,
      binding: {
        applicationId: app.id,
        origin: app.origin,
        projectIds: ['project'],
        roots: [root],
        verification: 'unknown',
        reason: 'Fixture',
      },
      events: [{ stepId: 'open', status: 'succeeded', at: now }],
      evidencePaths: [],
      metrics: { actions: 1, durationMs: 10, outputChars: 0, providerCalls: 0 },
    };
    await store.recordRun(run);
    const published = await store.commit(draft.id, 1, run.id, { kind: 'human' });
    const edited = await store.saveDraft(
      { ...published, title: 'Nouveau titre' },
      published.revision,
      { kind: 'human' },
    );
    const reopened = await new NavigationStore(root).load();
    expect(reopened.journeys[0].status).toBe('draft');
    expect(publishedJourneys(reopened)[0].revision).toBe(published.revision);
    const frozen = freezeNavigationContext(
      reopened,
      {
        applicationId: app.id,
        journeyId: published.id,
        revision: published.revision,
        parameters: {},
        intent: 'reproduce',
        allowInteractions: true,
      },
      [{ id: 'project', path: root }],
    );
    expect(frozen.journey?.title).toBe('Garage Oula');
    await store.archive(edited.id, edited.revision, { kind: 'human' });
    expect(publishedJourneys(store.snapshot())).toEqual([]);
  });
  it('persists confirmed screen-code links and marks them stale on file changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kerai-linked-'));
    directories.push(root);
    const project = join(root, 'project');
    await mkdir(project);
    await writeFile(join(project, 'Car.tsx'), 'export const title = "Fiche voiture";');
    const index = new CodeAnchorIndex(join(root, 'index'));
    await index.load();
    const projects = [{ id: 'project', path: project }];
    const found = await index.search(app.id, projects[0], 'Fiche voiture');
    await index.linkJourney(found.anchors[0].id, 'car', projects);
    expect(index.snapshot()[0]).toMatchObject({ state: 'corroborated', journeyIds: ['car'] });
    await writeFile(join(project, 'Car.tsx'), 'export const title = "Voiture";');
    await index.verify(projects, { applicationId: app.id });
    expect(index.snapshot()[0]).toMatchObject({ state: 'stale', journeyIds: ['car'] });
    await expect(index.linkJourney(found.anchors[0].id, 'car', projects)).rejects.toThrow('changé');
  });
});
