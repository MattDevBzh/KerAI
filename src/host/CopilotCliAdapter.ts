import { randomUUID } from 'node:crypto';
import { accountCredits, type AccountCredits } from '../shared/credits';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CopilotLaunch } from './CopilotLaunch';
import { redact } from './process';
import { z } from 'zod';
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
  McpServerConfig,
  McpCatalog,
  ReviewReport,
} from '../shared/types';
import { buildPrompt } from '../core/context';
export { buildPrompt } from '../core/context';
import {
  decideMcpPermission,
  McpStreamRedactor,
  redactMcp,
  resolveMcpPlan,
  verifyMcpCatalog,
  type McpSecretResolver,
} from './McpRuntime';

export interface CopilotCliAdapterOptions {
  cliPath: string | (() => string);
  storagePath: string;
  getTools(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal): Promise<Tool[]>;
  /** Injection for transport tests. Production uses the official SDK. */
  clientFactory?: (options: CopilotClientOptions) => CopilotClient;
  checkTimeoutMs?: number;
  resolveMcpSecret?: McpSecretResolver;
  /** Packaged Node launcher; stdout/stdin remain reserved for the SDK's JSON-RPC. */
  launcherPath?: string;
  debugLog?: (message: string) => void;
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

const reviewSchema = z
  .object({
    verdict: z.enum(['pass', 'changes_requested']),
    summary: z.string().trim().min(1).max(10_000),
    findings: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
            severity: z.enum(['info', 'warning', 'blocking']),
            message: z.string().trim().min(1).max(4_000),
            file: z.string().min(1).max(1_000).optional(),
            line: z.number().int().positive().max(1_000_000).optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

/** Structured review is optional; an absent or malformed report is never invented as a pass. */
export function parseReview(content: string): ReviewReport | undefined {
  const blocks = [...content.matchAll(/```feature-studio-review\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) {
    if (content.includes('```feature-studio-review')) throw new Error('Bloc de revue incomplet.');
    return undefined;
  }
  if (blocks.length !== 1 || blocks[0][1].length > 128_000)
    throw new Error('Bloc de revue invalide.');
  let value: unknown;
  try {
    value = JSON.parse(blocks[0][1]);
  } catch {
    throw new Error('Le bloc de revue contient un JSON invalide.');
  }
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success) throw new Error('Le bloc de revue ne respecte pas le contrat attendu.');
  const report = parsed.data;
  if (
    new Set(report.findings.map((f) => f.id)).size !== report.findings.length ||
    report.findings.some((f) => ['__proto__', 'constructor', 'prototype'].includes(f.id))
  )
    throw new Error('Identifiants de constats de revue invalides ou dupliqués.');
  if (report.verdict === 'pass' && report.findings.some((f) => f.severity === 'blocking'))
    throw new Error('Revue contradictoire : un constat bloquant interdit le verdict pass.');
  return report;
}

export class CopilotCliAdapter implements AgentAdapter {
  private readonly clients = new Set<CopilotClient>();
  private readonly launches = new Map<CopilotClient, CopilotLaunch>();
  private readonly closing = new Map<CopilotClient, Promise<void>>();
  private readonly runs = new Set<AbortController>();
  private disposed = false;
  private quotaClient: CopilotClient | undefined;
  constructor(private readonly options: CopilotCliAdapterOptions) {}

  /** Account metadata only: no session, prompt, model call or project tools. */
  async getAccountCredits(): Promise<AccountCredits> {
    const controller = new AbortController();
    this.runs.add(controller);
    const timer = setTimeout(() => controller.abort(), this.options.checkTimeoutMs ?? 8_000);
    let client: CopilotClient | undefined;
    try {
      client = this.quotaClient;
      if (!client) {
        client = await this.newClient();
        await withSignal(client.start(), controller.signal);
        this.quotaClient = client;
      }
      const auth = await withSignal(client.getAuthStatus(), controller.signal);
      if (!auth.isAuthenticated) {
        this.quotaClient = undefined;
        await this.close(client);
        return {
          state: 'unavailable',
          message: 'Connecte Copilot CLI pour consulter tes crédits.',
        };
      }
      const result = await withSignal(client.rpc.account.getQuota({}), controller.signal);
      // Only the billing flags are projected; credentials never leave the host.
      const current = await withSignal(client.rpc.account.getCurrentAuth(), controller.signal);
      return accountCredits(
        result.quotaSnapshots,
        current.authInfo && 'copilotUser' in current.authInfo
          ? current.authInfo.copilotUser
          : undefined,
      );
    } catch {
      this.quotaClient = undefined;
      if (client) await this.close(client);
      return {
        state: 'unavailable',
        message: 'Crédits indisponibles : connexion ou API de quota du CLI inaccessible.',
      };
    } finally {
      clearTimeout(timer);
      this.runs.delete(controller);
    }
  }

  private async newClient(secrets: Set<string> = new Set()): Promise<CopilotClient> {
    if (this.disposed) throw new Error('Adaptateur fermé.');
    const directory = join(this.options.storagePath, 'copilot-runtime');
    await mkdir(directory, { recursive: true });
    if (this.disposed) throw new Error('Adaptateur fermé.');
    const path =
      typeof this.options.cliPath === 'function' ? this.options.cliPath() : this.options.cliPath;
    if (!path.trim()) throw new Error('Chemin Copilot CLI manquant.');
    const launch = await CopilotLaunch.create(path, directory, this.options.debugLog, secrets);
    if (this.disposed) {
      await launch.dispose();
      throw new Error('Adaptateur fermé.');
    }
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FEATURE_STUDIO_REDACT_VALUES: JSON.stringify([...secrets]),
    };
    delete (env as NodeJS.ProcessEnv).NODE_OPTIONS;
    const settings: CopilotClientOptions = {
      connection: RuntimeConnection.forStdio({
        path: this.options.launcherPath ?? join(__dirname, 'copilot-launcher.js'),
        args: [
          launch.configPath,
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
      env,
    };
    try {
      const client = this.options.clientFactory
        ? this.options.clientFactory(settings)
        : new CopilotClient(settings);
      this.clients.add(client);
      this.launches.set(client, launch);
      this.options.debugLog?.(
        launch.safe(`Démarrage Copilot CLI : ${launch.executable} ; transport JSON-RPC stdio.`),
      );
      return client;
    } catch (error) {
      await launch.dispose();
      throw error;
    }
  }

  private async runtimeError(error: unknown, client?: CopilotClient): Promise<Error> {
    const launch = client && this.launches.get(client);
    const failure = launch ? await launch.failure(error) : new Error(redact(errorMessage(error)));
    this.options.debugLog?.(failure.message);
    return failure;
  }

  private async close(client: CopilotClient, session?: CopilotSession): Promise<void> {
    const pending = this.closing.get(client);
    if (pending) return pending;
    const closing = this.closeRuntime(client, session);
    this.closing.set(client, closing);
    try {
      await closing;
    } finally {
      this.closing.delete(client);
    }
  }

  private async closeRuntime(client: CopilotClient, session?: CopilotSession): Promise<void> {
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
      const launch = this.launches.get(client);
      await launch?.stop();
      await client.forceStop().catch(() => {});
      await launch?.dispose();
      this.launches.delete(client);
      this.clients.delete(client);
    }
  }

  async check(): Promise<RuntimeStatus> {
    let client: CopilotClient | undefined;
    const controller = new AbortController();
    this.runs.add(controller);
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
      return {
        state: 'unavailable',
        models: [],
        error: (await this.runtimeError(error, client)).message,
      };
    } finally {
      clearTimeout(timer);
      this.runs.delete(controller);
      if (client) await this.close(client);
    }
  }

  /** Explicit server connection + tools/list only. No send, sampling or tool execution. */
  async discoverMcp(server: McpServerConfig): Promise<McpCatalog> {
    let client: CopilotClient | undefined;
    let session: CopilotSession | undefined;
    const controller = new AbortController();
    this.runs.add(controller);
    const timer = setTimeout(
      () => controller.abort(new Error('La découverte MCP a expiré.')),
      this.options.checkTimeoutMs ?? 90_000,
    );
    let secrets = new Set<string>();
    try {
      const plan = await withSignal(
        resolveMcpPlan([server], this.options.resolveMcpSecret, true),
        controller.signal,
      );
      secrets = plan.secrets;
      client = await this.newClient(secrets);
      await withSignal(client.start(), controller.signal);
      session = await withSignal(
        client.createSession({
          sessionId: randomUUID(),
          tools: [],
          availableTools: [],
          mcpServers: plan.servers,
          workingDirectory: join(this.options.storagePath, 'copilot-runtime'),
          enableConfigDiscovery: false,
          skipCustomInstructions: true,
          enableFileHooks: false,
          enableSkills: false,
          enableHostGitOperations: false,
          enableSessionStore: false,
          enableOnDemandInstructionDiscovery: false,
          skipEmbeddingRetrieval: true,
          memory: { enabled: false },
          remoteSession: 'off',
          mcpOAuthTokenStorage: 'in-memory',
          onPermissionRequest: () => ({
            kind: 'reject',
            feedback: 'La découverte MCP ne permet aucune exécution d’outil.',
          }),
          hooks: { onPreToolUse: () => ({ permissionDecision: 'deny' }) },
        }),
        controller.signal,
      );
      await withSignal(session.rpc.tools.initializeAndValidate(), controller.signal);
      // CLI 1.0.63 requires config here; newer runtimes also support config-free start-by-name.
      await withSignal(
        session.rpc.mcp.startServer({ serverName: server.id, config: plan.servers[server.id] }),
        controller.signal,
      );
      const catalog = await withSignal(
        session.rpc.mcp.listTools({ serverName: server.id }),
        controller.signal,
      );
      return {
        state: 'ready',
        checkedAt: new Date().toISOString(),
        tools: catalog.tools.map((tool) => ({
          name: tool.name,
          description: redactMcp(tool.description ?? '', secrets),
        })),
      };
    } catch (error) {
      return {
        state: 'error',
        tools: [],
        checkedAt: new Date().toISOString(),
        error: redactMcp((await this.runtimeError(error, client)).message, secrets),
      };
    } finally {
      clearTimeout(timer);
      this.runs.delete(controller);
      controller.abort(new RunCancelledError('Diagnostic terminé.'));
      if (client) await this.close(client, session);
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
    let secrets = new Set<string>();
    const emit = (kind: RunEvent['kind'], message: string) =>
      callbacks.onEvent({
        id: randomUUID(),
        at: new Date().toISOString(),
        kind,
        message: redactMcp(message, secrets),
      });
    try {
      const mcp = await withSignal(
        resolveMcpPlan(
          input.mode === 'discussion' ? [] : (input.mcpServers ?? []),
          this.options.resolveMcpSecret,
        ),
        controller.signal,
      );
      secrets = mcp.secrets;
      client = await this.newClient(secrets);
      if (controller.signal.aborted) throw cancelled(controller.signal);
      await withSignal(client.start(), controller.signal);
      const auth = await withSignal(client.getAuthStatus(), controller.signal);
      if (!auth.isAuthenticated)
        throw new Error(
          'Copilot CLI n’est pas connecté dans l’environnement Feature Studio. Lance le diagnostic de connexion.',
        );
      const tools = [
        ...(input.mode === 'discussion'
          ? []
          : await withSignal(
              this.options.getTools(input, callbacks, controller.signal),
              controller.signal,
            )),
      ];
      if (!input.observation && input.mode !== 'discussion')
        tools.push({
          name: 'studio_ask_human',
          description:
            'Ask the human a question and wait for their real answer. Never invent a response. Cancels with the active attempt.',
          parameters: {
            type: 'object',
            properties: {
              question: { type: 'string', minLength: 1, maxLength: 2_000 },
              choices: {
                type: 'array',
                items: { type: 'string', minLength: 1, maxLength: 300 },
                minItems: 2,
                maxItems: 8,
              },
              allowFreeform: { type: 'boolean' },
            },
            required: ['question'],
            additionalProperties: false,
          },
          skipPermission: true,
          defer: 'never',
          handler: async (raw, invocation) => {
            const schema = z
              .object({
                question: z.string().trim().min(1).max(2_000),
                choices: z.array(z.string().trim().min(1).max(300)).min(2).max(8).optional(),
                allowFreeform: z.boolean().default(true),
              })
              .strict();
            const question = schema.parse(raw);
            if (!callbacks.onQuestion)
              throw new Error(
                'Aucun dialogue humain n’est disponible pour cette question. Termine avec le bloc de questions structuré.',
              );
            const requestSignal = invocation.signal
              ? AbortSignal.any([controller.signal, invocation.signal])
              : controller.signal;
            if (requestSignal.aborted) throw cancelled(requestSignal);
            const answer = await withSignal(
              callbacks.onQuestion({
                ...question,
                question: redactMcp(question.question, secrets),
                choices: question.choices?.map((choice) => redactMcp(choice, secrets)),
              }),
              requestSignal,
            );
            if (typeof answer !== 'string' || !answer.trim())
              throw new Error('Une réponse humaine non vide est nécessaire.');
            if (redactMcp(answer, secrets) !== answer)
              throw new Error(
                'Renseigne les identifiants MCP dans les réglages sécurisés, pas dans une réponse destinée au modèle.',
              );
            if (!question.allowFreeform && question.choices && !question.choices.includes(answer))
              throw new Error('La réponse doit correspondre à un choix proposé.');
            return { resultType: 'success', textResultForLlm: JSON.stringify({ answer }) };
          },
        });
      const allowed = new Set(tools.map((t) => t.name));
      if (
        (input.mode !== 'discussion' && !tools.length) ||
        allowed.size !== tools.length ||
        tools.some(
          (t) => !/^studio_[a-z0-9_]+$/.test(t.name) || !t.handler || t.overridesBuiltInTool,
        )
      )
        throw new Error(
          'Catalogue hôte invalide : des outils studio uniques, avec handlers, sont requis.',
        );
      // Native MCP reads can bypass callbacks when the runtime classifies them read-only.
      // Exact managed asks force the normal MCP request (with readOnly) when auto approval is off.
      const mcpAskRules = [...mcp.grants.values()]
        .filter((g) => !g.autoApproveReadOnly)
        .map((g) => `Mcp(${g.serverId}/${g.toolName})`);
      const allAllowed = [...allowed, ...mcp.grants.keys()];
      // CLI 1.0.63 custom agents require server/tool aliases; newer SDK docs use server-tool.
      // Both denote the same explicit grant. The session allowlist + catalog verification stays exact.
      const agentAllowed = [
        ...allowed,
        ...[...mcp.grants.values()].flatMap((grant) => [
          grant.runtimeName,
          `${grant.serverId}/${grant.toolName}`,
        ]),
      ];
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
        availableTools: allAllowed,
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
        mcpServers: mcp.servers,
        managedSettings: mcp.grants.size
          ? {
              permissions: {
                disableBypassPermissionsMode: 'disable',
                disableAssistedPermissionsMode: true,
                ask: mcpAskRules,
              },
            }
          : undefined,
        mcpOAuthTokenStorage: 'in-memory',
        enableHostGitOperations: false,
        enableSessionStore: false,
        enableExperimentalMode: false,
        skipEmbeddingRetrieval: true,
        embeddingCacheStorage: 'in-memory',
        enableOnDemandInstructionDiscovery: false,
        memory: { enabled: false },
        remoteSession: 'off',
        includeSubAgentStreamingEvents: true,
        customAgentsLocalOnly: true,
        infiniteSessions: { enabled: true },
        onPermissionRequest: (request) =>
          controller.signal.aborted
            ? { kind: 'reject', feedback: 'Tentative annulée ou terminée.' }
            : withSignal(
                decideMcpPermission(mcp, request, input.step.policy, callbacks),
                controller.signal,
              ),
        hooks: {
          onPreToolUse: (request) => {
            if (
              (!allowed.has(request.toolName) && !mcp.grants.has(request.toolName)) ||
              controller.signal.aborted
            )
              return {
                permissionDecision: 'deny',
                permissionDecisionReason:
                  'Outil hors du périmètre Feature Studio ou tentative annulée.',
              };
            // Hook 'ask' creates kind:'hook' without a readOnly attestation; use native MCP asks.
            return {};
          },
        },
        systemMessage: {
          mode: 'append',
          content: input.observation
            ? 'Tu analyses une seule session Feature Studio en lecture seule. Toutes les données sont dans le prompt. Aucun accès au projet ni intervention humaine. Réponds avec le JSON demandé.'
            : input.mode === 'discussion'
              ? 'Tu participes à une conversation Feature Studio. Réponds naturellement à la dernière intervention humaine en tenant compte de l’historique et du profil fourni. Tu ne disposes d’aucun outil ni d’accès au projet. Pose tes questions directement dans ta réponse.'
              : 'Tu exécutes une seule étape Feature Studio. Les restrictions sont appliquées par les outils hôtes. Termine avec le livrable Markdown et les questions structurées nécessaires.',
        },
        customAgents: [
          {
            name: 'feature-studio',
            displayName: input.agent.name,
            description: input.agent.description,
            // Role instructions appear once in the exact business prompt shown in preview.
            prompt:
              'Les instructions du rôle figurent dans le prompt. Utilise uniquement le catalogue autorisé.',
            tools: agentAllowed,
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
        if (mcp.grants.size) {
          const policy = await withSignal(session.rpc.managedSettings.get(), controller.signal);
          const value = policy.settings as
            | {
                permissions?: {
                  ask?: unknown;
                  disableBypassPermissionsMode?: unknown;
                  disableAssistedPermissionsMode?: unknown;
                };
              }
            | undefined;
          const permissions = value?.permissions;
          const ask = permissions?.ask;
          if (
            policy.failClosed ||
            policy.clientManaged !== true ||
            !policy.bypassPermissionsDisabled ||
            permissions?.disableAssistedPermissionsMode !== true ||
            !Array.isArray(ask) ||
            mcpAskRules.some((rule) => !ask.includes(rule))
          )
            throw new Error('La politique MCP native requise n’est pas attestée par ce runtime.');
          const configured = await withSignal(
            session.rpc.permissions.configure({
              approveAllReadPermissionRequests: false,
              approveAllToolPermissionRequests: false,
              rules: { approved: [], denied: [] },
            }),
            controller.signal,
          );
          if (!configured.success)
            throw new Error('Le runtime refuse le mode manuel des permissions MCP.');
        }
        await withSignal(session.rpc.tools.initializeAndValidate(), controller.signal);
        const catalog = await withSignal(session.rpc.tools.getCurrentMetadata(), controller.signal);
        verifyMcpCatalog(catalog.tools, allowed, mcp);
      } catch (error) {
        if (controller.signal.aborted) throw cancelled(controller.signal);
        throw new Error(
          `Exécution refusée avant tout prompt : confinement des outils non vérifiable. ${errorMessage(error)} SDK 1.0.20 ; MCP sélectionnés : ${input.mcpServers?.length ?? 0}. CLI : ${this.launches.get(client)?.executable ?? 'transport de test'}. Ce refus ne prouve pas que le CLI est trop ancien : conserve ce diagnostic pour identifier l’incompatibilité.`,
        );
      }
      emit(
        'info',
        `Catalogue vérifié : ${allowed.size} outils hôtes, ${mcp.grants.size} outils MCP sélectionnés. Session ${session.sessionId}.`,
      );
      let content = '';
      let actualModel: string | undefined;
      let usage: Usage | undefined;
      const seen = new Set<string>();
      const usageIds = new Set<string>();
      const stream = new McpStreamRedactor(secrets);
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
        const recordTrace = () => {
          if (
            !/^(user\.message|assistant\.message|assistant\.usage|tool\.|subagent\.|skill\.|hook\.|permission\.|session\.compaction|session\.error)/.test(
              event.type,
            ) ||
            event.type.endsWith('_delta')
          )
            return;
          try {
            callbacks.onTrace?.({
              id: event.id,
              at: event.timestamp,
              type: `sdk.${event.type}`,
              agentId: event.agentId,
              data: redactMcp(JSON.stringify(event.data), secrets),
            });
          } catch (error) {
            const failure = new Error(redactMcp(errorMessage(error), secrets));
            rejectIdle(failure);
            controller.abort(failure);
          }
        };
        // Usage is consumed before any event/log callback, including runs later cancelled or rejected.
        if (event.type === 'assistant.usage') {
          const data = event.data;
          const usageId = data.accounting?.usageId
            ? `${data.accounting.sourceSessionId}:${data.accounting.usageId}`
            : (data.apiCallId ?? event.id);
          if (usageIds.has(usageId)) return;
          usageIds.add(usageId);
          if (!event.agentId && data.model && data.model !== 'auto') actualModel = data.model;
          usage ??= { source: 'measured' };
          // Preserve known amounts, but never present a partial ledger as a complete total.
          if (!numeric(data.inputTokens) || !numeric(data.outputTokens))
            usage.incompleteTokens = true;
          if (!numeric(data.copilotUsage?.totalNanoAiu)) usage.incompleteCost = true;
          if (numeric(data.inputTokens))
            usage.inputTokens = (usage.inputTokens ?? 0) + data.inputTokens;
          if (numeric(data.outputTokens))
            usage.outputTokens = (usage.outputTokens ?? 0) + data.outputTokens;
          if (numeric(data.copilotUsage?.totalNanoAiu)) {
            usage.cost = (usage.cost ?? 0) + data.copilotUsage.totalNanoAiu;
            usage.unit = 'nano-AIU';
          }
          const modelKey = data.model && data.model !== 'auto' ? data.model : 'Non communiqué';
          const breakdown = (usage.byModel ??= Object.create(null));
          const metric = (breakdown[modelKey] ??= {});
          if (numeric(data.inputTokens))
            metric.inputTokens = (metric.inputTokens ?? 0) + data.inputTokens;
          if (numeric(data.outputTokens))
            metric.outputTokens = (metric.outputTokens ?? 0) + data.outputTokens;
          if (numeric(data.copilotUsage?.totalNanoAiu))
            metric.cost = (metric.cost ?? 0) + data.copilotUsage.totalNanoAiu;
          if (!numeric(data.inputTokens) || !numeric(data.outputTokens))
            metric.incompleteTokens = true;
          if (!numeric(data.copilotUsage?.totalNanoAiu)) metric.incompleteCost = true;
          usage.model = actualModel;
          try {
            callbacks.onUsage?.(structuredClone(usage));
          } catch (error) {
            const failure = new Error(redactMcp(errorMessage(error), secrets));
            rejectIdle(failure);
            controller.abort(failure);
            return;
          }
          recordTrace();
          emit(
            'usage',
            `Usage mesuré${actualModel ? ` (${actualModel})` : ''} : ${data.inputTokens ?? '?'} tokens entrants, ${data.outputTokens ?? '?'} sortants.`,
          );
          return;
        }
        recordTrace();
        if (event.agentId) return;
        switch (event.type) {
          case 'assistant.message_delta':
            {
              const safe = stream.push(event.data.deltaContent);
              if (safe) emit('message', safe);
            }
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
      await withSignal(
        session.send({ prompt: input.preparedPrompt ?? buildPrompt(input) }),
        controller.signal,
      );
      await withSignal(idle, controller.signal);
      {
        const remainder = stream.finish();
        if (remainder) emit('message', remainder);
      }
      if (!content.trim())
        throw new Error(
          input.mode === 'discussion'
            ? 'Copilot a terminé sans réponse complète. Vous pouvez poursuivre la discussion.'
            : 'Copilot a terminé sans livrable final. Les fragments partiels ne sont pas validés comme livrable.',
        );
      const parsed =
        input.mode === 'discussion'
          ? { content: redactMcp(content, secrets), questions: [] }
          : parseQuestions(redactMcp(content, secrets));
      const review = input.mode === 'discussion' ? undefined : parseReview(parsed.content);
      return {
        ...parsed,
        sessionId: session.sessionId,
        model: actualModel,
        usage,
        changedFiles: [],
        review,
      };
    } catch (error) {
      if (controller.signal.aborted) throw cancelled(controller.signal);
      const message = redactMcp((await this.runtimeError(error, client)).message, secrets);
      if (error instanceof Error && error.message === message) throw error;
      throw new Error(message);
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

  async deleteSessions(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const client = await this.newClient(new Set());
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Délai du nettoyage Copilot dépassé.')),
      30000,
    );
    try {
      await withSignal(client.start(), controller.signal);
      const sessions = await withSignal(client.listSessions(), controller.signal);
      const existing = new Set(sessions.map((session) => session.sessionId));
      for (const id of new Set(ids))
        if (existing.has(id)) await withSignal(client.deleteSession(id), controller.signal);
    } finally {
      clearTimeout(timer);
      await this.close(client);
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.runs)
      controller.abort(new RunCancelledError('Extension fermée.'));
    await Promise.allSettled([...this.clients].map((client) => this.close(client)));
  }
}
