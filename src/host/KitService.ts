import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, lstat, unlink, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { AgentRegistry, safePath, files, userKitMarkdown, avatarSchema } from '../core/registry';
import { validateWorkflow } from '../core/workflow';
import { kitBundleSchema, kitMetadataSchema, KIT_LIMITS } from '../core/kitSchemas';
import { kitNodes, resolveKitSelection } from '../shared/kits';
import type {
  KitBundle,
  KitFile,
  KitRef,
  KitMetadata,
  KitNode,
  KitPreview,
  KitCatalogItem,
} from '../shared/kits';
import type { AgentProfile, SkillInfo, Workflow } from '../shared/types';
import { isSensitivePath } from './PolicyEngine';
import { canonicalCaseless } from './UnicodeCaseFold';
import { ROAST_LEVELS } from '../shared/roast';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const agentSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(500),
  skills: z.array(id).max(100).default([]),
  tools: z.array(z.string().max(100)).max(30).default(['read', 'search', 'edit']),
  model: z.string().max(500).optional(),
  avatar: avatarSchema.optional(),
  nickname: z.string().max(80).optional(),
  emptyContextByDefault: z.boolean().optional(),
  discussionAgent: z.boolean().optional(),
  roastLevel: z.enum(ROAST_LEVELS).optional(),
});
const PRESETS: KitMetadata[] = [
  {
    id: 'copilot',
    name: 'Atelier Copilot',
    version: '2.0.0',
    description:
      'Du besoin au code relu. Les agents, méthodes et parcours du kit de développement.',
  },
  {
    id: 'devops',
    name: 'DevOps',
    version: '1.0.0',
    description:
      'Du challenge au test vérifié. Six spécialistes, des preuves et un test hors production maîtrisé.',
  },
];
const splitMarkdown = (content: string) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
  if (!match || !match[2].trim()) throw Error('Frontmatter ou instructions manquants.');
  return { meta: parse(match[1], { uniqueKeys: true }), body: match[2].trim() };
};
function validatePath(path: string) {
  const parts = path.split('/');
  if (
    path.includes('\\') ||
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        /[\x00-\x1f:<>"|?*]/.test(p) ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    ) ||
    isSensitivePath(path)
  )
    throw Error(`Chemin interdit dans le kit : ${path}`);
  if (
    !/^(agents\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.agent\.md|skills\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/.+|feature-studio\/workflows\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.ya?ml|feature-studio\/(?:kit|devops)\/.+)$/.test(
      path,
    )
  )
    throw Error(`Destination non autorisée : ${path}`);
}
function makeFile(path: string, bytes: Buffer): KitFile {
  validatePath(path);
  if (bytes.length > KIT_LIMITS.fileBytes) throw Error(`Fichier trop volumineux : ${path}`);
  // Known credential formats are rejected; no claim of exhaustive secret detection.
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})\b/.test(
      bytes.toString('utf8'),
    )
  )
    throw Error(`Secret potentiel dans ${path}. Retire-le avant de créer le kit.`);
  return { path, base64: bytes.toString('base64'), sha256: hash(bytes) };
}
function localReferences(file: KitFile): string[] {
  if (!file.path.endsWith('.md')) return [];
  const content = Buffer.from(file.base64, 'base64').toString('utf8');
  return [...content.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((link) => !/^(?:[a-z]+:|#)/i.test(link))
    .map((link) =>
      relative('/', resolve('/', dirname(file.path), link.split('#')[0])).replaceAll('\\', '/'),
    );
}
function bundleNodes(bundle: KitBundle): KitNode[] {
  const agents: AgentProfile[] = [],
    skills: SkillInfo[] = [],
    workflows: Workflow[] = [];
  for (const file of bundle.files) {
    const text = Buffer.from(file.base64, 'base64').toString('utf8');
    if (file.path.startsWith('agents/')) {
      const { meta, body } = splitMarkdown(text);
      const aid = basename(file.path, '.agent.md');
      const info = agentSchema.parse({ ...meta, name: meta?.name ?? aid });
      const linked = [
        ...body.matchAll(/\]\((?:\.\.\/)*skills\/([a-zA-Z0-9_-]+)\/SKILL\.md\)/g),
      ].map((m) => m[1]);
      agents.push({
        ...info,
        skills: [...new Set([...info.skills, ...linked])],
        id: aid,
        instructions: body,
        path: file.path,
        source: 'user',
      });
    } else if (/^skills\/[^/]+\/SKILL\.md$/.test(file.path)) {
      const { meta } = splitMarkdown(text);
      const info = z.object({ name: z.string().min(1), description: z.string() }).parse(meta);
      skills.push({
        ...info,
        id: file.path.split('/')[1],
        content: text,
        path: file.path,
        source: 'user',
      });
    } else if (file.path.startsWith('feature-studio/workflows/')) {
      const workflow = validateWorkflow(parse(text, { uniqueKeys: true }));
      if (workflow.id !== basename(file.path).replace(/\.ya?ml$/, ''))
        throw Error('Identifiant de parcours différent du nom de fichier.');
      if (workflow.source || workflow.steps.some((s) => s.mcpServerIds?.length))
        throw Error('Un kit ne doit pas contenir de chemin source ou de connexion MCP active.');
      workflows.push(workflow);
    }
  }
  return kitNodes({ agents, skills, workflows });
}
export function validateKit(input: unknown): { bundle: KitBundle; nodes: KitNode[] } {
  const bundle = kitBundleSchema.parse(input) as KitBundle;
  const paths = new Set<string>();
  let size = 0;
  for (const file of bundle.files) {
    validatePath(file.path);
    const key = canonicalCaseless(file.path.normalize('NFC'));
    if (paths.has(key)) throw Error(`Chemin dupliqué : ${file.path}`);
    paths.add(key);
    const bytes = Buffer.from(file.base64, 'base64');
    if (bytes.toString('base64') !== file.base64 || hash(bytes) !== file.sha256)
      throw Error(`Contenu ou empreinte invalide : ${file.path}`);
    makeFile(file.path, bytes);
    size += bytes.length;
    if (size > KIT_LIMITS.totalBytes) throw Error('Le kit dépasse 16 Mio.');
  }
  for (const key of paths) {
    const parts = key.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (paths.has(parts.join('/'))) throw Error(`Collision fichier/dossier : ${key}`);
    }
  }
  const nodes = bundleNodes(bundle);
  if (new Set(nodes.map((n) => n.ref)).size !== nodes.length)
    throw Error('Profils dupliqués dans le kit.');
  const selected = resolveKitSelection(nodes, bundle.roots);
  if (selected.errors.length) throw Error(selected.errors.join('\n'));
  if (nodes.some((n) => !selected.refs.includes(n.ref)))
    throw Error('Le kit contient des profils hors sélection.');
  for (const file of bundle.files) {
    if (
      file.path.startsWith('skills/') &&
      !nodes.some((n) => n.ref === `skill:${file.path.split('/')[1]}`)
    )
      throw Error(`Ressource sans skill : ${file.path}`);
    for (const target of localReferences(file)) {
      if (!bundle.files.some((file) => file.path === target))
        throw Error(`Référence locale absente : ${file.path} → ${target}`);
    }
  }
  if (!nodes.length) throw Error('Kit sans parcours, agent ou skill.');
  return { bundle, nodes };
}

export class KitService {
  private previews = new Map<string, KitBundle>();
  constructor(readonly registry: AgentRegistry) {}
  private async addFile(
    entries: Map<string, KitFile>,
    root: string,
    source: string,
    target: string,
    normalize = false,
  ) {
    const path = await safePath(root, source),
      stat = await lstat(path);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > KIT_LIMITS.fileBytes)
      throw Error(`Fichier non exportable : ${source}`);
    const bytes = await readFile(path);
    const file = makeFile(
      target,
      normalize && target.endsWith('.md')
        ? Buffer.from(userKitMarkdown(bytes.toString('utf8'), target))
        : bytes,
    );
    const old = entries.get(target);
    if (old && old.sha256 !== file.sha256) throw Error(`Ressources incompatibles : ${target}`);
    entries.set(target, file);
  }
  private async support(entries: Map<string, KitFile>, root: string) {
    let prefix = root === this.registry.defaultsPath ? 'kit' : 'feature-studio/kit';
    if (!(await files(root, prefix)).length) {
      root = this.registry.defaultsPath;
      prefix = 'kit';
    }
    // The original kit uses shared templates outside skill folders. Carry its passive support files.
    for (const folder of ['templates', 'scripts'])
      for (const file of await files(root, `${prefix}/${folder}`))
        await this.addFile(
          entries,
          root,
          file,
          `feature-studio/kit/${relative(prefix, file).replaceAll('\\', '/')}`,
        );
    await this.addFile(entries, root, `${prefix}/SOURCES.md`, 'feature-studio/kit/SOURCES.md');
  }
  async compose(metadata: KitMetadata, roots: KitRef[]): Promise<KitBundle> {
    metadata = kitMetadataSchema.parse(metadata);
    const data = await this.registry.load(),
      nodes = kitNodes(data),
      selected = resolveKitSelection(nodes, roots);
    if (selected.errors.length) throw Error(selected.errors.join('\n'));
    const entries = new Map<string, KitFile>();
    const originalSupport = new Set<string>();
    for (const ref of selected.refs) {
      const [kind, identifier] = ref.split(':');
      if (kind === 'workflow') {
        const original = data.workflows.find((w) => w.id === identifier)!;
        const { source, ...workflow } = structuredClone(original);
        for (const step of workflow.steps) delete step.mcpServerIds;
        entries.set(
          `feature-studio/workflows/${identifier}.yaml`,
          makeFile(
            `feature-studio/workflows/${identifier}.yaml`,
            Buffer.from(JSON.stringify(workflow, null, 2) + '\n'),
          ),
        );
      } else {
        const profile = (kind === 'agent' ? data.agents : data.skills).find(
          (p) => p.id === identifier,
        )!;
        const root =
          profile.source === 'bundled'
            ? this.registry.defaultsPath
            : profile.source === 'user'
              ? this.registry.userPath
              : this.registry.workspacePath;
        const source = relative(root, profile.path);
        if (kind === 'agent')
          await this.addFile(entries, root, source, `agents/${identifier}.agent.md`, true);
        else
          for (const file of await files(root, dirname(source)))
            await this.addFile(
              entries,
              root,
              file,
              `skills/${identifier}/${relative(dirname(source), file).replaceAll('\\', '/')}`,
              true,
            );
        if (identifier.startsWith('ai-') || identifier === 'fs-review') originalSupport.add(root);
      }
    }
    for (const root of originalSupport) await this.support(entries, root);
    // Include explicitly linked, portable local references; arbitrary project files are never swept in.
    await this.references(entries);
    return validateKit({
      format: 'feature-studio-kit',
      schemaVersion: 1,
      metadata,
      roots,
      files: [...entries.values()],
    }).bundle;
  }
  private async references(entries: Map<string, KitFile>) {
    for (const file of entries.values()) {
      for (const target of localReferences(file)) {
        if (entries.has(target)) continue;
        validatePath(target);
        if (!target.startsWith('feature-studio/kit/'))
          throw Error(
            `Référence locale absente : ${file.path} → ${target}. Ajoute son profil au kit ou place la ressource dans le dossier de la skill.`,
          );
        await this.addFile(entries, this.registry.userPath, target, target);
      }
    }
  }
  async preset(kitId: string): Promise<KitBundle> {
    const metadata = PRESETS.find((p) => p.id === kitId);
    if (!metadata) throw Error('Kit prédéfini inconnu.');
    const isolated = new AgentRegistry(
      '/feature-studio-empty-workspace',
      this.registry.defaultsPath,
      '/feature-studio-empty-user',
    );
    const data = await isolated.load();
    const roots = kitNodes(data)
      .filter((n) =>
        kitId === 'devops'
          ? n.id === 'devops' || n.id.startsWith('fs-devops-') || n.id.startsWith('devops-')
          : !(n.id === 'devops' || n.id.startsWith('fs-devops-') || n.id.startsWith('devops-')),
      )
      .map((n) => n.ref);
    const builder = new KitService(isolated);
    const bundle = await builder.compose(metadata, roots);
    if (kitId === 'copilot') {
      const entries = new Map(bundle.files.map((file) => [file.path, file]));
      for (const file of await files(this.registry.defaultsPath, 'kit/.github/agents')) {
        if (!file.endsWith('.agent.md')) continue;
        await this.addFile(
          entries,
          this.registry.defaultsPath,
          file,
          `agents/${basename(file)}`,
          true,
        );
        bundle.roots.push(`agent:${basename(file, '.agent.md')}`);
      }
      bundle.files = [...entries.values()];
    }
    return validateKit(bundle).bundle;
  }
  async catalog(): Promise<KitCatalogItem[]> {
    const result: KitCatalogItem[] = [];
    const add = async (bundle: KitBundle, source: KitCatalogItem['source'], storageId?: string) => {
      const nodes = validateKit(bundle).nodes;
      const preview = await this.describe(bundle, '');
      result.push({
        metadata: bundle.metadata,
        source,
        storageId,
        nodes,
        installed: preview.files.every((f) => f.status === 'identical'),
      });
    };
    for (const preset of PRESETS) await add(await this.preset(preset.id), 'bundled');
    let names: string[] = [];
    try {
      names = await readdir(await safePath(this.registry.userPath, 'feature-studio/kits'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    for (const name of names
      .filter((n) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.fskit\.json$/.test(n))
      .sort()
      .slice(0, 100)) {
      const storageId = name.replace(/\.fskit\.json$/, '');
      try {
        await add(await this.saved(storageId), 'saved', storageId);
      } catch (error) {
        result.push({
          metadata: { id: storageId, name, description: '', version: 'Indisponible' },
          source: 'saved',
          storageId,
          nodes: [],
          installed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  }
  async saved(kitId: string) {
    id.parse(kitId);
    return this.readBundle(
      await safePath(this.registry.userPath, `feature-studio/kits/${kitId}.fskit.json`),
    );
  }
  async readBundle(path: string) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > KIT_LIMITS.jsonBytes)
      throw Error('Choisis un fichier .fskit.json régulier de moins de 24 Mio.');
    return validateKit(JSON.parse(await readFile(path, 'utf8'))).bundle;
  }
  async preview(bundle: KitBundle): Promise<KitPreview> {
    const validated = validateKit(bundle).bundle,
      token = randomUUID();
    this.previews.set(token, structuredClone(validated));
    while (this.previews.size > 8) this.previews.delete(this.previews.keys().next().value!);
    return this.describe(validated, token);
  }
  private async describe(bundle: KitBundle, token: string): Promise<KitPreview> {
    const entries: KitPreview['files'] = [];
    for (const file of bundle.files) {
      let status: KitPreview['files'][number]['status'] = 'new';
      try {
        const path = await safePath(this.registry.userPath, file.path),
          stat = await lstat(path);
        status =
          stat.isFile() &&
          stat.nlink === 1 &&
          stat.size <= KIT_LIMITS.fileBytes &&
          hash(await readFile(path)) === file.sha256
            ? 'identical'
            : 'conflict';
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') status = 'conflict';
      }
      entries.push({ path: file.path, bytes: Buffer.from(file.base64, 'base64').length, status });
    }
    const nodes = validateKit(bundle).nodes;
    const warnings = [
      'Les scripts sont copiés comme ressources ; aucune commande ni connexion MCP n’est activée.',
    ];
    if (entries.some((f) => f.status === 'conflict'))
      warnings.push(
        'Des fichiers personnels diffèrent. Leur remplacement est exclu : résous ces conflits ou utilise de nouveaux identifiants avant installation.',
      );
    if (
      nodes.some((n) =>
        n.tools?.some((t) => ['edit', 'write', 'execute', 'studio_run_test'].includes(t)),
      )
    )
      warnings.push(
        'Ce kit contient des agents capables de modifier des fichiers ou de demander des tests selon les permissions du parcours.',
      );
    return {
      token,
      metadata: bundle.metadata,
      roots: bundle.roots,
      nodes,
      files: entries,
      bytes: entries.reduce((n, f) => n + f.bytes, 0),
      warnings,
      canInstall: !entries.some((f) => f.status === 'conflict'),
    };
  }
  bundle(token: string): KitBundle {
    const bundle = this.previews.get(token);
    if (!bundle) throw Error('Aperçu expiré. Prépare de nouveau le kit.');
    return structuredClone(bundle);
  }
  async remember(bundle: KitBundle) {
    bundle = validateKit(bundle).bundle;
    const content = JSON.stringify(bundle, null, 2) + '\n';
    if (
      PRESETS.some((preset) => preset.id === bundle.metadata.id) &&
      content === JSON.stringify(await this.preset(bundle.metadata.id), null, 2) + '\n'
    )
      return;
    const dir = await safePath(this.registry.userPath, 'feature-studio/kits');
    await mkdir(dir, { recursive: true });
    // Keep distinct revisions discoverable without replacing the user's earlier kit.
    for (const storageId of [
      bundle.metadata.id,
      `${bundle.metadata.id.slice(0, 67)}-${hash(content).slice(0, 12)}`,
    ]) {
      const path = await safePath(
        this.registry.userPath,
        `feature-studio/kits/${storageId}.fskit.json`,
      );
      try {
        await writeFile(path, content, { flag: 'wx' });
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const stat = await lstat(path);
        if (
          stat.isFile() &&
          stat.size <= KIT_LIMITS.jsonBytes &&
          (await readFile(path, 'utf8')) === content
        )
          return;
      }
    }
    throw Error('Cette révision du kit possède déjà un fichier différent dans le catalogue.');
  }
  async install(token: string) {
    const bundle = this.bundle(token),
      preview = await this.describe(bundle, token);
    if (!preview.canInstall)
      throw Error(
        'Installation bloquée : des fichiers existants diffèrent. Aucun fichier remplacé.',
      );
    const created: KitFile[] = [];
    try {
      for (const file of bundle.files) {
        if (preview.files.find((f) => f.path === file.path)?.status === 'identical') continue;
        const path = await safePath(this.registry.userPath, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(file.base64, 'base64'), { flag: 'wx' });
        created.push(file);
      }
      const installed = await this.describe(bundle, token);
      if (installed.files.some((file) => file.status !== 'identical'))
        throw Error(
          'Les fichiers ont changé pendant l’installation. Recommence depuis un nouvel aperçu.',
        );
      await this.remember(bundle);
    } catch (error) {
      for (const file of created.reverse()) {
        try {
          const path = await safePath(this.registry.userPath, file.path);
          if (hash(await readFile(path)) === file.sha256) await unlink(path);
        } catch {
          /* Concurrent edits or removals must not hide the original failure. */
        }
      }
      throw error;
    }
    return `${created.length} fichiers installés ; ${bundle.files.length - created.length} déjà identiques.`;
  }
}
