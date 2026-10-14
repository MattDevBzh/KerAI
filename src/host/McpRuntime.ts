import type {
  CurrentToolMetadata,
  MCPServerConfig as SdkMcpConfig,
  PermissionRequest,
  PermissionRequestResult,
} from '@github/copilot-sdk';
import type { McpServerConfig, PolicyProfile, RunCallbacks } from '../shared/types';

export type McpSecretResolver = (
  serverId: string,
  key: string,
) => PromiseLike<string | undefined> | string | undefined;
export interface McpGrant {
  serverId: string;
  toolName: string;
  runtimeName: string;
  autoApproveReadOnly: boolean;
}
export interface McpPlan {
  servers: Record<string, SdkMcpConfig>;
  grants: Map<string, McpGrant>;
  secrets: Set<string>;
}
const identifier = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const toolName = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const envName = /^[a-zA-Z_][a-zA-Z0-9_]{0,149}$/;

export function redactMcp(text: string, secrets: Set<string>): string {
  let output = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) output = output.split(secret).join('[secret masqué]');
  }
  return output;
}

/** Resolve credentials only in the host; callers must never persist or send this plan to a webview. */
export async function resolveMcpPlan(
  servers: McpServerConfig[],
  resolveSecret?: McpSecretResolver,
  discovery = false,
): Promise<McpPlan> {
  const plan: McpPlan = { servers: Object.create(null), grants: new Map(), secrets: new Set() };
  const ids = new Set<string>();
  for (const server of servers) {
    if (
      !identifier.test(server.id) ||
      ['constructor', 'prototype', 'github'].includes(server.id) ||
      ids.has(server.id)
    )
      throw new Error('Identifiant MCP invalide, réservé ou dupliqué.');
    ids.add(server.id);
    if (!discovery && !server.enabled)
      throw new Error(`Le serveur MCP ${server.name} est désactivé.`);
    if (
      !discovery &&
      (!server.tools.length ||
        new Set(server.tools).size !== server.tools.length ||
        server.tools.some((name) => !toolName.test(name)))
    )
      throw new Error(
        `Sélectionne des outils MCP précis pour ${server.name}. Les jokers sont interdits pendant une exécution.`,
      );
    const secret = async (key: string): Promise<string> => {
      if (!envName.test(key)) throw new Error('Référence de secret MCP invalide.');
      const value = (await resolveSecret?.(server.id, key)) ?? process.env[key];
      if (typeof value !== 'string' || !value)
        throw new Error(`Secret ou variable ${key} absent pour ${server.name}.`);
      plan.secrets.add(value);
      const bearer = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value);
      if (bearer) plan.secrets.add(bearer[1]);
      return value;
    };
    const tools = discovery ? ['*'] : [...server.tools];
    if (server.transport === 'stdio') {
      if (!server.command?.trim() || !Array.isArray(server.args))
        throw new Error(`Commande MCP absente pour ${server.name}.`);
      const env: Record<string, string> = Object.create(null);
      for (const key of server.envKeys) env[key] = await secret(key);
      plan.servers[server.id] = {
        type: 'stdio',
        command: server.command,
        args: [...server.args],
        env,
        tools,
        timeout: 60_000,
      };
    } else {
      if (!['http', 'sse'].includes(server.transport) || !server.url)
        throw new Error(`URL MCP absente pour ${server.name}.`);
      let url: URL;
      try {
        url = new URL(server.url);
      } catch {
        throw new Error(`URL MCP invalide pour ${server.name}.`);
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error('URL MCP HTTP(S) sans identifiants ni fragment requise.');
      const headers: Record<string, string> = Object.create(null);
      for (const [name, key] of Object.entries(server.headers)) {
        if (!/^[a-zA-Z0-9-]+$/.test(name)) throw new Error('Nom d’en-tête MCP invalide.');
        headers[name] = await secret(key);
      }
      plan.servers[server.id] = {
        type: server.transport,
        url: url.toString(),
        headers,
        tools,
        timeout: 60_000,
      };
    }
    if (!discovery)
      for (const name of server.tools) {
        const runtimeName = `${server.id}-${name}`;
        if (plan.grants.has(runtimeName)) throw new Error('Collision entre noms d’outils MCP.');
        plan.grants.set(runtimeName, {
          serverId: server.id,
          toolName: name,
          runtimeName,
          autoApproveReadOnly: server.autoApproveReadOnly === true,
        });
      }
  }
  return plan;
}

/** Check the runtime's model-facing catalog, not merely its version or configured names. */
export function verifyMcpCatalog(
  tools: CurrentToolMetadata[] | null,
  hostTools: Set<string>,
  plan: McpPlan,
): void {
  if (!tools) throw new Error('Catalogue d’outils indisponible : le CLI a renvoyé null.');
  const expected = new Set([...hostTools, ...plan.grants.keys()]);
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  const missing = [...expected].filter((name) => !counts.has(name));
  const unexpected = [...counts.keys()].filter((name) => !expected.has(name));
  const duplicates = [...counts.keys()].filter((name) => counts.get(name)! > 1);
  if (missing.length || unexpected.length || duplicates.length) {
    const names = (items: string[]) =>
      items.length
        ? items
            .slice(0, 30)
            .map((name) => JSON.stringify(name.slice(0, 128)))
            .join(', ') + (items.length > 30 ? ` (+${items.length - 30})` : '')
        : 'aucun';
    throw new Error(
      `Catalogue d’outils incomplet, dupliqué ou inattendu. Attendus : ${expected.size} ; reçus : ${tools.length}. Manquants : ${names(missing)}. Inattendus : ${names(unexpected)}. Doublons : ${names(duplicates)}.`,
    );
  }
  for (const tool of tools) {
    if (hostTools.has(tool.name)) {
      if (tool.mcpServerName || tool.mcpToolName || tool.namespacedName)
        throw new Error('Un outil externe usurpe un outil hôte.');
      continue;
    }
    const grant = plan.grants.get(tool.name);
    if (!grant || tool.mcpServerName !== grant.serverId || tool.mcpToolName !== grant.toolName)
      throw new Error('Provenance serveur/outils MCP non vérifiable ou non autorisée.');
  }
}

export async function decideMcpPermission(
  plan: McpPlan,
  request: PermissionRequest,
  policy: PolicyProfile,
  callbacks: RunCallbacks,
): Promise<PermissionRequestResult> {
  const reject = (feedback: string): PermissionRequestResult => ({ kind: 'reject', feedback });
  if (request.kind !== 'mcp')
    return reject(
      'Seuls les outils hôtes et les outils MCP explicitement sélectionnés sont autorisés.',
    );
  const grant = [...plan.grants.values()].find(
    (g) =>
      g.serverId === request.serverName &&
      (g.toolName === request.toolName || g.runtimeName === request.toolName),
  );
  if (!grant) return reject('Serveur ou outil MCP non sélectionné.');
  const readOnly = request.readOnly === true;
  if (policy === 'read-only' && !readOnly)
    return reject(
      'Cette étape interdit les opérations MCP d’écriture ou dont la lecture seule n’est pas attestée par le runtime.',
    );
  if (readOnly && grant.autoApproveReadOnly && !request.managedApprovalRequired)
    return { kind: 'approve-once' };
  if (!callbacks.onMcpPermission)
    return reject('Une permission humaine MCP est requise, mais aucun dialogue n’est disponible.');
  const approved = await callbacks.onMcpPermission({
    serverId: grant.serverId,
    toolName: grant.toolName,
    args: redactMcp(JSON.stringify(request.args ?? {}), plan.secrets),
    readOnly,
  });
  return approved === true
    ? { kind: 'approve-once', approvedInteractively: true }
    : reject('L’utilisateur a refusé cette opération MCP.');
}

/** Hold back a possible credential prefix when a token spans several streaming deltas. */
export class McpStreamRedactor {
  private pending = '';
  constructor(private readonly secrets: Set<string>) {}
  push(chunk: string): string {
    if (!this.secrets.size) return chunk;
    this.pending = redactMcp(this.pending + chunk, this.secrets);
    const keep = Math.max(0, ...[...this.secrets].map((secret) => secret.length - 1));
    const length = Math.max(0, this.pending.length - keep);
    const safe = this.pending.slice(0, length);
    this.pending = this.pending.slice(length);
    return safe;
  }
  finish(): string {
    const safe = redactMcp(this.pending, this.secrets);
    this.pending = '';
    return safe;
  }
}
