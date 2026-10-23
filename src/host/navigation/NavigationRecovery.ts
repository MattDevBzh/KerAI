import { mkdir, open, readFile, rename, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { navigationRunSchema, navigationStepSchema } from '../../core/navigationSchemas';
import type { BrowserSessionState, NavigationRun } from '../../shared/navigation';
const schema = z
  .object({
    version: z.literal(1),
    state: z
      .object({
        id: z.string().max(128),
        applicationId: z.string().max(128),
        state: z.enum(['idle', 'agent', 'recording', 'human', 'stopping', 'interrupted', 'closed']),
        generation: z.number().int().nonnegative(),
        url: z.string().max(1500).optional(),
        actor: z.string().max(200).optional(),
        recordedSteps: z.array(navigationStepSchema).max(80),
        recordingPaused: z.boolean(),
        recordingActive: z.boolean().optional(),
        warnings: z.array(z.string().max(1000)).max(100),
      })
      .strict()
      .optional(),
    runs: z.array(navigationRunSchema).max(64),
  })
  .strict();
export type BrowserRecovery = { version: 1; state?: BrowserSessionState; runs: NavigationRun[] };
/** Atomic private journal; no credentials, screenshots, model calls or browser startup. */
export class NavigationRecovery {
  private readonly file: string;
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {
    this.file = path.join(directory, 'browser-recovery.json');
  }
  async read(): Promise<BrowserRecovery | undefined> {
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || info.size > 16 * 1024 * 1024)
        throw new Error('Journal navigateur non conforme ; original conservé.');
      return schema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  write(value: BrowserRecovery): Promise<void> {
    const content = JSON.stringify(value);
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        if (!(await lstat(this.directory)).isDirectory())
          throw new Error('Répertoire du journal non conforme.');
        const temporary = path.join(this.directory, `browser-recovery-${randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(content);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, this.file);
      });
    this.tail = task;
    return task;
  }
  async flush() {
    await this.tail;
  }
}
