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
  });
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
    'PASS: activation, panel, defaults, create, configure, avatar persistence, kit install, close/reopen recovery. No paid prompt.',
  );
}
