import type { Attempt, Feature } from '../src/shared/types';
import { demoState } from '../webview/demo';

export const statsProjects = [
  { id: 'lms', name: 'LMS', path: '/dev/lms' },
  { id: 'lxp', name: 'LXP', path: '/dev/lxp' },
];
export function statsAttempt(id: string, changes: Partial<Attempt> = {}): Attempt {
  return {
    id,
    startedAt: '2026-10-20T08:00:00Z',
    finishedAt: '2026-10-20T08:01:00Z',
    status: 'approved',
    feedback: '',
    questions: [],
    answers: {},
    logs: [],
    changedFiles: [],
    model: 'requested',
    profileSnapshot: {
      agentId: 'developer',
      policy: 'read-only',
      skillIds: [],
      modelOverride: false,
    },
    agentName: 'Développeur',
    ...changes,
  };
}
export function statsFeature(
  id: string,
  attempts: Attempt[] = [],
  changes: Partial<Feature> = {},
): Feature {
  return {
    id,
    title: `Session ${id}`,
    description: '',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-20T08:01:00Z',
    branch: 'feature/demo',
    status: 'attention',
    activeStepId: 'work',
    workflowId: 'dev',
    workflowName: 'Développement',
    projects: [{ ...statsProjects[0], branch: 'develop' }],
    steps: [
      {
        id: 'work',
        name: 'Travail',
        description: '',
        agentId: 'edited-agent',
        policy: 'read-only',
        skills: [],
        maxAttempts: 10,
        artifact: 'REPORT.md',
        dependsOn: [],
        status: attempts.at(-1)?.status ?? 'pending',
        attempts,
      },
    ],
    ...changes,
  };
}
export function statisticsState() {
  const state = structuredClone(demoState);
  state.projectCatalog = {
    projects: statsProjects,
    selectedProjectIds: ['lms'],
    activeProjectId: 'lms',
    dedicated: true,
    windows: false,
  };
  state.features = [
    statsFeature('alpha', [
      statsAttempt('a', {
        startedAt: '2026-10-02T08:00:00Z',
        finishedAt: '2026-10-02T08:01:00Z',
        usage: { source: 'measured', model: 'sol', cost: 0, unit: 'nano-AIU' },
        promptCharacters: 1000,
      }),
      statsAttempt('b', {
        status: 'failed',
        usage: { source: 'measured', model: 'luna', cost: 2000000000, unit: 'nano-AIU' },
        promptCharacters: 3000,
      }),
    ]),
    statsFeature(
      'beta',
      [
        statsAttempt('c', {
          startedAt: '2026-10-19T10:00:00Z',
          finishedAt: '2026-10-19T10:04:00Z',
          profileSnapshot: {
            agentId: 'reviewer',
            policy: 'read-only',
            skillIds: [],
            modelOverride: false,
          },
          agentName: 'Relecture',
          usage: {
            source: 'measured',
            model: 'sol',
            cost: 1500000000,
            unit: 'nano-AIU',
            incompleteCost: true,
          },
          artifact: { name: 'Report', content: 'x'.repeat(100), updatedAt: '2026-10-19T10:04:00Z' },
        }),
      ],
      {
        status: 'completed',
        archived: true,
        projects: statsProjects.map((project) => ({ ...project, branch: 'develop' })),
        finalValidation: { id: 'v', at: '2026-10-19T11:00:00Z', stateKey: 'key', author: 'human' },
      },
    ),
    statsFeature('draft', [], {
      status: 'draft',
      createdAt: '2026-09-01T08:00:00Z',
      projects: [{ ...statsProjects[1], branch: 'develop' }],
    }),
    statsFeature('legacy', [], {
      status: 'completed',
      createdAt: 'invalid',
      projects: [],
      steps: [],
    }),
  ];
  return state;
}
