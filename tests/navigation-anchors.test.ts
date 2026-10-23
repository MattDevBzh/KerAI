import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeAnchorIndex } from '../src/host/CodeAnchorIndex';
import { NavigationService } from '../src/host/NavigationService';
import { freezeNavigationContext } from '../src/host/NavigationContext';
import { sha256 } from '../src/host/PolicyEngine';
import type { BrowserSessionManager } from '../src/host/navigation/BrowserSessionManager';
import type { ApplicationProfile, BrowserInspection, CodeAnchor } from '../src/shared/navigation';
let root: string, project: string, other: string, storage: string;
const now = '2026-10-23T12:00:00.000Z';
const app: ApplicationProfile = {
  id: 'app',
  name: 'App',
  projectIds: ['project'],
  origin: 'http://localhost:3999',
  allowedOrigins: ['http://localhost:3999'],
  interactionPolicy: 'confirm',
  createdAt: now,
  updatedAt: now,
};
const observation = (patch: Partial<BrowserInspection> = {}): BrowserInspection => ({
  url: app.origin,
  title: 'App',
  observedAt: now,
  text: 'CSS .screen — http://localhost:3999/src/screen.css:1 { color: red }',
  elements: [],
  resources: ['http://localhost:3999/src/screen.css'],
  sourceMaps: [
    {
      bundleUrl: `${app.origin}/bundle.js`,
      bundleHash: 'a'.repeat(64),
      sourceMapUrl: `${app.origin}/bundle.js.map`,
      sources: ['src/Screen.tsx'],
      file: 'bundle.js',
      state: 'candidate',
      reason: 'Browser observation only',
    },
  ],
  truncated: false,
  ...patch,
});
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'navigation-anchors-'));
  project = path.join(root, 'project');
  other = path.join(root, 'other');
  storage = path.join(root, 'index');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await mkdir(path.join(other, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src/Screen.tsx'), 'export const screen = "primary";');
  await writeFile(path.join(project, 'src/screen.css'), '.screen {color:red}');
  await writeFile(path.join(other, 'src/Screen.tsx'), 'export const screen = "worktree";');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('bounded source anchors from observed browser hints', () => {
  it('resolves source map and CSS paths only in authorized roots, hashes local bytes and keeps them candidates', async () => {
    const index = new CodeAnchorIndex(storage);
    await index.load();
    const result = await index.observe(app, observation(), [
      { id: 'project', path: project },
      { id: 'foreign', path: other },
    ]);
    expect(result.anchors).toHaveLength(2);
    expect(
      result.anchors.every(
        (anchor) => anchor.projectId === 'project' && anchor.state === 'candidate',
      ),
    ).toBe(true);
    expect(result.anchors.find((anchor) => anchor.relativePath.endsWith('.tsx'))).toMatchObject({
      hash: sha256('export const screen = "primary";'),
      line: 1,
      source: { bundleHash: 'a'.repeat(64), kind: 'source-map' },
    });
    expect(result.anchors.find((anchor) => anchor.relativePath.endsWith('.css'))?.reason).toContain(
      'CSS',
    );
    const reopened = new CodeAnchorIndex(storage);
    await reopened.load();
    expect(reopened.snapshot()).toEqual(index.snapshot());
    expect(JSON.stringify(result)).not.toContain('export const');
  });
  it('rejects traversals, secret paths, symlinks, foreign origins, contradictory maps and sourceContents', async () => {
    await writeFile(path.join(project, '.env'), 'TOKEN=PRIVATE');
    await symlink(path.join(other, 'src/Screen.tsx'), path.join(project, 'src/link.tsx'));
    const index = new CodeAnchorIndex(storage);
    await index.load();
    const poisoned = observation({
      resources: [],
      sourceMaps: [
        {
          ...observation().sourceMaps![0],
          sources: ['../../secret', '.env', 'src/link.tsx', 'src/Screen.tsx'],
        },
        {
          ...observation().sourceMaps![0],
          sourceMapUrl: 'https://external.invalid/map',
          sources: ['src/Screen.tsx'],
        },
        { ...observation().sourceMaps![0], file: 'wrong.js', sources: ['src/Screen.tsx'] },
        {
          ...observation().sourceMaps![0],
          sourcesContent: ['PRIVATE_SOURCE'],
          sources: ['src/Screen.tsx'],
        } as never,
      ],
    });
    const result = await index.observe(app, poisoned, [{ id: 'project', path: project }]);
    expect(result.anchors).toHaveLength(1);
    expect(result.anchors[0].relativePath).toBe('src/Screen.tsx');
    expect(result.omitted).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SOURCE|TOKEN|\.env|link.tsx/);
    expect(
      (
        await index.observe(app, observation({ url: 'https://foreign.invalid' }), [
          { id: 'project', path: project },
        ])
      ).checked,
    ).toBe(0);
  });
  it('marks only changed-file or changed-bundle anchors stale without claiming corroboration', async () => {
    const index = new CodeAnchorIndex(storage);
    await index.observe(app, observation(), [{ id: 'project', path: project }]);
    const before = index.snapshot();
    await writeFile(path.join(project, 'src/screen.css'), '.screen {color:blue}');
    await index.verify([{ id: 'project', path: project }], { applicationId: 'app' });
    expect(index.snapshot().find((anchor) => anchor.relativePath.endsWith('.css'))?.state).toBe(
      'stale',
    );
    expect(index.snapshot().find((anchor) => anchor.relativePath.endsWith('.tsx'))?.state).toBe(
      'candidate',
    );
    await index.observe(
      app,
      observation({
        resources: [],
        sourceMaps: [{ ...observation().sourceMaps![0], bundleHash: 'b'.repeat(64) }],
      }),
      [{ id: 'project', path: project }],
    );
    const old = index
      .snapshot()
      .find(
        (anchor) => anchor.id === before.find((value) => value.relativePath.endsWith('.tsx'))!.id,
      );
    expect(old?.state).toBe('stale');
    expect(index.snapshot().some((anchor) => anchor.state === 'corroborated')).toBe(false);
  });
  it('does no reads without a selected application and verifies at most 64 relevant candidates', async () => {
    const anchors: CodeAnchor[] = Array.from({ length: 70 }, (_, index) => ({
      id: `anchor-${String(index).padStart(3, '0')}`,
      applicationId: 'app',
      projectId: 'project',
      relativePath: `src/missing-${index}.tsx`,
      line: 1,
      hash: 'a'.repeat(64),
      query: index === 69 ? 'priority invoices' : 'screen',
      reason: 'Candidate',
      state: 'candidate',
      observedAt: now,
    }));
    anchors.push({ ...anchors[0], id: 'other-app', applicationId: 'other' });
    await mkdir(storage);
    await writeFile(path.join(storage, 'anchors.json'), JSON.stringify(anchors));
    const index = new CodeAnchorIndex(storage);
    await index.load();
    await index.verify([{ id: 'project', path: '/path-that-does-not-exist' }]);
    expect(index.snapshot().every((anchor) => anchor.state === 'candidate')).toBe(true);
    await index.verify([{ id: 'project', path: project }], {
      applicationId: 'app',
      queries: ['priority invoices'],
      limit: 9999,
    });
    expect(index.snapshot().filter((anchor) => anchor.state === 'stale')).toHaveLength(64);
    expect(index.snapshot().find((anchor) => anchor.id === 'anchor-069')?.state).toBe('stale');
    expect(index.snapshot().find((anchor) => anchor.id === 'other-app')?.state).toBe('candidate');
    const reopened = new CodeAnchorIndex(storage);
    await reopened.load();
    expect(reopened.snapshot()).toEqual(index.snapshot());
  });
  it('uses the frozen worktree root when agent inspection indexes a source map', async () => {
    const browser = {
      status: vi.fn(() => ({
        id: 'browser',
        applicationId: 'app',
        state: 'idle',
        generation: 1,
        recordedSteps: [],
        recordingPaused: false,
        warnings: [],
      })),
      inspect: vi.fn(async () => observation({ resources: [] })),
      dispose: vi.fn(async () => undefined),
    };
    const service = new NavigationService({
      storageRoot: path.join(root, 'service'),
      workerPath: '/unused',
      trusted: () => true,
      projects: () => [{ id: 'project', path: project }],
      browser: browser as unknown as BrowserSessionManager,
    });
    await service.store.load();
    await service.store.saveApplication(app);
    const context = freezeNavigationContext(
      service.store.snapshot(),
      { applicationId: 'app', parameters: {}, intent: 'reach-state', allowInteractions: false },
      [{ id: 'project', path: other }],
    );
    await service.inspect({ category: 'sources' }, context);
    expect(service.anchors.snapshot()[0].hash).toBe(sha256('export const screen = "worktree";'));
    expect(service.anchors.snapshot()[0].state).toBe('candidate');
    await service.dispose();
  });
});
