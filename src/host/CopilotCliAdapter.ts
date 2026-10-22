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
import { nativeSkillCatalog, nativeContextReceipt, NativeInstructionReads } from './NativeContext';
import { usesNativeTools, type NativePermissionMode } from '../shared/native';
import {
  NATIVE_TOOLS,
  NATIVE_READ_TOOLS,
  nativeGates,
  applyNativePermissions,
  decideNativePermission,
  probeNativeCapabilities,
  verifyNativeCatalog,
  NativeActivityCollector,
} from './NativeCopilot';
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
  private readonly nativeSessions = new Map<
    string,
    {
      session: CopilotSession;
      directory: string;
      mode: NativePermissionMode;
      controller: AbortController;
      changing: boolean;
      accepting: boolean;
      sends: Set<Promise<string>>;
      secrets: Set<string>;
    }
  >();
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

  private async newClient(
    secrets: Set<string> = new Set(),
    instructions = false,
  ): Promise<CopilotClient> {
    if (this.disposed) throw new Error('Adaptateur fermé.');
    const directory = join(this.options.storagePath, 'copilot-runtime');
    await mkdir(directory, { recursive: true });
    if (this.disposed) throw new Error('Adaptateur fermé.');
    const path =
      typeof this.options.cliPath === 'function' ? this.options.cliPath() : this.options.cliPath;
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
          ...(instructions ? [] : ['--no-custom-instructions']),
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
    let executable: Pick<RuntimeStatus, 'cliPath' | 'cliSource'> = {};
    const controller = new AbortController();
    this.runs.add(controller);
    const timer = setTimeout(
      () => controller.abort(new Error('Le diagnostic Copilot CLI a expiré.')),
      this.options.checkTimeoutMs ?? 15_000,
    );
    try {
      client = await this.newClient();
      const launch = this.launches.get(client)!;
      executable = { cliPath: launch.executable, cliSource: launch.source };
      await withSignal(client.start(), controller.signal);
      const status = await withSignal(client.getStatus(), controller.signal);
      if (status.protocolVersion < 3)
        throw new Error(`Protocole ${status.protocolVersion} incompatible : JSON-RPC v3 requis.`);
      const auth = await withSignal(client.getAuthStatus(), controller.signal);
      if (!auth.isAuthenticated)
        return {
          state: 'unavailable',
          ...executable,
          version: status.version,
          authenticated: false,
          models: [],
          error: `Copilot CLI doit être connecté. Exécute copilot login avec COPILOT_HOME=${join(this.options.storagePath, 'copilot-runtime')}, ou fournis un token via COPILOT_GITHUB_TOKEN dans l’environnement du processus VS Code.`,
        };
      const models = await withSignal(client.listModels(), controller.signal);
      const native = await withSignal(
        probeNativeCapabilities(client, join(this.options.storagePath, 'copilot-runtime')),
        controller.signal,
      );
      return {
        state: 'ready',
        native,
        ...executable,
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
        ...executable,
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
    const native = usesNativeTools(input);
    const skills = nativeSkillCatalog(native ? input : { ...input, skills: [] });
    const skillTools = native && skills.byName.size ? ['skill'] : [];
    const nativeTools = [
      ...(input.nativeReadOnly ? NATIVE_READ_TOOLS : NATIVE_TOOLS),
      ...skillTools,
    ];
    const earlyContextEvents: SessionEvent[] = [];
    let contextEventsReady = false;
    const permissionMode =
      input.launch?.permissionMode ?? input.feature.execution?.permissionMode ?? 'manual';
    let nativeActivity: NativeActivityCollector | undefined;
    if (signal.aborted) throw cancelled(signal);
    const controller = new AbortController();
    this.runs.add(controller);
    const relay = () => controller.abort(cancelled(signal));
    signal.addEventListener('abort', relay, { once: true });
    const minutes = Number.isFinite(input.settings.timeoutMinutes)
      ? Math.max(1, Math.min(120, input.settings.timeoutMinutes))
      : 20;
    let remaining = minutes * 60_000,
      started = Date.now(),
      waiting = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armTimer = () => {
      started = Date.now();
      timer = setTimeout(
        () =>
          controller.abort(new Error(`Délai maximal de ${minutes} minutes de travail dépassé.`)),
        Math.max(1, remaining),
      );
    };
    const humanWait = async <T>(work: () => Promise<T>): Promise<T> => {
      if (waiting++ === 0) {
        clearTimeout(timer);
        remaining -= Date.now() - started;
      }
      try {
        return await work();
      } finally {
        if (--waiting === 0 && !controller.signal.aborted) armTimer();
      }
    };
    armTimer();
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
          input.mode === 'discussion' || input.nativeReadOnly ? [] : (input.mcpServers ?? []),
          this.options.resolveMcpSecret,
        ),
        controller.signal,
      );
      secrets = mcp.secrets;
      client = await this.newClient(secrets, native);
      if (controller.signal.aborted) throw cancelled(controller.signal);
      await withSignal(client.start(), controller.signal);
      const auth = await withSignal(client.getAuthStatus(), controller.signal);
      if (!auth.isAuthenticated)
        throw new Error(
          'Copilot CLI n’est pas connecté dans l’environnement Feature Studio. Lance le diagnostic de connexion.',
        );
      const tools = [
        ...(input.mode === 'discussion' || input.nativeReadOnly
          ? []
          : await withSignal(
              this.options.getTools(input, callbacks, controller.signal),
              controller.signal,
            )),
      ];
      if (native) {
        const business = tools.filter(
          (tool) =>
            tool.name === 'studio_run_test' ||
            tool.name.startsWith('studio_devops_') ||
            [
              'studio_remote_review',
              'studio_read_personal_resource',
              'studio_write_review_report',
            ].includes(tool.name),
        );
        tools.splice(0, tools.length, ...business);
      }
      if (!native && !input.observation && input.mode !== 'discussion')
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
            const answer = await humanWait(() =>
              withSignal(
                callbacks.onQuestion!({
                  ...question,
                  question: redactMcp(question.question, secrets),
                  choices: question.choices?.map((choice) => redactMcp(choice, secrets)),
                }),
                requestSignal,
              ),
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
        (!native && input.mode !== 'discussion' && !tools.length) ||
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
        (input.step.model ?? input.agent.model) || input.settings.defaultModel || undefined;
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
        availableTools: native ? [...nativeTools, ...allAllowed] : allAllowed,
        excludedTools: native
          ? ['task', 'web_fetch', 'web_search']
          : [
              'bash',
              'powershell',
              'shell',
              'edit',
              'create',
              'view',
              'glob',
              'grep',
              'rg',
              'task',
              'web_fetch',
              'web_search',
              'ask_user',
            ],
        enableConfigDiscovery: false,
        enableFileHooks: false,
        skipCustomInstructions: !native,
        enableSkills: native && skills.byName.size > 0,
        includedBuiltinSkills: [],
        skillProvider: native && skills.byName.size ? skills.provider : undefined,
        skillDirectories: [],
        pluginDirectories: [],
        mcpServers: mcp.servers,
        managedSettings:
          !native && mcp.grants.size
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
        ...(native ? nativeGates : {}),
        skipEmbeddingRetrieval: true,
        embeddingCacheStorage: 'in-memory',
        enableOnDemandInstructionDiscovery: native,
        onEvent: native
          ? (event) => {
              if (
                !contextEventsReady &&
                (event.type === 'skill.invoked' || event.type === 'system.notification')
              )
                earlyContextEvents.push(event);
            }
          : undefined,
        memory: { enabled: false },
        remoteSession: 'off',
        includeSubAgentStreamingEvents: true,
        customAgentsLocalOnly: true,
        infiniteSessions: { enabled: true },
        onUserInputRequest: native
          ? async (request) => {
              if (!callbacks.onQuestion) throw new Error('Dialogue humain indisponible.');
              const answer = await humanWait(() =>
                withSignal(
                  callbacks.onQuestion!({
                    question: redactMcp(request.question, secrets),
                    choices: request.choices?.map((choice) => redactMcp(choice, secrets)),
                    allowFreeform: request.allowFreeform ?? true,
                  }),
                  controller.signal,
                ),
              );
              if (
                !answer.trim() ||
                (request.allowFreeform === false &&
                  request.choices &&
                  !request.choices.includes(answer))
              )
                throw new Error('Réponse humaine invalide.');
              if (redactMcp(answer, secrets) !== answer)
                throw new Error('Un secret ne peut pas être transmis dans une réponse au modèle.');
              return { answer, wasFreeform: !request.choices?.includes(answer) };
            }
          : undefined,
        onPermissionRequest: (request) =>
          controller.signal.aborted
            ? { kind: 'reject', feedback: 'Tentative annulée ou terminée.' }
            : humanWait(() =>
                withSignal(
                  native
                    ? decideNativePermission(
                        request,
                        (session && this.nativeSessions.get(session.sessionId)?.mode) ||
                          permissionMode,
                        async (prompt) => {
                          if (!callbacks.onNativePermission) return false;
                          if (prompt.details.length > 30000)
                            throw new Error(
                              'Demande de permission trop longue pour être présentée intégralement. Réduis la taille de l’action.',
                            );
                          const allowed = await callbacks.onNativePermission({
                            ...prompt,
                            details: redactMcp(prompt.details, secrets),
                          });
                          emit(
                            'info',
                            `Permission Copilot ${request.kind} : ${allowed === 'remembered' ? 'accord de session appliqué' : allowed ? 'accordée par l’utilisateur' : 'refusée'}.`,
                          );
                          return allowed;
                        },
                        input.workspacePath,
                      )
                    : decideMcpPermission(mcp, request, input.step.policy, callbacks),
                  controller.signal,
                ),
              ),
        hooks: {
          onPreToolUse: (request) => {
            if (request.toolName === 'skill') {
              const name = (request.toolArgs as { skill?: unknown } | null)?.skill;
              if (typeof name !== 'string' || !skills.byName.has(name))
                return {
                  permissionDecision: 'deny',
                  permissionDecisionReason:
                    'Compétence absente du catalogue sélectionné pour cette étape.',
                };
            }
            if (
              (!allowed.has(request.toolName) &&
                !mcp.grants.has(request.toolName) &&
                !(native && nativeTools.includes(request.toolName))) ||
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
              : input.nativeReadOnly
                ? 'Tu échanges avec l’utilisateur sur cette étape Feature Studio. Tu peux lire le code pour comprendre et expliquer ; les outils d’écriture, le terminal et les MCP sont indisponibles. Une question ne modifie pas le livrable. Propose le travail restant pour une correction et attends sa validation.'
                : native
                  ? 'Tu exécutes une étape Feature Studio avec les outils natifs Copilot et les permissions décidées par l’humain. Utilise ask_user pour les questions humaines. Termine avec le livrable Markdown. Arrête les processus de travail avant de terminer ; ne détache aucun service en arrière-plan sans demande humaine explicite.'
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
            tools: native ? [...nativeTools, ...agentAllowed] : agentAllowed,
            // Explicitly selected manual-only skills keep their original invocation policy.
            // Copilot preloads them for this agent; ordinary skills remain lazy.
            skills: native
              ? [...skills.byName.values()]
                  .filter((item) => item.descriptor.disableModelInvocation)
                  .map((item) => item.descriptor.name)
              : undefined,
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
      const instructionReads = native
        ? new NativeInstructionReads(
            input.workspacePath,
            (await withSignal(session.rpc.instructions.getSources(), controller.signal)).sources,
          )
        : undefined;
      abortRuntime = () => {
        void session?.abort().catch(() => {});
      };
      controller.signal.addEventListener('abort', abortRuntime, { once: true });
      // A protocol handshake does not prove support for additive SDK configuration.
      // Inspect the actual model-facing catalog before the first paid request.
      try {
        if (native) {
          await withSignal(
            applyNativePermissions(session, permissionMode, input.workspacePath),
            controller.signal,
          );
          this.nativeSessions.set(session.sessionId, {
            session,
            directory: input.workspacePath,
            mode: permissionMode,
            controller,
            changing: false,
            accepting: true,
            sends: new Set(),
            secrets,
          });
          emit(
            'info',
            `Copilot natif · permissions ${permissionMode} confirmées. Les accords ponctuels sont propres à cet appel ; la reprise réapplique le mode choisi.`,
          );
        } else if (mcp.grants.size) {
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
        if (native) {
          if (!catalog.tools) throw new Error('Catalogue natif indisponible.');
          if (
            catalog.tools.some(
              (tool) => nativeTools.includes(tool.name) && (tool.mcpServerName || tool.mcpToolName),
            )
          )
            throw new Error('Provenance d’un outil natif invalide.');
          verifyNativeCatalog(
            catalog.tools.map((tool) => tool.name),
            [...allAllowed, ...skillTools],
            input.nativeReadOnly,
          );
          if (skillTools.length && !catalog.tools.some((tool) => tool.name === 'skill'))
            throw new Error(
              'Le runtime ne propose pas le chargement natif des compétences sélectionnées.',
            );
          verifyMcpCatalog(
            catalog.tools.filter((tool) => !nativeTools.includes(tool.name)),
            allowed,
            mcp,
          );
        } else verifyMcpCatalog(catalog.tools, allowed, mcp);
      } catch (error) {
        if (controller.signal.aborted) throw cancelled(controller.signal);
        throw new Error(
          native
            ? `Copilot natif indisponible avant tout prompt : ${errorMessage(error)} Couple de référence : SDK 1.0.20 et CLI 1.0.102. Vérifie la compatibilité de Feature Studio avec le CLI utilisé, puis relance le diagnostic.`
            : `Exécution refusée avant tout prompt : confinement des outils non vérifiable. ${errorMessage(error)} SDK 1.0.20 ; MCP sélectionnés : ${input.mcpServers?.length ?? 0}. CLI : ${this.launches.get(client)?.executable ?? 'transport de test'}. Ce refus ne prouve pas que le CLI est trop ancien : conserve ce diagnostic pour identifier l’incompatibilité.`,
        );
      }
      emit(
        'info',
        `Catalogue vérifié : ${allowed.size} outils hôtes, ${mcp.grants.size} outils MCP sélectionnés. Session ${session.sessionId}.`,
      );
      let content = '';
      if (native)
        nativeActivity = new NativeActivityCollector(
          session.sessionId,
          input.workspacePath,
          (activity) => callbacks.onNativeActivity?.(activity),
          (value) => redactMcp(value, secrets),
        );
      let actualModel: string | undefined;
      let usage: Usage | undefined;
      const seen = new Set<string>(input.previousEventIds);
      const usageIds = new Set<string>();
      const stream = new McpStreamRedactor(secrets);
      const messageStreams = new Map<string, { stream: McpStreamRedactor; content: string }>();
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
        if (native && !event.ephemeral) callbacks.onNativeEventId?.(event.id);
        const recordTrace = () => {
          if (
            !/^(user\.message|assistant\.message|assistant\.reasoning|assistant\.usage|tool\.|subagent\.|skill\.|system\.notification|hook\.|permission\.|session\.compaction|session\.error)/.test(
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
        if (native) {
          try {
            const receipt =
              nativeContextReceipt(event, session!.sessionId, skills, (text) =>
                redactMcp(text, secrets),
              ) ??
              instructionReads?.receive(event, session!.sessionId, (text) =>
                redactMcp(text, secrets),
              );
            if (receipt) callbacks.onNativeContextLoad?.(receipt);
          } catch (error) {
            const failure = new Error(redactMcp(errorMessage(error), secrets));
            rejectIdle(failure);
            controller.abort(failure);
          }
        }
        nativeActivity?.receive(event);
        if (
          native &&
          [
            'assistant.message_delta',
            'assistant.message',
            'assistant.reasoning_delta',
            'assistant.reasoning',
          ].includes(event.type)
        ) {
          const data = event.data as {
            messageId?: string;
            reasoningId?: string;
            deltaContent?: string;
            content?: string;
          };
          const id = `native:${session!.sessionId}:${data.messageId ?? data.reasoningId ?? event.id}`;
          const final = !event.type.endsWith('_delta');
          const buffer = messageStreams.get(id) ?? {
            stream: new McpStreamRedactor(secrets),
            content: '',
          };
          buffer.content = final
            ? redactMcp(data.content ?? '', secrets)
            : buffer.content + buffer.stream.push(data.deltaContent ?? '');
          messageStreams.set(id, buffer);
          callbacks.onNativeMessage?.({
            id,
            kind: event.type.includes('reasoning') ? 'reasoning' : 'text',
            content: buffer.content,
            at: event.timestamp,
            complete: final,
          });
        }
        switch (event.type) {
          case 'user.message':
            if (event.data.messageId) callbacks.onNativeMessageReceived?.(event.data.messageId);
            break;
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
            emit(
              'tool',
              `Exécution : ${event.data.toolName}${native ? ` · ${input.workspacePath}\n${redactMcp(JSON.stringify(event.data.arguments ?? {}), secrets).slice(0, 6000)}` : ''}`,
            );
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
            {
              const active = this.nativeSessions.get(session!.sessionId);
              if (active) active.accepting = false;
            }
            if (event.data.aborted) rejectIdle(new RunCancelledError());
            else resolveIdle();
            break;
          case 'session.compaction_start':
            emit('info', 'Compaction du contexte Copilot.');
            break;
        }
      };
      unsubscribe = session.on(onEvent);
      contextEventsReady = true;
      for (const event of earlyContextEvents) onEvent(event);
      if (controller.signal.aborted) throw cancelled(controller.signal);
      callbacks.onPromptSending?.();
      await withSignal(
        session.send({ prompt: input.preparedPrompt ?? buildPrompt(input) }),
        controller.signal,
      );
      callbacks.onPromptSent?.();
      await withSignal(idle, controller.signal);
      await Promise.allSettled(this.nativeSessions.get(session.sessionId)?.sends ?? []);
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
      if (session) this.nativeSessions.delete(session.sessionId);
      nativeActivity?.finish();
    }
  }

  async sendMessage(sessionId: string, content: string): Promise<string | undefined> {
    const active = this.nativeSessions.get(sessionId);
    if (!active || !active.accepting || active.controller.signal.aborted) return undefined;
    if (redactMcp(content, active.secrets) !== content)
      throw new Error('Un secret ne peut pas être transmis dans un message au modèle.');
    const sent = withSignal(
      active.session.send({ prompt: content, mode: 'immediate' }),
      active.controller.signal,
    );
    active.sends.add(sent);
    try {
      return await sent;
    } finally {
      active.sends.delete(sent);
    }
  }

  async setPermissionMode(sessionId: string, mode: NativePermissionMode): Promise<void> {
    const active = this.nativeSessions.get(sessionId);
    if (!active || active.controller.signal.aborted)
      throw new Error('Cette conversation native n’est plus active.');
    if (active.changing) throw new Error('Un changement de permissions est déjà en cours.');
    active.changing = true;
    try {
      await withSignal(
        applyNativePermissions(active.session, mode, active.directory),
        active.controller.signal,
      );
      active.mode = mode;
    } catch (error) {
      active.controller.abort(
        new Error(`Changement de permissions non confirmé : ${errorMessage(error)}`),
      );
      throw error;
    } finally {
      active.changing = false;
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
