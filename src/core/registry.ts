import { readFile, readdir, mkdir, lstat, writeFile, open, rename, unlink } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ProfileSaveOptions,
  ProfileSaveResult,
  ProfileScope,
  ProfileTarget,
} from '../shared/profiles';
import { homedir } from 'node:os';
import { parse, parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import type { AgentProfile, SkillInfo, Workflow } from '../shared/types';
import { validateWorkflow } from './workflow';
import { ROAST_LEVELS } from '../shared/roast';
import { acceptedAvatarIds } from '../shared/avatars';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const avatarSchema = z.enum(acceptedAvatarIds);
const agentMetadata = z.object({
  name: z.string().min(1),
  description: z.string(),
  tools: z.array(z.string()).default(['read', 'search', 'edit']),
  model: z.string().optional(),
  skills: z.array(identifier).default([]),
  nickname: z.string().max(80).optional(),
  avatar: avatarSchema.optional(),
  emptyContextByDefault: z.boolean().optional(),
  discussionAgent: z.boolean().optional(),
  roastLevel: z.enum(ROAST_LEVELS).optional(),
});
const skillMetadata = z.object({ name: z.string().min(1), description: z.string() });
export interface RegistryData {
  agents: AgentProfile[];
  skills: SkillInfo[];
  workflows: Workflow[];
  notices: string[];
}
export interface InstallationReport {
  directory: string;
  installed: string[];
  unchanged: string[];
  conflicts: string[];
}

function markdown(source: string): { metadata: unknown; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw new Error('Frontmatter YAML requis.');
  return { metadata: parse(match[1], { uniqueKeys: true }), body: match[2].trim() };
}
/** Reject symlinks as well as traversal, including parent directory symlinks. */
export async function safePath(root: string, fragment: string): Promise<string> {
  if (!fragment || isAbsolute(fragment)) throw new Error('Chemin relatif requis.');
  const absoluteRoot = resolve(root),
    target = resolve(absoluteRoot, fragment),
    rel = relative(absoluteRoot, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Chemin hors du dépôt.');
  let current = absoluteRoot;
  try {
    if ((await lstat(current)).isSymbolicLink())
      throw new Error(`Lien symbolique interdit : ${current}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const part of rel.split(/[\\/]/)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Lien symbolique interdit : ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}
export async function files(root: string, fragment: string): Promise<string[]> {
  const directory = await safePath(root, fragment);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const result: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    if (entry.isSymbolicLink()) throw new Error(`Lien symbolique interdit : ${entry.name}`);
    const child = join(fragment, entry.name);
    if (entry.isDirectory()) result.push(...(await files(root, child)));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

function revision(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
async function targetRevision(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink > 1)
      throw new Error('Destination non régulière ou lien physique : enregistrement refusé.');
    return revision(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Keep the upstream project kit intact; map its resources into the personal Copilot layout. */
function userKitTarget(target: string): string {
  if (target.startsWith('.github/agents/')) return target.slice('.github/'.length);
  if (target.startsWith('.github/skills/')) return target.slice('.github/'.length);
  if (target === '.github/copilot-instructions.md') return 'copilot-instructions.md';
  if (target.startsWith('.ai/kit/'))
    return join('feature-studio/kit', target.slice('.ai/kit/'.length));
  if (target.startsWith('.ai/'))
    return join('feature-studio/kit/examples', target.slice('.ai/'.length));
  return join('feature-studio/kit', target);
}

export function userKitMarkdown(content: string, target: string): string {
  // A project's map cannot become a shared user map. Keep the reference relative to the active repo.
  content = content.replace(
    /\[carte du dépôt\]\((?:\.\.\/)+\.ai\/project\.md\)/g,
    'carte du dépôt `.ai/project.md` dans le projet courant, si elle existe',
  );
  content = content.replace(
    /\((?:\.\.\/)+templates\/([^)]+)\)/g,
    (_match, file: string) =>
      `(${relative(dirname(target), join('feature-studio/kit/templates', file)).replaceAll('\\', '/')})`,
  );
  if (target.replaceAll('\\', '/').startsWith('agents/'))
    content = content.replace(
      /(?<![\w/])templates\/review\.md/g,
      '../feature-studio/kit/templates/review.md',
    );
  if (target === 'copilot-instructions.md')
    content = content
      .replace(
        '# Consignes du dépôt - à fusionner avec les consignes existantes',
        '# Consignes personnelles du kit Copilot',
      )
      .replace(
        'Lire `.ai/project.md` puis',
        'Lire `.ai/project.md` dans le projet courant si ce fichier existe, puis',
      );
  return content;
}

export class AgentRegistry {
  constructor(
    readonly workspacePath: string,
    readonly defaultsPath: string,
    readonly userPath: string = resolve(process.env.COPILOT_HOME || join(homedir(), '.copilot')),
  ) {}

  async load(): Promise<RegistryData> {
    const agents = new Map<string, AgentProfile>(),
      skills = new Map<string, SkillInfo>(),
      workflows = new Map<string, Workflow>();
    const notices: string[] = [];
    const scan = async (root: string, folder: string) => {
      try {
        return await files(root, folder);
      } catch (error) {
        notices.push(`${folder} : ${(error as Error).message}`);
        return [];
      }
    };
    for (const [root, source, agentFolder, skillFolder, workflowFolder] of [
      [this.defaultsPath, 'bundled', 'agents', 'kit/.github/skills', 'workflows'],
      [this.defaultsPath, 'bundled', 'devops/agents', 'devops/skills', 'devops/workflows'],
      [this.userPath, 'user', 'agents', 'skills', 'feature-studio/workflows'],
      [
        this.workspacePath,
        'workspace',
        '.github/agents',
        '.github/skills',
        '.feature-studio/workflows',
      ],
    ] as const) {
      for (const file of await scan(root, agentFolder))
        if (file.endsWith('.agent.md')) {
          try {
            const path = await safePath(root, file),
              content = await readFile(path, 'utf8'),
              { metadata, body } = markdown(content);
            const id = identifier.parse(basename(file, '.agent.md'));
            const fields = z.record(z.string(), z.unknown()).parse(metadata);
            const meta = agentMetadata.parse({ ...fields, name: fields.name ?? id });
            if (!body) throw new Error('Instructions vides.');
            const version = {
              ...meta,
              id,
              instructions: body,
              source,
              path,
              revision: revision(content),
            };
            agents.set(id, {
              ...version,
              versions: [...(agents.get(id)?.versions ?? []), version],
            });
          } catch (error) {
            notices.push(`${file} ignoré : ${(error as Error).message}`);
          }
        }
      for (const file of await scan(root, skillFolder))
        if (basename(file) === 'SKILL.md') {
          try {
            const path = await safePath(root, file),
              content = await readFile(path, 'utf8'),
              { metadata, body } = markdown(content);
            const meta = skillMetadata.parse(metadata),
              id = identifier.parse(basename(dirname(file)));
            if (!body) throw new Error('Skill vide.');
            const version = { ...meta, id, content, source, path, revision: revision(content) };
            skills.set(id, {
              ...version,
              versions: [...(skills.get(id)?.versions ?? []), version],
            });
          } catch (error) {
            notices.push(`${file} ignoré : ${(error as Error).message}`);
          }
        }
      for (const file of await scan(root, workflowFolder))
        if (/\.ya?ml$/.test(file)) {
          try {
            const path = await safePath(root, file);
            const workflow = validateWorkflow(
              parse(await readFile(path, 'utf8'), { uniqueKeys: true }),
            );
            workflows.set(workflow.id, { ...workflow, source: path });
          } catch (error) {
            notices.push(`${file} ignoré : ${(error as Error).message}`);
          }
        }
    }
    for (const [id, workflow] of workflows) {
      const removed = await safePath(this.userPath, `feature-studio/removed-workflows/${id}.json`);
      if (
        await lstat(removed).then(
          () => true,
          (error) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          },
        )
      ) {
        workflows.delete(id);
        continue;
      }
      const invalid = workflow.steps.find(
        (s) => !agents.has(s.agentId) || s.skills.some((skill) => !skills.has(skill)),
      );
      if (invalid) {
        notices.push(`${workflow.name} ignoré : agent ou skill inconnu pour ${invalid.id}.`);
        workflows.delete(id);
      }
    }
    for (const agent of agents.values())
      for (const skill of agent.skills)
        if (!skills.has(skill)) notices.push(`${agent.name} : skill absent ${skill}.`);
    for (const [kind, entries] of [
      ['agent', agents.values()],
      ['skill', skills.values()],
    ] as const) {
      for (const entry of entries) {
        try {
          entry.targets = await this.targets(kind, entry.id);
        } catch (error) {
          notices.push(`${entry.id} : ${(error as Error).message}`);
        }
      }
    }
    return {
      agents: [...agents.values()],
      skills: [...skills.values()],
      workflows: [...workflows.values()],
      notices,
    };
  }

  async installKit(excludedTargets: string[] = []): Promise<InstallationReport> {
    const excluded = new Set(excludedTargets.map((target) => target.replaceAll('\\', '/')));
    const manifest = z
      .object({ files: z.array(z.object({ source: z.string(), target: z.string() })) })
      .parse(
        JSON.parse(await readFile(join(this.defaultsPath, 'kit/install-manifest.json'), 'utf8')),
      );
    const entries = manifest.files.map((file) => ({
      source: join('kit', file.source),
      target: userKitTarget(file.target),
    }));
    for (const file of await files(this.defaultsPath, 'agents'))
      if (file.endsWith('.agent.md'))
        entries.push({ source: file, target: join('agents', basename(file)) });
    for (const file of await files(this.defaultsPath, 'workflows'))
      if (/\.ya?ml$/.test(file))
        entries.push({ source: file, target: join('feature-studio/workflows', basename(file)) });
    for (const [folder, target] of [
      ['devops/agents', 'agents'],
      ['devops/workflows', 'feature-studio/workflows'],
      ['devops/skills', 'skills'],
    ] as const)
      for (const file of await files(this.defaultsPath, folder))
        entries.push({ source: file, target: join(target, relative(folder, file)) });
    entries.push({ source: 'devops/README.md', target: 'feature-studio/devops/README.md' });
    const report: InstallationReport = {
      directory: this.userPath,
      installed: [],
      unchanged: [],
      conflicts: [],
    };
    for (const entry of entries) {
      if (excluded.has(entry.target.replaceAll('\\', '/'))) continue;
      const source = await safePath(this.defaultsPath, entry.source);
      const original = await readFile(source);
      const content = entry.target.endsWith('.md')
        ? Buffer.from(userKitMarkdown(original.toString('utf8'), entry.target))
        : original;
      try {
        const target = await safePath(this.userPath, entry.target);
        await mkdir(dirname(target), { recursive: true });
        // Exclusive creation keeps every pre-existing user file intact, even if two install requests overlap.
        try {
          await writeFile(target, content, { flag: 'wx' });
          report.installed.push(entry.target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (content.equals(await readFile(target))) report.unchanged.push(entry.target);
          else report.conflicts.push(entry.target);
        }
      } catch (error) {
        report.conflicts.push(`${entry.target} : ${(error as Error).message}`);
      }
    }
    return report;
  }

  private fragment(kind: 'agent' | 'skill', id: string, scope: ProfileScope): string {
    return `${scope === 'workspace' ? '.github/' : ''}${kind === 'agent' ? `agents/${id}.agent.md` : `skills/${id}/SKILL.md`}`;
  }
  private root(scope: ProfileScope): string {
    return scope === 'workspace' ? this.workspacePath : this.userPath;
  }
  private async targets(
    kind: 'agent' | 'skill',
    id: string,
  ): Promise<Record<ProfileScope, ProfileTarget>> {
    const target = async (scope: ProfileScope) => {
      const path = await safePath(this.root(scope), this.fragment(kind, id, scope));
      return { path, revision: await targetRevision(path) };
    };
    return { user: await target('user'), workspace: await target('workspace') };
  }
  async saveAgent(
    input: Pick<
      AgentProfile,
      | 'id'
      | 'name'
      | 'description'
      | 'instructions'
      | 'tools'
      | 'model'
      | 'skills'
      | 'nickname'
      | 'avatar'
      | 'emptyContextByDefault'
      | 'discussionAgent'
      | 'roastLevel'
      | 'targets'
      | 'revision'
    > & { source?: AgentProfile['source'] },
    options: ProfileSaveOptions = {
      scope: 'user',
      expectedRevision: input.targets?.user.revision ?? null,
      sourceScope: input.source,
      sourceRevision: input.revision,
    },
  ): Promise<ProfileSaveResult> {
    const id = identifier.parse(input.id),
      meta = agentMetadata.parse(input);
    if (!input.instructions.trim()) throw new Error('Instructions obligatoires.');
    return this.saveProfile('agent', id, options, async (previous, origin) => {
      const original = previous ?? origin ?? '---\n{}\n---\n';
      z.record(z.string(), z.unknown()).parse(markdown(original).metadata);
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(original)![1];
      const document = parseDocument(frontmatter, { uniqueKeys: true });
      for (const key of Object.keys(agentMetadata.shape)) {
        // Older editors cannot clear a tone they do not know about; the current UI sends off explicitly.
        if ((key === 'roastLevel' || key === 'discussionAgent') && input[key] === undefined)
          continue;
        const value = meta[key as keyof typeof meta];
        if (value === undefined) document.delete(key);
        else document.set(key, value);
      }
      return `---\n${document.toString()}---\n\n${input.instructions.trim()}\n`;
    });
  }
  async saveSkill(
    id: string,
    content: string,
    options: ProfileSaveOptions = { scope: 'user', expectedRevision: null },
  ): Promise<ProfileSaveResult> {
    identifier.parse(id);
    const { metadata, body } = markdown(content);
    skillMetadata.parse(metadata);
    if (!body) throw new Error('Skill vide.');
    return this.saveProfile('skill', id, options, async () => content);
  }
  private async saveProfile(
    kind: 'agent' | 'skill',
    id: string,
    options: ProfileSaveOptions,
    content: (previous: string | undefined, origin: string | undefined) => Promise<string>,
  ): Promise<ProfileSaveResult> {
    if (
      !['user', 'workspace'].includes(options.scope) ||
      (options.expectedRevision !== null && !/^[a-f0-9]{64}$/.test(options.expectedRevision))
    )
      throw new Error('Portée ou révision invalide.');
    const root = this.root(options.scope),
      fragment = this.fragment(kind, id, options.scope);
    const path = await safePath(root, fragment);
    await mkdir(dirname(path), { recursive: true });
    await safePath(root, fragment);
    const lockPath = await safePath(root, `${fragment}.feature-studio.lock`);
    let lock;
    try {
      lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          'Une sauvegarde de ce profil est déjà en cours dans une autre fenêtre. Réessayez sans fermer votre brouillon.',
        );
      throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const assertRevision = async () => {
        await safePath(root, fragment);
        if ((await targetRevision(path)) !== options.expectedRevision)
          throw new Error(
            'Ce profil a changé depuis l’ouverture de l’éditeur. Votre brouillon est conservé. Rouvrez le profil pour comparer les versions, ou copiez votre brouillon vers un nouvel identifiant.',
          );
      };
      await assertRevision();
      let origin: string | undefined;
      if (options.sourceScope && options.sourceRevision) {
        const data = await this.load();
        const entry = (kind === 'agent' ? data.agents : data.skills).find(
          (entry) => entry.id === id,
        );
        const version = entry?.versions?.find((version) => version.source === options.sourceScope);
        if (!version || version.revision !== options.sourceRevision)
          throw new Error(
            'La version copiée a changé. Votre brouillon est conservé : comparez les versions avant de réessayer.',
          );
        origin = await readFile(version.path, 'utf8');
        if (revision(origin) !== options.sourceRevision)
          throw new Error('La version copiée a changé. Votre brouillon est conservé.');
      }
      const previous = options.expectedRevision === null ? undefined : await readFile(path, 'utf8');
      let value = await content(previous, origin);
      if (options.sourceScope === 'bundled' && options.scope === 'user') {
        // Install supporting resources without racing or replacing the target being customized.
        await this.installKit([fragment]);
        value = userKitMarkdown(value, fragment);
      }
      await writeFile(temporary, value, { flag: 'wx', mode: 0o600 });
      await assertRevision();
      await rename(temporary, path);
      return { scope: options.scope, path, revision: revision(value) };
    } finally {
      await unlink(temporary).catch(() => {});
      await lock.close();
      await unlink(lockPath);
    }
  }
  async saveWorkflow(input: Workflow): Promise<void> {
    const { source: _source, ...definition } = input;
    const workflow = validateWorkflow(definition);
    const data = await this.load();
    if (
      workflow.steps.some(
        (step) =>
          !data.agents.some((agent) => agent.id === step.agentId) ||
          step.skills.some((skill) => !data.skills.some((s) => s.id === skill)),
      )
    )
      throw new Error('Agent ou skill inconnu dans le workflow.');
    const path = await safePath(
      this.userPath,
      `feature-studio/workflows/${identifier.parse(workflow.id)}.yaml`,
    );
    await mkdir(dirname(path), { recursive: true });
    await safePath(this.userPath, `feature-studio/workflows/${workflow.id}.yaml`);
    await writeFile(path, stringify(workflow), 'utf8');
    const removed = await safePath(
      this.userPath,
      `feature-studio/removed-workflows/${workflow.id}.json`,
    );
    await unlink(removed).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  /** Retire all versions from this user's catalogue; existing sessions own their step snapshots. */
  async deleteWorkflow(id: string): Promise<void> {
    identifier.parse(id);
    const data = await this.load();
    if (!data.workflows.some((workflow) => workflow.id === id))
      throw new Error('Parcours inconnu.');
    const fragment = `feature-studio/removed-workflows/${id}.json`;
    const target = await safePath(this.userPath, fragment);
    await mkdir(dirname(target), { recursive: true });
    await safePath(this.userPath, fragment);
    await writeFile(target, JSON.stringify({ id, removedAt: new Date().toISOString() }), {
      flag: 'wx',
      mode: 0o600,
    });
  }
}
