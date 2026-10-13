import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClientMessage, StudioState, CheckpointComparison } from '../src/shared/types';
import type { DevOpsConfig, DevOpsState } from '../src/shared/devops';

interface Api {
  getState(): StudioState | undefined;
  getUiReady(): boolean;
  getDevOpsState(): DevOpsState | undefined;
  dispatch(message: ClientMessage): Promise<void | CheckpointComparison>;
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
  assert.ok(api.getState()?.workflows.some((workflow) => workflow.id === 'quality-feature'));
  assert.ok(api.getState()?.agents.some((agent) => agent.id === 'fs-visual-tests'));
  assert.ok(api.getState()?.agents.some((agent) => agent.id === 'fs-counterexamples'));
  // macOS exposes /var via workspace URIs while the host stores canonical /private/var paths.
  const source = await realpath(vscode.workspace.workspaceFolders![0].uri.fsPath);
  const devopsConfig: DevOpsConfig = {
    organization: 'feature-studio-offline',
    project: 'Smoke local',
    repository: 'fixture',
    remote: 'origin',
  };
  const indexBeforeDelivery = await readFile(join(source, '.git', 'index'));
  await api.dispatch({ type: 'deliveryInspect' });
  const delivery = api.getDevOpsState();
  assert.equal(delivery?.error, undefined, 'Inspecting the fixture requires no remote or account');
  assert.equal(delivery?.snapshot?.branch, 'main');
  assert.match(delivery?.snapshot?.head ?? '', /^[0-9a-f]{40}$/);
  const humanChange = delivery?.snapshot?.files.find((entry) => entry.path === 'story.txt');
  assert.ok(humanChange, 'The real Git fixture exposes the human modification');
  assert.equal(humanChange.staged, 'M', 'The staged source change is preserved');
  assert.equal(humanChange.unstaged, 'M', 'The unstaged source change is also visible');
  await api.dispatch({ type: 'devopsConfigure', config: devopsConfig });
  assert.equal(api.getDevOpsState()?.error, undefined, 'Saving ADO config makes no API request');
  assert.deepEqual(api.getDevOpsState()?.config, devopsConfig);
  assert.equal(api.getDevOpsState()?.authenticated, false, 'No PAT is requested or installed');
  assert.deepEqual(api.getDevOpsState()?.tickets, []);
  assert.deepEqual(api.getDevOpsState()?.pullRequests, []);
  assert.deepEqual(
    await readFile(join(source, '.git', 'index')),
    indexBeforeDelivery,
    'Delivery inspection and offline configuration preserve the fixture index',
  );
  assert.equal(await readFile(join(source, 'story.txt'), 'utf8'), 'Human unstaged source\n');
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
    requestId: 'smoke-save',
    options: { scope: 'user', expectedRevision: null },
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
  assert.equal(state.agents.find((a) => a.id === 'smoke-agent')?.source, 'user');
  const userAgent = state.agents.find((agent) => agent.id === 'smoke-agent')!;
  assert.ok(userAgent.revision, 'The user profile has a checked source revision');
  const userAgentContent = await readFile(userAgent.path, 'utf8');
  await api.dispatch({
    type: 'saveAgent',
    requestId: 'smoke-save-workspace',
    options: {
      scope: 'workspace',
      expectedRevision: null,
      sourceScope: 'user',
      sourceRevision: userAgent.revision,
    },
    agent: {
      id: 'smoke-agent',
      name: 'Smoke project',
      description: 'Project fixture override',
      instructions: 'Read this project only.',
      tools: ['read'],
      skills: [],
      nickname: 'Capitaine Projet',
      avatar: 'captain',
    },
  });
  const projectAgent = api.getState()!.agents.find((agent) => agent.id === 'smoke-agent')!;
  assert.equal(projectAgent.source, 'workspace', 'Project scope has priority over the user copy');
  assert.equal(projectAgent.nickname, 'Capitaine Projet');
  assert.equal(projectAgent.path, join(source, '.github', 'agents', 'smoke-agent.agent.md'));
  assert.equal(
    projectAgent.versions?.find((version) => version.source === 'user')?.nickname,
    'Capitaine Test',
    'The hidden user version remains available',
  );
  assert.equal(await readFile(userAgent.path, 'utf8'), userAgentContent);
  const projectAgentContent = await readFile(projectAgent.path, 'utf8');

  await api.dispatch({ type: 'installKit' });
  assert.ok(api.getState()!.agents.length >= 9);
  const sourceIndex = await readFile(join(source, '.git', 'index'));
  assert.equal(api.getState()!.workspace.canIsolate, true);
  await api.dispatch({
    type: 'createFeature',
    title: 'Git isolated smoke',
    description: 'No AI calls',
    workflowId: 'single',
    isolated: true,
  });
  const isolated = api.getState()!.features.at(-1)!;
  assert.ok(isolated.worktree);
  const file = join(isolated.worktree.path, 'story.txt');
  assert.equal(await readFile(file, 'utf8'), 'Committed feature context\n');
  assert.equal(await readFile(join(source, 'story.txt'), 'utf8'), 'Human unstaged source\n');
  assert.deepEqual(await readFile(join(source, '.git', 'index')), sourceIndex);
  await api.dispatch({ type: 'installQualityKit', featureId: isolated.id });
  const qualityReporter = join(
    isolated.worktree.path,
    '.feature-studio',
    'quality-kit',
    'playwright-reporter.cjs',
  );
  const reporterContent = await readFile(qualityReporter, 'utf8');
  assert.ok(reporterContent.includes('FEATURE_STUDIO_QUALITY_REPORT'));
  assert.ok(reporterContent.includes('FEATURE_STUDIO_QUALITY_NONCE'));
  await api.dispatch({ type: 'installQualityKit', featureId: isolated.id });
  assert.equal(
    await readFile(qualityReporter, 'utf8'),
    reporterContent,
    'Explicit repeated installation preserves the installed reporter',
  );
  const visualProfile = api.getState()!.agents.find((agent) => agent.id === 'fs-visual-tests');
  const counterexampleProfile = api
    .getState()!
    .agents.find((agent) => agent.id === 'fs-counterexamples');
  assert.ok(visualProfile, 'The visual-test profile is available after explicit kit installation');
  assert.ok(counterexampleProfile, 'The independent counterexample profile is available');
  assert.ok(visualProfile.tools.includes('execute'));
  assert.ok(counterexampleProfile.tools.includes('execute'));
  assert.notEqual(visualProfile.id, counterexampleProfile.id, 'The quality roles remain distinct');
  const qualityWorkflow = api
    .getState()!
    .workflows.find((workflow) => workflow.id === 'quality-feature')!;
  assert.equal(
    qualityWorkflow.steps.find((step) => step.id === 'visual')?.agentId,
    visualProfile.id,
  );
  assert.equal(
    qualityWorkflow.steps.find((step) => step.id === 'counterexamples')?.agentId,
    counterexampleProfile.id,
  );
  assert.deepEqual(await readFile(join(source, '.git', 'index')), sourceIndex);
  await api.dispatch({ type: 'createCheckpoint', featureId: isolated.id, label: 'Before edit' });
  const point = api.getState()!.features.find((f) => f.id === isolated.id)!.checkpoints![0];
  await writeFile(file, 'Feature workspace change\n');
  await writeFile(join(isolated.worktree.path, 'binary.bin'), Buffer.from([0xff, 0xfd]));
  const comparison = (await api.dispatch({
    type: 'compareCheckpoint',
    requestId: 'smoke-git',
    featureId: isolated.id,
    checkpointId: point.id,
  })) as CheckpointComparison;
  assert.ok(comparison.files.some((change) => change.path === 'story.txt'));
  await api.dispatch({ type: 'openFile', featureId: isolated.id, path: 'story.txt' });
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file);
  const document = vscode.window.activeTextEditor!.document;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(0, 0), 'Unsaved human buffer\n');
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.ok(document.isDirty);
  const restore: ClientMessage = {
    type: 'restoreCheckpoint',
    featureId: isolated.id,
    checkpointId: point.id,
    paths: ['story.txt'],
    expectedFingerprint: comparison.fingerprint,
  };
  await assert.rejects(api.dispatch(restore), /non enregistrées/);
  assert.equal(await readFile(file, 'utf8'), 'Feature workspace change\n');
  await vscode.commands.executeCommand('workbench.action.files.revert');
  assert.ok(!document.isDirty);
  await api.dispatch({
    type: 'openCheckpointDiff',
    featureId: isolated.id,
    checkpointId: point.id,
    path: 'story.txt',
  });
  const diffTexts = vscode.workspace.textDocuments
    .filter((doc) => doc.uri.scheme === 'feature-studio-diff')
    .map((doc) => doc.getText());
  assert.ok(diffTexts.includes('Committed feature context\n'));
  assert.ok(diffTexts.includes('Feature workspace change\n'));
  await api.dispatch({
    type: 'openCheckpointDiff',
    featureId: isolated.id,
    checkpointId: point.id,
    path: 'binary.bin',
  });
  assert.ok(
    vscode.workspace.textDocuments.some(
      (doc) =>
        doc.uri.scheme === 'feature-studio-diff' &&
        doc.getText().startsWith('[Fichier binaire · 2 octets · SHA-256 '),
    ),
  );
  await api.dispatch(restore);
  assert.equal(await readFile(file, 'utf8'), 'Committed feature context\n');
  const recovery = api
    .getState()!
    .features.find((f) => f.id === isolated.id)!
    .checkpoints!.at(-1)!;
  assert.equal(recovery.kind, 'recovery');
  await assert.rejects(api.dispatch(restore), /changé/);
  const recoverComparison = (await api.dispatch({
    type: 'compareCheckpoint',
    requestId: 'smoke-recovery',
    featureId: isolated.id,
    checkpointId: recovery.id,
  })) as CheckpointComparison;
  await api.dispatch({
    ...restore,
    checkpointId: recovery.id,
    expectedFingerprint: recoverComparison.fingerprint,
  });
  assert.equal(await readFile(file, 'utf8'), 'Feature workspace change\n');
  assert.equal(await readFile(join(source, 'story.txt'), 'utf8'), 'Human unstaged source\n');
  assert.deepEqual(await readFile(join(source, '.git', 'index')), sourceIndex);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('featureStudio.open');
  assert.equal(
    api.getState()?.features.find((f) => f.id === isolated.id)?.worktree?.path,
    isolated.worktree.path,
  );
  assert.equal(api.getState()?.features.find((f) => f.id === isolated.id)?.checkpoints?.length, 3);
  assert.deepEqual(
    api.getDevOpsState()?.config,
    devopsConfig,
    'ADO config survives cockpit reload',
  );
  assert.equal(api.getDevOpsState()?.authenticated, false);
  const reloadedAgent = api.getState()?.agents.find((agent) => agent.id === 'smoke-agent');
  assert.equal(reloadedAgent?.source, 'workspace');
  assert.equal(reloadedAgent?.nickname, 'Capitaine Projet');
  assert.equal(
    reloadedAgent?.versions?.find((version) => version.source === 'user')?.nickname,
    'Capitaine Test',
    'Both profile scopes survive reload with project priority',
  );
  assert.equal(await readFile(userAgent.path, 'utf8'), userAgentContent);
  assert.equal(await readFile(projectAgent.path, 'utf8'), projectAgentContent);
  assert.equal(await readFile(qualityReporter, 'utf8'), reporterContent);

  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await new Promise((resolve) => setTimeout(resolve, 200));
  await vscode.commands.executeCommand('featureStudio.open');
  assert.equal(
    api.getState()?.features.find((f) => f.id === feature.id)?.title,
    'Smoke extension host',
  );
  console.log(
    'PASS: activation, panel/CSP, manual context/MCP/secret settings, budget/autopilot/memory, avatars/kit, user/project profile priority and persistence, offline ADO config/reopen, real Git delivery inspection, explicit quality reporter installation, isolated Git worktree, source/index preservation, checkpoints/diff, dirty-buffer refusal, selected restore, stale comparison refusal, recovery restore and v3 close/reopen. No paid prompt.',
  );
}
