import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { stringify } from 'yaml';
import { Store } from './core/store';
import { CopilotCliAdapter } from './host/CopilotCliAdapter';
import { StudioService } from './host/StudioService';
import { WorkspaceLease } from './host/WorkspaceLease';
import { PolicyEngine, sha256 } from './host/PolicyEngine';
import { parseMessage } from './host/messages';
import { runProcess } from './host/process';
import type { ClientMessage, HostMessage } from './shared/types';

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
          getTools: (input, callbacks, signal) => next.getTools(input, callbacks, signal),
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
  const dispatch = async (raw: unknown): Promise<void> => {
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
      case 'runStep':
        void current
          .runStep(message.featureId, message.stepId, message.feedback, message.resume)
          .catch(report);
        return;
      case 'cancelRun':
        current.cancel(message.featureId);
        return;
      case 'approveStep':
        current.engine.approveStep(message.featureId, message.stepId);
        await current.persist();
        return;
      case 'answerQuestions':
        current.engine.answerQuestions(message.featureId, message.stepId, message.answers);
        await current.persist();
        return;
      case 'saveArtifact':
        current.engine.saveArtifact(message.featureId, message.stepId, message.content);
        await current.persist();
        notice('Livrable enregistré.');
        return;
      case 'configureStep': {
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
        });
        await current.persist();
        return;
      }
      case 'archiveFeature':
        current.engine.archiveFeature(message.featureId, message.archived);
        await current.persist();
        return;
      case 'saveAgent':
        current.assertTrusted();
        await current.registry.saveAgent(message.agent);
        await current.refresh();
        notice('Agent enregistré dans .github/agents.');
        return;
      case 'saveSkill':
        current.assertTrusted();
        await current.registry.saveSkill(message.id, message.content);
        await current.refresh();
        notice('Skill enregistré dans .github/skills.');
        return;
      case 'saveSettings': {
        current.assertTrusted();
        const previous = current.state.settings;
        const oldScripts = JSON.stringify([
          previous.testCommands,
          previous.hooks.filter((h) => h.enabled),
        ]);
        const newScripts = JSON.stringify([
          message.settings.testCommands,
          message.settings.hooks.filter((h) => h.enabled),
        ]);
        if (
          oldScripts !== newScripts &&
          (message.settings.testCommands.length || message.settings.hooks.some((h) => h.enabled))
        ) {
          const commands = [
            ...message.settings.testCommands,
            ...message.settings.hooks.filter((h) => h.enabled),
          ]
            .map((c) => `${c.name} : ${c.command} ${c.args.join(' ')}`)
            .join('\n');
          const choice = await vscode.window.showWarningMessage(
            'Autoriser ces commandes locales pour les prochaines sessions ?',
            {
              modal: true,
              detail: `${commands}\n\nElles tournent avec les droits de ton compte. Une commande de test peut exécuter les scripts du projet. Les hooks sont ignorés en lecture seule.`,
            },
            'Autoriser',
          );
          if (choice !== 'Autoriser') return;
        }
        await current.saveSettings(message.settings);
        notice('Réglages enregistrés.');
        return;
      }
      case 'installKit': {
        current.assertTrusted();
        const result = await current.registry.installKit();
        await current.refresh();
        notice(
          `Kit prêt : ${result.installed.length} fichiers ajoutés, ${result.unchanged.length} identiques, ${result.conflicts.length} fichiers existants préservés.`,
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
          path.isAbsolute(message.path) &&
          [...registryPaths, ...workflowPaths].includes(message.path)
            ? message.path
            : await new PolicyEngine(current.workspacePath, 'read-only', []).resolve(message.path);
        await vscode.window.showTextDocument(vscode.Uri.file(requested));
        return;
      }
      case 'openDiff': {
        const absolute = await new PolicyEngine(current.workspacePath, 'read-only', []).resolve(
          message.path,
        );
        const relative = path.relative(current.workspacePath, absolute).split(path.sep).join('/');
        const old = await runProcess('git', ['show', `HEAD:${relative}`], current.workspacePath, {
          timeoutMs: 10000,
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
        ];
        for (const step of feature.steps) {
          parts.push(`## ${step.name} — ${step.status}`);
          for (const [i, attempt] of step.attempts.entries()) {
            parts.push(
              `### Tentative ${i + 1}\n${attempt.startedAt} · ${attempt.model || 'modèle non communiqué'} · ${attempt.status}`,
              attempt.artifact?.content ?? attempt.error ?? 'Aucun livrable.',
            );
            if (attempt.feedback) parts.push(`Feedback : ${attempt.feedback}`);
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
  // Small read-only API used by the isolated extension-host smoke test.
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
