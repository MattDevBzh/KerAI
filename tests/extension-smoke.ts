import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClientMessage, StudioState, CheckpointComparison } from '../src/shared/types';
import type { DevOpsConfig, DevOpsState } from '../src/shared/devops';
import { THEME_IDS, type ThemeId } from '../src/shared/themes';
import { resolveAvatar } from '../src/shared/avatars';
import { featureStateKey } from '../src/shared/collaboration';

interface Api {
  getState(): StudioState | undefined;
  getUiReady(): boolean;
  getLauncherVisible(): boolean;
  getLauncherReady(): boolean;
  getTheme(): ThemeId;
  getDevOpsState(): DevOpsState | undefined;
  dispatch(message: ClientMessage): Promise<void | CheckpointComparison>;
}
async function smokeRun(): Promise<void> {
  const extension = vscode.extensions.getExtension<Api>('MattDevBzh.feature-studio');
  assert.ok(extension, 'Extension found in the real VS Code extension host');
  const contributions = extension.packageJSON.contributes;
  assert.ok(
    contributions.commands.some(
      (command: { command: string }) => command.command === 'featureStudio.analyzeSession',
    ),
  );
  const container = contributions.viewsContainers.activitybar.find(
    (entry: { id: string }) => entry.id === 'featureStudio',
  );
  assert.equal(container?.title, 'Feature Studio');
  assert.equal(container?.icon, 'resources/team.svg');
  assert.ok(await readFile(join(extension.extensionPath, container.icon)));
  assert.ok(await readFile(join(extension.extensionPath, 'resources/icon.png')));
  const shortcutIcon = await readFile(
    join(extension.extensionPath, 'resources/feature-studio.ico'),
  );
  assert.equal(shortcutIcon.readUInt16LE(0), 0);
  assert.equal(shortcutIcon.readUInt16LE(2), 1);
  assert.equal(shortcutIcon.readUInt16LE(4), 7);
  assert.ok(
    contributions.views.featureStudio.some(
      (entry: { id: string; name: string; type: string }) =>
        entry.id === 'featureStudio.launcher' &&
        entry.name === 'Cockpit' &&
        entry.type === 'webview',
    ),
    'The package contributes the local cockpit welcome webview',
  );
  const welcomes = (contributions.viewsWelcome ?? []).filter(
    (entry: { view: string }) => entry.view === 'featureStudio.launcher',
  );
  assert.equal(welcomes.length, 0, 'The obsolete native welcome content is removed');
  await vscode.commands.executeCommand('featureStudio.launcher.focus');
  const api = await extension.activate();
  for (let retry = 0; retry < 100 && !api.getLauncherReady(); retry++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(api.getLauncherVisible(), 'The local launcher is rendered in the sidebar');
  assert.ok(
    api.getLauncherReady(),
    'The launcher script and local avatar actually loaded and sent ready through its nonce CSP',
  );
  assert.ok((await vscode.commands.getCommands(true)).includes('featureStudio.launcher.focus'));
  assert.equal(api.getState(), undefined, 'Showing the launcher never initializes the store');
  assert.equal(api.getDevOpsState(), undefined, 'Showing the launcher never initializes DevOps');
  assert.equal(api.getUiReady(), false, 'Showing the launcher never opens the cockpit webview');
  assert.equal(api.getTheme(), 'auto', 'The isolated user profile starts in automatic mode');
  for (const theme of THEME_IDS) {
    await api.dispatch({
      type: 'setTheme',
      theme,
      requestId: `smoke-theme-${theme}`,
    });
    const config = vscode.workspace
      .getConfiguration('featureStudio')
      .inspect<ThemeId>('appearance.theme');
    assert.equal(config?.globalValue, theme, 'Theme choice is saved to the isolated user profile');
    assert.equal(config?.workspaceValue, undefined, 'Theme choice creates no workspace setting');
    assert.equal(config?.workspaceFolderValue, undefined);
    assert.equal(api.getTheme(), theme);
    assert.equal(
      api.getState(),
      undefined,
      'Changing appearance never initializes the business store',
    );
  }
  await assert.rejects(
    api.dispatch({
      type: 'setTheme',
      theme: 'arbitrary',
      requestId: 'bad-theme',
    } as unknown as ClientMessage),
  );
  await assert.rejects(
    api.dispatch({
      type: 'setTheme',
      theme: 'papier-clair',
      requestId: 'bad-key',
      key: 'cliPath',
    } as unknown as ClientMessage),
  );
  assert.equal(api.getTheme(), 'halloween', 'Invalid requests preserve the recorded choice');
  await Promise.all([
    vscode.commands.executeCommand('featureStudio.open'),
    vscode.commands.executeCommand('featureStudio.open'),
  ]);
  for (let retry = 0; retry < 100 && !api.getUiReady(); retry++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    api.getUiReady(),
    'Webview React actually loaded and sent its ready message through the CSP',
  );
  assert.ok(api.getState()?.workflows.some((workflow) => workflow.id === 'quality-feature'));
  assert.ok(api.getState()?.agents.some((agent) => agent.id === 'fs-visual-tests'));
  assert.equal(
    api.getState()?.workflows.find((workflow) => workflow.id === 'devops')?.steps.length,
    6,
  );
  assert.ok(api.getState()?.agents.some((agent) => agent.id === 'fs-devops-validate'));
  const devopsAgents = api.getState()!.agents.filter((agent) => agent.id.startsWith('fs-devops-'));
  assert.equal(new Set(devopsAgents.map((agent) => agent.avatar)).size, 6);
  for (const agent of devopsAgents) {
    for (const asset of ['idle.png', 'working.gif', 'approved.png'])
      assert.ok(
        await readFile(
          join(
            extension.extensionPath,
            'dist/webview/avatars',
            resolveAvatar(agent.avatar, agent.id),
            asset,
          ),
        ),
      );
  }
  assert.ok(api.getState()?.agents.some((agent) => agent.id === 'fs-counterexamples'));
  const cockpitTabs = () =>
    vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.filter(
        (tab) => tab.label === 'Feature Studio' && tab.input instanceof vscode.TabInputWebview,
      ),
    );
  assert.equal(cockpitTabs().length, 1, 'Concurrent launcher clicks create only one cockpit');
  await vscode.commands.executeCommand('featureStudio.open');
  assert.equal(cockpitTabs().length, 1, 'The launcher command reuses the existing cockpit panel');
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
  const beforeThemeChange = api.getState();
  const beforeThemeIndex = await readFile(join(source, '.git', 'index'));
  await Promise.all([
    api.dispatch({
      type: 'setTheme',
      theme: 'papier-clair',
      requestId: 'theme-fast-first',
    }),
    api.dispatch({
      type: 'setTheme',
      theme: 'guilde-sombre',
      requestId: 'theme-fast-last',
    }),
  ]);
  assert.equal(api.getTheme(), 'guilde-sombre', 'Successive changes persist in requested order');
  assert.deepEqual(
    api.getState(),
    beforeThemeChange,
    'Appearance changes preserve all business state',
  );
  assert.deepEqual(await readFile(join(source, '.git', 'index')), beforeThemeIndex);
  await vscode.workspace
    .getConfiguration('featureStudio')
    .update('appearance.theme', 'jardin-sombre', vscode.ConfigurationTarget.Global);
  assert.equal(
    api.getTheme(),
    'jardin-sombre',
    'External user setting changes are read authoritatively',
  );
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
    api.dispatch({
      type: 'runStep',
      featureId: feature.id,
      stepId: feature.steps[0].id,
    }),
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
    config: {
      checkpoints: ['plan', 'review'],
      maxRuns: 5,
      maxCorrectionCycles: 0,
      stepInputs: {},
    },
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
  await api.dispatch({
    type: 'setMcpSecret',
    serverId: 'smoke-mcp',
    key: 'SMOKE_KEY',
    value: '',
  });
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
      roastLevel: 'spicy',
    },
  });
  state = api.getState()!;
  assert.equal(state.agents.find((a) => a.id === 'smoke-agent')?.nickname, 'Capitaine Test');
  assert.equal(state.agents.find((a) => a.id === 'smoke-agent')?.source, 'user');
  assert.equal(state.agents.find((a) => a.id === 'smoke-agent')?.roastLevel, 'spicy');
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
      roastLevel: 'light',
    },
  });
  const projectAgent = api.getState()!.agents.find((agent) => agent.id === 'smoke-agent')!;
  assert.equal(projectAgent.source, 'workspace', 'Project scope has priority over the user copy');
  assert.equal(projectAgent.nickname, 'Capitaine Projet');
  assert.equal(projectAgent.roastLevel, 'light');
  assert.equal(
    projectAgent.versions?.find((version) => version.source === 'user')?.roastLevel,
    'spicy',
  );
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
  await assert.rejects(
    api.dispatch({
      type: 'finalizeFeature',
      featureId: isolated.id,
      expectedStateKey: featureStateKey(isolated),
    }),
    /étapes|validation|termin|valid/i,
    'The real host refuses finalization before the work has been reviewed',
  );
  assert.equal(
    api.getState()!.features.find((item) => item.id === isolated.id)?.finalValidation,
    undefined,
  );
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
  await api.dispatch({
    type: 'createCheckpoint',
    featureId: isolated.id,
    label: 'Before edit',
  });
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
  await api.dispatch({
    type: 'openFile',
    featureId: isolated.id,
    path: 'story.txt',
  });
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
    api.getTheme(),
    'jardin-sombre',
    'The user theme survives closing and reopening the cockpit',
  );
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
  assert.equal(api.getState()?.schemaVersion, 5);
  assert.ok(api.getState()?.agents.some((agent) => agent.id === 'fs-observer'));
  await api.dispatch({
    type: 'previewObservation',
    featureId: feature.id,
    requestId: 'smoke-observer-preview',
    options: { model: 'offline-smoke-model', maxCalls: 40 },
  });
  await api.dispatch({
    type: 'sessionStorage',
    featureId: feature.id,
    requestId: 'smoke-observer-storage',
  });
  assert.equal(
    api.getState()?.features.find((f) => f.id === feature.id)?.observations?.length ?? 0,
    0,
    'Preparation and storage consultation never start a paid model',
  );
  console.log(
    'PASS: activity-bar contribution/local launcher script and avatar readiness under CSP without business initialization/panel reuse, activation, panel/CSP, personal themes/strict protocol/ordered writes/reopen/business-state preservation, manual context/MCP/secret settings, budget/autopilot/memory, avatars/kit, user/project profile priority and persistence, offline ADO config/reopen, real Git delivery inspection, explicit quality reporter installation, isolated Git worktree, source/index preservation, checkpoints/diff, dirty-buffer refusal, selected restore, stale comparison refusal, recovery restore and v5 close/reopen, observer command/profile and offline dossier/storage preparation, roast profile scopes and premature final-validation refusal. No paid prompt.',
  );
}

export async function run(): Promise<void> {
  const diagnostics = process.env.FEATURE_STUDIO_SMOKE_DIAGNOSTICS;
  if (diagnostics) await writeFile(diagnostics, 'START\n');
  try {
    await smokeRun();
    if (diagnostics) await writeFile(diagnostics, 'PASS\n');
  } catch (error) {
    if (diagnostics)
      await writeFile(
        diagnostics,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    throw error;
  }
}
