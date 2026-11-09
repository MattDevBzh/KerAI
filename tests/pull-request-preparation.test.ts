import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DevOpsController, type DevOpsControllerOptions } from '../src/host/DevOpsController';
import { writePullRequest } from '../src/host/PullRequestWriter';
import { defaultPullRequestSettings } from '../src/shared/pullRequestPreparation';
import { demoState } from '../webview/demo';
import type { AgentAdapter, RunInput } from '../src/shared/types';

const exec = promisify(execFile),
  roots: string[] = [];
const config = { organization: 'org', project: 'project', repository: 'repo', remote: 'origin' };
const reply = (data: unknown) => new Response(JSON.stringify(data));
const reviewer = { id: '12345678-1234-4234-8234-123456789012', name: 'Camille', required: true };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pr-writing-'));
  roots.push(root);
  const source = path.join(root, 'source'),
    workspace = path.join(root, 'worktree');
  await mkdir(source);
  const git = async (directory: string, ...args: string[]) =>
    (
      await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: directory })
    ).stdout.trim();
  await git(source, 'init', '-b', 'main');
  await git(source, 'config', 'user.email', 'test@example.com');
  await git(source, 'config', 'user.name', 'PR Test');
  await git(source, 'config', 'core.autocrlf', 'false');
  await writeFile(path.join(source, 'app.ts'), 'initial\n');
  await git(source, 'add', '.');
  await git(source, 'commit', '-m', 'base');
  const base = await git(source, 'rev-parse', 'HEAD');
  await git(source, 'remote', 'add', 'origin', 'https://dev.azure.com/org/project/_git/repo');
  await git(source, 'worktree', 'add', '-b', 'codex/session', workspace);
  await writeFile(path.join(workspace, 'app.ts'), 'session change\n');
  await writeFile(path.join(workspace, '.env'), 'SECRET_MUST_NOT_REACH_WRITER=abc\n');
  await git(workspace, 'add', '.');
  await git(workspace, 'commit', '-m', 'session change');
  const head = await git(workspace, 'rev-parse', 'HEAD');
  await writeFile(path.join(source, 'app.ts'), 'unrelated source change\n');
  const server = {
    target: base,
    head,
    existing: false,
    posts: [] as Record<string, unknown>[],
    loseResponse: false,
  };
  const pr = () => ({
    pullRequestId: 27,
    title: 'Session PR',
    status: 'active',
    isDraft: true,
    sourceRefName: 'refs/heads/codex/session',
    targetRefName: 'refs/heads/main',
  });
  const options: DevOpsControllerOptions = {
    root: source,
    storageDirectory: path.join(root, 'storage'),
    secrets: { get: async () => 'token', store: async () => {}, delete: async () => {} },
    guard: vi.fn(),
    publish: vi.fn(),
    confirm: vi.fn(async () => true),
    requestToken: async () => undefined,
    withMutation: vi.fn(async (_label, work) => work()),
    withSessionMutation: vi.fn(async (_id, _label, work) => work()),
    getAgentInstructions: async () => '',
    features: () => [{ id: 'session', title: 'Session' }],
    createFeature: async () => '',
    resolveDeliverySession: async () => ({
      featureId: 'session',
      title: 'Session',
      path: workspace,
      branch: 'codex/session',
    }),
    generatePr: vi.fn(async () => ({
      title: 'Livrer le changement',
      description: 'Diff relu, tests non attestés.',
      model: 'selected-model',
    })),
    http: vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/refs')) {
        const branch = url.searchParams.get('filter')!;
        return reply({
          value: [
            {
              name: 'refs/' + branch,
              objectId: branch === 'heads/main' ? server.target : server.head,
            },
          ],
        });
      }
      if (url.pathname.endsWith('/pullrequests')) {
        if (init?.method === 'POST') {
          server.posts.push(JSON.parse(String(init.body)));
          server.existing = true;
          if (server.loseResponse) throw new Error('lost response');
          return reply(pr());
        }
        return reply({ value: server.existing ? [pr()] : [] });
      }
      if (url.pathname.endsWith('/identities'))
        return reply({
          value: [{ id: reviewer.id, providerDisplayName: reviewer.name, isActive: true }],
        });
      return reply({ value: [] });
    }),
  };
  const controller = new DevOpsController(options);
  await controller.initialize();
  await controller.handle({ type: 'deliverySelectSession', featureId: 'session' });
  expect(controller.getState().error).toBeUndefined();
  return { root, source, workspace, git, base, head, server, options, controller };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const generate = (controller: DevOpsController) =>
  controller.handle({ type: 'deliveryGeneratePr', featureId: 'session', target: 'main' });
const preview = (controller: DevOpsController) =>
  controller.handle({
    type: 'deliveryPreviewPr',
    featureId: 'session',
    target: 'main',
    title: 'Titre relu',
    description: 'Description relue',
    isDraft: false,
    reviewers: [reviewer],
  });

describe('session PR preparation', () => {
  it('writes from the isolated committed diff, excludes sensitive files, and leaves the dirty source untouched', async () => {
    const f = await fixture();
    await generate(f.controller);
    expect(f.controller.getState().error).toBeUndefined();
    expect(f.controller.getState().prGeneration).toMatchObject({
      head: f.head,
      targetHead: f.base,
      featureId: 'session',
      model: 'selected-model',
    });
    const input = vi.mocked(f.options.generatePr!).mock.calls[0][0];
    expect(input.workspacePath).toBe(f.workspace);
    expect(input.diff).toContain('+session change');
    expect(input.diff).toContain('COMPARAISON PARTIELLE');
    expect(input.diff).not.toContain('SECRET_MUST_NOT_REACH_WRITER');
    expect(input.diff).not.toContain('unrelated source change');
    expect(f.options.withSessionMutation).toHaveBeenCalledWith(
      'session',
      'Rédaction de la PR',
      expect.any(Function),
    );
    expect(f.options.withMutation).not.toHaveBeenCalled();
    expect(await readFile(path.join(f.source, 'app.ts'), 'utf8')).toBe('unrelated source change\n');
    expect(f.server.posts).toEqual([]);
  });
  it('commits only the session workspace and keeps that selection after restart', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'app.ts'), 'second change\n');
    await f.controller.handle({
      type: 'deliveryPreviewCommit',
      paths: ['app.ts'],
      title: 'fix: session',
    });
    const fingerprint = f.controller.getState().preview!.fingerprint;
    await f.controller.handle({ type: 'deliveryExecute', kind: 'commit', fingerprint });
    expect(f.controller.getState().error).toBeUndefined();
    expect(await f.git(f.workspace, 'log', '-1', '--format=%s')).toBe('fix: session');
    expect(f.controller.getState().deliveryResults?.commit).toMatchObject({
      status: 'success',
      head: await f.git(f.workspace, 'rev-parse', 'HEAD'),
    });
    expect(f.controller.getState().snapshot?.head).toBe(
      f.controller.getState().deliveryResults?.commit?.head,
    );
    expect(await f.git(f.source, 'log', '-1', '--format=%s')).toBe('base');
    await f.controller.dispose();
    const restored = new DevOpsController(f.options);
    await restored.initialize();
    expect(restored.getState().deliverySession?.path).toBe(f.workspace);
    expect(restored.getState().snapshot?.branch).toBe('codex/session');
  });
  it('blocks dirty sessions and wrong checked-out branches before calling the writer', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'new.txt'), 'uncommitted');
    await generate(f.controller);
    expect(f.controller.getState().error).toContain('pas commités');
    expect(f.options.generatePr).not.toHaveBeenCalled();
    await rm(path.join(f.workspace, 'new.txt'));
    await f.git(f.workspace, 'switch', '-c', 'another');
    await generate(f.controller);
    expect(f.controller.getState().error).toContain('branche courante');
    expect(f.options.generatePr).not.toHaveBeenCalled();
  });
  it('rejects generation if the branch or target moves during the model call', async () => {
    const f = await fixture();
    f.options.generatePr = async () => {
      f.server.target = 'f'.repeat(40);
      return { title: 'obsolete', description: 'obsolete' };
    };
    await generate(f.controller);
    expect(f.controller.getState().error).toContain('changé pendant');
    expect(f.controller.getState().prGeneration).toBeUndefined();
    expect(f.controller.getState().busy).toBe(false);
  });
  it('cancels the active writer even while busy and releases its operation', async () => {
    const f = await fixture();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.options.generatePr = ({ signal }) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener('abort', () => reject(new Error('Rédaction arrêtée.')), {
          once: true,
        });
      });
    const work = generate(f.controller);
    await ready;
    expect(f.controller.getState().prGenerating).toBe(true);
    await f.controller.handle({ type: 'deliveryCancelGeneration' });
    await work;
    expect(f.controller.getState().busy).toBe(false);
    expect(f.controller.getState().prGenerating).toBe(false);
    expect(f.controller.getState().prGeneration).toBeUndefined();
  });
  it('persists different PR settings per repository and Azure project', async () => {
    const f = await fixture();
    const settings = {
      ...defaultPullRequestSettings,
      agentId: 'my-agent',
      target: 'develop',
      instructions: 'Sections du projet',
      reviewers: [reviewer],
      isDraft: false,
    };
    await f.controller.handle({ type: 'deliverySavePrSettings', settings });
    await f.controller.handle({
      type: 'devopsConfigure',
      config: { ...config, repository: 'second' },
    });
    expect(f.controller.getState().prSettings).toEqual(defaultPullRequestSettings);
    await f.controller.handle({ type: 'devopsConfigure', config });
    expect(f.controller.getState().prSettings).toEqual(settings);
    await f.controller.dispose();
    const restored = new DevOpsController(f.options);
    await restored.initialize();
    expect(restored.getState().prSettings).toEqual(settings);
  });
  it('persists a PR administration mission per session through controller reload', async () => {
    const f = await fixture();
    const settings = {
      agentId: 'fs-devops-pr-admin',
      instructions: 'Annoter les changements',
      context: 'SEC-01 : accès contrôlé',
      threadStatus: 'wontFix' as const,
      comments: true,
      title: false,
      description: false,
    };
    await f.controller.handle({ type: 'deliveryPrAdminSettings', settings });
    expect(f.controller.getState().error).toBeUndefined();
    expect(f.controller.getState().prAdministration?.settings).toEqual(settings);
    await f.controller.handle({ type: 'deliverySelectSession' });
    expect(f.controller.getState().prAdministration).toBeUndefined();
    await f.controller.handle({ type: 'deliverySelectSession', featureId: 'session' });
    expect(f.controller.getState().prAdministration?.settings).toEqual(settings);
    await f.controller.dispose();
    const restored = new DevOpsController(f.options);
    await restored.initialize();
    expect(restored.getState().prAdministration?.settings).toEqual(settings);
  });
  it('shows an existing PR and performs neither generation nor creation', async () => {
    const f = await fixture();
    f.server.existing = true;
    await generate(f.controller);
    expect(f.controller.getState().existingPr?.id).toBe(27);
    expect(f.controller.getState().links).toContainEqual(
      expect.objectContaining({ featureId: 'session', pullRequestIds: [27] }),
    );
    expect(f.options.generatePr).not.toHaveBeenCalled();
    await preview(f.controller);
    expect(f.controller.getState().preview).toBeUndefined();
    expect(f.server.posts).toEqual([]);
  });
  it('rechecks duplicates after confirmation and reconciles an ambiguous creation response', async () => {
    const f = await fixture();
    await preview(f.controller);
    const fingerprint = f.controller.getState().preview!.fingerprint;
    f.options.confirm = async () => {
      f.server.existing = true;
      return true;
    };
    await f.controller.handle({ type: 'deliveryExecute', kind: 'pr', fingerprint });
    expect(f.server.posts).toEqual([]);
    expect(f.controller.getState().existingPr?.id).toBe(27);
    f.server.existing = false;
    f.server.loseResponse = true;
    f.options.confirm = async () => true;
    await preview(f.controller);
    await f.controller.handle({ type: 'deliveryExecute', kind: 'pr', fingerprint });
    expect(f.server.posts).toHaveLength(1);
    expect(f.server.posts[0]).toMatchObject({
      isDraft: false,
      reviewers: [{ id: reviewer.id, isRequired: true }],
      title: 'Titre relu',
    });
    expect(f.controller.getState().existingPr?.id).toBe(27);
    await preview(f.controller);
    expect(f.controller.getState().preview).toBeUndefined();
    expect(f.server.posts).toHaveLength(1);
  });
  it('rejects unpushed source commits before preview and searches real reviewer identities', async () => {
    const f = await fixture();
    f.server.head = 'c'.repeat(40);
    await preview(f.controller);
    expect(f.controller.getState().error).toContain('Pousse le commit');
    await f.controller.handle({ type: 'deliverySearchReviewers', query: 'Camille' });
    expect(f.controller.getState().reviewerResults).toEqual([{ ...reviewer, required: false }]);
  });
});

it('PR writer uses the chosen profile in prose-only mode, with no tools and strict JSON validation', async () => {
  const run = vi.fn(async (_input: RunInput) => ({
    content: '```json\n{"title":"Titre","description":"Description"}\n```',
    changedFiles: [],
    questions: [],
    model: 'chosen-model',
  }));
  const input = {
    feature: demoState.features[0],
    agent: { ...demoState.agents[0], model: 'chosen-model', tools: ['execute'] },
    adapter: { run } as unknown as AgentAdapter,
    settings: demoState.settings,
    workspacePath: '/session',
    devops: {
      authenticated: true,
      busy: false,
      notices: [],
      tickets: [],
      pullRequests: [],
      links: [],
      history: [],
    },
    diff: 'committed diff',
    target: 'main',
    instructions: 'Réglage du dépôt',
    signal: new AbortController().signal,
  };
  expect(await writePullRequest(input)).toMatchObject({
    title: 'Titre',
    description: 'Description',
    model: 'chosen-model',
  });
  expect(run.mock.calls[0][0]).toMatchObject({
    mode: 'discussion',
    agent: { tools: [], policy: 'read-only', model: 'chosen-model' },
    skills: [],
    settings: { hooks: [], mcpServers: [] },
  });
  expect(run.mock.calls[0][0].preparedPrompt).toContain('Réglage du dépôt');
  run.mockResolvedValueOnce({ content: 'not JSON', changedFiles: [], questions: [], model: '' });
  await expect(writePullRequest(input)).rejects.toThrow('brouillon est conservé');
});
