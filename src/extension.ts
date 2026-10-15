import { StudioHub } from './host/StudioHub';
import { ProjectCatalog, type StoredProject } from './host/ProjectCatalog';
import { DedicatedWindow, type WindowRequest } from './host/DedicatedWindow';
import { sessionMarkdown } from './shared/sessionExport';
import { DevOpsController } from './host/DevOpsController';
import { devOpsMessageSchema } from './core/devopsSchemas';
import { devOpsPlainText } from './shared/devopsText';
import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { stringify } from 'yaml';
import { Store } from './core/store';
import { CopilotCliAdapter } from './host/CopilotCliAdapter';
import { CockpitLauncher } from './host/CockpitLauncher';
import { RegistryMigration } from './core/registryMigration';
import { StudioService } from './host/StudioService';
import { WorkspaceLease } from './host/WorkspaceLease';
import { PolicyEngine, sha256 } from './host/PolicyEngine';
import { parseMessage } from './host/messages';
import { readHeadFile } from './host/GitFileContent';
import { redact } from './host/process';
import type { ClientMessage, HostMessage, CheckpointComparison } from './shared/types';
import { normalizeTheme } from './shared/themes';

let panel: vscode.WebviewPanel | undefined;
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
  const launcher = new CockpitLauncher(context.extensionUri, async () => {
    if (!vscode.workspace.isTrusted)
      return {
        state: 'unavailable',
        message: 'Approuve cet espace de travail pour connecter Copilot CLI.',
      };
    const cliPath = vscode.workspace.getConfiguration('featureStudio').get('cliPath', 'copilot');
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
  });
  const send = (message: HostMessage) => {
    if (panel) void panel.webview.postMessage(message);
  };
  const getTheme = () =>
    normalizeTheme(vscode.workspace.getConfiguration('featureStudio').get('appearance.theme'));
  const sendTheme = (requestId?: string, error?: string) =>
    send({ type: 'themeState', theme: getTheme(), requestId, error });
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
  context.subscriptions.push(
    output,
    launcher,
    {
      dispose: () => {
        void quotaAdapter?.dispose();
      },
    },
    vscode.window.registerWebviewViewProvider('featureStudio.launcher', launcher),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('featureStudio.appearance.theme')) sendTheme();
      if (event.affectsConfiguration('featureStudio.favoriteAgentIds')) service?.publish();
    }),
    vscode.workspace.registerTextDocumentContentProvider('feature-studio-diff', {
      provideTextDocumentContent: (uri) => diffContents.get(uri.toString()) ?? '',
    }),
  );
  const hubDirectory = path.join(context.globalStorageUri.fsPath, 'cockpit');
  const dedicatedWindow = new DedicatedWindow(hubDirectory);
  const dedicated = dedicatedWindow.isDedicated(vscode.workspace.workspaceFile?.fsPath);
  const catalog = new ProjectCatalog(hubDirectory);
  let initialized = false;
  const hub = new StudioHub(
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
      await next.initialize();
      const config = vscode.workspace.getConfiguration('featureStudio');
      if (isNew) {
        next.state.settings.defaultModel = config.get('defaultModel', '');
        next.state.settings.timeoutMinutes = config.get('timeoutMinutes', 20);
        await next.persist();
      }
      next.adapter = new CopilotCliAdapter({
        cliPath: () => vscode.workspace.getConfiguration('featureStudio').get('cliPath', 'copilot'),
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
      next.on('errorNotice', (message) => report(new Error(message)));
      const controller = new DevOpsController({
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
        features: () => next.state.features,
        createFeature: async (ticket) => {
          const feature = await next.createFeature({
            title: `#${ticket.id} — ${ticket.title}`,
            description: [
              devOpsPlainText(ticket.description),
              'Critères d’acceptation :',
              devOpsPlainText(ticket.acceptanceCriteria) || 'Non renseignés.',
              `Source Azure DevOps : ${ticket.url}`,
            ].join('\n\n'),
            isolated: false,
            projects: project ? [project] : undefined,
          });
          return feature.id;
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
  disposeHub = async () => {
    await hub.dispose();
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
      if (!dedicated && !catalog.state.projects.length) {
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
      await hub.initialize();
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
  const dispatch = async (raw: unknown): Promise<void | CheckpointComparison> => {
    const message = parseMessage(raw);
    if (message.type === 'setTheme') {
      themeWrites = themeWrites.then(async () => {
        try {
          await vscode.workspace
            .getConfiguration('featureStudio')
            .update('appearance.theme', message.theme, vscode.ConfigurationTarget.Global);
          sendTheme(message.requestId);
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
      'requestId' in message
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
    await bootstrap();
    if (message.type === 'activateProject') {
      const entry = await hub.activateProject(message.projectId);
      service = entry.service;
      devops = entry.devops;
      hub.publish();
      send({ type: 'devopsState', state: devops.getState() });
      return;
    }
    if (message.type === 'createFeature') {
      const projects = catalog.resolve(message.projectIds ?? catalog.state.selectedProjectIds);
      const entry = await hub.select(projects.map((project) => project.id));
      service = entry.service;
      devops = entry.devops;
      const created = await service.createFeature({ ...message, projects });
      send({ type: 'navigate', view: 'dashboard', featureId: created.id });
      return;
    }
    const requestOwner =
      message.type === 'answerHumanRequest'
        ? hub.snapshot()?.humanRequests?.find((request) => request.id === message.requestId)
            ?.featureId
        : undefined;
    const current = await ensure('featureId' in message ? message.featureId : requestOwner);
    if (message.type === 'activateFeature') {
      current.publish();
      send({ type: 'devopsState', state: devops!.getState() });
      return;
    }
    const deliveryMessage = devOpsMessageSchema.safeParse(message);
    if (deliveryMessage.success) {
      await devops!.handle(deliveryMessage.data);
      return;
    }
    switch (message.type) {
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
        webviewReady = true;
        if (dedicated) void drainRequests();
        sendTheme();
        current.publish();
        if (devops) send({ type: 'devopsState', state: devops.getState() });
        return;
      case 'refresh':
        await current.refresh();
        return;
      case 'checkRuntime':
        await current.checkRuntime();
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
        current.assertTrusted();
        current.engine.answerQuestions(message.featureId, message.stepId, message.answers);
        await current.persist();
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
      case 'archiveFeature':
        current.assertConfigurable(message.featureId);
        current.engine.archiveFeature(message.featureId, message.archived);
        await current.persist();
        return;
      case 'saveAgent':
      case 'saveSkill': {
        try {
          current.assertConfigurable();
          const result =
            message.type === 'saveAgent'
              ? await current.registry.saveAgent(message.agent, message.options)
              : await current.registry.saveSkill(message.id, message.content, message.options);
          await current.refresh();
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
        await vscode.window.showTextDocument(destination);
        return;
      }
      case 'saveWorkflow':
        current.assertTrusted();
        if (
          message.workflow.steps.some(
            (step) =>
              !current.state.agents.some((agent) => agent.id === step.agentId) ||
              step.skills.some((id) => !current.state.skills.some((skill) => skill.id === id)),
          )
        )
          throw new Error('Un agent ou une skill du parcours n’existe pas.');
        await current.registry.saveWorkflow(message.workflow);
        await current.refresh();
        notice(
          'Parcours enregistré au niveau utilisateur. Les sessions existantes conservent leur définition.',
        );
        return;
      case 'saveAutopilot':
        await current.saveAutopilot(message.featureId, message.config);
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

  const mount = async (target: vscode.WebviewPanel): Promise<void> => {
    webviewReady = false;
    panel = target;
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
      .replace(/<html\b/, `<html data-studio-theme="${getTheme()}"`)
      .replace(
        '<head>',
        `<head><base href="${base}"><meta http-equiv="Content-Security-Policy" content="${csp}">`,
      )
      .replace(/<script\b/g, `<script nonce="${nonce}"`);
    target.webview.html = html;
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
        shuttingDown = hub.dispose().finally(() => {
          initialized = false;
          service = undefined;
          devops = undefined;
          shuttingDown = undefined;
        });
      },
      undefined,
      context.subscriptions,
    );
    await ensure();
    sendTheme();
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
  const open = async () => {
    if (!dedicated && context.extensionMode !== vscode.ExtensionMode.Test) {
      await openDedicated();
      return;
    }
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
        return;
      }
      await ensure();
      // Another click may have mounted the panel while project initialization was pending.
      if (revealPanel()) return;
      await mount(
        vscode.window.createWebviewPanel('featureStudio', 'Feature Studio', vscode.ViewColumn.One, {
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );
      if (dedicated) await focusCockpit();
    } catch (error) {
      report(error);
      void vscode.window.showErrorMessage((error as Error).message);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('featureStudio.open', open),
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
      if (!dedicated && context.extensionMode !== vscode.ExtensionMode.Test)
        return openDedicated('newFeature');
      await open();
      send({ type: 'navigate', view: 'create' });
    }),
    vscode.commands.registerCommand('featureStudio.installKit', async () => {
      if (!dedicated && context.extensionMode !== vscode.ExtensionMode.Test)
        return openDedicated('installKit');
      await open();
      await dispatch({ type: 'installKit' }).catch(report);
    }),
    vscode.commands.registerCommand('featureStudio.migrateUserKit', async () => {
      if (!dedicated && context.extensionMode !== vscode.ExtensionMode.Test)
        return openDedicated('migrateUserKit');
      await open();
      await dispatch({ type: 'migrateUserKit' }).catch(report);
    }),
    vscode.window.registerWebviewPanelSerializer('featureStudio', {
      deserializeWebviewPanel: async (restored) => {
        if (!dedicated && context.extensionMode !== vscode.ExtensionMode.Test) {
          restored.dispose();
          await openDedicated();
          return;
        }
        if (panel && panel !== restored) {
          restored.dispose();
          panel.reveal();
          return;
        }
        await mount(restored);
        if (dedicated) await focusCockpit();
      },
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => hub.publish()),
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
    getDevOpsState: () => devops?.getState(),
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
