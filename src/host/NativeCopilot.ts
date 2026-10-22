import type {
  CopilotClient,
  CopilotSession,
  PermissionRequest,
  PermissionRequestResult,
  SessionConfig,
  SessionEvent,
} from '@github/copilot-sdk';
import {
  NATIVE_PERMISSION_MODES,
  type NativeActivity,
  type NativeCapabilities,
  type NativePermissionMode,
  type NativePermissionPrompt,
} from '../shared/native';

// The first native scope: file tools, shell lifecycle and human questions.
// Web, agents, skills, hooks and plugins belong to the separate ecosystem lot.
export const NATIVE_TOOLS = [
  'view',
  'glob',
  'grep',
  'rg',
  'edit',
  'create',
  'apply_patch',
  'bash',
  'powershell',
  'read_bash',
  'write_bash',
  'stop_bash',
  'list_bash',
  'read_powershell',
  'write_powershell',
  'stop_powershell',
  'list_powershell',
  'ask_user',
];
export const NATIVE_READ_TOOLS = ['view', 'glob', 'grep', 'rg', 'ask_user'];
export const nativeGates: Partial<SessionConfig> = {
  enableManagedSettings: true,
  enableExperimentalMode: true,
  onUserInputRequest: async () => {
    throw new Error('Aucune question humaine pendant le diagnostic.');
  },
};

export async function applyNativePermissions(
  session: CopilotSession,
  mode: NativePermissionMode,
  directory: string,
): Promise<void> {
  const policy = await session.rpc.managedSettings.get();
  if (policy.failClosed)
    throw new Error('La politique de permissions Copilot n’est pas disponible.');
  // Reapply on every resume and mode change: no silently restored location/session grants.
  const reset = await session.rpc.permissions.configure({
    approveAllReadPermissionRequests: false,
    approveAllToolPermissionRequests: false,
    rules: { approved: [], denied: [] },
    paths: {
      unrestricted: false,
      additionalDirectories: [],
      includeTempDirectory: false,
      workspacePath: directory,
    },
    urls: { unrestricted: false, initialAllowed: [] },
  });
  if (!reset.success) throw new Error('Copilot n’a pas confirmé la remise à zéro des accords.');
  const changed = await session.rpc.permissions.setMode({ mode });
  const current = await session.rpc.permissions.getMode();
  if (!changed.success || changed.mode !== mode || current.mode !== mode)
    throw new Error(
      `Le mode de permission « ${mode} » est indisponible ou interdit par la politique Copilot.`,
    );
}

export function verifyNativeCatalog(
  names: string[],
  extra: string[] = [],
  readOnly = false,
): void {
  const allowed = new Set([...(readOnly ? NATIVE_READ_TOOLS : NATIVE_TOOLS), ...extra]);
  const unexpected = names.filter((name) => !allowed.has(name));
  if (new Set(names).size !== names.length)
    throw new Error(
      `Catalogue natif dupliqué. Outils reçus : ${names.join(', ') || '(aucun)'}.`,
    );
  if (unexpected.length)
    throw new Error(
      `Catalogue natif inattendu : ${unexpected.join(', ')}. Outils reçus : ${names.join(', ') || '(aucun)'}.`,
    );
  // Copilot can expose grep, rg, or both for the same search capability.
  const required = readOnly
    ? ['view', 'glob', 'ask_user']
    : ['view', 'glob', 'edit', 'create', 'ask_user'];
  const missing = required.filter((name) => !names.includes(name));
  if (!names.some((name) => name === 'grep' || name === 'rg')) missing.push('grep ou rg');
  if (!readOnly && !names.some((name) => name === 'bash' || name === 'powershell'))
    missing.push('bash ou powershell');
  if (missing.length)
    throw new Error(
      `Outils natifs obligatoires absents : ${missing.join(', ')}. Outils reçus (${names.length}) : ${names.join(', ') || '(aucun)'}. Mode : ${readOnly ? 'lecture seule' : 'complet'}.`,
    );
}

/** Probes a disposable session. No prompt, model call or project tool is executed. */
export async function probeNativeCapabilities(
  client: CopilotClient,
  directory: string,
): Promise<NativeCapabilities> {
  let session: CopilotSession | undefined;
  let tools: string[] = [];
  try {
    session = await client.createSession({
      ...nativeGates,
      workingDirectory: directory,
      availableTools: NATIVE_TOOLS,
      enableConfigDiscovery: false,
      enableFileHooks: false,
      skipCustomInstructions: true,
      enableSkills: false,
      pluginDirectories: [],
      skillDirectories: [],
      memory: { enabled: false },
      remoteSession: 'off',
      onPermissionRequest: () => ({ kind: 'reject', feedback: 'Diagnostic sans exécution.' }),
    });
    await session.rpc.tools.initializeAndValidate();
    tools = ((await session.rpc.tools.getCurrentMetadata()).tools ?? []).map(
      (tool) => tool.name,
    );
    verifyNativeCatalog(tools);
    const permissionModes: NativePermissionMode[] = [];
    for (const mode of NATIVE_PERMISSION_MODES) {
      try {
        await applyNativePermissions(session, mode, directory);
        permissionModes.push(mode);
      } catch {
        /* The runtime and managed policy decide which modes are available. */
      }
    }
    if (!permissionModes.includes('manual'))
      throw new Error('API de permissions natives indisponible.');
    await applyNativePermissions(session, 'manual', directory);
    return { available: true, tools, permissionModes };
  } catch (error) {
    return {
      available: false,
      tools,
      permissionModes: [],
      error: `Copilot natif indisponible : ${(error as Error).message} Couple de référence : CLI 1.0.102, SDK 1.0.20.`,
    };
  } finally {
    if (session) {
      await session.disconnect().catch(() => {});
      await client.deleteSession(session.sessionId).catch(() => {});
    }
  }
}

export function nativePermissionPrompt(
  request: PermissionRequest,
  directory: string,
): NativePermissionPrompt {
  const titles: Record<string, string> = {
    shell: 'Exécuter cette commande ?',
    write: 'Appliquer cette modification ?',
    read: 'Autoriser cette lecture ?',
    url: 'Accéder à cette adresse ?',
    mcp: 'Autoriser cet outil MCP ?',
  };
  const lines = [`Dossier de la session : ${directory}`];
  if ('intention' in request && request.intention) lines.push(request.intention);
  if (request.kind === 'shell') {
    lines.push(`Commande :\n${request.fullCommandText}`);
    if (request.possiblePaths.length)
      lines.push(`Fichiers concernés :\n${request.possiblePaths.join('\n')}`);
    if (request.possibleUrls.length)
      lines.push(
        `Adresses concernées :\n${request.possibleUrls.map((item) => item.url).join('\n')}`,
      );
    if (request.warning) lines.push(request.warning);
  } else if (request.kind === 'write') {
    lines.push(
      `Fichier : ${request.fileName}`,
      request.diff || request.newFileContents || 'Aperçu de modification non fourni par Copilot.',
    );
  } else if (request.kind === 'read') lines.push(`Chemin : ${request.path}`);
  else if (request.kind === 'url') lines.push(`Adresse : ${request.url}`);
  else if (request.kind === 'mcp')
    lines.push(
      `Outil : ${request.serverName} / ${request.toolName}`,
      JSON.stringify(request.args ?? {}, null, 2),
    );
  else lines.push(JSON.stringify(request, null, 2));
  if (request.managedApprovalRequired)
    lines.push('Votre organisation exige une réponse humaine pour cette action.');
  if ('requestSandboxBypass' in request && request.requestSandboxBypass)
    lines.push(
      `Assouplissement de l’isolation demandé : ${request.requestSandboxBypassReason ?? 'voir la demande Copilot'}`,
    );
  return {
    kind: request.kind,
    question: titles[request.kind] ?? 'Autoriser cette action Copilot ?',
    details: lines.join('\n\n'),
  };
}

export async function decideNativePermission(
  request: PermissionRequest,
  mode: NativePermissionMode,
  ask: (prompt: NativePermissionPrompt) => Promise<boolean>,
  directory: string,
): Promise<PermissionRequestResult> {
  // Requests still reaching us in allow-all may be managed asks. Never approve them blindly.
  const advice = 'assistedApproval' in request ? request.assistedApproval : undefined;
  if (
    mode === 'assisted' &&
    !request.managedApprovalRequired &&
    !('requestSandboxBypass' in request && request.requestSandboxBypass) &&
    advice?.recommendation === 'approve'
  )
    return { kind: 'approve-once' };
  return (await ask(nativePermissionPrompt(request, directory)))
    ? { kind: 'approve-once', approvedInteractively: true }
    : {
        kind: 'reject',
        feedback: 'Action refusée par l’utilisateur. Adapte la suite sans exécuter cette action.',
      };
}

export class NativeActivityCollector {
  private readonly items = new Map<string, NativeActivity>();
  constructor(
    private sessionId: string,
    private directory: string,
    private publish: (activity: NativeActivity) => void,
    private safe: (value: string) => string,
  ) {}
  receive(event: SessionEvent): void {
    if (event.type === 'tool.execution_start') {
      const d = event.data;
      const args =
        d.arguments && typeof d.arguments === 'object' && !Array.isArray(d.arguments)
          ? d.arguments
          : {};
      const command =
        typeof args.command === 'string' ? args.command : d.shellToolInfo?.displayCommand;
      const serialized = this.safe(JSON.stringify(d.arguments ?? {}));
      const item: NativeActivity = {
        id: `${this.sessionId}:${d.toolCallId}`,
        source: 'copilot',
        sessionId: this.sessionId,
        tool: d.toolName,
        startedAt: event.timestamp,
        status: 'running',
        directory: this.directory,
        arguments: serialized.slice(0, 16000),
        command: command ? this.safe(command).slice(0, 16000) : undefined,
        truncated: serialized.length > 16000 || (command?.length ?? 0) > 16000,
      };
      this.items.set(d.toolCallId, item);
      this.publish(structuredClone(item));
    } else if (event.type === 'tool.execution_complete') {
      const d = event.data,
        item = this.items.get(d.toolCallId);
      if (!item) return;
      const output = this.safe(
        d.result?.detailedContent ?? d.result?.content ?? d.error?.message ?? '',
      );
      Object.assign(item, {
        finishedAt: event.timestamp,
        status: d.success ? 'completed' : 'failed',
        output: output.slice(0, 32000),
        truncated: item.truncated || output.length > 32000,
        exitCode: d.shellExecution?.exitCode,
        files: d.fileEdits?.slice(0, 1000).map((edit) => this.safe(edit.path).slice(0, 4000)),
      });
      this.publish(structuredClone(item));
    }
  }
  finish(): void {
    for (const item of this.items.values())
      if (item.status === 'running') {
        item.status = 'interrupted';
        item.finishedAt = new Date().toISOString();
        this.publish(structuredClone(item));
      }
  }
}
