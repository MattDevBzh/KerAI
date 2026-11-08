import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { Unzip, UnzipInflate, zipSync } from 'fflate';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { workshopManifestSchema } from '../core/workshopSchemas';
import { agentMetadataSchema, skillMetadataSchema, parseProfileMarkdown } from '../core/registry';
import { validateWorkflow } from '../core/workflow';
import { configurationSteps } from '../shared/subplans';
import { canonicalCaseless } from './UnicodeCaseFold';
import { isSensitivePath } from './PolicyEngine';

export const WORKSHOP_LIMITS = {
  files: 2048,
  file: 4 * 1024 * 1024,
  total: 32 * 1024 * 1024,
  zip: 40 * 1024 * 1024,
};
export type WorkshopFiles = Record<string, string>; // Base64 only in the private local snapshot; ZIP entries are ordinary files.
export type WorkshopManifest = z.infer<typeof workshopManifestSchema>;
export const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export const bytesOf = (value: string) => Buffer.from(value, 'base64');
export const isWorkflowFile = (path: string) => /\/workflows\/[^/]+\.ya?ml$/.test(path);

function safeName(path: string) {
  if (
    !path ||
    path.length > 600 ||
    path.includes('\\') ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[\x00-\x1f:<>"|?*]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw Error(`Chemin interdit dans l’atelier : ${path}`);
}
export function assertWorkshopPath(path: string) {
  safeName(path);
  const personal =
    /^(fourni|personnel)\/(agents\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.agent\.md|skills\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/.+|feature-studio\/(workflows\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.ya?ml|kit\/.+|devops\/.+))$/;
  const project =
    /^projet\/(\.github\/(agents\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.agent\.md|skills\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/.+|feature-studio\/(kit|devops)\/.+)|\.feature-studio\/workflows\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.ya?ml)$/;
  if (
    (!personal.test(path) && !project.test(path)) ||
    isSensitivePath(path) ||
    path.endsWith('.feature-studio.lock')
  )
    throw Error(`Fichier hors de l’atelier : ${path}`);
}
export function textOf(value: string): string | undefined {
  const bytes = bytesOf(value);
  if (bytes.includes(0)) return;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return;
  }
}
export function portableContent(path: string, bytes: Buffer): Buffer {
  if (!isWorkflowFile(path)) return bytes;
  const definition = validateWorkflow(parse(bytes.toString('utf8'), { uniqueKeys: true }));
  delete definition.source;
  for (const step of configurationSteps(definition.steps)) delete step.mcpServerIds;
  return Buffer.from(stringify(definition));
}
/** Local MCP bindings never leave the machine and survive an edit of the same step. */
export function installedContent(path: string, portable: string, previous?: string): string {
  if (!isWorkflowFile(path) || !previous) return portable;
  const next = validateWorkflow(parse(bytesOf(portable).toString('utf8'), { uniqueKeys: true }));
  const original = validateWorkflow(
    parse(bytesOf(previous).toString('utf8'), { uniqueKeys: true }),
  );
  const restore = (steps: typeof next.steps, old: typeof original.steps) => {
    for (const step of steps) {
      const before = old.find((candidate) => candidate.id === step.id);
      if (before?.mcpServerIds) step.mcpServerIds = [...before.mcpServerIds];
      if (step.subplan && before?.subplan) restore(step.subplan.steps, before.subplan.steps);
    }
  };
  restore(next.steps, original.steps);
  return Buffer.from(stringify(next)).toString('base64');
}
export function localLinks(path: string, content: string): string[] {
  if (!path.endsWith('.md')) return [];
  const text = textOf(content);
  if (text === undefined) throw Error(`Texte UTF-8 requis : ${path}`);
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((link) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link))
    .map((link) => {
      const target = decodeURIComponent(link.split(/[?#]/)[0]);
      if (!target) return path;
      if (target.startsWith('/') || target.includes('\\'))
        throw Error(`Lien local non portable : ${path} → ${link}`);
      return posix.normalize(posix.join(posix.dirname(path), target));
    });
}
/** Relative resources can be inherited from the supplied catalogue. */
export function resolveWorkshopReference(files: WorkshopFiles, path: string): string | undefined {
  if (Object.hasOwn(files, path)) return path;
  const canonical = path.startsWith('projet/.github/')
    ? path.slice('projet/.github/'.length)
    : path.startsWith('personnel/')
      ? path.slice('personnel/'.length)
      : undefined;
  if (canonical) {
    for (const candidate of [`personnel/${canonical}`, `fourni/${canonical}`])
      if (Object.hasOwn(files, candidate)) return candidate;
  }
}
export function validateWorkshopFiles(files: WorkshopFiles) {
  const paths = Object.keys(files);
  if (!paths.length || paths.length > WORKSHOP_LIMITS.files)
    throw Error('Nombre de fichiers d’atelier invalide.');
  const seen = new Set<string>();
  let total = 0;
  const agents = new Map<string, string[]>(),
    skills = new Set<string>();
  const workflows: ReturnType<typeof validateWorkflow>[] = [];
  for (const path of paths.sort((a, b) => {
    const rank = (p: string) => (p.startsWith('fourni/') ? 0 : p.startsWith('personnel/') ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  })) {
    assertWorkshopPath(path);
    const key = canonicalCaseless(path.normalize('NFC'));
    if (seen.has(key)) throw Error(`Chemin dupliqué : ${path}`);
    seen.add(key);
    const bytes = bytesOf(files[path]);
    if (
      bytes.toString('base64') !== files[path] ||
      bytes.length > WORKSHOP_LIMITS.file ||
      (total += bytes.length) > WORKSHOP_LIMITS.total
    )
      throw Error(`Contenu d’atelier trop volumineux ou invalide : ${path}`);
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})\b/.test(
        bytes.toString('utf8'),
      )
    )
      throw Error(`Secret potentiel dans ${path}. Retire-le avant l’export ou l’import.`);
    if (/\/agents\/[^/]+\.agent\.md$/.test(path)) {
      const { metadata, body } = parseProfileMarkdown(bytes.toString('utf8'));
      if (!body) throw Error(`Instructions vides : ${path}`);
      const id = posix.basename(path, '.agent.md');
      const info = agentMetadataSchema.parse({
        ...z.record(z.string(), z.unknown()).parse(metadata),
        name: (metadata as { name?: string }).name ?? id,
      });
      agents.set(id, info.skills);
    } else if (/\/skills\/[^/]+\/SKILL\.md$/.test(path)) {
      const { metadata, body } = parseProfileMarkdown(bytes.toString('utf8'));
      skillMetadataSchema.parse(metadata);
      if (!body) throw Error(`Skill vide : ${path}`);
      skills.add(posix.basename(posix.dirname(path)));
    } else if (isWorkflowFile(path)) {
      if (textOf(files[path]) === undefined) throw Error(`Texte UTF-8 requis : ${path}`);
      const workflow = validateWorkflow(parse(bytes.toString('utf8'), { uniqueKeys: true }));
      if (
        workflow.id !== posix.basename(path).replace(/\.ya?ml$/, '') ||
        workflow.source ||
        configurationSteps(workflow.steps).some((s) => s.mcpServerIds?.length)
      )
        throw Error(`Parcours non portable (identifiant, chemin ou connexion locale) : ${path}`);
      workflows.push(workflow);
    }
    for (const target of localLinks(path, files[path])) {
      if (!resolveWorkshopReference(files, target))
        throw Error(`Référence locale absente : ${path} → ${target}`);
    }
  }
  for (const path of seen) {
    const parts = path.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (seen.has(parts.join('/'))) throw Error(`Collision fichier/dossier : ${path}`);
    }
  }
  for (const [agent, dependencies] of agents)
    for (const skill of dependencies)
      if (!skills.has(skill)) throw Error(`Skill absent : ${agent} → ${skill}`);
  for (const workflow of workflows)
    for (const step of configurationSteps(workflow.steps)) {
      if (!agents.has(step.agentId)) throw Error(`Agent absent : ${workflow.id} → ${step.agentId}`);
      for (const skill of step.skills)
        if (!skills.has(skill)) throw Error(`Skill absent : ${workflow.id} → ${skill}`);
    }
  for (const path of paths) {
    const match = /^(.*\/skills\/[^/]+)\//.exec(path);
    if (match && !Object.hasOwn(files, `${match[1]}/SKILL.md`))
      throw Error(`Ressource sans SKILL.md : ${path}`);
  }
}

export function encodeWorkshopArchive(
  manifest: WorkshopManifest,
  files: WorkshopFiles,
  guide: string,
  inventory: string,
): Buffer {
  validateWorkshopFiles(files);
  const entries: Record<string, Uint8Array> = Object.create(null);
  entries['atelier.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  entries['LIRE-MOI.md'] = Buffer.from(guide);
  entries['INVENTAIRE.md'] = Buffer.from(inventory);
  entries['REVISION.md'] = Buffer.from(
    '# Compte rendu de révision\n\nDécrire ici les changements, leurs raisons et les vérifications proposées.\n',
  );
  for (const [path, content] of Object.entries(files)) entries[path] = bytesOf(content);
  return Buffer.from(zipSync(entries, { level: 6 }));
}
export function decodeWorkshopArchive(bytes: Buffer): {
  manifest: WorkshopManifest;
  files: WorkshopFiles;
  report: string;
} {
  if (bytes.length > WORKSHOP_LIMITS.zip) throw Error('L’archive dépasse 40 Mio.');
  let count = 0,
    total = 0,
    pending = 0;
  const seen = new Set<string>(),
    entries: Record<string, Buffer> = Object.create(null);
  const unzip = new Unzip((file) => {
    if (++count > WORKSHOP_LIMITS.files + 512) throw Error('Trop de fichiers dans l’archive.');
    safeName(file.name.replace(/\/$/, ''));
    const key = canonicalCaseless(file.name.normalize('NFC'));
    if (seen.has(key)) throw Error(`Chemin dupliqué dans le ZIP : ${file.name}`);
    seen.add(key);
    if (
      file.name.endsWith('/') ||
      file.name.startsWith('__MACOSX/') ||
      posix.basename(file.name) === '.DS_Store'
    )
      return;
    if ((file.originalSize ?? 0) > WORKSHOP_LIMITS.file)
      throw Error(`Fichier trop volumineux : ${file.name}`);
    const chunks: Buffer[] = [];
    let size = 0;
    pending++;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      total += data.length;
      if (size > WORKSHOP_LIMITS.file || total > WORKSHOP_LIMITS.total) {
        file.terminate();
        throw Error('Archive décompressée trop volumineuse.');
      }
      chunks.push(Buffer.from(data));
      if (final) {
        entries[file.name] = Buffer.concat(chunks);
        pending--;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 4096)
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  if (pending) throw Error('Archive ZIP incomplète.');
  if (!entries['atelier.json']) {
    const manifestPaths = Object.keys(entries).filter((path) => path.endsWith('/atelier.json'));
    if (manifestPaths.length === 1) {
      const prefix = manifestPaths[0].slice(0, -'atelier.json'.length);
      if (Object.keys(entries).every((path) => path.startsWith(prefix)))
        for (const path of Object.keys(entries)) {
          entries[path.slice(prefix.length)] = entries[path];
          delete entries[path];
        }
    }
  }
  if (!entries['atelier.json'])
    throw Error('Le ZIP doit contenir atelier.json et les dossiers de l’atelier.');
  const manifest = workshopManifestSchema.parse(
    JSON.parse(entries['atelier.json'].toString('utf8')),
  );
  const files: WorkshopFiles = Object.create(null);
  for (const [path, content] of Object.entries(entries)) {
    if (['atelier.json', 'LIRE-MOI.md', 'INVENTAIRE.md', 'REVISION.md'].includes(path)) continue;
    assertWorkshopPath(path);
    files[path] = content.toString('base64');
  }
  for (const path of manifest.deleted) assertWorkshopPath(path);
  validateWorkshopFiles(files);
  const report = entries['REVISION.md']?.toString('utf8') ?? '';
  if (report.length > 100000)
    throw Error('Le compte rendu REVISION.md dépasse 100 000 caractères.');
  return { manifest, files, report };
}
