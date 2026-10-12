import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CopilotClient,
  RuntimeConnection,
  type CopilotClientOptions,
  type CopilotSession,
  type SessionConfig,
  type SessionEvent,
  type Tool,
} from '@github/copilot-sdk';
import type {
  AgentAdapter,
  Question,
  RunCallbacks,
  RunEvent,
  RunInput,
  RunResult,
  RuntimeStatus,
  Usage,
} from '../shared/types';

export interface CopilotCliAdapterOptions {
  cliPath: string | (() => string);
  storagePath: string;
  getTools(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal): Promise<Tool[]>;
  /** Injection for transport tests. Production uses the official SDK. */
  clientFactory?: (options: CopilotClientOptions) => CopilotClient;
  checkTimeoutMs?: number;
}

export class RunCancelledError extends Error {
  constructor(message = 'Exécution annulée.') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function cancelled(signal: AbortSignal): Error {
  return signal.reason instanceof Error && signal.reason.name !== 'AbortError'
    ? signal.reason
    : new RunCancelledError();
}
async function withSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw cancelled(signal);
  let handler: () => void = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        handler = () => reject(cancelled(signal));
        signal.addEventListener('abort', handler, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', handler);
  }
}
function numeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Only this explicit block is interpreted as questions; ordinary code JSON remains an artifact. */
export function parseQuestions(content: string): { content: string; questions: Question[] } {
  const marker = /```feature-studio-questions\s*\n([\s\S]*?)```/g;
  const blocks = [...content.matchAll(marker)];
  if (blocks.length === 0) {
    if (content.includes('```feature-studio-questions'))
      throw new Error('Bloc de questions incomplet.');
    return { content: content.trim(), questions: [] };
  }
  if (blocks.length !== 1 || blocks[0][1].length > 32_000)
    throw new Error('Bloc de questions invalide.');
  let value: unknown;
  try {
    value = JSON.parse(blocks[0][1]);
  } catch {
    throw new Error('Le bloc de questions contient un JSON invalide.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('questions' in value) ||
    Object.keys(value).some((k) => k !== 'questions')
  )
    throw new Error('Le bloc doit contenir une liste questions.');
  const items = (value as { questions: unknown }).questions;
  if (!Array.isArray(items) || items.length > 12)
    throw new Error('Liste de questions invalide (12 maximum).');
  const ids = new Set<string>();
  const questions = items.map((item: unknown): Question => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Question invalide.');
    const q = item as Record<string, unknown>;
    if (Object.keys(q).some((k) => !['id', 'text', 'choices'].includes(k)))
      throw new Error('Champ de question inconnu.');
    if (
      typeof q.id !== 'string' ||
      !/^[a-zA-Z][\w-]{0,63}$/.test(q.id) ||
      ['constructor', 'prototype', '__proto__'].includes(q.id) ||
      ids.has(q.id)
    )
      throw new Error('Identifiant de question invalide ou dupliqué.');
    if (typeof q.text !== 'string' || !q.text.trim() || q.text.length > 2_000)
      throw new Error('Texte de question invalide.');
    if (
      q.choices !== undefined &&
      (!Array.isArray(q.choices) ||
        q.choices.length < 2 ||
        q.choices.length > 8 ||
        q.choices.some((c) => typeof c !== 'string' || !c.trim() || c.length > 300))
    )
      throw new Error('Choix de question invalides.');
    ids.add(q.id);
    return {
      id: q.id,
      text: q.text.trim(),
      ...(q.choices ? { choices: q.choices as string[] } : {}),
    };
  });
  return { content: content.replace(marker, '').trim(), questions };
}

export function buildPrompt(input: RunInput): string {
  const approved = input.feature.steps.flatMap((step) => {
    const attempt = step.attempts.at(-1);
    return step.status === 'approved' && attempt?.status === 'approved' && attempt.artifact
      ? [`### ${step.name}\n${attempt.artifact.content}`]
      : [];
  });
  const answers = Object.entries(input.attempt.answers)
    .map(([id, answer]) => `${id}: ${answer}`)
    .join('\n');
  return [
    `Feature : ${input.feature.title}\n${input.feature.description}`,
    `Étape : ${input.step.name}\n${input.step.description}\nProfil technique : ${input.step.policy}`,
    `Instructions de l'agent ${input.agent.name} :\n${input.agent.instructions}`,
    ...input.skills.map((s) => `Compétence ${s.name} :\n${s.content}`),
    approved.length ? `Livrables approuvés :\n${approved.join('\n\n')}` : '',
    input.attempt.feedback ? `Retour humain :\n${input.attempt.feedback}` : '',
    answers ? `Réponses humaines :\n${answers}` : '',
    input.attempt.artifact
      ? `Livrable précédent à reprendre :\n${input.attempt.artifact.content}`
      : '',
    'Produis le livrable de cette étape dans ta réponse finale. Utilise uniquement les outils studio fournis. ' +
      'Si une information humaine manque, arrête les actions dépendantes et termine avec un seul bloc :\n' +
      '```feature-studio-questions\n{"questions":[{"id":"question_id","text":"Question précise","choices":["Option A","Option B"]}]}\n```\n' +
      'Les choices sont facultatifs. Ne suppose jamais une réponse humaine. Aucun outil shell natif, MCP, publication ou push n’est autorisé.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export class CopilotCliAdapter implements AgentAdapter {
  private readonly clients = new Set<CopilotClient>();
  private readonly runs = new Set<AbortController>();
  private disposed = false;
  constructor(private readonly options: CopilotCliAdapterOptions) {}

  private async newClient(): Promise<CopilotClient> {
    if (this.disposed) throw new Error('Adaptateur fermé.');
    const directory = join(this.options.storagePath, 'copilot-runtime');
    await mkdir(directory, { recursive: true });
    if (this.disposed) throw new Error('Adaptateur fermé.');
    const path =
      typeof this.options.cliPath === 'function' ? this.options.cliPath() : this.options.cliPath;
    if (!path.trim()) throw new Error('Chemin Copilot CLI manquant.');
    const settings: CopilotClientOptions = {
      connection: RuntimeConnection.forStdio({
        path,
        args: [
          '--no-remote',
          '--no-custom-instructions',
          '--disable-builtin-mcps',
          '--disallow-temp-dir',
        ],
      }),
      workingDirectory: directory,
      baseDirectory: directory,
      useLoggedInUser: true,
      enableRemoteSessions: false,
      logLevel: 'none',
    };
    const client = this.options.clientFactory
      ? this.options.clientFactory(settings)
      : new CopilotClient(settings);
    this.clients.add(client);
    return client;
  }

  private async close(client: CopilotClient, session?: CopilotSession): Promise<void> {
    // Disconnect preserves persisted session data. A hung transport must not hang the extension.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          if (session) await session.disconnect().catch(() => {});
          await client.stop();
        })(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1_500);
        }),
      ]);
    } catch {
      /* forceStop below closes broken transport too */
    } finally {
      if (timer) clearTimeout(timer);
      await client.forceStop().catch(() => {});
      this.clients.delete(client);
    }
  }

  async check(): Promise<RuntimeStatus> {
    let client: CopilotClient | undefined;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Le diagnostic Copilot CLI a expiré.')),
      this.options.checkTimeoutMs ?? 15_000,
    );
    try {
      client = await this.newClient();
      await withSignal(client.start(), controller.signal);
      const status = await withSignal(client.getStatus(), controller.signal);
      if (status.protocolVersion < 3)
        throw new Error(`Protocole ${status.protocolVersion} incompatible : JSON-RPC v3 requis.`);
      const auth = await withSignal(client.getAuthStatus(), controller.signal);
      if (!auth.isAuthenticated)
        return {
          state: 'unavailable',
          version: status.version,
          authenticated: false,
          models: [],
          error: `Copilot CLI doit être connecté. Exécute copilot login avec COPILOT_HOME=${join(this.options.storagePath, 'copilot-runtime')}, ou fournis un token via COPILOT_GITHUB_TOKEN dans l’environnement du processus VS Code.`,
        };
      const models = await withSignal(client.listModels(), controller.signal);
      return {
        state: 'ready',
        version: status.version,
        authenticated: true,
        account: auth.login,
        models: models
          .filter((m) => m.policy?.state !== 'disabled')
          .map((m) => ({
            id: m.id,
            name: m.name,
            multiplier: m.billing?.multiplier,
            reasoningEfforts: m.supportedReasoningEfforts,
          })),
      };
    } catch (error) {
      return { state: 'unavailable', models: [], error: errorMessage(error) };
    } finally {
      clearTimeout(timer);
      if (client) await this.close(client);
    }
  }

  async run(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal): Promise<RunResult> {
    if (signal.aborted) throw cancelled(signal);
    const controller = new AbortController();
    this.runs.add(controller);
    const relay = () => controller.abort(cancelled(signal));
    signal.addEventListener('abort', relay, { once: true });
    const minutes = Number.isFinite(input.settings.timeoutMinutes)
      ? Math.max(1, Math.min(120, input.settings.timeoutMinutes))
      : 20;
    const timer = setTimeout(
      () => controller.abort(new Error(`Délai maximal de ${minutes} minutes dépassé.`)),
      minutes * 60_000,
    );
    let client: CopilotClient | undefined;
    let session: CopilotSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let abortRuntime: (() => void) | undefined;
    const emit = (kind: RunEvent['kind'], message: string) =>
      callbacks.onEvent({ id: randomUUID(), at: new Date().toISOString(), kind, message });
    try {
      client = await this.newClient();
      if (controller.signal.aborted) throw cancelled(controller.signal);
      await withSignal(client.start(), controller.signal);
      const auth = await withSignal(client.getAuthStatus(), controller.signal);
      if (!auth.isAuthenticated)
        throw new Error(
          'Copilot CLI n’est pas connecté dans l’environnement Feature Studio. Lance le diagnostic de connexion.',
        );
      const tools = await withSignal(
        this.options.getTools(input, callbacks, controller.signal),
        controller.signal,
      );
      const allowed = new Set(tools.map((t) => t.name));
      if (
        !tools.length ||
        allowed.size !== tools.length ||
        tools.some(
          (t) => !/^studio_[a-z0-9_]+$/.test(t.name) || !t.handler || t.overridesBuiltInTool,
        )
      )
        throw new Error(
          'Catalogue hôte invalide : des outils studio uniques, avec handlers, sont requis.',
        );
      const models = await withSignal(client.listModels(), controller.signal);
      const requestedModel =
        input.step.model || input.agent.model || input.settings.defaultModel || undefined;
      if (
        requestedModel &&
        !models.some((m) => m.id === requestedModel && m.policy?.state !== 'disabled')
      )
        throw new Error(`Le modèle ${requestedModel} n’est pas proposé par ce compte Copilot.`);
      const chosen = models.find((m) => m.id === requestedModel);
      if (
        input.step.reasoning &&
        (!chosen ||
          !chosen.supportedReasoningEfforts?.includes(
            input.step.reasoning as NonNullable<SessionConfig['reasoningEffort']>,
          ))
      )
        throw new Error('Ce modèle ne propose pas ce niveau de raisonnement.');
      const config: SessionConfig = {
        sessionId: randomUUID(),
        model: requestedModel,
        reasoningEffort: input.step.reasoning as SessionConfig['reasoningEffort'],
        workingDirectory: input.workspacePath,
        streaming: true,
        tools: tools.map((t) => ({ ...t, skipPermission: true, defer: 'never' })),
        // Exact custom names work on older v3 runtimes too. No wildcards or builtin aliases.
        availableTools: [...allowed],
        excludedTools: [
          'bash',
          'powershell',
          'shell',
          'edit',
          'create',
          'view',
          'glob',
          'grep',
          'task',
          'web_fetch',
          'web_search',
          'ask_user',
        ],
        enableConfigDiscovery: false,
        enableFileHooks: false,
        skipCustomInstructions: true,
        enableSkills: false,
        skillDirectories: [],
        pluginDirectories: [],
        mcpServers: {},
        enableHostGitOperations: false,
        enableSessionStore: false,
        enableExperimentalMode: false,
        skipEmbeddingRetrieval: true,
        embeddingCacheStorage: 'in-memory',
        enableOnDemandInstructionDiscovery: false,
        memory: { enabled: false },
        remoteSession: 'off',
        includeSubAgentStreamingEvents: false,
        customAgentsLocalOnly: true,
        infiniteSessions: { enabled: true },
        onPermissionRequest: () => ({
          kind: 'reject',
          feedback:
            'Feature Studio interdit les outils natifs et externes. Seuls les handlers studio appliquent les permissions.',
        }),
        hooks: {
          onPreToolUse: (request) => {
            if (!allowed.has(request.toolName) || controller.signal.aborted)
              return {
                permissionDecision: 'deny',
                permissionDecisionReason:
                  'Outil hors du périmètre Feature Studio ou tentative annulée.',
              };
            return {};
          },
        },
        systemMessage: {
          mode: 'append',
          content:
            'Tu exécutes une seule étape Feature Studio. Les restrictions sont appliquées par les outils hôtes. Termine avec le livrable Markdown et les questions structurées nécessaires.',
        },
        customAgents: [
          {
            name: 'feature-studio',
            displayName: input.agent.name,
            description: input.agent.description,
            prompt: input.agent.instructions,
            tools: [...allowed],
            infer: false,
          },
        ],
        agent: 'feature-studio',
      };
      session = input.resumeSessionId
        ? await withSignal(
            client.resumeSession(input.resumeSessionId, {
              ...config,
              allowTranscriptRecovery: false,
            }),
            controller.signal,
          )
        : await withSignal(client.createSession(config), controller.signal);
      callbacks.onSession(session.sessionId);
      abortRuntime = () => {
        void session?.abort().catch(() => {});
      };
      controller.signal.addEventListener('abort', abortRuntime, { once: true });
      // A protocol handshake does not prove support for additive SDK configuration.
      // Inspect the actual model-facing catalog before the first paid request.
      try {
        await withSignal(session.rpc.tools.initializeAndValidate(), controller.signal);
        const catalog = await withSignal(session.rpc.tools.getCurrentMetadata(), controller.signal);
        if (
          !catalog.tools ||
          catalog.tools.length !== allowed.size ||
          catalog.tools.some((t) => !allowed.has(t.name) || t.mcpServerName || t.namespacedName)
        )
          throw new Error(
            'Le runtime expose un catalogue différent des seuls outils hôtes autorisés.',
          );
      } catch (error) {
        if (controller.signal.aborted) throw cancelled(controller.signal);
        throw new Error(
          `Exécution refusée avant tout prompt : confinement des outils non vérifiable. ${errorMessage(error)} Mets Copilot CLI à jour manuellement vers une version compatible avec le SDK 1.0.20.`,
        );
      }
      emit(
        'info',
        `Catalogue vérifié : ${allowed.size} outils hôtes. Session ${session.sessionId}.`,
      );
      let content = '';
      let actualModel: string | undefined;
      let usage: Usage | undefined;
      const seen = new Set<string>();
      let resolveIdle!: () => void;
      let rejectIdle!: (error: Error) => void;
      const idle = new Promise<void>((resolve, reject) => {
        resolveIdle = resolve;
        rejectIdle = reject;
      });
      // Attach rejection handler immediately: errors may arrive while send() is awaiting acknowledgement.
      void idle.catch(() => {});
      const onEvent = (event: SessionEvent) => {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        if (event.agentId) return;
        switch (event.type) {
          case 'assistant.message_delta':
            emit('message', event.data.deltaContent);
            break;
          case 'assistant.message':
            if (!event.data.toolRequests?.length) content = event.data.content;
            break;
          case 'tool.execution_start':
            emit('tool', `Exécution : ${event.data.toolName}`);
            break;
          case 'tool.execution_complete':
            emit(
              event.data.success ? 'tool' : 'warning',
              event.data.success ? 'Outil terminé.' : 'Échec d’un outil.',
            );
            break;
          case 'assistant.usage': {
            const data = event.data;
            if (data.model && data.model !== 'auto') actualModel = data.model;
            usage ??= { source: 'measured' };
            if (numeric(data.inputTokens))
              usage.inputTokens = (usage.inputTokens ?? 0) + data.inputTokens;
            if (numeric(data.outputTokens))
              usage.outputTokens = (usage.outputTokens ?? 0) + data.outputTokens;
            if (numeric(data.copilotUsage?.totalNanoAiu)) {
              usage.cost = (usage.cost ?? 0) + data.copilotUsage.totalNanoAiu;
              usage.unit = 'nano-AIU';
            }
            usage.model = actualModel;
            emit(
              'usage',
              `Usage mesuré${actualModel ? ` (${actualModel})` : ''} : ${data.inputTokens ?? '?'} tokens entrants, ${data.outputTokens ?? '?'} sortants.`,
            );
            break;
          }
          case 'session.error':
            rejectIdle(new Error(event.data.message));
            emit('error', event.data.message);
            break;
          case 'session.idle':
            if (event.data.aborted) rejectIdle(new RunCancelledError());
            else resolveIdle();
            break;
          case 'session.compaction_start':
            emit('info', 'Compaction du contexte Copilot.');
            break;
        }
      };
      unsubscribe = session.on(onEvent);
      await withSignal(session.send({ prompt: buildPrompt(input) }), controller.signal);
      await withSignal(idle, controller.signal);
      if (!content.trim())
        throw new Error(
          'Copilot a terminé sans livrable final. Les fragments partiels ne sont pas validés comme livrable.',
        );
      const parsed = parseQuestions(content);
      return {
        ...parsed,
        sessionId: session.sessionId,
        model: actualModel,
        usage,
        changedFiles: [],
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', relay);
      this.runs.delete(controller);
      if (abortRuntime) controller.signal.removeEventListener('abort', abortRuntime);
      unsubscribe?.();
      if (!controller.signal.aborted)
        controller.abort(new RunCancelledError('Tentative terminée.'));
      if (client) await this.close(client, session);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.runs)
      controller.abort(new RunCancelledError('Extension fermée.'));
    await Promise.allSettled([...this.clients].map((client) => this.close(client)));
  }
}
