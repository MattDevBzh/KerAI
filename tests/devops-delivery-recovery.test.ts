import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DevOpsController, type DevOpsControllerOptions } from '../src/host/DevOpsController';
import { DeliveryService } from '../src/host/DeliveryService';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const config = { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' };
const response = (value: unknown) => new Response(JSON.stringify(value));
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'kerai-delivery-recovery-'));
  roots.push(root);
  await writeFile(
    path.join(root, 'devops.json'),
    JSON.stringify({
      version: 1,
      config,
      links: [
        {
          featureId: 'session',
          ticketId: 42,
          projectKey: 'org/project/repo',
          ticketUrl: 'https://dev.azure.com/org/project/_workitems/edit/42',
          pullRequestIds: [],
        },
      ],
      history: [],
    }),
  );
  const delivery = new DeliveryService(root, async () => ({
    code: 0,
    stdout: 'COMMITTED_PR_DIFF',
    stderr: '',
  }));
  delivery.inspect = vi.fn(async () => ({
    branch: 'codex/menu',
    head: 'a'.repeat(40),
    fingerprint: 'b'.repeat(64),
    files: [],
    diff: 'WORKTREE_DIFF',
    diffTruncated: false,
  }));
  delivery.validateBranch = vi.fn(async () => {});
  const http = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const value = String(url);
    if (value.includes('/refs?'))
      return response({
        value: [
          {
            name: 'refs/heads/' + (value.includes('heads%2Fmain') ? 'main' : 'codex/menu'),
            objectId: 'a'.repeat(40),
          },
        ],
      });
    if (value.includes('/workitems/42?'))
      return response({
        id: 42,
        rev: 1,
        fields: { 'System.Title': 'Ticket historique', 'System.TeamProject': 'project' },
      });
    if (value.includes('/comments?')) return response({ comments: [] });
    throw new Error('Unexpected HTTP fixture: ' + value);
  });
  const options: DevOpsControllerOptions = {
    root,
    storageDirectory: root,
    delivery,
    features: () => [{ id: 'session', title: 'Menu' }],
    secrets: { get: async () => 'test-token', store: async () => {}, delete: async () => {} },
    publish: vi.fn(),
    confirm: vi.fn(async () => false),
    requestToken: async () => undefined,
    guard: vi.fn(),
    withMutation: vi.fn(async (_label, work) => work()),
    getAgentInstructions: async () => '',
    createFeature: async () => 'session',
    http,
  };
  const controller = new DevOpsController(options);
  await controller.initialize();
  return { controller, options, delivery, http };
}
describe('delivery recovery and host guards', () => {
  it('reloads a durable session ticket missing from current results before preview, with committed diff and no publication', async () => {
    const { controller, options, http } = await fixture();
    await controller.handle({
      type: 'deliveryPreviewPr',
      featureId: 'session',
      ticketId: 42,
      title: 'Menu',
      description: 'Proofs',
      target: 'main',
    });
    const state = controller.getState();
    expect(state.error).toBeUndefined();
    expect(state.ticketDetail?.id).toBe(42);
    expect(state.preview).toMatchObject({
      kind: 'pr',
      featureId: 'session',
      ticketId: 42,
      diff: 'COMMITTED_PR_DIFF',
    });
    expect(state.preview?.diff).not.toContain('WORKTREE_DIFF');
    await controller.handle({ type: 'deliveryExecute', kind: 'pr', fingerprint: 'b'.repeat(64) });
    expect(options.withMutation).toHaveBeenCalledOnce();
    expect(options.confirm).toHaveBeenCalledOnce();
    expect(controller.getState().preview).toBeDefined();
    expect(http.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('cannot fetch an arbitrary uncached ticket from a forged PR association', async () => {
    const { controller, http } = await fixture();
    await controller.handle({
      type: 'deliveryPreviewPr',
      featureId: 'session',
      ticketId: 99,
      title: 'Menu',
      description: '',
      target: 'main',
    });
    expect(controller.getState().error).toContain('Actualise les tickets');
    expect(http.mock.calls.some(([url]) => String(url).includes('/workitems/99'))).toBe(false);
    expect(controller.getState().preview).toBeUndefined();
  });
  it('invalidates the reviewed diff when only the target branch advances during confirmation, before any PR write', async () => {
    const { controller, options, http } = await fixture();
    await controller.handle({
      type: 'deliveryPreviewPr',
      featureId: 'session',
      ticketId: 42,
      title: 'Menu',
      description: 'Reviewed',
      target: 'main',
    });
    expect(controller.getState().preview?.targetHead).toBe('a'.repeat(40));
    const afterConfirmation = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/refs?') && String(url).includes('heads%2Fmain'))
        return response({ value: [{ name: 'refs/heads/main', objectId: 'c'.repeat(40) }] });
      return http(url, init);
    });
    options.confirm = vi.fn(async () => {
      options.http = afterConfirmation;
      return true;
    });
    await controller.handle({ type: 'deliveryExecute', kind: 'pr', fingerprint: 'b'.repeat(64) });
    expect(options.confirm).toHaveBeenCalledOnce();
    expect(controller.getState().error).toContain(
      'La branche cible a changé depuis la comparaison',
    );
    expect(controller.getState().preview).toBeUndefined();
    expect(controller.getState().pullRequests).toEqual([]);
    expect(afterConfirmation.mock.calls.some(([url]) => String(url).includes('heads%2Fmain'))).toBe(
      true,
    );
    expect(afterConfirmation.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(http.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
