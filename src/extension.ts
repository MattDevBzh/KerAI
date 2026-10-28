import { proofDossierMarkdown } from './shared/proofs';
import { exportDocument } from './host/DocumentExport';
import { documentFormatLabels } from './shared/documentation';
import { allFeatures, configurationSteps } from './shared/subplans';
import { inheritTeamProfiles } from './shared/agentInheritance';
import { resolvePersonalReviewReport } from './host/PersonalReviewTools';
import { observationHtml, observationMarkdown } from './shared/observationReport';
import { DashboardController } from './host/DashboardController';
import { StudioHub } from './host/StudioHub';
import { DiscussionService, type DiscussionProfile } from './host/DiscussionService';
import { ProjectCatalog, type StoredProject } from './host/ProjectCatalog';
import { DedicatedWindow, type WindowRequest } from './host/DedicatedWindow';
import { sessionMarkdown } from './shared/sessionExport';
import { agentReport } from './shared/agentReport';
import { applySessionBatch } from './host/SessionBatch';
import { DevOpsController } from './host/DevOpsController';
import { devOpsMessageSchema } from './core/devopsSchemas';
import { type TicketTarget } from './shared/devopsTickets';
import * as vscode from 'vscode';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { stringify } from 'yaml';
import { Store } from './core/store';
import { CopilotCliAdapter } from './host/CopilotCliAdapter';
import { CockpitLauncher } from './host/CockpitLauncher';
import { AccountCreditsMonitor } from './host/AccountCreditsMonitor';
import { RegistryMigration } from './core/registryMigration';
import { StudioService } from './host/StudioService';
import { WorkspaceLease } from './host/WorkspaceLease';
import { PolicyEngine, sha256 } from './host/PolicyEngine';
import { parseMessage } from './host/messages';
import { readHeadFile } from './host/GitFileContent';
import { redact } from './host/process';
import type { ClientMessage, HostMessage, CheckpointComparison } from './shared/types';
import { normalizeTheme } from './shared/themes';
import { normalizeZoom } from './shared/zoom';
import { QuestService, type QuestFact } from './host/QuestService';
import { RewardService } from './host/RewardService';
import { DRAGON_BALL_UNLOCK_KEY } from './shared/dragonBall';
import { rewardById, themeReward, unlockedRewards } from './shared/rewards';
import { studioQuestFacts, discussionQuestFacts } from './host/questFacts';

let panel: vscode.WebviewPanel | undefined;
let dashboardPanel: vscode.WebviewPanel | undefined;
let service: StudioService | undefined;
let devops: DevOpsController | undefined;
let lease: WorkspaceLease | undefined;
let initializing: Promise<void> | undefined;
let disposeHub: (() => Promise<void>) | undefined;
let shuttingDown: Promise<void> | undefined;
let webviewReady = false;
const diffContents = new Map<string, string>();

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Feature Studio');
  let quotaAdapter: CopilotCliAdapter | undefined;
  let quotaCliPath: string | undefined;
  const launcher = new CockpitLauncher();
  const credits = new AccountCreditsMonitor(
    async () => {
      if (!vscode.workspace.isTrusted)
        return {
          state: 'unavailable',
          message: 'Approuve cet espace de travail pour connecter Copilot CLI.',
        };
      const cliPath = vscode.workspace.getConfiguration('featureStudio').get('cliPath', 'auto');
      if (quotaAdapter && cliPath !== quotaCliPath) {
        await quotaAdapter.dispose();
        quotaAdapter = undefined;
      }
      if (!quotaAdapter) {
        quotaCliPath = cliPath;
        quotaAdapter = new CopilotCliAdapter({
          cliPath,
          storagePath: path.join(context.globalStorageUri.fsPath, 'copilot-runtime'),
          launcherPath: path.join(context.extensionPath, 'dist', 'copilot-launcher.js'),
          getTools: async () => [],
        });
      }
      return quotaAdapter.getAccountCredits();
    },
    (state) => send({ type: 'accountCredits', state }),
  );
  const send = (message: HostMessage) => {
    if (panel) void panel.webview.postMessage(message);
    if (
      dashboardPanel &&
      [
        'state',
        'dashboardState',
        'dashboardSaved',
        'accountCredits',
        'themeState',
        'rewardState',
        'secretThemeState',
        'zoomState',
        'error',
      ].includes(message.type)
    )
      void dashboardPanel.webview.postMessage(message);
  };
  const dragonBallUnlocked = () => context.globalState.get(DRAGON_BALL_UNLOCK_KEY) === true;
  const sendSecrets = (requestId?: string, error?: string) =>
    send({ type: 'secretThemeState', dragonBallUnlocked: dragonBallUnlocked(), requestId, error });
  const getTheme = () => {
    const theme = normalizeTheme(
      vscode.workspace.getConfiguration('featureStudio').get('appearance.theme'),
    );
    if (theme === 'dragonball' && !dragonBallUnlocked()) return 'auto';
    const reward = themeReward(theme);
    return reward && !unlockedRewards(quests.snapshot()).includes(reward) ? 'auto' : theme;
  };
  const sendTheme = (requestId?: string, error?: string) =>
    send({ type: 'themeState', theme: getTheme(), requestId, error });
  const getZoom = () =>
    normalizeZoom(vscode.workspace.getConfiguration('featureStudio').get('appearance.zoom'));
  const sendZoom = (requestId?: string, error?: string) =>
    send({ type: 'zoomState', zoom: getZoom(), requestId, error });
  const getLivingHq = () =>
    vscode.workspace.getConfiguration('featureStudio').get('appearance.livingHq') === true;
  const sendLivingHq = (requestId?: string, error?: string) =>
    send({ type: 'livingHqState', enabled: getLivingHq(), requestId, error });
  let livingHqWrites = Promise.resolve();
  let zoomWrites = Promise.resolve();
  // Theme writes share a queue so fast successive choices keep their requested order.
  let themeWrites = Promise.resolve();
  let favoriteWrites = Promise.resolve();
  const favorites = () =>
    vscode.workspace.getConfiguration('featureStudio').get<string[]>('favoriteAgentIds', []);
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(message);
    send({ type: 'error', message });
  };
  const reportCreationError = (requestId: string, error: unknown) => {
    const message =
      redact(error instanceof Error ? error.message : String(error)).trim() ||
      'La création a échoué. Réessaie après avoir vérifié le dossier du projet.';
    output.appendLine(`Création de session : ${message}`);
    send({ type: 'featureCreateResult', requestId, error: message });
  };
  context.subscriptions.push(
    output,
    launcher,
    credits,
    {
      dispose: () => {
        void quotaAdapter?.dispose();
      },
    },
    vscode.window.registerWebviewViewProvider('featureStudio.launcher', launcher),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('featureStudio.appearance.zoom')) sendZoom();
      if (event.affectsConfiguration('featureStudio.appearance.livingHq')) sendLivingHq();
      if (event.affectsConfiguration('featureStudio.appearance.theme')) sendTheme();
      if (event.affectsConfiguration('featureStudio.favoriteAgentIds')) service?.publish();
    }),
    vscode.workspace.registerTextDocumentContentProvider('feature-studio-diff', {
      provideTextDocumentContent: (uri) => diffContents.get(uri.toString()) ?? '',
    }),
  );
  const hubDirectory = path.join(context.globalStorageUri.fsPath, 'cockpit');
  const quests = new QuestService(hubDirectory);
  const rewards = new RewardService(hubDirectory, () => quests.snapshot());
  const sendRewards = (requestId?: string, error?: string) =>
    send({ type: 'rewardState', state: rewards.snapshot(), requestId, error });
  rewards.on('state', () => sendRewards());
  quests.on('state', (state, earned: string[]) => {
    send({ type: 'questState', state, earned });
    rewards.publish();
    sendTheme();
  });
  const refreshPersonalRewards = async () => {
    await quests.initialize();
    await rewards.initialize();
  };
  const recordQuest = (metric: QuestFact['metric'], key: string) =>
    quests.record([{ metric, key }]);
  const dedicatedWindow = new DedicatedWindow(hubDirectory);
  const dedicated = dedicatedWindow.isDedicated(vscode.workspace.workspaceFile?.fsPath);
  const catalog = new ProjectCatalog(hubDirectory);
  let initialized = false;
  const hub: StudioHub = new StudioHub(
    catalog,
    async (project?: StoredProject) => {
      const root = project?.path ?? dedicatedWindow.home;
      const store = new Store(
        project ? catalog.storage(project) : path.join(hubDirectory, 'empty'),
      );
      const { access } = await import('node:fs/promises');
      const isNew = await access(store.path)
        .then(() => false)
        .catch((error) => {
          if (error.code === 'ENOENT') return true;
          throw error;
        });
      const next = new StudioService(
        root,
        path.join(context.extensionPath, 'defaults'),
        store,
        () => vscode.workspace.isTrusted,
      );
      next.navigationProjects = () =>
        catalog.state.projects.map((p) => ({ id: p.id, path: p.path }));
      await next.initialize();
      next.on(
        'optionalStep',
        (
          featureId: string,
          request: NonNullable<import('./shared/types').Feature['optionalRequest']>,
        ) => {
          const feature = next.engine.getFeature(featureId);
          const step = feature.steps.find((item) => item.id === request.stepId)!;
          void vscode.window
            .showInformationMessage(
              `${feature.title} — ${step.name} est facultative. Le pilote attend ton choix.`,
              'Exécuter et continuer',
              'Passer et continuer',
              'Décider plus tard',
            )
            .then((choice) => {
              if (choice !== 'Exécuter et continuer' && choice !== 'Passer et continuer') return;
              const message: Extract<ClientMessage, { type: 'resolveOptionalStep' }> = {
                type: 'resolveOptionalStep',
                featureId,
                stepId: request.stepId,
                decisionId: request.id,
                expectedStateKey: request.stateKey,
                choice: choice === 'Exécuter et continuer' ? 'run' : 'skip',
                continueAutopilot: true,
              };
              void next
                .recordHumanAction(message)
                .then(() => next.resolveOptionalStep(message))
                .catch(report);
            });
        },
      );
      next.on('persisted', (state) => {
        void quests.record(studioQuestFacts(state));
      });
      const config = vscode.workspace.getConfiguration('featureStudio');
      if (isNew) {
        next.state.settings.defaultModel = config.get('defaultModel', '');
        next.state.settings.timeoutMinutes = config.get('timeoutMinutes', 20);
        await next.persist();
      }
      next.adapter = new CopilotCliAdapter({
        cliPath: () => vscode.workspace.getConfiguration('featureStudio').get('cliPath', 'auto'),
        storagePath: path.join(context.globalStorageUri.fsPath, 'copilot-runtime'),
        launcherPath: path.join(context.extensionPath, 'dist', 'copilot-launcher.js'),
        debugLog: (message) => {
          if (vscode.workspace.getConfiguration('featureStudio').get('debugCli', false))
            output.appendLine(message);
        },
        getTools: (input, callbacks, signal) => next.getTools(input, callbacks, signal),
        resolveMcpSecret: (serverId, key) =>
          context.secrets.get(`studio-mcp:${sha256(root)}:${serverId}:${key}`),
      });
      await next
        .recoverSessionDeletions()
        .catch((error) =>
          next.state.notices.push(`Nettoyage à reprendre : ${(error as Error).message}`),
        );
      next.on('errorNotice', (message) => report(new Error(message)));
      const controller = new DevOpsController({
        assertReadable: () => next.assertTrusted(),
        root,
        storageDirectory: path.join(store.rootPath, 'devops'),
        secrets: context.secrets,
        publish: (state) => {
          if (service === next) send({ type: 'devopsState', state });
        },
        guard: () => {
          next.globalGuard?.();
          next.assertConfigurable();
        },
        withMutation: (label, work) =>
          next.withWorkspaceMutation(label, async () => {
            const result = await work();
            await next.refresh();
            return result;
          }),
        confirm: async (title, detail) => {
          next.assertTrusted();
          if (
            vscode.workspace.textDocuments.some(
              (document) =>
                document.isDirty &&
                document.uri.scheme === 'file' &&
                (document.uri.fsPath === root || document.uri.fsPath.startsWith(root + path.sep)),
            )
          )
            throw new Error(
              'Enregistre ou ferme les fichiers modifiés dans l’éditeur avant la livraison.',
            );
          const result = await vscode.window.showWarningMessage(
            title,
            { modal: true, detail },
            'Confirmer',
          );
          next.assertTrusted();
          return result === 'Confirmer';
        },
        requestToken: async () => {
          const token = await vscode.window.showInputBox({
            title: 'Connexion Azure DevOps',
            prompt:
              'Lecture : Code, Work Items, Build et Test Management selon tes besoins. Écriture Code uniquement pour créer des PR. Stocké dans SecretStorage.',
            password: true,
            ignoreFocusOut: true,
          });
          next.assertTrusted();
          return token;
        },
        getAgentInstructions: async () => {
          const registry = await next.registry.load();
          const profile = registry.agents.find((agent) => agent.id === 'fs-delivery');
          if (!profile)
            throw new Error(
              'Profil fs-delivery absent. Restaure le profil depuis le catalogue Agents.',
            );
          return profile.instructions;
        },
        features: () => [
          ...new Map(
            [next, ...[...hub.entries.values()].map((entry) => entry.service)]
              .flatMap((owner) => owner.state.features)
              .map((feature) => [feature.id, feature]),
          ).values(),
        ],
        ticketTargets: async () => {
          const targets: TicketTarget[] = [];
          for (const candidate of catalog.state.projects.filter((item) => !item.hidden)) {
            try {
              const entry = await hub.entry(candidate.id);
              const target: TicketTarget = {
                id: candidate.id,
                name: candidate.name,
                path: candidate.path,
                branch: entry.service.state.workspace.branch,
                canIsolate: false,
                branches: [],
              };
              try {
                const info = await entry.service.workspaces.inspectRepository();
                Object.assign(target, {
                  branch: info.branch,
                  dirtyCount: info.dirtyCount,
                  canIsolate: true,
                  branches: await entry.service.workspaces.branchChoices(),
                });
              } catch (error) {
                target.isolationReason = (error as Error).message;
              }
              targets.push(target);
            } catch {
              /* A missing/unavailable registered folder is not offered as a development target. */
            }
          }
          return targets.sort(
            (a, b) => Number(b.id === project?.id) - Number(a.id === project?.id),
          );
        },
        createFeature: async (_ticket, plan, source, targetInfo) => {
          const existing = [...hub.entries.values()]
            .flatMap((entry) => entry.service.state.features)
            .find(
              (feature) =>
                feature.ticketSource?.ticketId === source.ticketId &&
                feature.ticketSource.projectKey === source.projectKey,
            );
          if (existing) return existing.id;
          const projects = catalog.resolve([plan.targetProjectId]);
          const target = await hub.entry(plan.targetProjectId);
          const feature = await target.service.createFeature({
            requestId: plan.requestId,
            title: plan.title,
            description: source.context,
            isolated: plan.isolated,
            projects,
            ticketSource: source,
            expectedCurrentBranch: plan.isolated ? undefined : targetInfo.branch,
            worktreeChoice: plan.isolated
              ? {
                  baseRef: plan.baseRef!,
                  baseCommit: plan.baseCommit!,
                  branchName: plan.branchName!,
                }
              : undefined,
          });
          return feature.id;
        },
        ensureFeatureSaved: async (id) => {
          const owner = [...hub.entries.values()].find((entry) =>
            allFeatures(entry.service.state.features).some((feature) => feature.id === id),
          );
          if (!owner) throw new Error('La session liée est indisponible.');
          await owner.service.withWorkspaceMutation(
            'Enregistrement de la session liée au ticket',
            () => owner.service.persist(),
          );
        },
        openFeature: async (id) => {
          const entry = await hub.activateFeature(id);
          service = entry.service;
          devops = entry.devops;
          hub.publish();
          send({ type: 'devopsState', state: devops.getState() });
          send({ type: 'navigate', view: 'dashboard', featureId: id });
        },
      });
      await controller.initialize();
      next.devopsInspector = (signal) => {
        next.assertTrusted();
        return controller.inspector(signal);
      };
      next.devopsProjectKey = () => {
        const config = controller.getState().config;
        return config
          ? `${config.organization}/${config.project}/${config.repository}`.toLowerCase()
          : undefined;
      };
      return { service: next, devops: controller, project };
    },
    dedicated,
    process.platform === 'win32',
  );
  hub.on('state', (state) =>
    send({ type: 'state', state: { ...state, favoriteAgentIds: favorites() } }),
  );
  const dashboard = new DashboardController(
    hubDirectory,
    () =>
      [...hub.entries.values()]
        .filter(
          (entry) =>
            entry.project &&
            !catalog.state.projects.find((p) => p.id === entry.project!.id)?.hidden,
        )
        .map((entry) => ({
          id: entry.project!.id,
          name:
            catalog.state.projects.find((p) => p.id === entry.project!.id)?.name ??
            entry.project!.name,
          devops: entry.devops,
        })),
    (state) => send({ type: 'dashboardState', state }),
  );
  let cockpitDashboardVisible = false;
  let dashboardReady = false;
  const updateDashboardVisibility = () => {
    dashboard.setVisible('cockpit', cockpitDashboardVisible && Boolean(panel?.visible));
    dashboard.setVisible('control', dashboardReady && Boolean(dashboardPanel?.visible));
    credits.setVisible(
      (webviewReady && Boolean(panel?.visible)) ||
        (dashboardReady && Boolean(dashboardPanel?.visible)),
    );
  };
  const discussions = new DiscussionService({
    directory: hubDirectory,
    workspacePath: dedicatedWindow.home,
    assertTrusted: () => {
      if (!vscode.workspace.isTrusted)
        throw new Error('Approuvez cet espace de travail pour discuter avec les agents.');
    },
    defaults: () => {
      const config = vscode.workspace.getConfiguration('featureStudio');
      return {
        defaultModel: config.get('defaultModel', ''),
        timeoutMinutes: config.get('timeoutMinutes', 20),
      };
    },
    adapter: async () => (await hub.entry('empty')).service.adapter,
    profiles: async () => {
      const personal = await (await hub.entry('empty')).service.registry.load();
      const profiles: DiscussionProfile[] = personal.agents.map((profile) => ({
        key: `global:${profile.id}`,
        profile,
        skills: personal.skills,
      }));
      for (const project of catalog.state.projects) {
        if (project.hidden) continue;
        try {
          const data = await (await hub.entry(project.id)).service.registry.load();
          profiles.push(
            ...data.agents
              .filter((agent) => agent.source === 'workspace')
              .map((profile) => ({
                key: `project:${project.id}:${profile.id}`,
                projectName: project.name,
                profile,
                skills: data.skills,
              })),
          );
        } catch (error) {
          output.appendLine(`Agents de discussion — ${project.name} : ${(error as Error).message}`);
        }
      }
      return profiles;
    },
  });
  discussions.on('state', (state) => send({ type: 'discussionState', state }));
  discussions.on('persisted', (state) => {
    void quests.record(discussionQuestFacts(state));
  });
  disposeHub = async () => {
    await dashboard.dispose();
    credits.setVisible(false);
    await discussions.dispose();
    await hub.dispose();
    await quests.flush();
    await rewards.flush();
    initialized = false;
  };
  const bootstrap = async (): Promise<void> => {
    if (shuttingDown) await shuttingDown;
    if (initialized) return;
    if (initializing) return initializing;
    initializing = (async () => {
      await dedicatedWindow.prepare();
      if (!lease) {
        const nextLease = new WorkspaceLease(dedicatedWindow.home);
        await nextLease.acquire();
        lease = nextLease;
      }
      await catalog.load();
      if (!dedicated) {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
          if (folder.uri.scheme !== 'file') continue;
          const root = await realpath(folder.uri.fsPath);
          await catalog.add(
            [root],
            context.storageUri
              ? {
                  root,
                  storagePath: path.join(
                    context.storageUri.fsPath,
                    'studio',
                    sha256(root).slice(0, 24),
                  ),
                }
              : undefined,
          );
        }
      }
      await refreshPersonalRewards();
      await hub.initialize();
      await dashboard.initialize();
      await discussions.initialize();
      for (const entry of hub.entries.values())
        await quests.record(studioQuestFacts(entry.service.snapshot()));
      await quests.record(discussionQuestFacts(discussions.snapshot()));
      if (getTheme() !== 'auto') await recordQuest('theme', getTheme());
      initialized = true;
    })();
    try {
      await initializing;
    } finally {
      initializing = undefined;
    }
  };
  const ensure = async (featureId?: string): Promise<StudioService> => {
    await bootstrap();
    const entry = featureId ? await hub.activateFeature(featureId) : await hub.current();
    service = entry.service;
    devops = entry.devops;
    return service;
  };

  const notice = (message: string) => send({ type: 'notice', message });
  let sessionBatchRunning = false;
  const dispatch = async (
    raw: unknown,
    surface: 'cockpit' | 'control' = 'cockpit',
  ): Promise<void | CheckpointComparison> => {
    let message: ClientMessage;
    try {
      message = parseMessage(raw);
    } catch (error) {
      if (
        raw &&
        typeof raw === 'object' &&
        'type' in raw &&
        raw.type === 'createFeature' &&
        'requestId' in raw &&
        typeof raw.requestId === 'string' &&
        raw.requestId.length <= 150
      ) {
        reportCreationError(
          raw.requestId,
          new Error('Le formulaire de création est invalide. Rouvre-le puis réessaie.'),
        );
        return;
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'type' in raw &&
        raw.type === 'dashboardSave' &&
        'requestId' in raw &&
        typeof raw.requestId === 'string' &&
        raw.requestId.length <= 150
      ) {
        send({
          type: 'dashboardSaved',
          requestId: raw.requestId,
          error: 'Réglages invalides : vérifie les champs et les limites des filtres.',
        });
        return;
      }
      throw error;
    }
    if (message.type === 'manageWorkspaceTrust') {
      // Open VS Code's own decision screen, including in restricted or busy workspaces.
      await vscode.commands.executeCommand('workbench.trust.manage');
      return;
    }
    if (message.type.startsWith('dashboard')) {
      await ensure();
      switch (message.type) {
        case 'dashboardVisible':
          if (surface === 'cockpit') cockpitDashboardVisible = message.visible;
          updateDashboardVisibility();
          send({ type: 'dashboardState', state: dashboard.snapshot() });
          return;
        case 'dashboardRefresh':
          await dashboard.refresh();
          return;
        case 'dashboardSave':
          try {
            await dashboard.save(message.config, message.revision);
            send({ type: 'dashboardSaved', requestId: message.requestId });
          } catch (error) {
            send({ type: 'dashboardState', state: dashboard.snapshot() });
            send({
              type: 'dashboardSaved',
              requestId: message.requestId,
              error: redact((error as Error).message),
            });
          }
          return;
        case 'dashboardDetach':
          await openDashboard();
          return;
        case 'dashboardFullscreen':
          dashboardPanel?.reveal();
          await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
          return;
        case 'dashboardOpen': {
          if (!(await open())) return;
          if (message.featureId) await ensure(message.featureId);
          else if (message.projectId) {
            const entry = await hub.activateProject(message.projectId);
            service = entry.service;
            devops = entry.devops;
          }
          hub.publish();
          if (devops) send({ type: 'devopsState', state: devops.getState() });
          send({
            type: 'navigate',
            view: message.page ?? 'sessions',
            featureId: message.featureId,
            stepId: message.stepId,
          });
          if (message.ticketId && message.page === 'devops-tickets')
            await devops?.handle({ type: 'devopsLoadTicket', ticketId: message.ticketId });
          return;
        }
      }
    }
    if (message.type === 'refreshSecretThemes') {
      sendSecrets();
      sendTheme();
      return;
    }
    if (message.type === 'unlockDragonBall') {
      const result = themeWrites.then(async () => {
        try {
          if (!dragonBallUnlocked()) await context.globalState.update(DRAGON_BALL_UNLOCK_KEY, true);
          await vscode.workspace
            .getConfiguration('featureStudio')
            .update('appearance.theme', 'dragonball', vscode.ConfigurationTarget.Global);
          sendTheme();
          sendSecrets(message.requestId);
        } catch (error) {
          sendSecrets(
            message.requestId,
            redact(error instanceof Error ? error.message : String(error)),
          );
        }
      });
      themeWrites = result.catch(() => undefined);
      await result;
      return;
    }
    if (message.type === 'refreshRewards') {
      await refreshPersonalRewards();
      return;
    }
    if (message.type === 'setReward') {
      try {
        await refreshPersonalRewards();
        rewards.assertUnlocked(message.rewardId);
        const reward = rewardById.get(message.rewardId)!;
        if (reward.kind === 'theme') {
          // Share the theme queue with the ordinary picker; no business session is initialized.
          const result = themeWrites.then(async () => {
            rewards.assertUnlocked(message.rewardId);
            const next = message.enabled
              ? normalizeTheme(message.rewardId)
              : getTheme() === message.rewardId
                ? 'auto'
                : getTheme();
            await vscode.workspace
              .getConfiguration('featureStudio')
              .update('appearance.theme', next, vscode.ConfigurationTarget.Global);
            sendTheme();
            if (initialized && next !== 'auto') await recordQuest('theme', next);
          });
          themeWrites = result.catch(() => undefined);
          await result;
        } else await rewards.set(message.rewardId, message.enabled);
        sendRewards(message.requestId);
      } catch (error) {
        sendRewards(
          message.requestId,
          redact(error instanceof Error ? error.message : String(error)),
        );
      }
      return;
    }
    if (message.type === 'hqWindow') {
      try {
        if (surface !== 'cockpit' || !panel) throw new Error('Ouvre le QG depuis le cockpit.');
        const command =
          message.action === 'detach'
            ? 'workbench.action.moveEditorToNewWindow'
            : 'workbench.action.toggleFullScreen';
        if (!(await vscode.commands.getCommands(true)).includes(command))
          throw new Error(
            'Cette version de VS Code ne propose pas cette commande. Tu peux déplacer la fenêtre manuellement.',
          );
        panel.reveal();
        await vscode.commands.executeCommand(command);
        send({ type: 'hqWindowResult', requestId: message.requestId });
      } catch (error) {
        send({
          type: 'hqWindowResult',
          requestId: message.requestId,
          error: redact(error instanceof Error ? error.message : String(error)),
        });
      }
      return;
    }
    if (message.type === 'setLivingHq') {
      livingHqWrites = livingHqWrites.then(async () => {
        try {
          await vscode.workspace
            .getConfiguration('featureStudio')
            .update('appearance.livingHq', message.enabled, vscode.ConfigurationTarget.Global);
          sendLivingHq(message.requestId);
        } catch (error) {
          sendLivingHq(
            message.requestId,
            redact(error instanceof Error ? error.message : String(error)),
          );
        }
      });
      await livingHqWrites;
      return;
    }
    if (message.type === 'setZoom') {
      zoomWrites = zoomWrites.then(async () => {
        try {
          await vscode.workspace
            .getConfiguration('featureStudio')
            .update('appearance.zoom', message.zoom, vscode.ConfigurationTarget.Global);
          sendZoom(message.requestId);
        } catch (error) {
          sendZoom(
            message.requestId,
            redact(error instanceof Error ? error.message : String(error)),
          );
        }
      });
      await zoomWrites;
      return;
    }
    if (message.type === 'setTheme') {
      themeWrites = themeWrites.then(async () => {
        try {
          if (message.theme === 'dragonball' && !dragonBallUnlocked())
            throw new Error('Ce thème secret n’est pas encore débloqué.');
          const reward = themeReward(message.theme);
          if (reward) {
            await refreshPersonalRewards();
            rewards.assertUnlocked(reward);
          }
          await vscode.workspace
            .getConfiguration('featureStudio')
            .update('appearance.theme', message.theme, vscode.ConfigurationTarget.Global);
          sendTheme(message.requestId);
          if (initialized && message.theme !== 'auto') await recordQuest('theme', message.theme);
        } catch (error) {
          sendTheme(
            message.requestId,
            redact(error instanceof Error ? error.message : String(error)),
          );
        }
      });
      await themeWrites;
      return;
    }
    if (
      [
        'addProjects',
        'renameProject',
        'hideProject',
        'selectProjects',
        'openDedicatedWindow',
        'createWindowsShortcut',
      ].includes(message.type) &&
      'requestId' in message &&
      message.requestId !== undefined
    ) {
      try {
        if (message.type === 'openDedicatedWindow') await openDedicated();
        else if (message.type === 'createWindowsShortcut') {
          const destination = await dedicatedWindow.shortcut(
            process.execPath,
            path.join(context.extensionPath, 'resources', 'feature-studio.ico'),
          );
          send({
            type: 'projectResult',
            requestId: message.requestId,
            message: `Raccourci créé : ${destination}`,
          });
          return;
        } else {
          await bootstrap();
          if (message.type === 'addProjects') {
            const folders = await vscode.window.showOpenDialog({
              title: 'Ajouter des espaces de travail',
              canSelectFolders: true,
              canSelectFiles: false,
              canSelectMany: true,
              openLabel: 'Ajouter les projets',
            });
            if (folders?.length) {
              if (folders.some((folder) => folder.scheme !== 'file'))
                throw new Error('Choisis des dossiers accessibles sur ce poste.');
              await catalog.add(folders.map((folder) => folder.fsPath));
              await hub.initialize();
            }
          } else if (message.type === 'renameProject')
            await catalog.update(message.projectId, { name: message.name });
          else if (message.type === 'hideProject')
            await catalog.update(message.projectId, { hidden: message.hidden });
          else if (message.type === 'selectProjects') await hub.select(message.projectIds);
          const active = await hub.current();
          service = active.service;
          devops = active.devops;
          hub.publish();
          send({ type: 'devopsState', state: devops.getState() });
          await discussions.refreshProfiles();
        }
        send({ type: 'projectResult', requestId: message.requestId });
      } catch (error) {
        send({
          type: 'projectResult',
          requestId: message.requestId,
          error: redact((error as Error).message),
        });
      }
      return;
    }
    if (message.type === 'statsStorage') {
      const items: import('./shared/statistics').StatsStorageItem[] = [];
      try {
        await bootstrap();
        for (const featureId of new Set(message.featureIds)) {
          try {
            const bytes = await hub.featureEntry(featureId).service.statisticsStorage(featureId);
            items.push({ featureId, bytes });
          } catch (error) {
            items.push({ featureId, error: redact((error as Error).message) });
          }
        }
        send({ type: 'statsStorageResult', requestId: message.requestId, items });
      } catch (error) {
        send({
          type: 'statsStorageResult',
          requestId: message.requestId,
          items,
          error: redact((error as Error).message),
        });
      }
      return;
    }
    if (message.type === 'manageSessions') {
      if (sessionBatchRunning) {
        send({
          type: 'sessionBatchResult',
          requestId: message.requestId,
          action: message.action,
          succeeded: [],
          failed: [],
          freedBytes: 0,
          error: 'Une opération sur les sessions est déjà en cours.',
        });
        return;
      }
      sessionBatchRunning = true;
      try {
        await bootstrap();
        const result = await applySessionBatch(
          message,
          (id) => {
            const entry = hub.featureEntry(id);
            return {
              service: entry.service,
              removeDeletedFeature: (featureId) => entry.devops.removeDeletedFeature(featureId),
            };
          },
          async (features) => {
            const names = features
              .map((feature) => {
                const projects =
                  feature.projects?.map((project) => project.name).join(' + ') ||
                  hub.featureEntry(feature.id).project?.name;
                return `• ${feature.title}${projects ? ` — ${projects}` : ''}`;
              })
              .join('\n');
            const choice = await vscode.window.showWarningMessage(
              `Supprimer définitivement ${features.length} session${features.length > 1 ? 's' : ''} ?`,
              {
                modal: true,
                detail: `${names}\n\nLes journaux, contextes, rapports, pièces jointes et sauvegardes propres à ces sessions seront supprimés. Les fichiers du projet, branches, worktrees et exports externes sont conservés. Cette action est irréversible.`,
              },
              'Supprimer définitivement',
            );
            return choice === 'Supprimer définitivement';
          },
          (completed, total) =>
            send({ type: 'sessionBatchProgress', requestId: message.requestId, completed, total }),
        );
        send({ type: 'sessionBatchResult', ...result });
      } catch (error) {
        send({
          type: 'sessionBatchResult',
          requestId: message.requestId,
          action: message.action,
          succeeded: [],
          failed: [],
          freedBytes: 0,
          error: redact((error as Error).message),
        });
      } finally {
        sessionBatchRunning = false;
        hub.publish();
      }
      return;
    }
    if (
      message.type === 'saveProofClaim' ||
      message.type === 'checkProofDossier' ||
      message.type === 'exportProofDossier'
    ) {
      try {
        const current = await ensure(message.featureId);
        if (message.type === 'saveProofClaim') await current.saveProofClaim(message);
        else if (message.type === 'checkProofDossier')
          await current.checkProofDossier(message.featureId);
        else {
          const content = proofDossierMarkdown(current.engine.getFeature(message.featureId));
          const destination = await vscode.window.showSaveDialog({
            title: 'Exporter le dossier de preuves',
            defaultUri: vscode.Uri.file(path.join(homedir(), 'dossier-preuves.md')),
            filters: { Markdown: ['md'] },
          });
          if (destination) await vscode.workspace.fs.writeFile(destination, Buffer.from(content));
        }
        send({
          type: 'proofDossierResult',
          requestId: message.requestId,
          notice:
            message.type === 'checkProofDossier'
              ? 'Empreintes des tests contrôlées. Aucun test relancé, aucune page web revisitée.'
              : undefined,
        });
      } catch (error) {
        send({
          type: 'proofDossierResult',
          requestId: message.requestId,
          error: redact((error as Error).message),
        });
      }
      return;
    }
    if (message.type === 'exportAgentReport') {
      try {
        const current = await ensure(message.featureId);
        const report = agentReport(
          current.engine.getFeature(message.featureId),
          message.stepId,
          message.attemptId,
          message.revision,
        );
        const format = message.format ?? 'md';
        const bytes = await exportDocument(
          report.content,
          format,
          current.engine.getFeature(message.featureId).title,
        );
        const destination = await vscode.window.showSaveDialog({
          title: 'Télécharger le compte rendu de l’agent',
          saveLabel: `Enregistrer · ${documentFormatLabels[format]}`,
          defaultUri: vscode.Uri.file(
            path.join(homedir(), report.filename.replace(/\.md$/, `.${format}`)),
          ),
          filters: { [documentFormatLabels[format]]: [format] },
        });
        if (destination) await vscode.workspace.fs.writeFile(destination, bytes);
        send({
          type: 'agentReportExported',
          requestId: message.requestId,
          cancelled: !destination,
        });
      } catch (error) {
        send({
          type: 'agentReportExported',
          requestId: message.requestId,
          error: redact((error as Error).message),
        });
      }
      return;
    }
    if (message.type === 'createFeature') {
      try {
        await bootstrap();
        if (
          message.discussionId &&
          !discussions.state.discussions.some((item) => item.id === message.discussionId)
        )
          throw new Error('La discussion d’origine n’est plus disponible.');
        const projects = catalog.resolve(message.projectIds ?? catalog.state.selectedProjectIds);
        const entry = await hub.select(projects.map((project) => project.id));
        service = entry.service;
        devops = entry.devops;
        const created = await service.createFeature({ ...message, projects });
        if (message.requestId)
          send({
            type: 'featureCreateResult',
            requestId: message.requestId,
            featureId: created.id,
          });
        send({ type: 'navigate', view: 'dashboard', featureId: created.id });
      } catch (error) {
        if (!message.requestId) throw error;
        reportCreationError(message.requestId, error);
      }
      return;
    }
    await bootstrap();
    if (message.type === 'refreshDiscussions') {
      await discussions.refreshProfiles();
      return;
    }
    if (message.type === 'openReportDiscussion') {
      try {
        const current = await ensure(message.featureId);
        const source = await current.discussionSource(
          message.featureId,
          message.stepId,
          message.attemptId,
          message.revision,
        );
        const discussionId = await discussions.openSource(source);
        send({ type: 'reportDiscussionOpened', requestId: message.requestId, discussionId });
      } catch (error) {
        send({
          type: 'reportDiscussionOpened',
          requestId: message.requestId,
          error: redact((error as Error).message),
        });
      }
      return;
    }
    if (message.type === 'returnToDiscussionReport') {
      const source = discussions.reportSource(message.discussionId);
      const current = await ensure(source.featureId);
      const feature = current.engine.getFeature(source.featureId),
        step = current.engine.getStep(source.featureId, source.stepId);
      const attempt = message.edit
        ? step.attempts.at(-1)
        : step.attempts.find((item) => item.id === source.attemptId);
      if (!attempt?.artifact)
        throw new Error(
          'Ce compte rendu n’est plus disponible. La copie conservée reste consultable dans la discussion.',
        );
      const edit =
        message.edit &&
        !feature.archived &&
        !feature.steps.some((item) => item.status === 'running') &&
        feature.autopilot?.status !== 'running' &&
        !current.state.workspaceOperation;
      current.publish();
      send({
        type: 'discussionReportOpened',
        featureId: feature.id,
        stepId: step.id,
        attemptId: attempt.id,
        edit: Boolean(edit),
        notice:
          attempt.id !== source.attemptId || (attempt.revision ?? 0) !== source.revision
            ? 'Le compte rendu a évolué depuis cette discussion. Vous consultez sa version actuelle ; la copie discutée reste dans le chat.'
            : message.edit && !edit
              ? 'Le compte rendu est consultable. L’édition sera disponible quand la session pourra être modifiée.'
              : undefined,
      });
      return;
    }
    if (
      message.type === 'sendDiscussion' ||
      message.type === 'prepareDiscussionFeature' ||
      message.type === 'deleteDiscussion' ||
      message.type === 'cancelDiscussion'
    ) {
      if (message.type === 'cancelDiscussion') {
        discussions.cancel(message.discussionId);
        return;
      }
      try {
        if (message.type === 'sendDiscussion') await discussions.send(message);
        else if (message.type === 'prepareDiscussionFeature') {
          const current = await ensure();
          const registry = await current.registry.load();
          await discussions.prepareFeature(message, registry.agents);
        } else {
          const choice = await vscode.window.showWarningMessage(
            'Supprimer cette discussion et son historique ?',
            { modal: true },
            'Supprimer',
          );
          if (choice !== 'Supprimer') {
            send({
              type: 'discussionResult',
              requestId: message.requestId,
              discussionId: message.discussionId,
              cancelled: true,
            });
            return;
          }
          await discussions.delete(message.discussionId);
        }
        send({
          type: 'discussionResult',
          requestId: message.requestId,
          discussionId: message.discussionId,
        });
      } catch (error) {
        send({
          type: 'discussionResult',
          requestId: message.requestId,
          discussionId: message.discussionId,
          error: redact((error as Error).message),
        });
      }
      return;
    }
    if (message.type === 'activateProject') {
      const entry = await hub.activateProject(message.projectId);
      service = entry.service;
      devops = entry.devops;
      hub.publish();
      send({ type: 'devopsState', state: devops.getState() });
      return;
    }
    const requestOwner =
      message.type === 'answerHumanRequest'
        ? hub.snapshot()?.humanRequests?.find((request) => request.id === message.requestId)
            ?.featureId
        : undefined;
    const current =
      message.type === 'saveSettings' && message.projectId
        ? (await hub.entry(message.projectId)).service
        : await ensure('featureId' in message ? message.featureId : requestOwner);
    if (message.type === 'activateFeature') {
      current.publish();
      send({ type: 'devopsState', state: devops!.getState() });
      return;
    }
    await current.recordHumanAction(message);
    const deliveryMessage = devOpsMessageSchema.safeParse(message);
    if (deliveryMessage.success) {
      await devops!.handle(deliveryMessage.data);
      return;
    }
    if (message.type === 'navigationIntervention') {
      const feature = current.engine.getFeature(message.featureId);
      const step = feature.steps.find((s) => s.id === message.stepId);
      const attempt = step?.attempts.find((a) => a.id === message.attemptId);
      const request = attempt?.navigationRequest;
      if (
        !attempt ||
        !request ||
        step?.attempts.at(-1)?.id !== attempt.id ||
        attempt.status === 'running'
      )
        throw new Error('Cette demande de contexte est inactive ou l’agent travaille encore.');
      if (request.navigatorFeatureId) {
        send({ type: 'navigate', view: 'dashboard', featureId: request.navigatorFeatureId });
        return;
      }
      const application = current.navigation.application(request.applicationId);
      if (!application.ownerNavigatorId)
        throw new Error('Choisis le Navigateur dans le profil de l’application.');
      const projects = catalog.resolve(application.projectIds);
      const primary = projects.findIndex((p) => p.path === current.workspacePath);
      if (primary < 0) throw new Error('Le projet actif doit appartenir à cette application.');
      projects.unshift(...projects.splice(primary, 1));
      const created = await current.createFeature({
        title: `Accès pour ${feature.title}`.slice(0, 200),
        description: `Contexte manquant de la session ${feature.id}, étape ${step!.id}, tentative ${attempt.id}.\n${request.reason}\nObservations (données à vérifier) :\n${request.observations}`,
        agentId: application.ownerNavigatorId,
        projects,
        isolated: false,
      });
      created.navigation = {
        applicationId: application.id,
        parameters: {},
        intent: 'reach-state',
        allowInteractions: false,
      };
      request.navigatorFeatureId = created.id;
      await current.persist();
      send({ type: 'navigate', view: 'dashboard', featureId: created.id });
      return;
    }
    if (message.type === 'navigation') {
      try {
        const result = await current.navigation.handle(message.command);
        if (result.openPath)
          await vscode.window.showTextDocument(vscode.Uri.file(result.openPath), { preview: true });
        if (result.exportText) {
          const destination = await vscode.window.showSaveDialog({
            title: `Exporter ${result.exportName}`,
            filters: { JSON: ['json'] },
          });
          if (destination)
            await vscode.workspace.fs.writeFile(
              destination,
              Buffer.from(result.exportText, 'utf8'),
            );
        }
        if (result.description) {
          const { application, title, description } = result.description;
          const owner = application.ownerNavigatorId;
          if (
            !owner ||
            !current.state.agents.some(
              (agent) => agent.id === owner && agent.tools.includes('navigation'),
            )
          )
            throw new Error(
              'Choisis un profil Navigateur disposant de la capacité navigation dans le profil de l’application.',
            );
          const projects = catalog.resolve(application.projectIds);
          const primaryIndex = projects.findIndex((p) => p.path === current.workspacePath);
          if (primaryIndex < 0) throw new Error('L’application doit inclure le projet actif.');
          projects.unshift(...projects.splice(primaryIndex, 1));
          const feature = await current.createFeature({
            title,
            description,
            agentId: owner,
            projects,
            isolated: false,
            requestId: message.requestId,
          });
          feature.navigation = {
            applicationId: application.id,
            parameters: {},
            intent: 'reach-state',
            allowInteractions: false,
          };
          await current.persist();
          send({ type: 'navigate', view: 'dashboard', featureId: feature.id });
        }
        send({
          type: 'navigationState',
          state: current.navigation.snapshot(),
          requestId: message.requestId,
          message: result.message,
        });
      } catch (error) {
        send({
          type: 'navigationState',
          state: current.navigation.snapshot(),
          requestId: message.requestId,
          error: redact((error as Error).message),
        });
      }
      return;
    }
    switch (message.type) {
      case 'openNavigationCapture': {
        const feature = current.engine.getFeature(message.featureId);
        const capture = feature.steps
          .flatMap((s) => s.attempts.flatMap((a) => a.navigationCaptures ?? []))
          .find((c) => c.id === message.captureId);
        if (!capture) throw new Error('Capture inconnue pour cette session.');
        await current.navigation.verifiedCapture(capture);
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(capture.path), {
          preview: true,
        });
        return;
      }
      case 'setPermissionMode':
        await current.setPermissionMode(message.featureId, message.mode);
        return;
      case 'installQualityKit': {
        const result = await current.installQualityKit(message.featureId);
        notice(
          `Reporter qualité : ${result.installed.length} fichiers installés, ${result.unchanged.length} identiques, ${result.conflicts.length} personnalisations préservées. Guide : .feature-studio/quality-kit/README.md.`,
        );
        return;
      }
      case 'openQualityAttachment': {
        const { file, attachment } = await current.qualityAttachment(
          message.featureId,
          message.evidenceId,
          message.attachmentId,
        );
        if (attachment.kind === 'screenshot') {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file), {
            preview: true,
          });
        } else {
          const destination = await vscode.window.showSaveDialog({
            title: 'Enregistrer la trace Playwright pour consultation locale',
            defaultUri: vscode.Uri.file(
              path.join(current.workspacePath, `trace-${attachment.sha256.slice(0, 12)}.zip`),
            ),
            filters: { 'Trace Playwright': ['zip'] },
          });
          if (destination) {
            const verified = await current.qualityAttachment(
              message.featureId,
              message.evidenceId,
              message.attachmentId,
            );
            await vscode.workspace.fs.writeFile(destination, await readFile(verified.file));
            notice('Trace enregistrée. Aucun visualiseur en ligne ouvert.');
          }
        }
        return;
      }
      case 'ready':
        sendSecrets();
        quests.publish();
        discussions.publish();
        webviewReady = true;
        updateDashboardVisibility();
        send({ type: 'dashboardState', state: dashboard.snapshot() });
        if (dedicated) void drainRequests();
        sendTheme();
        sendZoom();
        sendLivingHq();
        current.publish();
        if (devops) send({ type: 'devopsState', state: devops.getState() });
        return;
      case 'refresh':
        await discussions.refreshProfiles();
        await current.refresh();
        return;
      case 'refreshQuests':
        await refreshPersonalRewards();
        for (const entry of hub.entries.values())
          await quests.record(studioQuestFacts(entry.service.snapshot()));
        await quests.record(discussionQuestFacts(discussions.snapshot()));
        return;
      case 'checkRuntime':
        await current.checkRuntime();
        return;
      case 'autoDetectCli':
        await vscode.workspace
          .getConfiguration('featureStudio')
          .update('cliPath', 'auto', vscode.ConfigurationTarget.Global);
        notice('Détection automatique activée pour les prochains lancements.');
        if (vscode.workspace.isTrusted) await current.checkRuntime();
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'featureStudio');
        return;
      case 'setAgentFavorite': {
        favoriteWrites = favoriteWrites
          .catch(() => undefined)
          .then(async () => {
            try {
              const ids = new Set(favorites());
              if (message.favorite) ids.add(message.agentId);
              else ids.delete(message.agentId);
              await vscode.workspace
                .getConfiguration('featureStudio')
                .update('favoriteAgentIds', [...ids], vscode.ConfigurationTarget.Global);
              current.publish();
              if (message.favorite) await recordQuest('favorite', message.agentId);
              send({
                type: 'agentFavoriteResult',
                requestId: message.requestId,
              });
            } catch (error) {
              send({
                type: 'agentFavoriteResult',
                requestId: message.requestId,
                error: (error as Error).message,
              });
            }
          });
        await favoriteWrites;
        return;
      }
      case 'saveFeatureTeam': {
        try {
          const revision = await current.saveFeatureTeam(
            message.featureId,
            message.expectedRevision,
            message.steps,
          );
          send({
            type: 'featureTeamResult',
            featureId: message.featureId,
            requestId: message.requestId,
            revision,
          });
        } catch (error) {
          send({
            type: 'featureTeamResult',
            featureId: message.featureId,
            requestId: message.requestId,
            error: (error as Error).message,
          });
        }
        return;
      }
      case 'openFeatureWorkspace': {
        current.assertTrusted();
        const root = message.projectId
          ? await current.projectPath(message.featureId, message.projectId)
          : await current.featurePath(message.featureId);
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), {
          forceNewWindow: true,
        });
        return;
      }
      case 'createCheckpoint':
        await current.createCheckpoint(message.featureId, message.label, message.projectId);
        notice('Point de restauration enregistré localement.');
        return;
      case 'compareCheckpoint': {
        const comparison = await current.compareCheckpoint(
          message.featureId,
          message.checkpointId,
          message.targetCheckpointId,
        );
        send({
          type: 'checkpointComparison',
          requestId: message.requestId,
          comparison,
        });
        return comparison;
      }
      case 'openCheckpointDiff': {
        const contents = await current.checkpointDiff(
          message.featureId,
          message.checkpointId,
          message.path,
          message.targetCheckpointId,
        );
        const display = (value?: Buffer): string =>
          value && (value.includes(0) || !Buffer.from(value.toString('utf8'), 'utf8').equals(value))
            ? `[Fichier binaire · ${value.length} octets · SHA-256 ${sha256(value)}]`
            : (value?.toString('utf8') ?? '');
        const left = vscode.Uri.from({
          scheme: 'feature-studio-diff',
          path: `/avant/${message.path}`,
          query: randomBytes(8).toString('hex'),
        });
        const right = vscode.Uri.from({
          scheme: 'feature-studio-diff',
          path: `/après/${message.path}`,
          query: randomBytes(8).toString('hex'),
        });
        diffContents.set(left.toString(), display(contents.before));
        diffContents.set(right.toString(), display(contents.after));
        await vscode.commands.executeCommand(
          'vscode.diff',
          left,
          right,
          `${message.path} · point ↔ ${message.targetCheckpointId ? 'point' : 'fichiers actuels'}`,
        );
        return;
      }
      case 'restoreCheckpoint': {
        const ensureSaved = async (): Promise<void> => {
          const { root } = await current.checkpointWorkspace(
            message.featureId,
            message.checkpointId,
          );
          const selected = new Set(message.paths.map((file) => path.resolve(root, file)));
          for (const document of vscode.workspace.textDocuments) {
            if (!document.isDirty || document.uri.scheme !== 'file') continue;
            const file = await realpath(document.uri.fsPath).catch(() =>
              path.resolve(document.uri.fsPath),
            );
            if (selected.has(file))
              throw new Error(
                `Enregistre ou ferme les modifications non enregistrées de ${path.basename(file)} avant la restauration.`,
              );
          }
        };
        await ensureSaved();
        await current.restoreCheckpoint(
          message.featureId,
          message.checkpointId,
          message.paths,
          message.expectedFingerprint,
          ensureSaved,
        );
        notice(
          'Fichiers restaurés. Le point de récupération conserve leur état précédent ; les étapes sont à revalider.',
        );
        return;
      }
      case 'pairAction':
        try {
          await current.pairAction(message);
          send({
            type: 'pairActionResult',
            requestId: message.requestId,
            featureId: message.featureId,
            stepId: message.stepId,
          });
        } catch (error) {
          send({
            type: 'pairActionResult',
            requestId: message.requestId,
            featureId: message.featureId,
            stepId: message.stepId,
            error: redact((error as Error).message),
          });
        }
        return;
      case 'runStep':
        if (!message.previewFingerprint || !message.launch)
          throw new Error('Prépare le contexte de cette tentative avant de la lancer.');
        void current
          .runStep(
            message.featureId,
            message.stepId,
            message.feedback,
            message.resume,
            message.launch,
            message.previewFingerprint,
          )
          .catch(report);
        return;
      case 'previewRun':
        send({
          type: 'runPreview',
          requestId: message.requestId,
          preview: await current.previewRun(
            message.featureId,
            message.stepId,
            message.feedback,
            message.resume,
            message.launch,
          ),
        });
        return;
      case 'answerHumanRequest':
        current.answerHumanRequest(message.requestId, message.answer);
        return;
      case 'testMcp':
        void current.testMcp(message.serverId).catch(report);
        return;
      case 'setMcpSecret': {
        current.assertTrusted();
        const server = current.state.settings.mcpServers?.find(
          (item) => item.id === message.serverId,
        );
        if (!server || ![...server.envKeys, ...Object.values(server.headers)].includes(message.key))
          throw new Error('Cette clé n’est pas référencée par le MCP enregistré.');
        const key = `studio-mcp:${sha256(current.workspacePath)}:${message.serverId}:${message.key}`;
        if (message.value) await context.secrets.store(key, message.value);
        else await context.secrets.delete(key);
        notice(
          message.value
            ? 'Secret enregistré dans le trousseau VS Code.'
            : 'Secret supprimé du trousseau.',
        );
        return;
      }
      case 'cancelRun':
        current.cancel(message.featureId);
        return;
      case 'approveStep':
        try {
          if (!message.expectedAttemptId || message.expectedRevision === undefined)
            throw new Error('Recharge le livrable avant de le valider.');
          await current.approveStep(
            message.featureId,
            message.stepId,
            message.expectedAttemptId,
            message.expectedRevision,
            'human',
            message.expectedReviewWarningsKey,
          );
          send({
            type: 'stepApprovalResult',
            featureId: message.featureId,
            stepId: message.stepId,
            attemptId: message.expectedAttemptId,
          });
          notice(
            current.engine.getFeature(message.featureId).status === 'awaiting_final_validation'
              ? 'Parcours relu : la validation définitive reste à confirmer.'
              : 'Étape validée.',
          );
        } catch (error) {
          send({
            type: 'stepApprovalResult',
            featureId: message.featureId,
            stepId: message.stepId,
            attemptId: message.expectedAttemptId,
            error: redact((error as Error).message),
          });
          throw error;
        }
        return;
      case 'answerQuestions':
        await current.answerQuestions(message.featureId, message.stepId, message.answers);
        return;
      case 'saveArtifact': {
        try {
          if (
            !message.expectedAttemptId ||
            message.expectedRevision === undefined ||
            !message.expectedStateKey
          )
            throw new Error('Recharge le compte rendu avant de l’enregistrer.');
          await current.saveArtifact(message.featureId, message.stepId, message.content, {
            expectedAttemptId: message.expectedAttemptId,
            expectedRevision: message.expectedRevision,
            expectedStateKey: message.expectedStateKey,
            description: message.description,
            reason: message.reason,
          });
          const attempt = current.engine
            .getStep(message.featureId, message.stepId)
            .attempts.at(-1)!;
          send({
            type: 'artifactSaveResult',
            featureId: message.featureId,
            stepId: message.stepId,
            attemptId: attempt.id,
            revision: attempt.revision ?? 0,
          });
          notice('Révision du compte rendu enregistrée.');
        } catch (error) {
          send({
            type: 'artifactSaveResult',
            featureId: message.featureId,
            stepId: message.stepId,
            error: redact((error as Error).message),
          });
          throw error;
        }
        return;
      }
      case 'requestCorrection': {
        try {
          const correctionId = await current.requestCorrection(message.featureId, message);
          send({
            type: 'correctionResult',
            featureId: message.featureId,
            correctionId,
          });
          notice('Correction enregistrée. Le pilote reprend avec les validations habituelles.');
        } catch (error) {
          send({
            type: 'correctionResult',
            featureId: message.featureId,
            error: redact((error as Error).message),
          });
          throw error;
        }
        return;
      }
      case 'finalizeFeature': {
        try {
          const finalizationId = await current.finalizeFeature(
            message.featureId,
            message.expectedStateKey,
          );
          send({
            type: 'featureFinalizationResult',
            featureId: message.featureId,
            finalizationId,
          });
          notice('Validation définitive enregistrée : session terminée.');
        } catch (error) {
          send({
            type: 'featureFinalizationResult',
            featureId: message.featureId,
            error: redact((error as Error).message),
          });
          throw error;
        }
        return;
      }
      case 'configureStep': {
        current.assertConfigurable(message.featureId);
        if (
          !current.state.agents.some((agent) => agent.id === message.agentId) ||
          message.skills.some((id) => !current.state.skills.some((skill) => skill.id === id))
        )
          throw new Error('Agent ou skill inconnu.');
        current.engine.configureStep(message.featureId, message.stepId, {
          agentId: message.agentId,
          model: message.model,
          reasoning: message.reasoning,
          skills: message.skills,
          maxAttempts: message.maxAttempts,
          initialContext: message.initialContext,
          mcpServerIds: message.mcpServerIds,
          askBeforeRun: message.askBeforeRun,
        });
        await current.persist();
        return;
      }
      case 'previewObservation':
        try {
          send({
            type: 'observationPreview',
            requestId: message.requestId,
            preview: await current.previewObservation(message.featureId, message.options),
          });
        } catch (error) {
          send({
            type: 'observationPreview',
            requestId: message.requestId,
            error: (error as Error).message,
          });
        }
        return;
      case 'runObservation':
        await current.observeSession(message.featureId, message.options, message.fingerprint);
        return;
      case 'cancelObservation':
        current.cancelObservation(message.featureId);
        return;
      case 'sessionStorage':
        try {
          send({
            type: 'sessionStorage',
            requestId: message.requestId,
            storage: await current.sessionStorage(message.featureId),
          });
        } catch (error) {
          send({
            type: 'sessionStorage',
            requestId: message.requestId,
            error: (error as Error).message,
          });
        }
        return;
      case 'sessionJournal':
        try {
          send({
            type: 'sessionJournal',
            requestId: message.requestId,
            ...(await current.sessionJournal(message.featureId, message.attemptId, message.offset)),
          });
        } catch (error) {
          send({
            type: 'sessionJournal',
            requestId: message.requestId,
            error: (error as Error).message,
          });
        }
        return;
      case 'observationSource':
        try {
          send({
            type: 'observationSource',
            requestId: message.requestId,
            ...(await current.observationSource(
              message.featureId,
              message.observationId,
              message.sourceId,
              message.offset,
            )),
          });
        } catch (error) {
          send({
            type: 'observationSource',
            requestId: message.requestId,
            error: (error as Error).message,
          });
        }
        return;
      case 'exportObservation': {
        const review = current.observation(message.featureId, message.observationId);
        const ext = message.format === 'html' ? 'html' : 'md';
        const destination = await vscode.window.showSaveDialog({
          title: 'Exporter le rapport de l’Observateur',
          defaultUri: vscode.Uri.file(
            path.join(current.workspacePath, `analyse-${review.id}.${ext}`),
          ),
          filters: message.format === 'html' ? { HTML: ['html'] } : { Markdown: ['md'] },
        });
        if (!destination) return;
        await vscode.workspace.fs.writeFile(
          destination,
          Buffer.from(
            message.format === 'html'
              ? observationHtml(review, current.engine.getFeature(message.featureId))
              : observationMarkdown(review, current.engine.getFeature(message.featureId)),
          ),
        );
        await vscode.window.showTextDocument(destination);
        return;
      }
      case 'deleteFeature': {
        const sessionDevops = devops;
        current.assertConfigurable(message.featureId);
        const feature = current.engine.getFeature(message.featureId);
        const storage = await current.sessionStorage(feature.id);
        const choice = await vscode.window.showWarningMessage(
          `Supprimer définitivement « ${feature.title} » ?`,
          {
            modal: true,
            detail: `Les journaux, contextes, rapports, pièces jointes et sauvegardes propres à cette session seront supprimés. Stockage propre : ${(storage.bytes / 1024 ** 2).toFixed(1)} Mio ; objets partagés : ${(storage.sharedBytes / 1024 ** 2).toFixed(1)} Mio (libérés uniquement s’ils ne servent plus). Les fichiers du projet, branches, worktrees et exports externes sont conservés. Cette action est irréversible.`,
          },
          'Supprimer définitivement',
        );
        if (choice !== 'Supprimer définitivement') return;
        try {
          const freedBytes = await current.deleteFeature(feature.id);
          await sessionDevops?.removeDeletedFeature(feature.id);
          send({ type: 'deleteFeatureResult', featureId: feature.id, freedBytes });
        } catch (error) {
          send({
            type: 'deleteFeatureResult',
            featureId: feature.id,
            error: `Nettoyage incomplet, reprise au prochain démarrage : ${(error as Error).message}`,
          });
        }
        return;
      }
      case 'archiveFeature':
        await current.archiveFeature(message.featureId, message.archived);
        return;
      case 'saveAgent':
      case 'saveSkill': {
        try {
          current.assertConfigurable();
          const result =
            message.type === 'saveAgent'
              ? await current.registry.saveAgent(message.agent, message.options)
              : await current.registry.saveSkill(message.id, message.content, message.options);
          await hub.refreshProfiles();
          await quests.record(studioQuestFacts(current.snapshot()));
          await discussions.refreshProfiles().catch(report);
          send({
            type: 'profileSaveResult',
            requestId: message.requestId,
            ...result,
          });
          notice(`Profil enregistré dans ${result.path}.`);
        } catch (error) {
          send({
            type: 'profileSaveResult',
            requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case 'saveSettings': {
        current.assertTrusted();
        const previous = current.state.settings;
        const oldScripts = JSON.stringify([
          previous.testCommands,
          previous.hooks.filter((h) => h.enabled),
          previous.mcpServers?.filter((server) => server.enabled),
        ]);
        const newScripts = JSON.stringify([
          message.settings.testCommands,
          message.settings.hooks.filter((h) => h.enabled),
          message.settings.mcpServers?.filter((server) => server.enabled),
        ]);
        if (
          oldScripts !== newScripts &&
          (message.settings.testCommands.length ||
            message.settings.hooks.some((h) => h.enabled) ||
            message.settings.mcpServers?.some((server) => server.enabled))
        ) {
          const commands =
            [...message.settings.testCommands, ...message.settings.hooks.filter((h) => h.enabled)]
              .map((c) => `${c.name} : ${c.command} ${c.args.join(' ')}`)
              .join('\n') +
            '\n' +
            (message.settings.mcpServers ?? [])
              .filter((server) => server.enabled)
              .map(
                (server) =>
                  `MCP ${server.name} : ${server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url} · outils : ${server.tools.join(', ')} · lectures automatiques : ${server.autoApproveReadOnly ? 'oui' : 'non'}`,
              )
              .join('\n');
          const choice = await vscode.window.showWarningMessage(
            'Autoriser ces commandes et connexions pour les prochaines sessions ?',
            {
              modal: true,
              detail: `${commands}\n\nLes commandes locales tournent sous ton compte. Les MCP sélectionnés pour une tentative peuvent accéder aux services de ton organisation. Une écriture MCP reste soumise à une autorisation par appel. Les hooks sont ignorés en lecture seule.`,
            },
            'Autoriser',
          );
          if (choice !== 'Autoriser') return;
        }
        await current.saveSettings(message.settings);
        notice('Réglages enregistrés.');
        return;
      }
      case 'migrateUserKit': {
        current.assertConfigurable();
        // Ensure relocated kit links have their shared resources; existing custom files are preserved.
        await current.registry.installKit();
        const migration = new RegistryMigration(current.registry);
        const plan = await migration.plan();
        const conflicts = plan.filter((entry) => entry.conflict);
        if (conflicts.length) {
          output.appendLine(
            `Migration : profils conservés dans le projet\n${conflicts.map((entry) => `${entry.label} : ${entry.conflict}`).join('\n')}`,
          );
          output.show(true);
        }
        const candidates = plan.filter((entry) => !entry.conflict);
        if (!candidates.length) {
          notice(
            conflicts.length
              ? 'Aucun profil migrable sans conflit. Voir la sortie Feature Studio.'
              : 'Aucun agent ou skill à migrer dans ce projet.',
          );
          return;
        }
        const selected = await vscode.window.showQuickPick(
          candidates.map((entry) => ({
            label: entry.label,
            description: entry.source,
            detail: `${entry.files.length} fichier(s) → ${current.registry.userPath}. Sauvegarde puis retrait de la copie du projet.`,
            entry,
          })),
          {
            canPickMany: true,
            title: 'Migrer les agents et skills vers le compte utilisateur',
            placeHolder:
              'Sélectionner les profils à partager entre les projets. Les originaux seront sauvegardés puis retirés du projet.',
            ignoreFocusOut: true,
          },
        );
        if (!selected?.length) return;
        current.assertConfigurable();
        const result = await migration.migrate(selected.map((item) => item.entry));
        await current.refresh();
        notice(
          `${result.migrated.length} profil(s) migré(s), ${result.conflicts.length} conflit(s). Sauvegarde : ${result.backupDirectory}.`,
        );
        output.appendLine(`Migration utilisateur\n${JSON.stringify(result, null, 2)}`);
        if (result.conflicts.length) output.show(true);
        return;
      }
      case 'kitCatalog':
      case 'kitPreview':
      case 'kitCompose':
      case 'kitImport':
      case 'kitExport':
      case 'kitInstall': {
        try {
          current.assertTrusted();
          if (message.type === 'kitCatalog') {
            send({
              type: 'kitResult',
              requestId: message.requestId,
              catalog: await current.kits.catalog(),
            });
          } else if (message.type === 'kitPreview' || message.type === 'kitCompose') {
            const bundle =
              message.type === 'kitCompose'
                ? await current.kits.compose(message.metadata, message.roots)
                : message.source === 'bundled'
                  ? await current.kits.preset(message.kitId)
                  : await current.kits.saved(message.kitId);
            send({
              type: 'kitResult',
              requestId: message.requestId,
              preview: await current.kits.preview(bundle),
            });
          } else if (message.type === 'kitImport') {
            const selected = await vscode.window.showOpenDialog({
              canSelectMany: false,
              canSelectFolders: false,
              filters: { 'Kit Feature Studio': ['json'] },
              title: 'Choisir un kit .fskit.json',
            });
            if (!selected?.[0])
              send({
                type: 'kitResult',
                requestId: message.requestId,
                cancelled: true,
              });
            else
              send({
                type: 'kitResult',
                requestId: message.requestId,
                preview: await current.kits.preview(
                  await current.kits.readBundle(selected[0].fsPath),
                ),
              });
          } else if (message.type === 'kitExport') {
            const bundle = current.kits.bundle(message.token);
            const destination = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(
                path.join(current.workspacePath, `${bundle.metadata.id}.fskit.json`),
              ),
              filters: { 'Kit Feature Studio': ['json'] },
              title: 'Exporter le kit',
            });
            if (!destination)
              send({
                type: 'kitResult',
                requestId: message.requestId,
                cancelled: true,
              });
            else {
              current.assertConfigurable();
              await writeFile(destination.fsPath, JSON.stringify(bundle, null, 2) + '\n');
              await current.kits.remember(bundle);
              await recordQuest('kitExport', bundle.metadata.id);
              send({
                type: 'kitResult',
                requestId: message.requestId,
                message: `Kit exporté : ${destination.fsPath}`,
                catalog: await current.kits.catalog(),
              });
            }
          } else {
            current.assertConfigurable();
            const result = await current.kits.install(message.token);
            await current.refresh();
            await recordQuest('kitImport', current.kits.bundle(message.token).metadata.id);
            await quests.record(studioQuestFacts(current.snapshot()));
            send({
              type: 'kitResult',
              requestId: message.requestId,
              message: result,
              preview: await current.kits.preview(current.kits.bundle(message.token)),
              catalog: await current.kits.catalog(),
            });
          }
        } catch (error) {
          send({
            type: 'kitResult',
            requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case 'installKit': {
        current.assertConfigurable();
        const result = await current.registry.installKit();
        await current.refresh();
        notice(
          `Kit utilisateur prêt dans ${result.directory} : ${result.installed.length} fichiers ajoutés, ${result.unchanged.length} identiques, ${result.conflicts.length} fichiers existants préservés.`,
        );
        if (result.conflicts.length) {
          output.appendLine(`Fichiers préservés :\n${result.conflicts.join('\n')}`);
          output.show(true);
        }
        return;
      }
      case 'openPersonalReviewReport': {
        const requested = await resolvePersonalReviewReport(
          current.registry.userPath,
          message.sessionId,
        );
        await vscode.window.showTextDocument(vscode.Uri.file(requested));
        return;
      }
      case 'openFile': {
        const registryPaths = [...current.state.agents, ...current.state.skills].map(
          (item) => item.path,
        );
        const workflowPaths = current.state.workflows.map((item) => item.source).filter(Boolean);
        const location = await current.fileLocation(message.featureId, message.path);
        const requested =
          !message.featureId &&
          path.isAbsolute(message.path) &&
          [...registryPaths, ...workflowPaths].includes(message.path)
            ? message.path
            : await new PolicyEngine(location.root, 'read-only', []).resolve(location.path);
        await vscode.window.showTextDocument(vscode.Uri.file(requested));
        return;
      }
      case 'openDiff': {
        const location = await current.fileLocation(message.featureId, message.path);
        const root = location.root;
        const absolute = await new PolicyEngine(root, 'read-only', []).resolve(location.path);
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        const old = await readHeadFile(root, absolute);
        const left = vscode.Uri.from({
          scheme: 'feature-studio-diff',
          path: `/${relative}`,
          query: randomBytes(8).toString('hex'),
        });
        diffContents.set(left.toString(), old ?? '');
        await vscode.commands.executeCommand(
          'vscode.diff',
          left,
          vscode.Uri.file(absolute),
          `${relative} · HEAD ↔ workspace`,
        );
        return;
      }
      case 'exportFeature': {
        const feature = current.engine.getFeature(message.featureId);
        const destination = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(
              current.workspacePath,
              `${feature.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)}.md`,
            ),
          ),
          filters: { Markdown: ['md'] },
          title: 'Exporter la session Feature Studio',
        });
        if (!destination) return;
        await vscode.workspace.fs.writeFile(
          destination,
          Buffer.from(sessionMarkdown(feature, current.workspacePath)),
        );
        await recordQuest('export', feature.id);
        await vscode.window.showTextDocument(destination);
        return;
      }
      case 'saveWorkflow': {
        current.assertTrusted();
        message.workflow.steps = inheritTeamProfiles(message.workflow.steps, current.state.agents);
        if (
          configurationSteps(message.workflow.steps).some(
            (step) =>
              !current.state.agents.some((agent) => agent.id === step.agentId) ||
              step.skills.some((id) => !current.state.skills.some((skill) => skill.id === id)),
          )
        )
          throw new Error('Un agent ou une skill du parcours n’existe pas.');
        const isNew = !current.state.workflows.some(
          (workflow) => workflow.id === message.workflow.id,
        );
        await current.registry.saveWorkflow(message.workflow);
        await current.refresh();
        if (isNew) await recordQuest('workflowsCreated', message.workflow.id);
        notice(
          'Parcours enregistré au niveau utilisateur. Les sessions existantes conservent leur définition.',
        );
        return;
      }
      case 'deleteWorkflow': {
        try {
          current.assertConfigurable();
          const workflow = current.state.workflows.find((entry) => entry.id === message.workflowId);
          if (!workflow) throw new Error('Parcours inconnu.');
          const choice = await vscode.window.showWarningMessage(
            `Supprimer « ${workflow.name} » du catalogue ?`,
            {
              modal: true,
              detail:
                'Ce parcours sera retiré de votre catalogue pour tous vos projets. Les sessions existantes et les fichiers de définition seront conservés.',
            },
            'Supprimer',
          );
          if (choice !== 'Supprimer') {
            send({ type: 'workflowDeleteResult', requestId: message.requestId, cancelled: true });
            return;
          }
          current.assertConfigurable();
          await current.registry.deleteWorkflow(message.workflowId);
          await hub.refreshProfiles();
          send({ type: 'workflowDeleteResult', requestId: message.requestId });
          notice('Parcours supprimé du catalogue. Les sessions existantes sont conservées.');
        } catch (error) {
          send({
            type: 'workflowDeleteResult',
            requestId: message.requestId,
            error: redact((error as Error).message),
          });
        }
        return;
      }
      case 'saveAutopilot':
        try {
          await current.saveAutopilot(message.featureId, message.config);
          if (message.requestId) send({ type: 'autopilotSaved', requestId: message.requestId });
        } catch (error) {
          if (message.requestId)
            send({
              type: 'autopilotSaved',
              requestId: message.requestId,
              error: redact((error as Error).message),
            });
          else report(error);
        }
        return;
      case 'previewAutopilot':
        try {
          send({
            type: 'autopilotPreview',
            requestId: message.requestId,
            preview: await current.previewAutopilot(message.featureId),
          });
        } catch (error) {
          send({
            type: 'autopilotPreview',
            requestId: message.requestId,
            error: redact((error as Error).message),
          });
        }
        return;
      case 'resolveOptionalStep':
        void current
          .resolveOptionalStep(message)
          .then(() => {
            if (message.requestId)
              send({ type: 'optionalStepResult', requestId: message.requestId });
          })
          .catch((error) => {
            if (message.requestId)
              send({
                type: 'optionalStepResult',
                requestId: message.requestId,
                error: redact((error as Error).message),
              });
            report(error);
          });
        return;
      case 'startAutopilot':
        void current.startAutopilot(message.featureId).catch(report);
        return;
      case 'pauseAutopilot':
        current.assertTrusted();
        current.pauseAutopilot(message.featureId);
        await current.persist();
        return;
      case 'saveBudget':
        await current.saveBudget(message.featureId, message.budget);
        await recordQuest('budget', message.featureId);
        return;
      case 'saveCriteria':
        await current.saveCriteria(message.featureId, message.criteria);
        return;
      case 'addReviewComment':
        await current.addReviewComment(message.featureId, message.comment);
        return;
      case 'resolveReviewComment':
        await current.resolveReviewComment(message.featureId, message.commentId, message.resolved);
        return;
      case 'saveMemory':
        await current.saveMemory(message.entry);
        notice('Mémoire enregistrée localement, sans appel IA.');
        return;
      case 'deleteMemory':
        await current.deleteMemory(message.id);
        return;
      case 'createWorkflow': {
        current.assertTrusted();
        const name = await vscode.window.showInputBox({
          prompt: 'Identifiant du nouveau workflow',
          placeHolder: 'mon-workflow',
          validateInput: (value) =>
            /^[a-z][a-z0-9-]{0,60}$/.test(value)
              ? undefined
              : 'Utilise des minuscules, chiffres et tirets.',
        });
        if (!name) return;
        // Configuration directory is intentionally owned by this explicit UI action, not agent tools.
        const directory = path.join(current.workspacePath, '.feature-studio', 'workflows');
        const { lstat } = await import('node:fs/promises');
        for (const part of [path.dirname(directory), directory]) {
          try {
            if ((await lstat(part)).isSymbolicLink())
              throw new Error('Dossier de workflows symbolique refusé.');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `${name}.yaml`),
          example = structuredClone(current.state.workflows.find((w) => w.id === 'single')!);
        delete example.source;
        example.id = name;
        example.name = name;
        await writeFile(file, stringify(example), { flag: 'wx' });
        await current.refresh();
        await vscode.window.showTextDocument(vscode.Uri.file(file));
        return;
      }
    }
  };

  const setWebviewHtml = async (target: vscode.WebviewPanel, surface: 'cockpit' | 'control') => {
    target.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');
    target.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    };
    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
    const base = target.webview.asWebviewUri(webviewRoot).toString() + '/';
    const nonce = randomBytes(20).toString('hex');
    let html = await readFile(path.join(context.extensionPath, 'dist/webview/index.html'), 'utf8');
    const csp = `default-src 'none'; img-src ${target.webview.cspSource} data:; style-src ${target.webview.cspSource} 'unsafe-inline'; font-src ${target.webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; base-uri ${target.webview.cspSource}; form-action 'none';`;
    html = html
      .replace(
        /<html\b/,
        `<html data-studio-surface="${surface}" data-studio-theme="${getTheme()}" data-studio-zoom="${getZoom()}" data-studio-living-hq="${getLivingHq()}"`,
      )
      .replace(
        '<head>',
        `<head><base href="${base}"><meta http-equiv="Content-Security-Policy" content="${csp}">`,
      )
      .replace(/<script\b/g, `<script nonce="${nonce}"`);
    target.webview.html = html;
  };
  const shutdownIfUnused = () => {
    updateDashboardVisibility();
    if (panel || dashboardPanel) return;
    shuttingDown = (async () => {
      await discussions.unload();
      await hub.dispose();
      await quests.flush();
      await rewards.flush();
      await lease?.release();
      lease = undefined;
    })().finally(() => {
      initialized = false;
      service = undefined;
      devops = undefined;
      shuttingDown = undefined;
    });
  };
  const mountDashboard = async (target: vscode.WebviewPanel) => {
    dashboardPanel = target;
    dashboardReady = false;
    target.onDidDispose(
      () => {
        if (dashboardPanel === target) dashboardPanel = undefined;
        dashboardReady = false;
        shutdownIfUnused();
      },
      undefined,
      context.subscriptions,
    );
    target.onDidChangeViewState(updateDashboardVisibility, undefined, context.subscriptions);
    target.webview.onDidReceiveMessage(
      (raw) => {
        if (raw?.type === 'ready') {
          dashboardReady = true;
          hub.publish();
          sendTheme();
          sendRewards();
          sendSecrets();
          sendZoom();
          send({ type: 'dashboardState', state: dashboard.snapshot() });
          updateDashboardVisibility();
          void credits.refresh();
          return;
        }
        if (
          [
            'dashboardVisible',
            'dashboardRefresh',
            'dashboardSave',
            'dashboardOpen',
            'dashboardFullscreen',
            'unlockDragonBall',
            'refreshSecretThemes',
          ].includes(raw?.type)
        )
          void dispatch(raw, 'control').catch(report);
      },
      undefined,
      context.subscriptions,
    );
    await ensure();
    await setWebviewHtml(target, 'control');
  };
  const openDashboard = async () => {
    if (dashboardPanel) {
      dashboardPanel.reveal();
      return;
    }
    const commands = new Set(await vscode.commands.getCommands(true));
    if (!commands.has('workbench.action.moveEditorToNewWindow'))
      throw new Error(
        'Cette version de VS Code ne permet pas de détacher le dashboard. Mets VS Code à jour.',
      );
    const target = vscode.window.createWebviewPanel(
      'featureStudio.dashboard',
      'Feature Studio · Tour de contrôle',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    await mountDashboard(target);
    target.reveal();
    await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
  };
  const mount = async (target: vscode.WebviewPanel): Promise<void> => {
    webviewReady = false;
    panel = target;
    updateDashboardVisibility();
    await setWebviewHtml(target, 'cockpit');
    target.webview.onDidReceiveMessage(
      (raw) => {
        void dispatch(raw).catch(report);
      },
      undefined,
      context.subscriptions,
    );
    target.onDidDispose(
      () => {
        if (panel === target) panel = undefined;
        webviewReady = false;
        cockpitDashboardVisible = false;
        shutdownIfUnused();
      },
      undefined,
      context.subscriptions,
    );
    target.onDidChangeViewState(
      () => {
        if (panel === target) updateDashboardVisibility();
      },
      undefined,
      context.subscriptions,
    );
    await ensure();
    sendTheme();
    sendZoom();
    service!.publish();
    if (devops) send({ type: 'devopsState', state: devops.getState() });
  };
  const revealPanel = () => {
    if (!panel) return false;
    panel.reveal();
    return true;
  };
  const openDedicated = async (action?: WindowRequest['action']) => {
    await dedicatedWindow.prepare();
    if (!dedicated) {
      await catalog.load();
      let projectId: string | undefined;
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (folder.uri.scheme !== 'file') continue;
        const root = await realpath(folder.uri.fsPath);
        const added = await catalog.add(
          [root],
          context.storageUri
            ? {
                root,
                storagePath: path.join(
                  context.storageUri.fsPath,
                  'studio',
                  sha256(root).slice(0, 24),
                ),
              }
            : undefined,
        );
        projectId ??= added[0]?.id;
      }
      if (action) await dedicatedWindow.enqueue(action, projectId);
      await vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(dedicatedWindow.workspace),
        { forceNewWindow: true },
      );
    } else {
      await open();
      if (action) {
        await dedicatedWindow.enqueue(action);
        await drainRequests();
      }
    }
  };
  const showObservationPicker = async () => {
    await ensure();
    const chosen = await vscode.window.showQuickPick(
      (hub.snapshot()?.features ?? []).map((feature) => ({
        label: feature.title,
        description: `${feature.workflowName}${feature.archived ? ' · archive' : ''}`,
        id: feature.id,
      })),
      { placeHolder: 'Quelle session souhaitez-vous analyser ?' },
    );
    if (chosen) {
      await ensure(chosen.id);
      send({ type: 'navigate', view: 'observation', featureId: chosen.id });
    }
  };
  let draining = false;
  const drainRequests = async () => {
    if (!dedicated || !webviewReady || draining) return;
    draining = true;
    try {
      for (const request of await dedicatedWindow.takeRequests()) {
        try {
          await hub.initialize();
          if (request.projectId && request.action !== 'newFeature') {
            const entry = await hub.activateProject(request.projectId);
            service = entry.service;
            devops = entry.devops;
          }
          if (request.action === 'newFeature') send({ type: 'navigate', view: 'create' });
          else if (request.action === 'analyzeSession') await showObservationPicker();
          else await dispatch({ type: request.action });
        } catch (error) {
          report(error);
        }
      }
    } finally {
      draining = false;
    }
  };
  const focusCockpit = async () => {
    const available = new Set(await vscode.commands.getCommands(true));
    for (const command of [
      'workbench.action.closeSidebar',
      'workbench.action.closePanel',
      'workbench.action.closeAuxiliaryBar',
    ])
      if (available.has(command)) await vscode.commands.executeCommand(command);
    panel?.reveal(vscode.ViewColumn.One);
  };
  const open = async (): Promise<boolean> => {
    try {
      if (revealPanel()) {
        await hub.initialize();
        const active = await hub.current();
        service = active.service;
        devops = active.devops;
        hub.publish();
        send({ type: 'devopsState', state: devops.getState() });
        if (dedicated) {
          await focusCockpit();
          await drainRequests();
        }
        return true;
      }
      await ensure();
      // Another click may have mounted the panel while project initialization was pending.
      if (revealPanel()) return true;
      await mount(
        vscode.window.createWebviewPanel('featureStudio', 'Feature Studio', vscode.ViewColumn.One, {
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );
      if (dedicated) await focusCockpit();
      return true;
    } catch (error) {
      report(error);
      void vscode.window.showErrorMessage((error as Error).message);
      return false;
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('featureStudio.open', open),
    vscode.commands.registerCommand('featureStudio.openDashboard', async () => {
      await ensure();
      await openDashboard();
    }),
    vscode.window.registerWebviewPanelSerializer('featureStudio.dashboard', {
      deserializeWebviewPanel: async (restored) => {
        if (dashboardPanel) {
          restored.dispose();
          dashboardPanel.reveal();
          return;
        }
        await mountDashboard(restored);
      },
    }),
    vscode.commands.registerCommand('featureStudio.analyzeSession', async () => {
      if (!(await open())) return;
      await showObservationPicker();
    }),
    vscode.commands.registerCommand('featureStudio.openDedicated', () => openDedicated()),
    vscode.commands.registerCommand('featureStudio.createWindowsShortcut', async () => {
      try {
        const destination = await dedicatedWindow.shortcut(
          process.execPath,
          path.join(context.extensionPath, 'resources', 'feature-studio.ico'),
        );
        void vscode.window.showInformationMessage(`Raccourci Feature Studio créé : ${destination}`);
      } catch (error) {
        report(error);
      }
    }),
    vscode.commands.registerCommand('featureStudio.newFeature', async () => {
      if (!(await open())) return;
      send({ type: 'navigate', view: 'create' });
    }),
    vscode.commands.registerCommand('featureStudio.installKit', async () => {
      if (!(await open())) return;
      await dispatch({ type: 'installKit' }).catch(report);
    }),
    vscode.commands.registerCommand('featureStudio.migrateUserKit', async () => {
      if (!(await open())) return;
      await dispatch({ type: 'migrateUserKit' }).catch(report);
    }),
    vscode.window.registerWebviewPanelSerializer('featureStudio', {
      deserializeWebviewPanel: async (restored) => {
        if (panel && panel !== restored) {
          restored.dispose();
          panel.reveal();
          return;
        }
        await mount(restored);
        if (dedicated) await focusCockpit();
      },
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      hub.publish();
      void credits.refresh();
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (dedicated && state.focused) void open();
    }),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
  status.text = '$(circuit-board) Feature Studio';
  status.tooltip = 'Ouvrir le cockpit agentique';
  status.command = 'featureStudio.open';
  status.show();
  context.subscriptions.push(status);
  if (dedicated) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(dedicatedWindow.requests), '*.json'),
    );
    context.subscriptions.push(
      watcher,
      watcher.onDidCreate(() => {
        void drainRequests().catch(report);
      }),
    );
    void open();
  }
  // The isolated extension-host smoke test uses the same validated message handler as the UI.
  return {
    getState: () => hub.snapshot(),
    getUiReady: () => webviewReady,
    getLauncherVisible: () => launcher.visible,
    getLauncherReady: () => launcher.isReady,
    getTheme,
    getZoom,
    getLivingHq,
    getQuestState: () => quests.snapshot(),
    getRewardState: () => rewards.snapshot(),
    getDevOpsState: () => devops?.getState(),
    getDashboardState: () => dashboard.snapshot(),
    getDashboardReady: () => dashboardReady,
    dispatchDashboard: (message: ClientMessage) => {
      if (
        ![
          'dashboardVisible',
          'dashboardRefresh',
          'dashboardSave',
          'dashboardOpen',
          'dashboardFullscreen',
        ].includes(message.type)
      )
        throw new Error('La Tour de contrôle est une vue de suivi.');
      return dispatch(message, 'control');
    },
    dispatch: (message: ClientMessage) => dispatch(message),
  };
}
export async function deactivate(): Promise<void> {
  await disposeHub?.();
  devops = undefined;
  service = undefined;
  await lease?.release();
  if (shuttingDown) await shuttingDown;
}
