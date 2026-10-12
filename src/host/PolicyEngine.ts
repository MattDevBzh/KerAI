import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PolicyProfile, TestCommand } from '../shared/types';

export const sha256 = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex');
const secretName =
  /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i;
const excluded = new Set([
  '.git',
  '.feature-studio',
  'node_modules',
  '.ssh',
  '.aws',
  '.azure',
  '.codex',
  '.copilot',
  '.venv',
  'bin',
  'obj',
]);
export const isSensitivePath = (name: string): boolean =>
  name
    .replaceAll('\\', '/')
    .split('/')
    .some((segment) => excluded.has(segment) || secretName.test(segment));

export class PolicyEngine {
  private readHashes = new Map<string, string>();
  private root = '';
  constructor(
    private workspace: string,
    readonly profile: PolicyProfile,
    private testPaths: string[],
    private dirtyFiles: Set<string> = new Set(),
    private ownedHashes: Record<string, string> = {},
  ) {}
  async initialize(): Promise<void> {
    this.root = await realpath(this.workspace);
  }
  async resolve(relativePath: string, write = false): Promise<string> {
    if (!this.root) await this.initialize();
    if (
      !relativePath ||
      relativePath.includes('\0') ||
      path.isAbsolute(relativePath) ||
      /^[a-z]:/i.test(relativePath) ||
      relativePath.includes('\\')
    )
      throw new Error('Utiliser un chemin relatif au workspace, avec /.');
    const normalized = path.posix.normalize(relativePath);
    if (normalized === '..' || normalized.startsWith('../') || isSensitivePath(normalized))
      throw new Error('Chemin hors périmètre ou sensible : accès refusé.');
    if (write) {
      if (this.profile === 'read-only') throw new Error('Cet agent est en lecture seule.');
      if (/^(?:\.github|\.vscode)(?:\/|$)/.test(normalized))
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
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink())
          throw new Error('Les liens symboliques ne sont pas accessibles aux agents.');
        if (write && stat.isFile() && stat.nlink > 1)
          throw new Error('Écriture sur un lien physique refusée.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return target;
  }
  async recordRead(relativePath: string, content: Buffer | string): Promise<void> {
    this.readHashes.set(path.posix.normalize(relativePath), sha256(content));
  }
  async assertWrite(relativePath: string): Promise<string> {
    const target = await this.resolve(relativePath, true);
    const normalized = path.posix.normalize(relativePath);
    let content: Buffer;
    try {
      content = await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (this.dirtyFiles.has(normalized))
          throw new Error(`Suppression préexistante protégée : ${normalized}.`);
        return target;
      }
      throw error;
    }
    const current = sha256(content);
    if (this.dirtyFiles.has(normalized) && this.ownedHashes[normalized] !== current)
      throw new Error(
        `Modification préexistante protégée : ${normalized}. Enregistre-la dans Git ou intègre-la toi-même avant de relancer.`,
      );
    if (this.readHashes.get(normalized) !== current)
      throw new Error(
        `Relis ${normalized} avant de l’écrire : contenu absent du contexte ou modifié depuis la dernière lecture.`,
      );
    return target;
  }
  recordWrite(relativePath: string, content: string): void {
    const normalized = path.posix.normalize(relativePath);
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
