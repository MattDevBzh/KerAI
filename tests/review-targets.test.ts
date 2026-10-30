import { describe, expect, it, vi } from 'vitest';
import { PullRequestReview } from '../src/host/PullRequestReview';
import { reviewTargetSchema } from '../src/core/reviewSchemas';
import { parseMessage } from '../src/host/messages';
import { promptSections } from '../src/core/context';
import type { RunInput } from '../src/shared/types';
import { demoState } from '../webview/demo';
const source = 'a'.repeat(40),
  base = 'b'.repeat(40),
  merge = 'c'.repeat(40);
const metadata = {
  title: 'Fix',
  body: 'Context',
  head: { sha: source, repo: { full_name: 'fork/repo' } },
  base: { sha: base, repo: { full_name: 'owner/repo' } },
};
const signal = () => new AbortController().signal;

describe('review targets', () => {
  it('validates message boundaries and rejects credentials, other hosts and identical branches', () => {
    expect(
      parseMessage({
        type: 'createFeature',
        title: 'Review',
        description: '',
        reviewTarget: { kind: 'working-tree' },
      }),
    ).toMatchObject({ reviewTarget: { kind: 'working-tree' } });
    for (const url of [
      'http://github.com/a/b/pull/1',
      'https://token@github.com/a/b/pull/1',
      'https://evil.test/a/b/pull/1',
      'https://github.com/a/b/pull/1?token=secret',
    ])
      expect(reviewTargetSchema.safeParse({ kind: 'pull-request', url }).success).toBe(false);
    expect(
      reviewTargetSchema.safeParse({
        kind: 'branches',
        source: 'refs/heads/main',
        destination: 'refs/heads/main',
      }).success,
    ).toBe(false);
    expect(
      reviewTargetSchema.safeParse({
        kind: 'pull-request',
        url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/10',
      }).success,
    ).toBe(true);
  });
  it('keeps the target in the prompt even when optional context is empty or disabled', () => {
    const feature = structuredClone(demoState.features[0]);
    feature.reviewTarget = {
      kind: 'branches',
      source: 'refs/heads/feature',
      destination: 'refs/heads/main',
    };
    const input = {
      feature,
      step: feature.steps[0],
      agent: demoState.agents[0],
      attempt: { roastLevel: 0, answers: {} },
      skills: [],
      settings: demoState.settings,
      launch: {
        contextMode: 'empty',
        contextBlocks: { 'review-target': { enabled: false, content: 'wrong' } },
        memoryIds: [],
        mcpServerIds: [],
        initialContext: '',
        useProjectMemory: false,
      },
    } as unknown as RunInput;
    const target = promptSections(input).find((section) => section.id === 'review-target');
    expect(target).toMatchObject({ enabled: true, editable: false });
    expect(target?.content).toContain('refs/heads/feature');
  });
});

describe('PR read sources', () => {
  it('reads fork contents at the advertised commit, paginates files, excludes sensitive files and detects drift', async () => {
    let moved = false;
    const github = vi.fn(async (route: string) => {
      if (route.endsWith('/pulls/1'))
        return moved ? { ...metadata, head: { ...metadata.head, sha: 'd'.repeat(40) } } : metadata;
      if (route.includes('/compare/')) return { merge_base_commit: { sha: merge } };
      if (route.includes('/files?'))
        return [
          { filename: 'src/a.ts', status: 'modified', patch: '+new' },
          { filename: '.env', patch: '+SECRET' },
        ];
      if (route.includes('/contents/'))
        return {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('new\n').toString('base64'),
        };
      throw new Error(route);
    });
    const reader = new PullRequestReview(
      'https://github.com/owner/repo/pull/1',
      '/tmp',
      signal(),
      undefined,
      github,
    );
    expect(await reader.read({ operation: 'overview' })).toMatchObject({
      source,
      base,
      mergeBase: merge,
    });
    expect(await reader.read({ operation: 'changes' })).toMatchObject({
      files: [{ path: 'src/a.ts' }, { excluded: true }],
    });
    expect(await reader.read({ operation: 'read', path: 'src/a.ts' })).toMatchObject({
      commit: source,
      content: 'new\n',
    });
    expect(github).toHaveBeenCalledWith(`repos/fork/repo/contents/src/a.ts?ref=${source}`);
    await expect(reader.read({ operation: 'read', path: '.env' })).rejects.toThrow('exclu');
    moved = true;
    await expect(reader.read({ operation: 'changes' })).rejects.toThrow('changé');
  });
  it('uses the Azure merge base and requests exact commit contents, with explicit pagination', async () => {
    const azure = vi.fn(async (route: string, query: Record<string, string>) => {
      if (route.includes('/pullrequests/'))
        return {
          data: {
            title: 'Azure PR',
            lastMergeSourceCommit: { commitId: source },
            lastMergeTargetCommit: { commitId: base },
          },
        };
      if (route.endsWith('/items')) return { data: { content: 'old\n' } };
      if (query.diffCommonCommit) return { data: { commonCommit: merge } };
      return {
        data: {
          changes: [{ item: { path: '/src/a.ts', gitObjectType: 'blob' }, changeType: 'edit' }],
          allChangesIncluded: false,
        },
      };
    });
    const reader = new PullRequestReview(
      'https://dev.azure.com/org/project/_git/repo/pullrequest/1',
      '/tmp',
      signal(),
      azure,
    );
    expect(await reader.read({ operation: 'changes', page: 2 })).toMatchObject({
      nextPage: 3,
      base: merge,
    });
    expect(await reader.read({ operation: 'read', side: 'base', path: '/src/a.ts' })).toMatchObject(
      { commit: merge, content: 'old\n' },
    );
    expect(azure).toHaveBeenCalledWith(
      'git/repositories/repo/items',
      expect.objectContaining({ 'versionDescriptor.version': merge }),
    );
  });
});
