import { AzureDevOps, type SecretStore } from '../../src/host/AzureDevOps';
import type { DevOpsTestTarget } from '../../src/shared/devopsKit';
export const target: DevOpsTestTarget = {
  buildId: 123,
  pipelineId: 42,
  commit: 'a'.repeat(40),
  branch: 'refs/heads/test/devops',
  environment: 'Projet isolé, connexion de test et données fictives',
  isolationConfirmed: true,
  expectedStages: ['Validate'],
  expectedArtifacts: ['report'],
  requireTestResults: true,
};
export function mockDevOps() {
  const repository = {
    id: 'repo-id',
    name: 'Repo',
    type: 'TfsGit',
    defaultBranch: 'refs/heads/main',
  };
  const pipeline = {
    id: 42,
    name: 'CI test',
    revision: 3,
    repository,
    process: { type: 2, yamlFilename: 'pipelines/test.yml' },
    variables: {
      apiKey: { value: 'SHOULD_NOT_LEAVE_API', isSecret: true },
      ordinary: { value: 'ALSO_PRIVATE', isSecret: false },
    },
    triggers: [{ triggerType: 'continuousIntegration', branchFilters: ['+refs/heads/test/*'] }],
  };
  const run = {
    id: 123,
    status: 'completed',
    result: 'succeeded',
    sourceVersion: target.commit,
    sourceBranch: target.branch,
    finishTime: '2026-10-13T10:00:00Z',
    repository,
    definition: { id: 42, revision: 3 },
  };
  const timeline = {
    records: [
      {
        id: 'stage-1',
        identifier: 'Validate',
        name: 'Validation',
        type: 'Stage',
        state: 'completed',
        result: 'succeeded',
        attempt: 1,
      },
    ],
  };
  const artifacts = {
    value: [
      {
        id: 1,
        name: 'report',
        resource: {
          type: 'PipelineArtifact',
          downloadUrl: 'https://secret.invalid/?sig=SHOULD_NOT_LEAVE_API',
        },
      },
    ],
  };
  const tests = {
    value: [
      {
        id: 9,
        name: 'Tests',
        state: 'Completed',
        build: { id: '123' },
        totalTests: 2,
        passedTests: 2,
        completedDate: '2026-10-13T10:00:00Z',
      },
    ],
  };
  const calls: { url: URL; init?: RequestInit }[] = [];
  const state = {
    repository,
    pipeline,
    run,
    timeline,
    artifacts,
    tests,
    continuation: undefined as string | undefined,
    status: 200,
  };
  const secrets: SecretStore = {
    get: async () => 'PRIVATE_PAT',
    store: async () => {
      throw new Error('Unexpected mutation');
    },
    delete: async () => {
      throw new Error('Unexpected mutation');
    },
  };
  const api = new AzureDevOps(
    { organization: 'org', project: 'Project', repository: 'Repo', remote: 'origin' },
    secrets,
    async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({ url: parsed, init });
      const route = parsed.pathname.split('/_apis/')[1];
      let data: unknown;
      switch (route) {
        case 'git/repositories/Repo':
          data = state.repository;
          break;
        case 'build/definitions':
          data = { value: [state.pipeline] };
          break;
        case 'build/definitions/42':
          data = state.pipeline;
          break;
        case 'build/builds':
          data = { value: [state.run] };
          break;
        case 'build/builds/123':
          data = state.run;
          break;
        case 'build/builds/123/timeline':
          data = state.timeline;
          break;
        case 'build/builds/123/artifacts':
          data = state.artifacts;
          break;
        case 'test/runs':
          data = state.tests;
          break;
        default:
          throw new Error('Unexpected route: ' + route);
      }
      return new Response(JSON.stringify(data), {
        status: state.status,
        headers: {
          'Content-Type': 'application/json',
          ...(state.continuation ? { 'x-ms-continuationtoken': state.continuation } : {}),
        },
      });
    },
  );
  return { inspector: api.inspector(), api, state, calls };
}
