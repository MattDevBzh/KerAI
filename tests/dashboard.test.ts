import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardController } from '../src/host/DashboardController';
import { DevOpsController } from '../src/host/DevOpsController';
import { AzureDevOps } from '../src/host/AzureDevOps';
import { dashboardConfigSchema } from '../src/core/dashboardSchemas';
import {
  currentDashboardStep,
  dashboardFeatures,
  defaultDashboardConfig,
  newDashboardModule,
} from '../src/shared/dashboard';
import { demoState } from '../webview/demo';
import { parseMessage } from '../src/host/messages';

const roots: string[] = [];
const controllers: DashboardController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-dashboard-'));
  roots.push(root);
  const read = vi
    .fn<DevOpsController['dashboardRead']>()
    .mockResolvedValue({ tickets: [], prs: [], partial: false });
  const publish = vi.fn();
  const controller = new DashboardController(
    root,
    () => [
      {
        id: 'one',
        name: 'Premier projet',
        devops: { dashboardRead: read } as unknown as DevOpsController,
      },
    ],
    publish,
  );
  controllers.push(controller);
  await controller.initialize();
  return { root, read, publish, controller };
}
describe('shared persistent dashboard', () => {
  it('persists duplicate modules independently and rejects concurrent stale writes', async () => {
    const { root, controller } = await fixture(),
      config = defaultDashboardConfig();
    config.modules = [
      newDashboardModule('tickets', 'urgent'),
      newDashboardModule('tickets', 'sprint'),
    ];
    config.modules[0].filters.tickets.types = ['Bug'];
    config.modules[1].filters.tickets.iterationPath = 'Team\\Sprint 4';
    config.modules[1].height = 440;
    config.modules[1].span = 4;
    const results = await Promise.allSettled([
      controller.save(config, 0),
      controller.save(defaultDashboardConfig(), 0),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(controller.snapshot().revision).toBe(1);
    const stored = JSON.parse(await readFile(path.join(root, 'dashboard.json'), 'utf8'));
    expect(stored.config).toEqual(config);
    const reopened = new DashboardController(
      root,
      () => [],
      () => {},
    );
    controllers.push(reopened);
    await reopened.initialize();
    expect(reopened.snapshot().config).toEqual(config);
  });
  it('shares identical read requests, stops polling when all windows hide and avoids overlapping refreshes', async () => {
    const { controller, read } = await fixture();
    const config = defaultDashboardConfig();
    config.refreshSeconds = 15;
    config.modules = [newDashboardModule('prs', 'a'), newDashboardModule('prs', 'b')];
    await controller.save(config, 0);
    vi.useFakeTimers();
    controller.setVisible('cockpit', true);
    await controller.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    controller.setVisible('control', true);
    controller.setVisible('cockpit', false);
    await vi.advanceTimersByTimeAsync(15000);
    expect(read).toHaveBeenCalledTimes(2);
    controller.setVisible('control', false);
    await vi.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(2);
    let finish!: () => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ tickets: [], prs: [], partial: false });
        }),
    );
    const first = controller.refresh(),
      second = controller.refresh();
    expect(first).toBe(second);
    finish();
    await first;
  });
  it('retains freshness on failure and never displays a failed read as an empty successful list', async () => {
    const { controller, read } = await fixture();
    const config = defaultDashboardConfig();
    config.modules = [newDashboardModule('tickets', 'tickets')];
    await controller.save(config, 0);
    read.mockResolvedValueOnce({
      tickets: [
        {
          id: 42,
          title: 'Un vrai ticket',
          state: 'Active',
          url: 'https://dev.azure.com/org/project/_workitems/edit/42',
          description: '',
          acceptanceCriteria: '',
          comments: [],
        },
      ],
      prs: [],
      partial: true,
    });
    await controller.refresh();
    const initial = controller.snapshot().data.tickets;
    read.mockRejectedValueOnce(new Error('Compte déconnecté'));
    await controller.refresh();
    const failed = controller.snapshot().data.tickets;
    expect(failed.tickets).toEqual(initial.tickets);
    expect(failed.updatedAt).toBe(initial.updatedAt);
    expect(failed.errors).toEqual(['Premier projet : Compte déconnecté']);
    expect(failed.loading).toBe(false);
  });
  it('intersects global and module project filters and discards a response after config replacement', async () => {
    const { controller, read } = await fixture();
    const config = defaultDashboardConfig();
    config.modules = [newDashboardModule('tickets', 'a')];
    config.projectIds = ['other'];
    await controller.save(config, 0);
    await controller.refresh();
    expect(read).not.toHaveBeenCalled();
    expect(controller.snapshot().data.a.errors[0]).toContain('Aucun projet');
    config.projectIds = [];
    await controller.save(config, 1);
    let finish!: () => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ tickets: [], prs: [], partial: false });
        }),
    );
    const pending = controller.refresh();
    await controller.save({ ...config, modules: [] }, 2);
    finish();
    await pending;
    expect(controller.snapshot().data).toEqual({});
  });
  it('validates filters, refresh rates and module identity at the host boundary', () => {
    const config = defaultDashboardConfig();
    expect(dashboardConfigSchema.parse(config)).toEqual(config);
    expect(() => dashboardConfigSchema.parse({ ...config, refreshSeconds: 1 })).toThrow();
    expect(() =>
      dashboardConfigSchema.parse({ ...config, modules: [config.modules[0], config.modules[0]] }),
    ).toThrow();
    expect(() => parseMessage({ type: 'dashboardOpen', command: 'runStep' })).toThrow();
    expect(() =>
      parseMessage({ type: 'dashboardSave', config, revision: -1, requestId: 'x' }),
    ).toThrow();
  });
  it('filters by current agent and keeps historical validated steps separate from the active station', () => {
    const feature = structuredClone(demoState.features[0]);
    feature.archived = false;
    feature.status = 'running';
    feature.activeStepId = feature.steps[1].id;
    feature.steps.forEach(
      (s, i) => (s.status = i === 1 ? 'running' : i === 0 ? 'approved' : 'pending'),
    );
    expect(currentDashboardStep(feature)?.id).toBe(feature.steps[1].id);
    const module = newDashboardModule('sessions', 's');
    module.filters.agentId = feature.steps[0].agentId;
    expect(dashboardFeatures([feature], defaultDashboardConfig(), module)).toHaveLength(0);
    module.filters.agentId = feature.steps[1].agentId;
    expect(dashboardFeatures([feature], defaultDashboardConfig(), module)).toHaveLength(1);
  });
  it('reads repository PRs independently of the current user with bounded pagination', async () => {
    const urls: string[] = [];
    const api = new AzureDevOps(
      { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' },
      { get: async () => 'test-secret', store: async () => {}, delete: async () => {} },
      async (url) => {
        urls.push(String(url));
        return new Response(
          JSON.stringify({
            value: [
              {
                pullRequestId: 81,
                title: 'Une PR de Camille',
                status: 'active',
                createdBy: { displayName: 'Camille' },
                sourceRefName: 'refs/heads/feature',
                targetRefName: 'refs/heads/main',
                reviewers: [{ id: 'reviewer', displayName: 'Matt', vote: 0 }],
              },
            ],
          }),
        );
      },
    );
    const result = await api.dashboardPullRequests('active');
    expect(result.pullRequests[0].createdBy).toBe('Camille');
    expect(urls[0]).toContain('searchCriteria.status=active');
    expect(urls[0]).not.toContain('creatorId');
    expect(result.partial).toBe(false);
  });
});
