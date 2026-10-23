import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PolicyEngine, sha256 } from './PolicyEngine';
import { WorkspaceExplorer } from './WorkspaceExplorer';
import { readTextFile } from './textFiles';
import { sourceMapCandidatePath } from './navigation/ChromiumInspection';
import type { ApplicationProfile, BrowserInspection, CodeAnchor } from '../shared/navigation';

type Project = { id: string; path: string };
export interface AnchorVerificationOptions {
  applicationId?: string;
  queries?: string[];
  limit?: number;
  signal?: AbortSignal;
}
const MAX_ANCHOR_READS = 64;
const MAX_ANCHOR_BYTES = 16 * 1024 * 1024;
const anchorSchema = z
  .object({
    id: z.string().max(200),
    applicationId: z.string().max(128),
    projectId: z.string().max(128),
    relativePath: z.string().max(1000),
    line: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    query: z.string().max(200),
    reason: z.string().max(4000),
    state: z.enum(['candidate', 'corroborated', 'stale']),
    observedAt: z.string(),
    source: z
      .object({
        kind: z.enum(['source-map', 'stylesheet']),
        url: z.string().max(1000),
        bundleUrl: z.string().max(1000).optional(),
        bundleHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/i)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
type StoredAnchor = z.infer<typeof anchorSchema>;
const mapSchema = z
  .object({
    bundleUrl: z.string().max(1000),
    bundleHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    sourceMapUrl: z.string().max(1000),
    sources: z.array(z.string().max(1000)).max(40),
    file: z.string().max(1000).optional(),
    state: z.literal('candidate'),
    reason: z.string().max(1000),
  })
  .strict();
const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
function observedUrl(raw: string, origins: string[]): URL | undefined {
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) &&
      origins.includes(url.origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/** A rebuildable, private projection. A matching path/hash never proves the served build. */
export class CodeAnchorIndex {
  private anchors: StoredAnchor[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  async load() {
    try {
      this.anchors = z
        .array(anchorSchema)
        .max(5000)
        .parse(JSON.parse(await readFile(join(this.directory, 'anchors.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  snapshot() {
    return structuredClone(this.anchors);
  }
  private update(change: (current: StoredAnchor[]) => StoredAnchor[]): Promise<void> {
    const work = this.queue
      .catch(() => undefined)
      .then(async () => {
        const next = z.array(anchorSchema).max(5000).parse(change(this.anchors).slice(-5000));
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = join(this.directory, `anchors-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
          await rename(temporary, join(this.directory, 'anchors.json'));
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
        this.anchors = next;
      });
    this.queue = work;
    return work;
  }
  private save(found: StoredAnchor[]) {
    return this.update((current) => [
      ...current.filter((anchor) => !found.some((other) => anchor.id === other.id)),
      ...found,
    ]);
  }
  async search(
    applicationId: string,
    project: Project,
    query: string,
    directory = '.',
    signal = new AbortController().signal,
  ) {
    z.string().trim().min(2).max(200).parse(query);
    const policy = new PolicyEngine(project.path, 'read-only', []);
    await policy.initialize();
    const explorer = new WorkspaceExplorer(project.path, policy, signal);
    const result = await explorer.search({ query, path: directory, startLine: 1 });
    const found: StoredAnchor[] = [];
    for (const match of result.matches.slice(0, 12)) {
      signal.throwIfAborted();
      const file = await policy.resolve(match.path);
      const content = await readTextFile(file, signal);
      found.push({
        id: createHash('sha256')
          .update(`${applicationId}:${project.id}:${match.path}:${match.line}:${query}`)
          .digest('hex'),
        applicationId,
        projectId: project.id,
        relativePath: match.path,
        line: match.line,
        hash: sha256(content.bytes),
        query,
        reason: `Correspondance littérale observée : ${match.text}`.slice(0, 4000),
        state: 'candidate',
        observedAt: new Date().toISOString(),
      });
    }
    await this.save(found);
    return {
      anchors: found,
      truncated: result.truncated || result.matches.length > found.length,
      scannedFiles: result.scannedFiles,
      scannedBytes: result.scannedBytes,
      reason: 'Pistes candidates ; vérifier les dépendances et le lien avec le build servi.',
    };
  }
  /** Resolve only explicit browser hints; no recursive repository sweep or sourceContents trust. */
  async observe(
    application: ApplicationProfile,
    observation: BrowserInspection,
    projects: Project[],
    signal = new AbortController().signal,
  ) {
    const allowed = [...new Set([application.origin, ...application.allowedOrigins])];
    if (!observedUrl(observation.url, allowed))
      return {
        anchors: [] as StoredAnchor[],
        checked: 0,
        scannedBytes: 0,
        omitted: 1,
        truncated: true,
        reason: 'Observation hors origine autorisée.',
      };
    const bundles = new Map<string, { hash?: string; map: string }>();
    const candidates: {
      relativePath: string;
      line: number;
      query: string;
      reason: string;
      source: NonNullable<StoredAnchor['source']>;
    }[] = [];
    let omitted = 0;
    for (const raw of (observation.sourceMaps ?? []).slice(0, 4)) {
      const parsed = mapSchema.safeParse(raw);
      if (!parsed.success) {
        omitted++;
        continue;
      }
      const map = parsed.data;
      const bundle = observedUrl(map.bundleUrl, allowed),
        sourceMap = observedUrl(map.sourceMapUrl, allowed);
      if (
        !bundle ||
        !sourceMap ||
        (map.file && map.file.split('/').at(-1) !== bundle.pathname.split('/').at(-1))
      ) {
        omitted++;
        continue;
      }
      bundles.set(bundle.href, { hash: map.bundleHash, map: sourceMap.href });
      for (const source of map.sources) {
        const relativePath = sourceMapCandidatePath(source);
        if (!relativePath) {
          omitted++;
          continue;
        }
        candidates.push({
          relativePath,
          line: 1,
          query: relativePath.slice(0, 200),
          source: {
            kind: 'source-map',
            url: sourceMap.href,
            bundleUrl: bundle.href,
            bundleHash: map.bundleHash,
          },
          reason: `Source map observée : ${sourceMap.href}. Bundle ${bundle.href}${map.bundleHash ? ` ; empreinte Chromium ${map.bundleHash}` : ''}. Chemin candidat résolu et fichier local hashé ; correspondance de build non attestée.`,
        });
      }
    }
    for (const resource of observation.resources.slice(0, 24)) {
      const url = observedUrl(resource, allowed);
      if (!url || !/\.css$/i.test(url.pathname)) continue;
      let relativePath: string | undefined;
      try {
        relativePath = sourceMapCandidatePath(decodeURIComponent(url.pathname.replace(/^\//, '')));
      } catch {
        omitted++;
        continue;
      }
      if (!relativePath) {
        omitted++;
        continue;
      }
      const escaped = resource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`${escaped}:(\\d+)`).exec(observation.text);
      const line = match ? Math.min(1000000, Math.max(1, Number(match[1]))) : 1;
      candidates.push({
        relativePath,
        line,
        query: relativePath.slice(0, 200),
        source: { kind: 'stylesheet', url: url.href },
        reason: `Feuille CSS observée : ${url.href}${match ? `, ligne ${line}` : ''}. Chemin candidat résolu dans le dépôt ; correspondance du build servi non attestée.`,
      });
    }
    const scoped = projects.filter((project) => application.projectIds.includes(project.id));
    const policies = new Map<string, PolicyEngine>();
    const found: StoredAnchor[] = [];
    const seen = new Set<string>();
    let checked = 0,
      bytes = 0;
    outer: for (const candidate of candidates)
      for (const project of scoped) {
        signal.throwIfAborted();
        const key = `${project.id}:${candidate.relativePath}:${candidate.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (checked >= MAX_ANCHOR_READS || bytes >= MAX_ANCHOR_BYTES) {
          omitted++;
          break outer;
        }
        checked++;
        try {
          let policy = policies.get(project.id);
          if (!policy) {
            policy = new PolicyEngine(project.path, 'read-only', []);
            await policy.initialize();
            policies.set(project.id, policy);
          }
          const file = await policy.resolve(candidate.relativePath);
          const stat = await lstat(file);
          if (!stat.isFile() || stat.size > Math.min(4 * 1024 * 1024, MAX_ANCHOR_BYTES - bytes)) {
            omitted++;
            continue;
          }
          const content = await readTextFile(file, signal);
          bytes += content.bytes.length;
          if (candidate.line > content.text.split('\n').length) {
            omitted++;
            continue;
          }
          found.push({
            id: sha256(`${application.id}:${key}:${candidate.reason}`),
            applicationId: application.id,
            projectId: project.id,
            relativePath: candidate.relativePath,
            line: candidate.line,
            query: candidate.query,
            hash: sha256(content.bytes),
            reason: candidate.reason.slice(0, 4000),
            source: candidate.source,
            state: 'candidate',
            observedAt: new Date().toISOString(),
          });
        } catch {
          signal.throwIfAborted();
          omitted++;
        }
      }
    if (found.length || bundles.size)
      await this.update((current) => [
        ...current
          .filter((anchor) => !found.some((next) => next.id === anchor.id))
          .map((anchor) => {
            const currentBundle = anchor.source?.bundleUrl && bundles.get(anchor.source.bundleUrl);
            return anchor.applicationId === application.id &&
              currentBundle &&
              (anchor.source!.url !== currentBundle.map ||
                (anchor.source!.bundleHash &&
                  currentBundle.hash &&
                  anchor.source!.bundleHash !== currentBundle.hash))
              ? { ...anchor, state: 'stale' as const }
              : anchor;
          }),
        ...found,
      ]);
    return {
      anchors: structuredClone(found),
      checked,
      scannedBytes: bytes,
      omitted,
      truncated: omitted > 0 || candidates.length * scoped.length > checked,
      reason:
        'Candidats locaux uniquement ; aucune source map ne certifie la version servie ou le diagnostic.',
    };
  }
  /** No selected application means no filesystem reads. At most 64 candidates / 16 MiB. */
  async verify(projects: Project[], options: AnchorVerificationOptions = {}) {
    if (!options.applicationId) return this.snapshot();
    const signal = options.signal ?? new AbortController().signal;
    const limit = Number.isFinite(options.limit)
      ? Math.max(0, Math.min(MAX_ANCHOR_READS, Math.floor(options.limit!)))
      : MAX_ANCHOR_READS;
    const terms = (options.queries ?? [])
      .flatMap((query) => normalized(query).split(/[^a-z0-9]+/))
      .filter((term) => term.length > 1)
      .slice(0, 30);
    const score = (anchor: CodeAnchor) =>
      terms.reduce(
        (total, term) =>
          total + (normalized(`${anchor.relativePath} ${anchor.query}`).includes(term) ? 1 : 0),
        0,
      );
    const selected = this.anchors
      .filter(
        (anchor) =>
          anchor.applicationId === options.applicationId &&
          projects.some((project) => project.id === anchor.projectId),
      )
      .sort(
        (a, b) =>
          score(b) - score(a) ||
          b.observedAt.localeCompare(a.observedAt) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, limit);
    const policies = new Map<string, PolicyEngine>();
    const stale = new Map<string, string>();
    let bytes = 0;
    for (const anchor of selected) {
      signal.throwIfAborted();
      const project = projects.find((item) => item.id === anchor.projectId)!;
      try {
        let policy = policies.get(project.id);
        if (!policy) {
          policy = new PolicyEngine(project.path, 'read-only', []);
          await policy.initialize();
          policies.set(project.id, policy);
        }
        const file = await policy.resolve(anchor.relativePath);
        const stat = await lstat(file);
        if (stat.size > MAX_ANCHOR_BYTES - bytes) break;
        const content = await readTextFile(file, signal);
        bytes += content.bytes.length;
        if (sha256(content.bytes) !== anchor.hash) stale.set(anchor.id, anchor.hash);
      } catch {
        signal.throwIfAborted();
        stale.set(anchor.id, anchor.hash);
      }
    }
    if (stale.size)
      await this.update((current) =>
        current.map((anchor) =>
          stale.get(anchor.id) === anchor.hash ? { ...anchor, state: 'stale' } : anchor,
        ),
      );
    return this.snapshot();
  }
  async resolve(project: Project, relativePath: string) {
    const policy = new PolicyEngine(project.path, 'read-only', []);
    await policy.initialize();
    return policy.resolve(relativePath);
  }
}
