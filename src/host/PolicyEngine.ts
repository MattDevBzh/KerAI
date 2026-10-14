import { createHash } from 'node:crypto';
import { lstat, realpath, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PolicyProfile, TestCommand } from '../shared/types';
import { canonicalCaseless } from './UnicodeCaseFold';
import { equivalentWorkspaceFiles } from './FilesystemPathIdentity';

export const sha256 = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex');
const secretName =
  /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i;
// .azure is also a conventional project folder for pipelines and scripts.
// Block Azure CLI identities/caches by name (including backup extensions), not
// every source file beneath a directory named .azure.
const azureIdentityName =
  /^(?:accesstokens?|azureprofile|msal_token_cache|msal_http_cache|service_principal_entries|personalaccesstokens)(?:\..*)?$/;
const azureRuntimeEntries = new Set([
  'config',
  'clouds.config',
  'az.json',
  'az.sess',
  'commands',
  'logs',
  'telemetry',
  'azuredevops',
]);
const excluded = new Set([
  '.git',
  '.feature-studio',
  'node_modules',
  '.ssh',
  '.aws',
  '.codex',
  '.copilot',
  '.venv',
  'bin',
  'obj',
]);
export const isSensitivePath = (name: string): boolean => {
  const segments = name.replaceAll('\\', '/').split('/').map(canonicalCaseless);
  return segments.some(
    (segment, index) =>
      excluded.has(segment) ||
      secretName.test(segment) ||
      azureIdentityName.test(segment) ||
      (segments[index - 1] === '.azure' && azureRuntimeEntries.has(segment)),
  );
};

export class PolicyEngine {
  private readHashes = new Map<string, string>();
  private root = '';
  private initialization?: Promise<void>;
  private dirtyAliases = new Map<string, string[]>();
  private ownedAliases = new Map<string, Set<string>>();
  private verifiedOwnedAliases = new Map<string, string[]>();
  constructor(
    private workspace: string,
    readonly profile: PolicyProfile,
    private testPaths: string[],
    private dirtyFiles: Set<string> = new Set(),
    private ownedHashes: Record<string, string> = {},
  ) {}
  async initialize(): Promise<void> {
    this.initialization ??= this.initializePaths();
    await this.initialization;
  }
  private async initializePaths(): Promise<void> {
    const root = await realpath(this.workspace);
    this.dirtyFiles = new Set([...this.dirtyFiles].map((name) => path.posix.normalize(name)));
    for (const name of this.dirtyFiles) {
      const key = canonicalCaseless(name);
      this.dirtyAliases.set(key, [...(this.dirtyAliases.get(key) ?? []), name]);
    }
    const owned: Record<string, string> = Object.create(null);
    for (const [name, hash] of Object.entries(this.ownedHashes)) {
      const key = path.posix.normalize(name);
      if (Object.hasOwn(owned, key) && owned[key] !== hash)
        throw new Error('Empreintes contradictoires pour un même fichier.');
      owned[key] = hash;
      const folded = canonicalCaseless(key);
      const aliases = this.ownedAliases.get(folded) ?? new Set<string>();
      aliases.add(key);
      this.ownedAliases.set(folded, aliases);
    }
    this.ownedHashes = owned;
    this.root = root;
  }
  async resolve(relativePath: string, write = false): Promise<string> {
    await this.initialize();
    if (
      !relativePath ||
      relativePath.includes('\0') ||
      path.isAbsolute(relativePath) ||
      /^[a-z]:/i.test(relativePath) ||
      relativePath.includes('\\')
    )
      throw new Error('Utiliser un chemin relatif au workspace, avec /.');
    const normalized = path.posix.normalize(relativePath);
    if (
      process.platform === 'win32' &&
      normalized.split('/').some((part) => /[. ]$/.test(part) && part !== '.')
    )
      throw new Error('Les alias de chemins Windows ne sont pas accessibles aux agents.');
    if (normalized === '..' || normalized.startsWith('../') || isSensitivePath(normalized))
      throw new Error('Chemin hors périmètre ou sensible : accès refusé.');
    if (write) {
      if (this.profile === 'read-only') throw new Error('Cet agent est en lecture seule.');
      if (['.github', '.vscode'].includes(canonicalCaseless(normalized.split('/')[0])))
        throw new Error(
          'Les configurations d’agents, hooks et outils se modifient dans le catalogue, pas par un agent.',
        );
      if (
        this.profile === 'tests' &&
        !this.testPaths.some((prefix) => normalized.startsWith(prefix.replace(/\/+$/, '') + '/'))
      )
        throw new Error('Le profil Tests ne peut écrire que dans les dossiers de tests autorisés.');
    }
    const target = path.resolve(this.root, normalized);
    if (target !== this.root && !target.startsWith(this.root + path.sep))
      throw new Error('Chemin hors workspace.');
    let current = this.root;
    for (const part of normalized.split('/').filter((p) => p && p !== '.')) {
      const parent = current;
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink())
          throw new Error('Les liens symboliques ne sont pas accessibles aux agents.');
        if (write && stat.isFile() && stat.nlink > 1)
          throw new Error('Écriture sur un lien physique refusée.');
        const names = await readdir(parent);
        if (!names.includes(part)) {
          // Git precomposeUnicode supplies NFC names for physical NFD entries on macOS.
          const canonical = names.find((name) => name.normalize('NFD') === part.normalize('NFD'));
          const entry = canonical ? await lstat(path.join(parent, canonical)) : undefined;
          if (!entry || entry.dev !== stat.dev || entry.ino !== stat.ino)
            throw new Error(
              'Alias de chemin refusé : utilise le nom exact du fichier ou du dossier.',
            );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return target;
  }
  async recordRead(relativePath: string, content: Buffer | string): Promise<void> {
    await this.resolve(relativePath);
    // ToolHost supplies its verified contextPath; other callers must read the same spelling.
    this.readHashes.set(path.posix.normalize(relativePath), sha256(content));
  }
  /** One spelling for ToolHost spans and output evidence, only after actual-entry proof. */
  async contextPath(relativePath: string, write = false): Promise<string> {
    const target = await this.resolve(relativePath, write);
    const normalized = path.posix.normalize(relativePath);
    const composed = normalized.normalize('NFC');
    if (composed === normalized) return normalized;
    try {
      const [actual, canonical] = await Promise.all([
        lstat(target),
        lstat(path.resolve(this.root, composed)),
      ]);
      if (actual.dev === canonical.dev && actual.ino === canonical.ino) return composed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return normalized;
  }
  async assertWrite(relativePath: string): Promise<string> {
    const target = await this.resolve(relativePath, true);
    const normalized = path.posix.normalize(relativePath);
    const folded = canonicalCaseless(normalized);
    let dirty = false,
      uncertain = false;
    for (const name of this.dirtyAliases.get(folded) ?? []) {
      const equivalence = await equivalentWorkspaceFiles(this.root, name, normalized);
      dirty ||= equivalence !== 'different';
      uncertain ||= equivalence === 'uncertain';
    }
    const owned: string[] = [];
    for (const name of this.ownedAliases.get(folded) ?? [])
      if ((await equivalentWorkspaceFiles(this.root, name, normalized)) === 'same')
        owned.push(name);
    this.verifiedOwnedAliases.set(normalized, owned);
    const hashes = new Set(owned.map((name) => this.ownedHashes[name]));
    if (hashes.size > 1) throw new Error('Empreintes contradictoires pour un même fichier.');
    const ownedHash = uncertain ? undefined : hashes.values().next().value;
    let content: Buffer;
    try {
      content = await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (dirty && ownedHash !== '<missing>')
          throw new Error(`Suppression préexistante protégée : ${normalized}.`);
        return target;
      }
      throw error;
    }
    const current = sha256(content);
    if (dirty && ownedHash !== current)
      throw new Error(
        `Modification préexistante protégée : ${normalized}. Au prochain lancement, prépare l’aperçu et sélectionne ce fichier dans « Reprendre des modifications existantes », puis actualise l’aperçu. Un accord dans la conversation ne suffit pas.`,
      );
    if (this.readHashes.get(normalized) !== current)
      throw new Error(
        `Relis ${normalized} avant de l’écrire : contenu absent du contexte ou modifié depuis la dernière lecture.`,
      );
    return target;
  }
  recordWrite(relativePath: string, content: string): void {
    const normalized = path.posix.normalize(relativePath);
    const folded = canonicalCaseless(normalized);
    const aliases = this.ownedAliases.get(folded) ?? new Set<string>();
    for (const name of this.verifiedOwnedAliases.get(normalized) ?? []) {
      delete this.ownedHashes[name];
      aliases.delete(name);
    }
    aliases.add(normalized);
    this.ownedAliases.set(folded, aliases);
    this.ownedHashes[normalized] = sha256(content);
    this.readHashes.set(normalized, sha256(content));
  }
  assertCommand(id: string, commands: TestCommand[]): TestCommand {
    if (this.profile !== 'tests')
      throw new Error('Les commandes de test sont réservées au profil Tests.');
    const command = commands.find((item) => item.id === id);
    if (!command)
      throw new Error('Cette commande de test n’a pas été autorisée dans les réglages.');
    return command;
  }
}
