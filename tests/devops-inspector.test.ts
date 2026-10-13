import { describe, expect, it } from 'vitest';
import { devOpsQuerySchema, devOpsTestTargetSchema } from '../src/core/devopsKitSchemas';
import { mockDevOps, target } from './fixtures/devops-kit';

describe('read-only DevOps collection and verification', () => {
  it('collects scoped source metadata via GET without secret values, arbitrary URLs or downloads', async () => {
    const f = mockDevOps();
    const pipeline = await f.inspector.inspect({ kind: 'pipeline', pipelineId: 42, revision: 3 });
    expect(pipeline.data).toMatchObject({
      yamlFilename: 'pipelines/test.yml',
      revision: 3,
      variables: [
        { name: 'apiKey', isSecret: true, value: '<non collectée>' },
        { name: 'ordinary', isSecret: false, value: '<non collectée>' },
      ],
    });
    expect(pipeline.sourceUrl).toContain('revision=3');
    const result = await f.inspector.verify(target);
    expect(result.status).toBe('passed');
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(JSON.stringify([pipeline, result])).not.toMatch(
      /SHOULD_NOT_LEAVE_API|ALSO_PRIVATE|PRIVATE_PAT|downloadUrl/,
    );
    expect(
      f.calls.every(
        (call) =>
          call.url.origin === 'https://dev.azure.com' &&
          call.init?.method === 'GET' &&
          call.init.body === undefined &&
          call.init.redirect === 'error',
      ),
    ).toBe(true);
    expect(
      f.calls.some((call) => call.url.searchParams.get('buildUri') === 'vstfs:///Build/Build/123'),
    ).toBe(true);
    expect(
      devOpsQuerySchema.safeParse({ kind: 'build', buildId: 123, url: 'https://foreign.invalid' })
        .success,
    ).toBe(false);
    expect(devOpsQuerySchema.safeParse({ kind: 'queue', pipelineId: 42 }).success).toBe(false);
  });
  it('keeps pagination explicit and rejects cross-repository and cross-build responses', async () => {
    const f = mockDevOps();
    f.state.continuation = 'page-2';
    expect(await f.inspector.inspect({ kind: 'pipelines' })).toMatchObject({
      truncated: true,
      continuationToken: 'page-2',
    });
    await f.inspector.inspect({ kind: 'builds', pipelineId: 42, continuationToken: 'opaque&next' });
    expect(f.calls.at(-1)?.url.searchParams.get('continuationToken')).toBe('opaque&next');
    f.state.run.repository = { ...f.state.repository, id: 'another-repo' };
    await expect(f.inspector.inspect({ kind: 'timeline', buildId: 123 })).rejects.toThrow(/dépôt/);
    f.state.run.repository = f.state.repository;
    f.state.tests.value[0].build.id = '777';
    await expect(f.inspector.inspect({ kind: 'test-runs', buildId: 123 })).rejects.toThrow(
      /autre exécution/,
    );
  });
  it.each(['sourceVersion', 'sourceBranch', 'definition'] as const)(
    'refuses a mismatch of %s before collecting unrelated evidence',
    async (field) => {
      const f = mockDevOps();
      if (field === 'definition') f.state.run.definition.id = 999;
      else f.state.run[field] = 'wrong';
      const result = await f.inspector.verify(target);
      expect(result.status).toBe('failed');
      expect(result.observations.map((item) => item.kind)).toEqual(['build']);
    },
  );
  it.each(['skipped', 'failed', 'succeededWithIssues', 'canceled'])(
    'does not accept a green build when the expected stage is %s',
    async (result) => {
      const f = mockDevOps();
      f.state.timeline.records[0].result = result;
      expect((await f.inspector.verify(target)).status).toBe('failed');
    },
  );
  it('does not let an older successful stage retry mask the latest failure', async () => {
    const f = mockDevOps();
    f.state.timeline.records.push({
      ...f.state.timeline.records[0],
      id: 'retry',
      attempt: 2,
      result: 'failed',
    });
    expect((await f.inspector.verify(target)).status).toBe('failed');
  });
  it('requires complete, nonempty passing tests when requested and verifies artifact names', async () => {
    const f = mockDevOps();
    f.state.tests.value[0].totalTests = 3;
    expect((await f.inspector.verify(target)).status).toBe('failed');
    f.state.tests.value = [];
    expect((await f.inspector.verify(target)).status).toBe('failed');
    expect((await f.inspector.verify({ ...target, requireTestResults: false })).status).toBe(
      'passed',
    );
    f.state.artifacts.value = [];
    expect((await f.inspector.verify({ ...target, requireTestResults: false })).status).toBe(
      'failed',
    );
  });
  it('distinguishes incomplete responses from success and bounds large timeline metadata', async () => {
    const f = mockDevOps();
    f.state.continuation = 'more';
    expect((await f.inspector.verify(target)).status).toBe('incomplete');
    f.state.continuation = undefined;
    f.state.timeline.records = Array.from({ length: 2000 }, (_, i) => ({
      ...f.state.timeline.records[0],
      id: String(i),
      name: 'X'.repeat(500),
    }));
    const response = await f.inspector.inspect({ kind: 'timeline', buildId: 123 });
    expect(response.truncated).toBe(true);
    expect(JSON.stringify(response.data).length).toBeLessThanOrEqual(48000);
  });
  it('requires human isolation confirmation and does not interpret missing rights as no tests', async () => {
    const f = mockDevOps();
    await expect(f.inspector.verify({ ...target, isolationConfirmed: false })).rejects.toThrow(
      /Confirme/,
    );
    expect(f.calls).toHaveLength(0);
    f.state.status = 403;
    await expect(f.inspector.verify(target)).rejects.toThrow(/refuse l’accès/);
    expect(devOpsTestTargetSchema.safeParse({ ...target, expectedStages: [] }).success).toBe(false);
    expect(devOpsTestTargetSchema.safeParse({ ...target, commit: 'abc123' }).success).toBe(false);
  });
});
