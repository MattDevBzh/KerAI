import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { ClientMessage, StudioState } from '../src/shared/types';

interface Api {
  getState(): StudioState | undefined;
  getUiReady(): boolean;
  dispatch(message: ClientMessage): Promise<void>;
}
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<Api>('MattDevBzh.feature-studio');
  assert.ok(extension, 'Extension found in the real VS Code extension host');
  const api = await extension.activate();
  await vscode.commands.executeCommand('featureStudio.open');
  for (let retry = 0; retry < 100 && !api.getUiReady(); retry++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    api.getUiReady(),
    'Webview React actually loaded and sent its ready message through the CSP',
  );
  assert.equal(api.getState()?.workflows.length, 3);
  assert.equal(api.getState()?.agents.length, 5);
  if (process.env.FEATURE_STUDIO_TEST_CLI_PATH) {
    await vscode.workspace
      .getConfiguration('featureStudio')
      .update(
        'cliPath',
        process.env.FEATURE_STUDIO_TEST_CLI_PATH,
        vscode.ConfigurationTarget.Global,
      );
    await api.dispatch({ type: 'checkRuntime' });
    assert.equal(api.getState()?.runtime.state, 'ready', api.getState()?.runtime.error);
  }
  await api.dispatch({
    type: 'createFeature',
    title: 'Smoke extension host',
    description: 'No Copilot prompt is sent.',
    workflowId: 'feature',
  });
  let state = api.getState()!;
  const feature = state.features.at(-1)!;
  assert.equal(feature.steps.length, 5);
  await api.dispatch({
    type: 'configureStep',
    featureId: feature.id,
    stepId: feature.steps[0].id,
    agentId: 'fs-specs',
    skills: [],
    initialContext: 'US-208 : contexte initial saisi à la main.',
    askBeforeRun: true,
  });
  assert.equal(
    api.getState()!.features.at(-1)!.steps[0].initialContext,
    'US-208 : contexte initial saisi à la main.',
  );
  await api.dispatch({
    type: 'previewRun',
    requestId: 'smoke-preview',
    featureId: feature.id,
    stepId: feature.steps[0].id,
    launch: {
      initialContext: 'US-209 : aperçu sans modèle.',
      mcpServerIds: [],
      memoryIds: [],
      useProjectMemory: false,
    },
  });
  await assert.rejects(
    api.dispatch({ type: 'runStep', featureId: feature.id, stepId: feature.steps[0].id }),
    /contexte/,
  );
  await api.dispatch({
    type: 'saveBudget',
    featureId: feature.id,
    budget: { maxRuns: 5, maxPromptChars: 50000, modelProfile: 'current' },
  });
  await api.dispatch({
    type: 'saveAutopilot',
    featureId: feature.id,
    config: { checkpoints: ['plan', 'review'], maxRuns: 5, maxCorrectionCycles: 0, stepInputs: {} },
  });
  await api.dispatch({
    type: 'saveMemory',
    entry: {
      id: 'smoke-convention',
      title: 'Convention',
      content: 'Use the existing store.',
      category: 'convention',
      enabled: true,
      agentIds: [],
      updatedAt: '2026-10-13',
    },
  });
  await api.dispatch({
    type: 'saveSettings',
    settings: {
      ...api.getState()!.settings,
      mcpServers: [
        {
          id: 'smoke-mcp',
          name: 'MCP saved without executing it',
          transport: 'stdio',
          command: 'node',
          args: ['fixture.mjs'],
          tools: ['read_story'],
          envKeys: ['SMOKE_KEY'],
          headers: {},
          enabled: false,
          autoApproveReadOnly: false,
        },
      ],
    },
  });
  await api.dispatch({
    type: 'setMcpSecret',
    serverId: 'smoke-mcp',
    key: 'SMOKE_KEY',
    value: 'isolated-smoke-secret',
  });
  assert.ok(!JSON.stringify(api.getState()).includes('isolated-smoke-secret'));
  await api.dispatch({ type: 'setMcpSecret', serverId: 'smoke-mcp', key: 'SMOKE_KEY', value: '' });
  assert.equal(api.getState()!.memory?.length, 1);
  assert.equal(api.getState()!.features.at(-1)!.autopilot?.status, 'idle');
  await api.dispatch({
    type: 'saveAgent',
    agent: {
      id: 'smoke-agent',
      name: 'Smoke',
      description: 'Local fixture',
      instructions: 'Read only.',
      tools: ['read'],
      skills: [],
      nickname: 'Capitaine Test',
      avatar: 'captain',
    },
  });
  state = api.getState()!;
  assert.equal(state.agents.find((a) => a.id === 'smoke-agent')?.nickname, 'Capitaine Test');
  await api.dispatch({ type: 'installKit' });
  assert.ok(api.getState()!.agents.length >= 9);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await new Promise((resolve) => setTimeout(resolve, 200));
  await vscode.commands.executeCommand('featureStudio.open');
  assert.equal(
    api.getState()?.features.find((f) => f.id === feature.id)?.title,
    'Smoke extension host',
  );
  console.log(
    'PASS: activation, panel/CSP, defaults, manual context preview, missing-preview refusal, MCP/secret settings, budget/autopilot/memory, avatars, kit, close/reopen recovery. No paid prompt.',
  );
}
