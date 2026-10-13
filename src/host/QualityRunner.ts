import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { qualityCommandSchema, qualityReportSchema } from '../core/qualitySchemas';
import type { QualityCommandConfig, QualityEvidence, QualityAttachment } from '../shared/quality';
import type { TestEvidence } from '../shared/types';
import { redact } from './process';

const REPORT_LIMIT = 1024 * 1024;
const MEDIA_LIMIT = 16 * 1024 * 1024;
const TOTAL_LIMIT = 64 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface QualityRunContext {
  workspacePath: string;
  storagePath: string;
  featureId: string;
  attemptId: string;
  commandId: string;
  /** Immutable host snapshot of the feature criteria for this attempt. */
  criterionIds: readonly string[];
  config: QualityCommandConfig;
  nonce: string;
  startedAt: string;
  env: Record<string, string>;
}

/** Every path component must exist as a real directory or regular file. */
async function checkedPath(root: string, relative: string, createParents = false): Promise<string> {
  if (
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('Chemin de preuve invalide.');
  const canonicalRoot = await realpath(root);
  if ((await lstat(root)).isSymbolicLink())
    throw new Error('Racine de preuve symbolique interdite.');
  let current = canonicalRoot;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!stat && createParents && index < parts.length - 1) {
      await mkdir(current, { mode: 0o700 });
      stat = await lstat(current);
    }
    if (stat?.isSymbolicLink()) throw new Error('Lien symbolique interdit dans les preuves.');
    if (stat && index < parts.length - 1 && !stat.isDirectory())
      throw new Error('Dossier de preuve invalide.');
    if (stat && index === parts.length - 1 && !stat.isFile())
      throw new Error('Fichier de preuve invalide.');
  }
  return current;
}

async function readBounded(root: string, relative: string, limit: number): Promise<Buffer> {
  const target = await checkedPath(root, relative);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > limit)
      throw new Error('Preuve non régulière, liée ou trop volumineuse.');
    const bytes = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error('Preuve modifiée pendant sa collecte.');
    if ((await checkedPath(root, relative)) !== target)
      throw new Error('Chemin de preuve modifié.');
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function prepareQualityRun(
  input: Omit<QualityRunContext, 'nonce' | 'startedAt' | 'env'>,
): Promise<QualityRunContext> {
  const config = qualityCommandSchema.parse(input.config);
  const criterionIds = Object.freeze([...input.criterionIds]);
  await mkdir(input.storagePath, { recursive: true, mode: 0o700 });
  const report = await checkedPath(input.workspacePath, config.reportPath, true);
  const nonce = randomUUID();
  const startedAt = new Date().toISOString();
  return {
    ...input,
    config,
    criterionIds,
    nonce,
    startedAt,
    env: {
      FEATURE_STUDIO_QUALITY_REPORT: report,
      FEATURE_STUDIO_QUALITY_NONCE: nonce,
      FEATURE_STUDIO_QUALITY_FEATURE: input.featureId,
      FEATURE_STUDIO_QUALITY_ATTEMPT: input.attemptId,
      FEATURE_STUDIO_QUALITY_COMMAND: input.commandId,
      FEATURE_STUDIO_QUALITY_KIND: config.kind,
    },
  };
}

/** Called only after run_test produced authoritative process and file-hash evidence. */
export async function collectQualityEvidence(
  context: QualityRunContext,
  evidence: TestEvidence,
): Promise<QualityEvidence> {
  const base: QualityEvidence = {
    version: 1,
    kind: context.config.kind,
    featureId: context.featureId,
    attemptId: context.attemptId,
    commandId: context.commandId,
    evidenceId: evidence.id,
    collectedAt: new Date().toISOString(),
    status: 'invalid',
    reportPath: context.config.reportPath,
    cases: [],
    attachments: [],
  };
  try {
    if (
      evidence.source !== 'host' ||
      evidence.commandId !== context.commandId ||
      !evidence.finishedAt
    )
      throw new Error('Provenance de la commande absente.');
    const bytes = await readBounded(context.workspacePath, context.config.reportPath, REPORT_LIMIT);
    const report = qualityReportSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (
      report.nonce !== context.nonce ||
      report.featureId !== context.featureId ||
      report.attemptId !== context.attemptId ||
      report.commandId !== context.commandId ||
      report.kind !== context.config.kind
    )
      throw new Error('Rapport périmé ou lié à une autre tentative.');
    const start = Date.parse(report.startedAt),
      finish = Date.parse(report.finishedAt);
    if (
      start < Date.parse(context.startedAt) ||
      finish < start ||
      finish > Date.parse(evidence.finishedAt) + 1000
    )
      throw new Error('Dates du rapport hors de la tentative courante.');
    const unique = (ids: string[]) => new Set(ids).size === ids.length;
    if (
      !unique(report.cases.map((c) => c.id)) ||
      !unique(report.attachments.map((a) => a.id)) ||
      !unique(report.attachments.map((a) => a.path))
    )
      throw new Error('Identifiants ou chemins de preuve dupliqués.');
    const allowedCriteria = new Set(context.criterionIds);
    if (
      report.cases.some((testCase) => testCase.criterionIds.some((id) => !allowedCriteria.has(id)))
    )
      throw new Error('Le rapport référence un critère inconnu de cette tentative.');
    const ids = new Set(report.attachments.map((a) => a.id));
    if (report.cases.some((c) => c.attachmentIds.some((id) => !ids.has(id))))
      throw new Error('Pièce jointe absente.');
    const attachments: QualityAttachment[] = [];
    let total = 0;
    // Validate everything before publishing any metadata. The storage uses hashes only.
    for (const attachment of report.attachments) {
      const relative = path.posix.join(
        path.posix.dirname(context.config.reportPath),
        attachment.path,
      );
      const media = await readBounded(context.workspacePath, relative, MEDIA_LIMIT);
      total += media.length;
      if (total > TOTAL_LIMIT) throw new Error('Budget de pièces jointes dépassé (64 Mio).');
      const ext = path.extname(attachment.path);
      const png =
        ext === '.png' &&
        media.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpg = ext === '.jpg' && media[0] === 255 && media[1] === 216 && media[2] === 255;
      const zip = ext === '.zip' && media.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
      if (
        (attachment.kind === 'screenshot' && !png && !jpg) ||
        (attachment.kind === 'trace' && !zip)
      )
        throw new Error('Format de pièce jointe invalide.');
      const sha256 = digest(media);
      const stored = await checkedPath(context.storagePath, `${sha256}${ext}`);
      // Never overwrite a previously collected blob, including a replaced symlink.
      await writeFile(stored, media, { flag: 'wx', mode: 0o600 }).catch(
        async (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
          if (
            digest(await readBounded(context.storagePath, `${sha256}${ext}`, MEDIA_LIMIT)) !==
            sha256
          )
            throw new Error('Copie privée altérée.');
        },
      );
      attachments.push({
        id: attachment.id,
        name: redact(attachment.name),
        kind: attachment.kind,
        mime: zip ? 'application/zip' : png ? 'image/png' : 'image/jpeg',
        sizeBytes: media.length,
        sha256,
      });
    }
    const cases = report.cases.map((c) => ({
      ...c,
      title: redact(c.title),
      steps: c.steps.map(redact),
      errors: c.errors.map(redact),
      expected: c.expected && redact(c.expected),
      actual: c.actual && redact(c.actual),
      reproduction: c.reproduction?.map(redact),
    }));
    const status =
      evidence.exitCode !== 0 ||
      evidence.error ||
      cases.some((c) => c.status === 'failed' || c.errors.length > 0)
        ? 'failed'
        : !cases.length ||
            cases.some(
              (c) =>
                c.status === 'skipped' ||
                !c.criterionIds.length ||
                !c.steps.length ||
                (context.config.kind === 'visual' &&
                  !c.attachmentIds.some((id) =>
                    attachments.some((a) => a.id === id && a.kind === 'screenshot'),
                  )),
            )
          ? 'incomplete'
          : 'passed';
    return {
      ...base,
      runner: report.runner,
      status,
      cases,
      attachments,
      reportSha256: digest(bytes),
    };
  } catch (error) {
    return {
      ...base,
      status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unavailable' : 'invalid',
      error: redact(error instanceof Error ? error.message : String(error)).slice(0, 2000),
    };
  }
}

/** Host-only attachment resolver: call with persisted evidence, never client-supplied metadata. */
export async function resolveQualityAttachment(
  storagePath: string,
  quality: QualityEvidence,
  attachmentId: string,
): Promise<string> {
  const attachment = quality.attachments.find((a) => a.id === attachmentId);
  if (!attachment || !/^[a-f0-9]{64}$/.test(attachment.sha256)) throw new Error('Preuve inconnue.');
  const ext =
    attachment.mime === 'application/zip'
      ? '.zip'
      : attachment.mime === 'image/png'
        ? '.png'
        : '.jpg';
  const relative = `${attachment.sha256}${ext}`;
  const bytes = await readBounded(storagePath, relative, MEDIA_LIMIT);
  if (digest(bytes) !== attachment.sha256 || bytes.length !== attachment.sizeBytes)
    throw new Error('Preuve privée modifiée.');
  return checkedPath(storagePath, relative);
}

/** Explicit host action: install a self-contained reporter, preserving any customized file. */
export async function installQualityKit(
  workspacePath: string,
  bundledQualityPath: string,
): Promise<{ installed: string[]; unchanged: string[]; conflicts: string[] }> {
  const result = {
    installed: [] as string[],
    unchanged: [] as string[],
    conflicts: [] as string[],
  };
  for (const name of ['playwright-reporter.cjs', 'README.md']) {
    const source = await readBounded(bundledQualityPath, name, REPORT_LIMIT);
    const relative = `.feature-studio/quality-kit/${name}`;
    const target = await checkedPath(workspacePath, relative, true);
    try {
      await writeFile(target, source, { flag: 'wx', mode: 0o600 });
      result.installed.push(relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (digest(await readBounded(workspacePath, relative, REPORT_LIMIT)) === digest(source))
        result.unchanged.push(relative);
      else result.conflicts.push(relative);
    }
  }
  return result;
}
