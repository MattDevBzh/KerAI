import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export interface StartupMeasure {
  stage: string;
  atMs: number;
  durationMs?: number;
  project?: string;
  outcome?: 'ok' | 'error';
}
/** Local timing metadata only: no arguments, paths, output, prompts or file content. */
class StartupDiagnostics {
  private epoch = performance.now();
  private rows: StartupMeasure[] = [];
  private sink?: (row: StartupMeasure) => void;
  configure(sink: (row: StartupMeasure) => void) {
    this.sink = sink;
  }
  mark(stage: string, root?: string, durationMs?: number, outcome?: 'ok' | 'error') {
    const row: StartupMeasure = {
      stage,
      atMs: Math.round((performance.now() - this.epoch) * 100) / 100,
      ...(root ? { project: createHash('sha256').update(root).digest('hex').slice(0, 12) } : {}),
      ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs * 100) / 100 }),
      ...(outcome ? { outcome } : {}),
    };
    this.rows.push(row);
    if (this.rows.length > 2000) this.rows.shift();
    this.sink?.(row);
  }
  async measure<T>(stage: string, work: () => Promise<T>, root?: string): Promise<T> {
    const start = performance.now();
    try {
      const value = await work();
      this.mark(stage, root, performance.now() - start, 'ok');
      return value;
    } catch (error) {
      this.mark(stage, root, performance.now() - start, 'error');
      throw error;
    }
  }
  snapshot() {
    return structuredClone(this.rows);
  }
  async save(file: string) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ platform: process.platform, measures: this.rows }, null, 2),
      { mode: 0o600 },
    );
  }
}
export const startupDiagnostics = new StartupDiagnostics();
