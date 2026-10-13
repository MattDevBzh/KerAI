import { readFile, readdir, mkdir, lstat, writeFile } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { AgentProfile, SkillInfo, Workflow } from '../shared/types';
import { validateWorkflow } from './workflow';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const avatarSchema = z.enum([
  'wizard',
  'hacker',
  'detective',
  'lumberjack',
  'scientist',
  'robot',
  'ninja',
  'captain',
]);
const agentMetadata = z.object({
  name: z.string().min(1),
  description: z.string(),
  tools: z.array(z.string()).default(['read', 'search', 'edit']),
  model: z.string().optional(),
  skills: z.array(identifier).default([]),
  nickname: z.string().max(80).optional(),
  avatar: avatarSchema.optional(),
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
async function safePath(root: string, fragment: string): Promise<string> {
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
async function files(root: string, fragment: string): Promise<string[]> {
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

function userKitMarkdown(content: string, target: string): string {
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
              { metadata, body } = markdown(await readFile(path, 'utf8'));
            const id = identifier.parse(basename(file, '.agent.md'));
            const fields = z.record(z.string(), z.unknown()).parse(metadata);
            const meta = agentMetadata.parse({ ...fields, name: fields.name ?? id });
            if (!body) throw new Error('Instructions vides.');
            agents.set(id, { ...meta, id, instructions: body, source, path });
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
            skills.set(id, { ...meta, id, content, source, path });
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
    return {
      agents: [...agents.values()],
      skills: [...skills.values()],
      workflows: [...workflows.values()],
      notices,
    };
  }

  async installKit(): Promise<InstallationReport> {
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
    const report: InstallationReport = {
      directory: this.userPath,
      installed: [],
      unchanged: [],
      conflicts: [],
    };
    for (const entry of entries) {
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
    >,
  ): Promise<void> {
    const id = identifier.parse(input.id),
      meta = agentMetadata.parse(input);
    if (!input.instructions.trim()) throw new Error('Instructions obligatoires.');
    const path = await safePath(this.workspacePath, `.github/agents/${id}.agent.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `---\n${stringify(meta)}---\n\n${input.instructions.trim()}\n`, 'utf8');
  }
  async saveSkill(id: string, content: string): Promise<void> {
    identifier.parse(id);
    const { metadata, body } = markdown(content);
    skillMetadata.parse(metadata);
    if (!body) throw new Error('Skill vide.');
    const path = await safePath(this.workspacePath, `.github/skills/${id}/SKILL.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
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
      this.workspacePath,
      `.feature-studio/workflows/${identifier.parse(workflow.id)}.yaml`,
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stringify(workflow), 'utf8');
  }
}
