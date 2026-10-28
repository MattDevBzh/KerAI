import { describe, expect, it } from 'vitest';
import {
  applicationReadiness,
  initialSessionStarter,
  launchReadiness,
  restrictedNativeTools,
} from '../webview/launchReadiness';
import { demoState } from '../webview/demo';
import type { RunLaunchOptions } from '../src/shared/types';

const launch: RunLaunchOptions = {
  initialContext: '',
  mcpServerIds: [],
  memoryIds: [],
  useProjectMemory: false,
};
function fixture() {
  const state = structuredClone(demoState);
  state.runtime = {
    state: 'ready',
    models: [],
    native: {
      available: true,
      tools: ['view', 'glob', 'rg', 'edit', 'bash', 'ask_user'],
      permissionModes: ['manual'],
    },
  };
  state.workspace.trusted = true;
  const feature = state.features[0];
  const step = feature.steps[0];
  step.attempts = [];
  step.maxAttempts = 0;
  state.features.forEach((item) =>
    item.steps.forEach((candidate) => {
      candidate.status = 'pending';
    }),
  );
  return { state, feature, step };
}
describe('launch readiness', () => {
  it('keeps a useful default after the first session and preserves an explicit custom choice', () => {
    const { state } = fixture();
    expect(state.features.length).toBeGreaterThan(0);
    expect(initialSessionStarter(state)).toBe('feature');
    expect(initialSessionStarter(state, 'custom')).toBe('custom');
    expect(initialSessionStarter(state, 'code-review')).toBe('code-review');
    state.workflows = state.workflows.filter((workflow) => workflow.id !== 'code-review');
    expect(initialSessionStarter(state, 'code-review')).toBe('feature');
  });
  it('explains unavailable permission modes and trust without making them launchable', () => {
    const { state, feature, step } = fixture();
    feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
    expect(launchReadiness(state, feature, step, launch)).toEqual([]);
    state.workspace.trusted = false;
    const blockers = launchReadiness(state, feature, step, {
      ...launch,
      permissionMode: 'allow-all',
    });
    expect(blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'manageWorkspaceTrust' }),
        expect.objectContaining({
          message: expect.stringContaining('permissions sélectionné est indisponible'),
        }),
      ]),
    );
  });
  it('identifies an incompatible navigation agent before preview', () => {
    const { state, feature, step } = fixture();
    state.agents.find((agent) => agent.id === step.agentId)!.tools = ['read'];
    expect(
      launchReadiness(state, feature, step, {
        ...launch,
        navigation: {
          applicationId: 'app',
          intent: 'reproduce',
          allowInteractions: false,
          parameters: {},
        },
      }),
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('ne possède pas la capacité navigation'),
      }),
    ]);
  });
  it('shows only the restricted native tools for documentation and the owner Navigator', () => {
    const { state, feature, step } = fixture();
    feature.execution = { mode: 'copilot-native', permissionMode: 'manual' };
    const agent = state.agents.find((agent) => agent.id === step.agentId)!;
    agent.tools = ['documentation'];
    expect(restrictedNativeTools(state, feature, step, launch)).toMatchObject({
      readOnly: true,
      tools: ['view', 'glob', 'rg', 'ask_user'],
    });
    agent.tools = ['navigation'];
    state.navigation = {
      navigationVersion: 1,
      applications: [
        {
          id: 'app',
          name: 'App',
          origin: 'https://intranet.example',
          projectIds: ['p'],
          allowedOrigins: [],
          ownerNavigatorId: agent.id,
          interactionPolicy: 'confirm',
          createdAt: '',
          updatedAt: '',
        },
      ],
      journeys: [],
      runs: [],
      contributions: [],
    };
    expect(
      restrictedNativeTools(state, feature, step, {
        ...launch,
        navigation: {
          applicationId: 'app',
          intent: 'reproduce',
          allowInteractions: false,
          parameters: {},
        },
      }),
    ).toMatchObject({ readOnly: true, owner: true, tools: ['view', 'glob', 'rg', 'ask_user'] });
  });
  it('diagnoses active-project and owner mismatches while accepting arbitrary HTTP(S) domains and paths', () => {
    const { state } = fixture();
    state.projectCatalog = {
      projects: [{ id: 'active', path: state.workspace.path, name: 'Active' }],
      selectedProjectIds: ['active'],
      activeProjectId: 'active',
      dedicated: false,
      windows: false,
    };
    const app = {
      id: 'app',
      name: 'App',
      origin: 'https://private.example:8443',
      startUrl: 'https://private.example:8443/espace',
      projectIds: ['other'],
      allowedOrigins: [],
      interactionPolicy: 'confirm' as const,
      createdAt: '',
      updatedAt: '',
    };
    expect(applicationReadiness(state, app)).toEqual([
      expect.stringContaining('projet actif'),
      expect.stringContaining('capacité navigation'),
    ]);
  });
});
