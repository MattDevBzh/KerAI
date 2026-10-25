import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { NativeActivity } from '../shared/native';
import type { RunInput, TestEvidence } from '../shared/types';
import { gitRead } from './gitRead';
import { runProcess } from './process';

/** Only an exact, unambiguous command configured by the human can attest a test. */
export function nativeTestCommand(command: {
  command: string;
  args: string[];
}): string | undefined {
  const words = [command.command, ...command.args];
  return words.every((word) => /^[A-Za-z0-9_./:@%+=,-]+$/.test(word)) ? words.join(' ') : undefined;
}

export async function nativeTestSnapshot(
  workspacePath: string,
  projects?: { id: string; path: string }[],
): Promise<{ digest: string; files: Record<string, string> }> {
  const roots = projects?.length ? projects : [{ id: '', path: workspacePath }];
  const files: Record<string, string> = {};
  const heads: string[] = [];
  let bytes = 0,
    count = 0;
  for (const project of roots) {
    const canonicalRoot = await realpath(project.path);
    const listing = await gitRead(
      project.path,
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { rawOutput: true, maxBytes: 1_000_000 },
    );
    const head = await gitRead(project.path, ['rev-parse', '--verify', 'HEAD'], {
      rawOutput: true,
    });
    if (listing.code || listing.truncated || head.truncated)
      throw new Error('Inventaire des fichiers de tests incomplet.');
    heads.push(`${project.id}:${head.code ? 'unborn' : head.stdout.trim()}`);
    for (const file of [...new Set(listing.stdout.split('\0').filter(Boolean))].sort()) {
      const target = resolve(project.path, file),
        rel = relative(project.path, target);
      if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Chemin de test hors projet.');
      const key = roots.length > 1 ? `@${project.id}/${file}` : file;
      if (++count > 5000)
        throw new Error(
          'Preuve native limitée à 5 000 fichiers. Utilise une commande de tests hôte.',
        );
      try {
        const stat = await lstat(target);
        if (!stat.isFile() || stat.size > 8_000_000 || bytes + stat.size > 64_000_000)
          throw new Error('Inventaire natif incomplet : fichier spécial ou volume trop important.');
        const canonicalFile = await realpath(target);
        const actualRelative = relative(canonicalRoot, canonicalFile);
        if (isAbsolute(actualRelative) || actualRelative.startsWith('..'))
          throw new Error('Fichier de test hors projet.');
        bytes += stat.size;
        files[key] = createHash('sha256')
          .update(await readFile(target))
          .digest('hex');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        files[key] = '<missing>';
      }
    }
  }
  return {
    files,
    digest: createHash('sha256').update(JSON.stringify({ heads, files })).digest('hex'),
  };
}

type Receipt = {
  command: RunInput['settings']['testCommands'][number];
  text: string;
  before?: Awaited<ReturnType<typeof nativeTestSnapshot>>;
  activity?: NativeActivity;
  conflict?: boolean;
  error?: string;
};

/** Awaited pre-tool snapshots plus runtime events; missing exit metadata requires a host recheck. */
export class NativeTestEvidence {
  private receipts: Receipt[] = [];
  private activities = new Map<string, NativeActivity>();
  constructor(
    private input: RunInput,
    private options: {
      recheckMissingExit?: boolean;
      signal?: AbortSignal;
      onRecheck?: (name: string) => void;
    } = {},
  ) {}
  async before(tool: string, raw: unknown): Promise<void> {
    for (const receipt of this.receipts)
      if (!receipt.activity || receipt.activity.status === 'running') receipt.conflict = true;
    if (!['bash', 'powershell'].includes(tool) || this.input.step.policy !== 'tests') return;
    let decoded = raw;
    if (typeof raw === 'string') {
      if (raw.length > 32000) return;
      try {
        decoded = JSON.parse(raw);
      } catch {
        return;
      }
    }
    const args = decoded as Record<string, unknown> | undefined;
    if (!args || typeof args.command !== 'string' || (args.mode && args.mode !== 'sync')) return;
    if (
      Object.keys(args).some(
        (key) => !['command', 'description', 'mode', 'timeout', 'initial_wait'].includes(key),
      )
    )
      return;
    const command = this.input.settings.testCommands.find(
      (item) => !item.quality && nativeTestCommand(item) === args.command,
    );
    if (!command) return;
    const receipt: Receipt = { command, text: args.command };
    const earlier = [...this.activities.values()].find(
      (activity) =>
        activity.status === 'running' &&
        activity.command === receipt.text &&
        activity.directory === this.input.workspacePath &&
        !this.receipts.some((other) => other.activity?.id === activity.id),
    );
    if (earlier) receipt.activity = structuredClone(earlier);
    receipt.conflict =
      this.receipts.some((other) => !other.activity || other.activity.status === 'running') ||
      [...this.activities.values()].some(
        (activity) => activity.status === 'running' && activity.id !== earlier?.id,
      );
    this.receipts.push(receipt);
    try {
      receipt.before = await nativeTestSnapshot(this.input.workspacePath, this.input.projects);
    } catch (error) {
      receipt.error = (error as Error).message;
    }
  }
  receive(activity: NativeActivity): void {
    this.activities.set(activity.id, structuredClone(activity));
    const existing = this.receipts.find((item) => item.activity?.id === activity.id);
    if (existing) {
      existing.activity = structuredClone(activity);
      return;
    }
    if (
      activity.status !== 'running' ||
      !['bash', 'powershell'].includes(activity.tool) ||
      activity.directory !== this.input.workspacePath
    )
      return;
    const receipt = this.receipts.find((item) => !item.activity && item.text === activity.command);
    if (receipt) receipt.activity = structuredClone(activity);
  }
  async finish(): Promise<TestEvidence[]> {
    if (!this.receipts.length) return [];
    let after: Awaited<ReturnType<typeof nativeTestSnapshot>> | undefined;
    try {
      after = await nativeTestSnapshot(this.input.workspacePath, this.input.projects);
    } catch {
      /* fail closed below */
    }
    const results: TestEvidence[] = [];
    for (const receipt of this.receipts) {
      const activity = receipt.activity;
      if (!activity) continue;
      let verification: 'runtime' | 'host-recheck' = 'runtime';
      let recheckError: string | undefined;
      if (
        this.options.recheckMissingExit &&
        activity.exitCode === undefined &&
        activity.status === 'completed' &&
        !receipt.error &&
        !receipt.conflict &&
        receipt.before &&
        after?.digest === receipt.before.digest
      ) {
        verification = 'host-recheck';
        this.options.onRecheck?.(receipt.command.name);
        try {
          const result = await runProcess(
            receipt.command.command,
            receipt.command.args,
            this.input.workspacePath,
            { signal: this.options.signal, timeoutMs: 300000 },
          );
          activity.exitCode = result.code;
          activity.output = result.stdout + (result.stderr ? '\n' + result.stderr : '');
          activity.truncated = result.truncated || activity.output.length > 32000;
          activity.output = activity.output.slice(0, 32000);
          activity.finishedAt = new Date().toISOString();
          after = await nativeTestSnapshot(this.input.workspacePath, this.input.projects);
        } catch (error) {
          recheckError = (error as Error).message;
        }
      }
      const error =
        recheckError ||
        receipt.error ||
        (receipt.conflict
          ? 'Des outils concurrents empêchent d’attester cette exécution.'
          : undefined) ||
        (!receipt.before || !after || receipt.before.digest !== after.digest
          ? 'Les fichiers ont changé depuis le début des tests ou leur inventaire est incomplet.'
          : undefined) ||
        (!['completed', 'failed'].includes(activity.status) || activity.exitCode === undefined
          ? 'Le terminal natif ne fournit pas de résultat complet.'
          : undefined);
      results.push({
        id: randomUUID(),
        source: 'host' as const,
        native: {
          activityId: activity.id,
          sessionId: activity.sessionId,
          snapshot: receipt.before?.digest ?? '0'.repeat(64),
          verification,
        },
        commandId: receipt.command.id,
        name: (
          receipt.command.name + (verification === 'host-recheck' ? ' (revérifié par KerAI)' : '')
        ).slice(0, 200),
        command: receipt.command.command,
        args: [...receipt.command.args],
        startedAt: activity.startedAt,
        finishedAt: activity.finishedAt ?? new Date().toISOString(),
        exitCode: activity.exitCode ?? null,
        stdout: activity.output ?? '',
        stderr: '',
        truncated: Boolean(activity.truncated),
        fileHashes: receipt.before?.files ?? {},
        ...(error ? { error } : {}),
      });
    }
    return results;
  }
}
