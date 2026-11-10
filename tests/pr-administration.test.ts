import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeliveryService } from '../src/host/DeliveryService';
import { PrAdministrationApi, type PrAdminThread } from '../src/host/PrAdministrationApi';
import {
  PrAdministrationService,
  type PrAdministrationOptions,
} from '../src/host/PrAdministrationService';
import { prAdministrationDiff } from '../src/host/PrAdministrationDiff';
import { writePrAdministration } from '../src/host/PrAdministrationWriter';
import {
  defaultPrAdministrationSettings,
  type PrAdminSnapshot,
  type PrAdminModelProposal,
} from '../src/shared/prAdministration';
import { demoState } from '../webview/demo';
import { AzureDevOpsHttpError } from '../src/host/DevOpsErrors';
import type { AgentAdapter, RunInput } from '../src/shared/types';
const exec = promisify(execFile),
  roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const initial: PrAdminSnapshot = {
  id: 42,
  url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/42',
  title: 'Initial',
  description: 'Description initiale',
  sourceBranch: 'refs/heads/codex/session',
  targetBranch: 'refs/heads/main',
  sourceHead: 'a'.repeat(40),
  targetHead: 'b'.repeat(40),
  baseHead: 'b'.repeat(40),
  iteration: 1,
  status: 'active',
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pr-admin-'));
  roots.push(root);
  const git = async (...args: string[]) =>
    (await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root })).stdout.trim();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Test');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'core.autocrlf', 'false');
  await writeFile(path.join(root, 'app.ts'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n');
  await git('add', '.');
  await git('commit', '-m', 'base');
  const base = await git('rev-parse', 'HEAD');
  await writeFile(path.join(root, 'app.ts'), 'ONE\ntwo\nthree\nfour\nfive\nsix\n');
  await writeFile(path.join(root, '.env'), 'SECRET_VALUE=do-not-transmit\n');
  await git('add', '.');
  await git('commit', '-m', 'change');
  let scope = 'repo:session';
  const remote = {
    snapshot: {
      ...initial,
      baseHead: base,
      targetHead: base,
      sourceHead: await git('rev-parse', 'HEAD'),
    },
    threads: [] as PrAdminThread[],
    lostPost: false,
    postFail: false,
    hidden: false,
    actor: 'actor-1',
    lostPatch: false,
  };
  const changes = [
    { changeTrackingId: 1, item: { path: '/app.ts' } },
    { changeTrackingId: 2, item: { path: '/.env' } },
  ];
  const api = {
    snapshot: vi.fn(async () => structuredClone(remote.snapshot)),
    changes: vi.fn(async () => ({ changes, partial: false })),
    threads: vi.fn(async () => structuredClone(remote.hidden ? [] : remote.threads)),
    thread: vi.fn(async (_s: PrAdminSnapshot, id: number) => {
      const t = remote.threads.find((t) => t.id === id);
      if (!t) throw new Error('missing');
      return structuredClone(t);
    }),
    actorId: vi.fn(async () => remote.actor),
    createThread: vi.fn(
      async (
        _s: PrAdminSnapshot,
        block: { path: string; side: string; startLine: number },
        content: string,
        status: string,
      ) => {
        if (remote.postFail) throw new Error('network');
        const thread = {
          id: remote.threads.length + 1,
          status,
          comments: [{ id: 1, content, author: { id: remote.actor }, parentCommentId: 0 }],
          threadContext: {
            filePath: '/' + block.path,
            [`${block.side}FileStart`]: { line: block.startLine },
          },
        };
        remote.threads.push(thread);
        if (remote.lostPost) throw new Error('lost response');
        return structuredClone(thread);
      },
    ),
    updateField: vi.fn(
      async (_s: PrAdminSnapshot, field: 'title' | 'description', content: string) => {
        remote.snapshot[field] = content;
      },
    ),
    updateComment: vi.fn(
      async (_s: PrAdminSnapshot, id: number, _comment: number, content: string) => {
        remote.threads.find((t) => t.id === id)!.comments[0].content = content;
        if (remote.lostPatch) throw new Error('lost patch');
      },
    ),
  };
  let wording = 'Justification de SEC-01';
  const options: PrAdministrationOptions = {
    scope: () => ({
      key: scope,
      session: {
        featureId: scope.split(':')[1],
        title: 'Session',
        path: root,
        branch: 'codex/session',
      },
    }),
    api: () => api as unknown as PrAdministrationApi,
    delivery: () => new DeliveryService(root),
    ensureCommit: async () => {},
    generate: vi.fn(async ({ blocks }) => ({
      proposal: {
        summary: 'Explications',
        comments: [
          {
            blockId: blocks[0].id,
            rule: 'SEC-01',
            explanation: wording,
            reference: 'Guide SEC-01',
          },
        ],
      },
    })),
    save: vi.fn(async () => {}),
    publish: vi.fn(),
    mutate: async (_label, work) => work(),
    confirm: vi.fn(async () => true),
  };
  const service = new PrAdministrationService(options);
  service.reset();
  await service.handle({
    type: 'deliveryPrAdminSettings',
    settings: { ...defaultPrAdministrationSettings, context: 'SEC-01 : contrôler les accès' },
  });
  const prepare = () => service.handle({ type: 'deliveryPrAdminPreview', pullRequestId: 42 });
  const apply = () => {
    const preview = service.getState()!.preview!;
    return service.handle({
      type: 'deliveryPrAdminApply',
      previewId: preview.id,
      changes: preview.actions
        .filter((a) => a.operation === 'create' || a.operation === 'update')
        .map((a) => ({ id: a.id, content: a.content })),
    });
  };
  return {
    root,
    git,
    remote,
    api,
    options,
    service,
    prepare,
    apply,
    changes,
    setWording: (v: string) => {
      wording = v;
    },
    setScope: (v: string) => {
      scope = v;
      service.reset();
    },
  };
}
describe('PR administration diff and publication', () => {
  it('does not require thread or identity permissions for a title-only mission', async () => {
    const f = await fixture();
    await f.service.handle({
      type: 'deliveryPrAdminSettings',
      settings: {
        ...defaultPrAdministrationSettings,
        comments: false,
        title: true,
      },
    });
    f.options.generate = async () => ({
      proposal: { summary: 'Titre', title: 'Nouveau titre', comments: [] },
    });
    f.api.threads.mockRejectedValue(new Error('Discussion access denied'));
    f.api.actorId.mockRejectedValue(new Error('Identity access denied'));
    await f.prepare();
    await f.apply();
    expect(f.remote.snapshot.title).toBe('Nouveau titre');
    expect(f.api.threads).not.toHaveBeenCalled();
    expect(f.api.actorId).not.toHaveBeenCalled();
  });
  it('explains an empty annotatable diff before spending a model call', async () => {
    const f = await fixture();
    f.changes.splice(0, 1);
    await expect(f.prepare()).rejects.toThrow('Aucun bloc de code');
    expect(f.options.generate).not.toHaveBeenCalled();
    expect(f.service.getState()).toMatchObject({
      generating: false,
      error: expect.stringContaining('Active les propositions'),
    });
    expect(f.service.getState()!.progress).toBeUndefined();
  });
  it.each([400, 403])(
    'allows retry after an explicit Azure %i rejection without creating a permanent uncertain annotation',
    async (status) => {
      const f = await fixture();
      f.api.createThread.mockRejectedValueOnce(
        new AzureDevOpsHttpError(status, 'Refus explicite Azure'),
      );
      await f.prepare();
      await expect(f.apply()).rejects.toThrow('Refus explicite Azure');
      expect(f.service.records['repo:session'].annotations['42']).toEqual([]);
      await f.apply();
      expect(f.remote.threads).toHaveLength(1);
      expect(f.service.getState()!.preview!.completed).toHaveLength(1);
    },
  );
  it('does not strand an annotation when saving its intent fails before the request', async () => {
    const f = await fixture();
    await f.prepare();
    vi.mocked(f.options.save).mockRejectedValueOnce(new Error('Disque plein'));
    await expect(f.apply()).rejects.toThrow('Disque plein');
    expect(f.api.createThread).not.toHaveBeenCalled();
    expect(f.service.records['repo:session'].annotations['42']).toEqual([]);
    await f.apply();
    expect(f.remote.threads).toHaveLength(1);
  });
  it('records a confirmed field update even if the other field changes concurrently', async () => {
    const f = await fixture();
    await f.service.handle({
      type: 'deliveryPrAdminSettings',
      settings: {
        ...defaultPrAdministrationSettings,
        comments: false,
        title: true,
        description: true,
      },
    });
    f.options.generate = async () => ({
      proposal: {
        summary: 'Champs',
        title: 'Nouveau titre',
        description: 'Proposition',
        comments: [],
      },
    });
    f.api.updateField.mockImplementationOnce(async () => {
      f.remote.snapshot.title = 'Nouveau titre';
      f.remote.snapshot.description = 'Modification humaine simultanée';
    });
    await f.prepare();
    await expect(f.apply()).rejects.toThrow('Un autre champ');
    expect(f.service.getState()!.preview!.completed).toEqual(['title']);
    expect(f.service.getState()!.result).toContain('1 intervention');
    expect(f.api.updateField).toHaveBeenCalledTimes(1);
    expect(f.remote.snapshot.description).toBe('Modification humaine simultanée');
  });
  it('anchors added and deleted hunks from the committed PR, excludes secrets and ignores dirty local files', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, 'app.ts'), 'DIRTY LOCAL DATA');
    await f.prepare();
    const input = vi.mocked(f.options.generate).mock.calls[0][0];
    expect(input.blocks).toHaveLength(2);
    expect(input.blocks[0]).toMatchObject({
      path: 'app.ts',
      side: 'right',
      startLine: 1,
      endLine: 1,
    });
    expect(input.blocks[1]).toMatchObject({
      path: 'app.ts',
      side: 'left',
      startLine: 7,
      endLine: 7,
    });
    expect(input.blocks.map((b) => b.code).join('')).not.toMatch(/SECRET_VALUE|DIRTY LOCAL/);
    expect(f.service.getState()!.preview!.warnings.join(' ')).toMatch(/sensible/);
    expect(f.service.getState()!.preview).toMatchObject({
      annotatedBlocks: 1,
      blockCount: 2,
      threadStatus: 'byDesign',
    });
    expect(f.api.createThread).not.toHaveBeenCalled();
  });
  it('creates one attributed annotation, reruns without duplicate, and updates only its untouched comment', async () => {
    const f = await fixture();
    await f.prepare();
    await f.apply();
    expect(f.api.createThread).toHaveBeenCalledTimes(1);
    expect(f.remote.threads[0].status).toBe('byDesign');
    expect(f.remote.threads[0].comments[0].content).toMatch(/SEC-01.*[\s\S]*kerai-pr:/);
    await f.apply();
    expect(f.api.createThread).toHaveBeenCalledTimes(1);
    await f.prepare();
    expect(f.service.getState()!.preview!.actions[0].operation).toBe('unchanged');
    f.setWording('Explication améliorée');
    await f.prepare();
    await f.apply();
    expect(f.api.updateComment).toHaveBeenCalledTimes(1);
    expect(f.remote.threads).toHaveLength(1);
    expect(f.remote.threads[0].status).toBe('byDesign');
  });
  it.each(['reply', 'edit', 'status', 'deleted', 'position'] as const)(
    'preserves a thread after human %s',
    async (kind) => {
      const f = await fixture();
      await f.prepare();
      await f.apply();
      const thread = f.remote.threads[0];
      if (kind === 'reply')
        thread.comments.push({
          id: 2,
          parentCommentId: 1,
          author: { id: 'actor-1' },
          content: 'Même compte, intervention humaine',
        });
      if (kind === 'edit') thread.comments[0].content = 'Texte humain';
      if (kind === 'status') thread.status = 'active';
      if (kind === 'deleted') thread.isDeleted = true;
      if (kind === 'position') thread.threadContext!.rightFileStart = { line: 5 };
      f.setWording('Nouvelle explication');
      await f.prepare();
      expect(f.service.getState()!.preview!.actions[0].operation).toBe('protected');
      expect(f.api.updateComment).not.toHaveBeenCalled();
    },
  );
  it('rechecks human replies and commit changes after confirmation', async () => {
    const f = await fixture();
    await f.prepare();
    await f.apply();
    f.setWording('New');
    await f.prepare();
    f.options.confirm = async () => {
      f.remote.threads[0].comments.push({ id: 2, parentCommentId: 1, content: 'Question' });
      return true;
    };
    await expect(f.apply()).rejects.toThrow('humain');
    expect(f.api.updateComment).not.toHaveBeenCalled();
    const g = await fixture();
    await g.prepare();
    g.options.confirm = async () => {
      g.remote.snapshot.sourceHead = 'f'.repeat(40);
      return true;
    };
    await expect(g.apply()).rejects.toThrow('changé depuis');
    expect(g.api.createThread).not.toHaveBeenCalled();
  });
  it('blocks a stale PR during generation and mismatched session branches', async () => {
    const f = await fixture(),
      generate = f.options.generate;
    f.options.generate = async (input) => {
      const result = await generate(input);
      f.remote.snapshot.targetHead = 'e'.repeat(40);
      return result;
    };
    await expect(f.prepare()).rejects.toThrow('changé pendant');
    expect(f.service.getState()?.preview).toBeUndefined();
    f.remote.snapshot.sourceBranch = 'refs/heads/other';
    await expect(f.prepare()).rejects.toThrow('branche de la session');
  });
  it.each(['block', 'rule', 'permission'] as const)(
    'rejects invented %s before any publication',
    async (kind) => {
      const f = await fixture(),
        generate = f.options.generate;
      f.options.generate = async (input) => {
        const result = await generate(input);
        if (kind === 'block') result.proposal.comments[0].blockId = 'invented';
        if (kind === 'rule') result.proposal.comments[0].rule = 'SEC-99';
        if (kind === 'permission') result.proposal.title = 'Forbidden';
        return result;
      };
      await expect(f.prepare()).rejects.toThrow();
      expect(f.api.createThread).not.toHaveBeenCalled();
      expect(f.service.getState()?.preview).toBeUndefined();
    },
  );
  it('recovers lost create and update responses without duplicating writes', async () => {
    const f = await fixture();
    f.remote.lostPost = true;
    await f.prepare();
    await f.apply();
    expect(f.remote.threads).toHaveLength(1);
    f.setWording('After loss');
    f.remote.lostPatch = true;
    await f.prepare();
    await f.apply();
    expect(f.api.updateComment).toHaveBeenCalledTimes(1);
    await f.prepare();
    expect(f.service.getState()!.preview!.actions[0].operation).toBe('unchanged');
  });
  it('persists an uncertain intent before POST and never retries an ambiguous creation blindly', async () => {
    const f = await fixture();
    f.remote.lostPost = true;
    f.remote.hidden = true;
    await f.prepare();
    await expect(f.apply()).rejects.toThrow('lost response');
    expect(f.service.records['repo:session'].annotations['42'][0].uncertain).toBe(true);
    await expect(f.apply()).rejects.toThrow('incertain');
    expect(f.api.createThread).toHaveBeenCalledTimes(1);
    f.remote.hidden = false;
    await f.prepare();
    expect(f.service.getState()!.preview!.actions[0].operation).toBe('unchanged');
  });
  it('keeps session missions separate and restores ownership receipts after restart', async () => {
    const f = await fixture();
    await f.prepare();
    await f.apply();
    f.setScope('repo:other');
    expect(f.service.getState()!.settings.context).toBe('');
    const restored = new PrAdministrationService(f.options);
    restored.records = structuredClone(f.service.records);
    f.setScope('repo:session');
    restored.reset();
    expect(restored.getState()!.settings.context).toContain('SEC-01');
    await restored.handle({ type: 'deliveryPrAdminPreview', pullRequestId: 42 });
    expect(restored.getState()!.preview!.actions[0].operation).toBe('unchanged');
  });
  it('supports won’t fix on new threads and never resets an existing thread status', async () => {
    const f = await fixture();
    await f.service.handle({
      type: 'deliveryPrAdminSettings',
      settings: { ...f.service.getState()!.settings, threadStatus: 'wontFix' },
    });
    await f.prepare();
    await f.apply();
    expect(f.remote.threads[0].status).toBe('wontFix');
    await f.service.handle({
      type: 'deliveryPrAdminSettings',
      settings: { ...f.service.getState()!.settings, threadStatus: 'active' },
    });
    f.setWording('Updated');
    await f.prepare();
    await f.apply();
    expect(f.remote.threads[0].status).toBe('wontFix');
  });
  it('stops a partial batch and resumes without repeating completed actions', async () => {
    const f = await fixture();
    await f.service.handle({
      type: 'deliveryPrAdminSettings',
      settings: { ...f.service.getState()!.settings, title: true },
    });
    const generate = f.options.generate;
    f.options.generate = async (input) => {
      const r = await generate(input);
      r.proposal.title = 'New title';
      return r;
    };
    f.remote.postFail = true;
    await f.prepare();
    await expect(f.apply()).rejects.toThrow('network');
    expect(f.service.getState()!.preview!.completed).toEqual(['title']);
    expect(f.remote.snapshot.title).toBe('New title');
    await expect(f.apply()).rejects.toThrow('incertain');
    expect(f.api.updateField).toHaveBeenCalledTimes(1);
    expect(f.api.createThread).toHaveBeenCalledTimes(1);
  });
  it('refuses a different account or declined publication', async () => {
    const f = await fixture();
    f.options.confirm = async () => false;
    await f.prepare();
    await f.apply();
    expect(f.api.createThread).not.toHaveBeenCalled();
    f.options.confirm = async () => true;
    await f.apply();
    f.remote.actor = 'actor-2';
    f.setWording('changed');
    await f.prepare();
    await expect(f.apply()).rejects.toThrow('compte Azure');
    expect(f.api.updateComment).not.toHaveBeenCalled();
  });
  it('cancels preparation while preserving the last preview', async () => {
    const f = await fixture();
    await f.prepare();
    const previous = f.service.getState()!.preview!.id;
    let ready!: () => void;
    const started = new Promise<void>((resolve) => (ready = resolve));
    f.options.generate = ({ signal }) =>
      new Promise((_resolve, reject) => {
        ready();
        signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
      });
    const result = f.prepare();
    await started;
    f.service.cancel();
    await expect(result).rejects.toThrow('Stopped');
    expect(f.service.getState()!.generating).toBe(false);
    expect(f.service.getState()!.preview!.id).toBe(previous);
  });
  it('excludes renamed files and keeps repeated hunks distinct', async () => {
    const f = await fixture();
    const diff = await prAdministrationDiff(new DeliveryService(f.root), f.remote.snapshot, [
      { changeTrackingId: 3, item: { path: '/app.ts' }, originalPath: '/old.ts' },
    ]);
    expect(diff.blocks).toHaveLength(0);
    expect(diff.warnings.join('')).toContain('renommage');
    const runner = {
      run: vi.fn(async () => ({
        code: 0,
        stderr: '',
        stdout: '@@ -1 +1 @@\n-a\n+b\n@@ -10 +10 @@\n-a\n+b\n',
      })),
    };
    const repeated = await prAdministrationDiff(runner, f.remote.snapshot, [f.changes[0]]);
    expect(repeated.blocks).toHaveLength(2);
    expect(new Set(repeated.blocks.map((b) => b.stableKey)).size).toBe(2);
  });
});

it('reads Azure system threads without status and deleted comment bodies without losing human threads', async () => {
  const api = new PrAdministrationApi(
    async () => ({
      value: [
        {
          id: 1,
          comments: [{ id: 1, content: 'Merge attempt', author: { id: 'system' } }],
          threadContext: null,
        },
        {
          id: 2,
          status: null,
          comments: [{ id: 1, content: null, author: null, isDeleted: true }],
          isDeleted: true,
        },
        {
          id: 3,
          status: 'active',
          comments: [{ id: 1, content: 'Human review', author: { id: 'human' } }],
        },
      ],
    }),
    () => initial.url,
    async () => 'actor',
  );
  const threads = await api.threads(initial);
  expect(threads.map((thread) => thread.status)).toEqual(['unknown', 'unknown', 'active']);
  expect(threads[2].comments[0].content).toBe('Human review');
});
it.each([
  [{ status: 'completed' }, 'plus active'],
  [{ status: 'active', lastMergeSourceCommit: null }, 'pas encore calculé'],
])('explains unavailable PR snapshots before parsing missing commits', async (pr, message) => {
  const api = new PrAdministrationApi(
    async (route) => (route.includes('/iterations?') ? { value: [] } : pr),
    () => initial.url,
    async () => 'actor',
  );
  await expect(api.snapshot(42)).rejects.toThrow(message);
});

it.each([
  { side: 'left' as const, endLine: 7 },
  { side: 'left' as const, endLine: 8 },
  { side: 'right' as const, endLine: 7 },
  { side: 'right' as const, endLine: 8 },
])(
  'Azure adapter uses accepted offsets for $side comment ending on line $endLine and verifies refs',
  async ({ side, endLine }) => {
    let moved = false;
    const request = vi.fn(
      async (
        suffix: string,
        body?: unknown,
        _method?: 'PATCH',
      ): Promise<Record<string, unknown>> => {
        if (body)
          return { id: 1, status: 'byDesign', comments: [{ id: 1, content: 'Explanation' }] };
        if (suffix.includes('/refs?')) {
          const branch = new URL('https://local' + suffix).searchParams.get('filter')!;
          return {
            value: [
              {
                name: 'refs/' + branch,
                objectId:
                  branch === 'heads/main'
                    ? initial.targetHead
                    : moved
                      ? 'c'.repeat(40)
                      : initial.sourceHead,
              },
            ],
          };
        }
        if (suffix.includes('/diffs/')) return { commonCommit: initial.baseHead };
        if (suffix.includes('/iterations?'))
          return { value: [{ id: 1, sourceRefCommit: { commitId: initial.sourceHead } }] };
        return {
          title: initial.title,
          description: initial.description,
          sourceRefName: initial.sourceBranch,
          targetRefName: initial.targetBranch,
          status: 'active',
          lastMergeSourceCommit: { commitId: initial.sourceHead },
          lastMergeTargetCommit: { commitId: initial.targetHead },
        };
      },
    );
    const api = new PrAdministrationApi(
      request,
      () => initial.url,
      async () => 'actor',
    );
    expect(await api.snapshot(42)).toEqual(initial);
    await api.updateField(initial, 'title', 'New');
    expect(request).toHaveBeenLastCalledWith(
      '/pullrequests/42?api-version=7.1',
      { title: 'New' },
      'PATCH',
    );
    const block = {
      id: 'b',
      stableKey: 's',
      path: 'app.ts',
      side,
      startLine: 7,
      endLine,
      changeTrackingId: 12,
      code: '-old',
    };
    await api.createThread(initial, block, 'Explanation', 'wontFix');
    expect(request).toHaveBeenLastCalledWith(
      '/pullrequests/42/threads?api-version=7.1',
      expect.objectContaining({
        status: 'wontFix',
        threadContext: {
          filePath: '/app.ts',
          [`${side}FileStart`]: { line: 7, offset: 1 },
          [`${side}FileEnd`]: { line: endLine, offset: 1 },
        },
        pullRequestThreadContext: {
          changeTrackingId: 12,
          iterationContext: { firstComparingIteration: 1, secondComparingIteration: 1 },
        },
      }),
    );
    await api.updateComment(initial, 1, 1, 'New');
    expect(request).toHaveBeenLastCalledWith(
      '/pullrequests/42/threads/1/comments/1?api-version=7.1',
      { content: 'New' },
      'PATCH',
    );
    moved = true;
    await expect(api.snapshot(42)).rejects.toThrow('branche a changé');
  },
);
it('administrator uses the selected model with rules and no tool access', async () => {
  const proposal: PrAdminModelProposal = { summary: 'No evidence', comments: [] };
  const run = vi.fn(async (_input: RunInput) => ({
    content: JSON.stringify(proposal),
    changedFiles: [],
    questions: [],
    model: 'chosen',
  }));
  const result = await writePrAdministration({
    feature: demoState.features[0],
    agent: { ...demoState.agents[0], model: 'chosen', tools: ['execute'] },
    adapter: { run } as unknown as AgentAdapter,
    settings: demoState.settings,
    workspacePath: '/session',
    signal: new AbortController().signal,
    devops: {
      authenticated: true,
      busy: false,
      notices: [],
      tickets: [],
      pullRequests: [],
      links: [],
      history: [],
    },
    administration: { ...defaultPrAdministrationSettings, context: 'SEC-01' },
    sessionContext: {
      summary: 'Résumé exact de la session',
      sources: [
        {
          id: 'source',
          digest: 'digest',
          kind: 'document',
          label: 'Règles.md',
          origin: 'Spécification',
          content: 'SEC-42 : droits obligatoires',
        },
      ],
      fingerprint: 'snapshot',
      warnings: [],
    },
    snapshot: initial,
    blocks: [],
  });
  expect(result.proposal).toEqual(proposal);
  expect(run.mock.calls[0][0]).toMatchObject({
    mode: 'discussion',
    agent: { model: 'chosen', tools: [], skills: [], policy: 'read-only' },
    settings: { mcpServers: [], hooks: [] },
  });
  expect(run.mock.calls[0][0].preparedPrompt).toContain('SEC-01');
  expect(run.mock.calls[0][0].preparedPrompt).toContain('SEC-42 : droits obligatoires');
  expect(run.mock.calls[0][0].preparedPrompt).toContain('Résumé exact de la session');
});

it('sends only chosen session sources, accepts their rule identifiers and persists the selection', async () => {
  const f = await fixture();
  const catalog = {
    featureId: 'session',
    title: 'Session',
    summary: 'Résumé automatique',
    warnings: [],
    items: [
      {
        id: '1'.repeat(64),
        digest: 'a'.repeat(64),
        kind: 'document' as const,
        label: 'Règles.md',
        origin: 'Session',
        content: 'SEC-DOC : contrôle des accès',
      },
      {
        id: '2'.repeat(64),
        digest: 'b'.repeat(64),
        kind: 'exchange' as const,
        label: 'Échange privé',
        origin: 'Session',
        content: 'UNSELECTED_CONTEXT',
      },
    ],
  };
  f.options.context = () => structuredClone(catalog);
  await f.service.handle({ type: 'deliveryPrAdminLoadContext' });
  expect(f.service.getState()!.contextCatalog?.items).toHaveLength(2);
  const source = catalog.items[0];
  await f.service.handle({
    type: 'deliveryPrAdminSettings',
    settings: {
      ...f.service.getState()!.settings,
      context: '',
      sessionContext: [{ id: source.id, digest: source.digest }],
    },
  });
  const generate = f.options.generate;
  f.options.generate = vi.fn(async (input) => {
    expect(input.sessionContext?.sources).toEqual([source]);
    const result = await generate(input);
    result.proposal.comments[0].rule = 'SEC-DOC';
    return result;
  });
  await f.prepare();
  expect(f.service.getState()!.preview!.sessionContext?.sources).toEqual([source]);
  await f.apply();
  expect(f.api.createThread).toHaveBeenCalledTimes(1);
  expect(f.service.records['repo:session'].settings.sessionContext).toEqual([
    { id: source.id, digest: source.digest },
  ]);
});
it.each(['generation', 'confirmation'] as const)(
  'rejects a changed selected source during %s without publishing',
  async (phase) => {
    const f = await fixture();
    const source = {
      id: '1'.repeat(64),
      digest: 'a'.repeat(64),
      kind: 'document' as const,
      label: 'Règles.md',
      origin: 'Session',
      content: 'SEC-01',
    };
    f.options.context = () => ({
      featureId: 'session',
      title: 'Session',
      summary: 'Résumé',
      warnings: [],
      items: [structuredClone(source)],
    });
    await f.service.handle({
      type: 'deliveryPrAdminSettings',
      settings: {
        ...f.service.getState()!.settings,
        sessionContext: [{ id: source.id, digest: source.digest }],
      },
    });
    if (phase === 'generation') {
      const generate = f.options.generate;
      f.options.generate = async (input) => {
        const result = await generate(input);
        source.digest = 'b'.repeat(64);
        return result;
      };
      await expect(f.prepare()).rejects.toThrow('source de contexte a changé');
    } else {
      await f.prepare();
      f.options.confirm = async () => {
        source.digest = 'b'.repeat(64);
        return true;
      };
      await expect(f.apply()).rejects.toThrow('source de contexte a changé');
    }
    expect(f.api.createThread).not.toHaveBeenCalled();
  },
);
it('rejects an unrelated session catalogue and forged context before calling the model', async () => {
  const f = await fixture();
  f.options.context = () => ({
    featureId: 'other-session',
    title: 'Other',
    summary: 'Other context',
    items: [],
    warnings: [],
  });
  await expect(f.prepare()).rejects.toThrow('autre session');
  expect(f.options.generate).not.toHaveBeenCalled();
});

it('accepts grouped audit findings from supplied context and rejects the missing component before publication', async () => {
  const f = await fixture();
  const generate = f.options.generate;
  let rule = 'F11/F12';
  f.options.generate = vi.fn(async (input) => {
    const result = await generate(input);
    result.proposal.comments[0].rule = rule;
    return result;
  });
  await f.service.handle({
    type: 'deliveryPrAdminSettings',
    settings: {
      ...defaultPrAdministrationSettings,
      context: 'F04 — migration\nF11 et F12 — mandat et vérifications',
    },
  });
  await f.prepare();
  expect(f.service.getState()!.preview!.actions[0].rule).toBe('F11/F12');
  expect(f.api.createThread).not.toHaveBeenCalled();
  rule = 'F11/F99';
  await expect(f.prepare()).rejects.toThrow(/f99.*Sélectionne toutes les parties/);
  expect(f.api.createThread).not.toHaveBeenCalled();
});
