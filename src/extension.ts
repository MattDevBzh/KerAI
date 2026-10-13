import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { stringify } from 'yaml';
import { Store } from './core/store';
import { CopilotCliAdapter } from './host/CopilotCliAdapter';
import { RegistryMigration } from './core/registryMigration';
import { StudioService } from './host/StudioService';
import { WorkspaceLease } from './host/WorkspaceLease';
import { PolicyEngine, sha256 } from './host/PolicyEngine';
import { parseMessage } from './host/messages';
import { gitRead } from './host/gitRead';
import type { ClientMessage, HostMessage, CheckpointComparison } from './shared/types';

let panel: vscode.WebviewPanel | undefined;
let service: StudioService | undefined;
let lease: WorkspaceLease | undefined;
let initializing: Promise<StudioService> | undefined;
let shuttingDown: Promise<void> | undefined;
let webviewReady = false;
const diffContents = new Map<string, string>();

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Feature Studio');
  const send = (message: HostMessage) => {
    if (panel) void panel.webview.postMessage(message);
  };
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(message);
    send({ type: 'error', message });
  };
  context.subscriptions.push(
    output,
    vscode.workspace.registerTextDocumentContentProvider('feature-studio-diff', {
      provideTextDocumentContent: (uri) => diffContents.get(uri.toString()) ?? '',
    }),
  );
  const ensure = async (): Promise<StudioService> => {
    if (shuttingDown) await shuttingDown;
    if (service) return service;
    if (initializing) return initializing;
    initializing = (async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length)
        throw new Error('Ouvre un dossier de projet dans VS Code pour utiliser Feature Studio.');
      const folder =
        folders.length === 1
          ? folders[0]
          : await vscode.window.showWorkspaceFolderPick({
              placeHolder: 'Quel dossier souhaites-tu piloter ?',
            });
      if (!folder) throw new Error('Aucun dossier sélectionné.');
      if (folder.uri.scheme !== 'file' || !context.storageUri)
        throw new Error('Un dossier local ou distant sur disque est nécessaire.');
      const root = await realpath(folder.uri.fsPath);
      const newLease = new WorkspaceLease(root);
      await newLease.acquire();
      try {
        const store = new Store(
          path.join(context.storageUri.fsPath, 'studio', sha256(root).slice(0, 24)),
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
          cliPath: () =>
            vscode.workspace.getConfiguration('featureStudio').get('cliPath', 'copilot'),
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
        next.on('state', (state) => send({ type: 'state', state }));
        next.on('errorNotice', (message) => report(new Error(message)));
        service = next;
        lease = newLease;
        return next;
      } catch (error) {
        await newLease.release();
        throw error;
      }
    })();
    try {
      return await initializing;
    } finally {
      initializing = undefined;
    }
  };

  const notice = (message: string) => send({ type: 'notice', message });
  const dispatch = async (raw: unknown): Promise<void | CheckpointComparison> => {
    const message = parseMessage(raw),
      current = await ensure();
    switch (message.type) {
      case 'ready':
        webviewReady = true;
        current.publish();
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
      case 'createFeature': {
        const created = await current.createFeature(message);
        send({ type: 'navigate', view: 'dashboard', featureId: created.id });
        return;
      }
      case 'openFeatureWorkspace': {
        current.assertTrusted();
        const root = await current.featurePath(message.featureId);
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), {
          forceNewWindow: true,
        });
        return;
      }
      case 'createCheckpoint':
        await current.createCheckpoint(message.featureId, message.label);
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
          const root = await current.featurePath(message.featureId);
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
          preview: current.previewRun(
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
        if (!message.expectedAttemptId || message.expectedRevision === undefined)
          throw new Error('Recharge le livrable avant de le valider.');
        await current.approveStep(
          message.featureId,
          message.stepId,
          message.expectedAttemptId,
          message.expectedRevision,
        );
        return;
      case 'answerQuestions':
        current.assertTrusted();
        current.engine.answerQuestions(message.featureId, message.stepId, message.answers);
        await current.persist();
        return;
      case 'saveArtifact':
        current.assertConfigurable(message.featureId);
        current.engine.saveArtifact(message.featureId, message.stepId, message.content);
        await current.persist();
        notice('Livrable enregistré.');
        return;
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
        current.assertConfigurable();
        await current.registry.saveAgent(message.agent);
        await current.refresh();
        notice(`Agent enregistré au niveau utilisateur dans ${current.registry.userPath}.`);
        return;
      case 'saveSkill':
        current.assertConfigurable();
        await current.registry.saveSkill(message.id, message.content);
        await current.refresh();
        notice(`Skill enregistrée au niveau utilisateur dans ${current.registry.userPath}.`);
        return;
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
        const requested =
          !message.featureId &&
          path.isAbsolute(message.path) &&
          [...registryPaths, ...workflowPaths].includes(message.path)
            ? message.path
            : await new PolicyEngine(
                await current.featurePath(message.featureId),
                'read-only',
                [],
              ).resolve(message.path);
        await vscode.window.showTextDocument(vscode.Uri.file(requested));
        return;
      }
      case 'openDiff': {
        const root = await current.featurePath(message.featureId);
        const absolute = await new PolicyEngine(root, 'read-only', []).resolve(message.path);
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        const old = await gitRead(root, ['show', `HEAD:${relative}`], {
          timeoutMs: 10000,
          rawOutput: true,
        });
        const left = vscode.Uri.from({
          scheme: 'feature-studio-diff',
          path: `/${relative}`,
          query: randomBytes(8).toString('hex'),
        });
        diffContents.set(left.toString(), old.code === 0 ? old.stdout : '');
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
        const parts = [
          `# ${feature.title}`,
          feature.description,
          `Branche : ${feature.branch}\nWorkflow : ${feature.workflowName}`,
          `Espace : ${feature.worktree?.path ?? current.workspacePath}`,
        ];
        for (const checkpoint of feature.checkpoints ?? [])
          parts.push(
            `Point de restauration : ${checkpoint.label} · ${checkpoint.kind} · ${checkpoint.createdAt} · ${checkpoint.fileCount} fichiers · ${checkpoint.excludedCount} exclusions · ${checkpoint.id}`,
          );
        for (const step of feature.steps) {
          parts.push(`## ${step.name} — ${step.status}`);
          for (const [i, attempt] of step.attempts.entries()) {
            parts.push(
              `### Tentative ${i + 1}\n${attempt.startedAt} · ${attempt.model || 'modèle non communiqué'} · ${attempt.status}`,
              attempt.artifact?.content ?? attempt.error ?? 'Aucun livrable.',
            );
            if (attempt.feedback) parts.push(`Feedback : ${attempt.feedback}`);
            if (attempt.launch?.initialContext)
              parts.push(`Contexte initial :\n${attempt.launch.initialContext}`);
            if (attempt.usage) parts.push(`Usage mesuré : ${JSON.stringify(attempt.usage)}`);
            for (const proof of attempt.evidence ?? [])
              parts.push(
                `#### Preuve hôte · ${proof.name}\n${proof.command} ${proof.args.join(' ')}\n${proof.startedAt} → ${proof.finishedAt}\nCode : ${proof.exitCode ?? 'inconnu'}${proof.truncated ? ' · sortie tronquée' : ''}\n\n\`\`\`text\n${proof.stdout}\n${proof.stderr}\n\`\`\``,
              );
            for (const question of attempt.questions)
              parts.push(
                `- ${question.text}\n  Réponse : ${attempt.answers[question.id] ?? 'En attente'}`,
              );
          }
        }
        await vscode.workspace.fs.writeFile(destination, Buffer.from(parts.join('\n\n')));
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
        notice('Parcours enregistré. Les sessions existantes conservent leur définition.');
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
        const previous = service,
          oldLease = lease;
        service = undefined;
        lease = undefined;
        shuttingDown = (async () => {
          try {
            await previous?.dispose();
          } finally {
            await oldLease?.release();
          }
        })().finally(() => {
          shuttingDown = undefined;
        });
      },
      undefined,
      context.subscriptions,
    );
    await ensure();
    service!.publish();
  };
  const open = async () => {
    try {
      if (panel) {
        panel.reveal();
        return;
      }
      await ensure();
      await mount(
        vscode.window.createWebviewPanel('featureStudio', 'Feature Studio', vscode.ViewColumn.One, {
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );
    } catch (error) {
      report(error);
      void vscode.window.showErrorMessage((error as Error).message);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('featureStudio.open', open),
    vscode.commands.registerCommand('featureStudio.newFeature', async () => {
      await open();
      send({ type: 'navigate', view: 'create' });
    }),
    vscode.commands.registerCommand('featureStudio.installKit', async () => {
      await open();
      await dispatch({ type: 'installKit' }).catch(report);
    }),
    vscode.commands.registerCommand('featureStudio.migrateUserKit', async () => {
      await open();
      await dispatch({ type: 'migrateUserKit' }).catch(report);
    }),
    vscode.window.registerWebviewPanelSerializer('featureStudio', {
      deserializeWebviewPanel: async (restored) => {
        await mount(restored);
      },
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => service?.publish()),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
  status.text = '$(circuit-board) Feature Studio';
  status.tooltip = 'Ouvrir le cockpit agentique';
  status.command = 'featureStudio.open';
  status.show();
  context.subscriptions.push(status);
  // The isolated extension-host smoke test uses the same validated message handler as the UI.
  return {
    getState: () => service?.snapshot(),
    getUiReady: () => webviewReady,
    dispatch: (message: ClientMessage) => dispatch(message),
  };
}
export async function deactivate(): Promise<void> {
  await service?.dispose();
  await lease?.release();
  if (shuttingDown) await shuttingDown;
}
