import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClientMessage, StudioState, CheckpointComparison } from '../src/shared/types';
import type { DevOpsConfig, DevOpsState } from '../src/shared/devops';
import { THEME_IDS, type ThemeId } from '../src/shared/themes';
import { themeReward, type RewardState } from '../src/shared/rewards';
import { DRAGON_BALL_CODE } from '../src/shared/dragonBall';
import { resolveAvatar } from '../src/shared/avatars';
import { featureStateKey } from '../src/shared/collaboration';
import { teamSteps } from '../src/shared/team';
import type { QuestState } from '../src/shared/quests';
import type { DashboardState } from '../src/shared/dashboard';

interface Api {
  getState(): StudioState | undefined;
  getUiReady(): boolean;
  getLauncherVisible(): boolean;
  getLauncherReady(): boolean;
  getTheme(): ThemeId;
  getLivingHq(): boolean;
  getQuestState(): QuestState;
  getRewardState(): RewardState;
  getDevOpsState(): DevOpsState | undefined;
  getDashboardState(): DashboardState;
  getDashboardReady(): boolean;
  dispatchDashboard(message: ClientMessage): Promise<void | CheckpointComparison>;
  dispatch(message: ClientMessage): Promise<void | CheckpointComparison>;
}
async function waitForAutomaticConnection(api: Api): Promise<void> {
  for (let retry = 0; retry < 250; retry++) {
    const status = api.getState()?.runtime.state;
    if (status === 'ready' || status === 'unavailable') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('Opening the cockpit must automatically finish its bounded Copilot check');
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
    'The package contributes the direct cockpit launcher',
  );
  const welcomes = (contributions.viewsWelcome ?? []).filter(
    (entry: { view: string }) => entry.view === 'featureStudio.launcher',
  );
  assert.equal(welcomes.length, 0, 'The obsolete native welcome content is removed');
  const api = await extension.activate();
  assert.ok((await vscode.commands.getCommands(true)).includes('featureStudio.launcher.focus'));
  assert.equal(api.getState(), undefined, 'Activation alone never initializes the store');
  assert.equal(api.getDevOpsState(), undefined, 'Activation alone never initializes DevOps');
  assert.equal(api.getUiReady(), false, 'Activation alone never opens the cockpit webview');
  assert.ok((await vscode.commands.getCommands(true)).includes('workbench.trust.manage'));
  const wasTrusted = vscode.workspace.isTrusted;
  await api.dispatch({ type: 'manageWorkspaceTrust' });
  assert.equal(vscode.workspace.isTrusted, wasTrusted, 'Opening the trust editor grants nothing');
  assert.equal(api.getState(), undefined, 'Managing trust never initializes a business session');
  assert.equal(api.getTheme(), 'auto', 'The isolated user profile starts in automatic mode');
  assert.equal(api.getLivingHq(), false);
  assert.equal(
    contributions.configuration.properties['featureStudio.appearance.livingHq'].scope,
    'application',
  );
  for (const enabled of [true, false]) {
    await api.dispatch({ type: 'setLivingHq', enabled, requestId: `hq-${enabled}` });
    const preference = vscode.workspace
      .getConfiguration('featureStudio')
      .inspect<boolean>('appearance.livingHq');
    assert.equal(preference?.globalValue, enabled);
    assert.equal(preference?.workspaceValue, undefined);
    assert.equal(api.getLivingHq(), enabled);
    assert.equal(api.getState(), undefined, 'The HQ checkbox never initializes a business session');
  }
  for (const backdrop of ['atelier', 'papier', 'guilde', 'halloween', 'dragonball'])
    assert.ok(await readFile(join(extension.extensionPath, `dist/webview/qg/${backdrop}.png`)));
  for (const image of ['eiffel', 'kitten'])
    assert.ok(await readFile(join(extension.extensionPath, `dist/webview/rewards/${image}.png`)));
  for (let sheet = 1; sheet <= 4; sheet++)
    assert.ok(
      await readFile(
        join(extension.extensionPath, `dist/webview/avatar-events/dragonball/team-${sheet}.png`),
      ),
    );
  await api.dispatch({ type: 'setTheme', theme: 'dragonball', requestId: 'locked-dragonball' });
  assert.notEqual(api.getTheme(), 'dragonball');
  await api.dispatch({
    type: 'unlockDragonBall',
    sequence: DRAGON_BALL_CODE,
    requestId: 'secret-dragonball',
  });
  assert.equal(api.getTheme(), 'dragonball');
  assert.equal(api.getState(), undefined, 'The secret code never initializes a business session');
  for (const theme of THEME_IDS.filter((theme) => !themeReward(theme))) {
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
  const previousTheme = api.getTheme();
  await api.dispatch({ type: 'setTheme', theme: 'matrix', requestId: 'locked-matrix' });
  assert.equal(api.getTheme(), previousTheme, 'A direct message cannot select an unearned theme');
  await api.dispatch({
    type: 'setReward',
    rewardId: 'kitten',
    enabled: true,
    requestId: 'locked-kitten',
  });
  assert.equal(api.getRewardState().selection.mascot, null);
  assert.equal(api.getState(), undefined, 'Reward choices never initialize the business store');
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
  assert.equal(api.getTheme(), previousTheme, 'Invalid requests preserve the recorded choice');
  await vscode.workspace
    .getConfiguration('featureStudio')
    .update(
      'cliPath',
      process.env.FEATURE_STUDIO_TEST_CLI_PATH ||
        join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'missing-smoke-copilot'),
      vscode.ConfigurationTarget.Global,
    );
  const originalFolders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString());
  const originalWorkspace = vscode.workspace.workspaceFile?.toString();
  await vscode.commands.executeCommand('featureStudio.launcher.focus');
  for (let retry = 0; retry < 100 && (!api.getUiReady() || api.getLauncherVisible()); retry++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    api.getUiReady(),
    'Selecting the activity icon opens the cockpit without a second click',
  );
  assert.equal(api.getLauncherVisible(), false, 'The intermediate sidebar closes after opening');
  assert.deepEqual(
    vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()),
    originalFolders,
  );
  assert.equal(
    vscode.workspace.workspaceFile?.toString(),
    originalWorkspace,
    'The cockpit stays in the current project window',
  );
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
  await waitForAutomaticConnection(api);
  assert.equal(
    api.getState()?.runtime.state,
    process.env.FEATURE_STUDIO_TEST_CLI_PATH ? 'ready' : 'unavailable',
    'The cockpit connects automatically; a missing CLI leaves the UI usable with a diagnostic',
  );
  if (!process.env.FEATURE_STUDIO_TEST_CLI_PATH) assert.ok(api.getState()?.runtime.error);
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
  await vscode.commands.executeCommand('featureStudio.launcher.focus');
  for (let retry = 0; retry < 100 && api.getLauncherVisible(); retry++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(api.getLauncherVisible(), false, 'Selecting the icon again still opens directly');
  assert.equal(cockpitTabs().length, 1, 'Repeated activity selections reuse the same cockpit');
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
  await api.dispatch({
    type: 'createFeature',
    title: 'Smoke extension host',
    description: 'No Copilot prompt is sent.',
    workflowId: 'feature',
  });
  const beforeThemeChange = api.getState();
  await api.dispatch({ type: 'refreshQuests' });
  assert.equal(api.getQuestState().error, undefined);
  assert.equal(
    api.getQuestState().counts.featuresCreated,
    1,
    'A durable feature earns the first creation quest',
  );
  assert.equal(
    api.getQuestState().counts.featuresLaunched,
    0,
    'Creating a session does not invent an agent launch',
  );
  const creationTrophies = api.getQuestState().trophies;
  await api.dispatch({ type: 'refreshQuests' });
  assert.equal(
    api.getQuestState().trophies,
    creationTrophies,
    'Reloading facts cannot reward twice',
  );
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
    type: 'saveFeatureTeam',
    featureId: feature.id,
    expectedRevision: feature.teamRevision ?? 0,
    steps: teamSteps(feature),
    requestId: 'quest-team',
  });
  await api.dispatch({ type: 'refreshQuests' });
  assert.equal(
    api.getQuestState().counts.teamsCreated,
    1,
    'A saved composition advances the team series',
  );
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

  const questWorkflow = {
    ...api.getState()!.workflows[0],
    id: 'smoke-quest-route',
    name: 'Parcours quêtes',
  };
  await api.dispatch({ type: 'saveWorkflow', workflow: questWorkflow });
  await api.dispatch({ type: 'saveWorkflow', workflow: questWorkflow });
  await api.dispatch({ type: 'refreshQuests' });
  assert.equal(
    api.getQuestState().counts.workflowsCreated,
    1,
    'Updating the same workflow does not create another quest reward',
  );
  assert.equal(api.getQuestState().counts.budget, 1);
  assert.ok((api.getQuestState().counts.agentsCreated ?? 0) >= 1);
  assert.equal(
    api.getQuestState().counts.featuresLaunched,
    0,
    'A refused launch and previews do not earn launch trophies',
  );
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
  const beforeQuestReopen = api.getQuestState();
  await vscode.commands.executeCommand('featureStudio.open');
  await waitForAutomaticConnection(api);
  await api.dispatch({ type: 'refreshQuests' });
  assert.equal(api.getQuestState().error, undefined);
  assert.deepEqual(
    api.getQuestState(),
    beforeQuestReopen,
    'The personal trophy ledger survives cockpit reload with no duplicate rewards',
  );
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
  assert.equal(api.getState()?.schemaVersion, 9);
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
  const proposalAgent = api.getState()!.agents[0];
  const beforeProposal = api.getState()!.features.length;
  const proposalRequest: Extract<ClientMessage, { type: 'createFeature' }> = {
    type: 'createFeature',
    requestId: 'f00daf65-5877-48fa-9bb5-444b601a3173',
    title: 'Reviewed conversation proposal',
    description: 'Human-adjusted brief, no automatic run.',
    criteria: ['Keyboard navigation works'],
    team: [
      {
        agentId: proposalAgent.id,
        name: 'Review the need',
        description: 'Check the acceptance criteria',
        policy: 'read-only',
        optional: true,
      },
    ],
  };
  await api.dispatch(proposalRequest);
  await api.dispatch(proposalRequest);
  const proposed = api
    .getState()!
    .features.find((item) => item.creationRequestId === proposalRequest.requestId)!;
  assert.ok(proposed);
  assert.equal(
    api.getState()!.features.length,
    beforeProposal + 1,
    'Repeated creation acknowledgements do not duplicate a feature',
  );
  assert.equal(proposed.status, 'draft');
  assert.equal(proposed.criteria?.[0].status, 'pending');
  assert.equal(
    proposed.steps[0].attempts.length,
    0,
    'Creating a reviewed proposal never launches an agent',
  );
  assert.equal(proposed.steps[0].optional, true, 'Reviewed team choices reach the host');
  await api.dispatch({
    type: 'resolveOptionalStep',
    requestId: 'smoke-optional',
    featureId: proposed.id,
    stepId: proposed.steps[0].id,
    expectedStateKey: featureStateKey(proposed),
    choice: 'skip',
  });
  for (
    let retry = 0;
    retry < 100 &&
    api.getState()!.features.find((item) => item.id === proposed.id)!.steps[0].status !== 'skipped';
    retry++
  )
    await new Promise((resolve) => setTimeout(resolve, 50));
  const skipped = api.getState()!.features.find((item) => item.id === proposed.id)!.steps[0];
  assert.equal(skipped.status, 'skipped', 'A real host persists a manual optional decision');
  assert.equal(
    skipped.attempts.length,
    0,
    'Skipping never fabricates an attempt or starts a model',
  );
  assert.equal(skipped.optionalDecision?.author, 'human');
  assert.equal(
    api.getState()!.features.find((item) => item.id === proposed.id)!.status,
    'attention',
    'Unverified criteria still block completion',
  );
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.commands.executeCommand('featureStudio.open');
  assert.equal(
    api.getState()!.features.find((item) => item.id === proposed.id)?.criteria?.[0].text,
    'Keyboard navigation works',
  );
  assert.equal(
    api.getState()!.features.find((item) => item.id === proposed.id)!.steps[0].status,
    'skipped',
    'Skipped state survives closing and reopening',
  );
  const dashboard = api.getDashboardState();
  const config = {
    ...dashboard.config,
    modules: dashboard.config.modules.filter(
      (m) => m.kind === 'sessions' || m.kind === 'attention',
    ),
    refreshSeconds: 0,
  };
  config.modules[0].title = 'Sessions à suivre';
  await api.dispatch({
    type: 'dashboardSave',
    config,
    revision: dashboard.revision,
    requestId: 'smoke-dashboard',
  });
  assert.equal(api.getDashboardState().config.modules[0].title, 'Sessions à suivre');
  await vscode.commands.executeCommand('featureStudio.openDashboard');
  for (let i = 0; i < 100 && !api.getDashboardReady(); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    api.getDashboardReady(),
    'The real auxiliary window loads the control dashboard with the same host',
  );
  assert.throws(
    () =>
      api.dispatchDashboard({
        type: 'runStep',
        featureId: proposed.id,
        stepId: proposed.steps[0].id,
      }),
    /vue de suivi/,
  );
  const cockpit = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find((tab) => tab.label === 'Feature Studio' && tab.input instanceof vscode.TabInputWebview);
  assert.ok(cockpit, 'The main cockpit and control dashboard coexist');
  await vscode.window.tabGroups.close(cockpit);
  assert.equal(
    api.getState()!.features.find((f) => f.id === proposed.id)?.criteria?.[0].text,
    'Keyboard navigation works',
    'Closing the cockpit preserves the hub while the dashboard observes it',
  );
  await api.dispatchDashboard({
    type: 'dashboardOpen',
    featureId: proposed.id,
    stepId: proposed.steps[0].id,
  });
  assert.ok(api.getState()!.features.some((f) => f.id === proposed.id));
  assert.equal(api.getDashboardState().config.modules[0].title, 'Sessions à suivre');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('featureStudio.open');
  assert.equal(
    api.getDashboardState().config.modules[0].title,
    'Sessions à suivre',
    'Layout survives closing and reopening both surfaces',
  );
  console.log(
    'PASS: activity-bar direct opening in the current window/sidebar dismissal/panel reuse, activation, panel/CSP, personal themes/strict protocol/ordered writes/reopen/business-state preservation, personal quest ledger/feature and team creation/workflow deduplication/budget/reopen/no rewards for refused launches, manual context/MCP/secret settings, budget/autopilot/memory, avatars/kit, user/project profile priority and persistence, offline ADO config/reopen, real Git delivery inspection, explicit quality reporter installation, isolated Git worktree, source/index preservation, checkpoints/diff, dirty-buffer refusal, selected restore, stale comparison refusal, recovery restore and v7 close/reopen, optional team override/manual skip without inference/persistence, observer command/profile and offline dossier/storage preparation, roast profile scopes and premature final-validation refusal. No paid prompt.',
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
