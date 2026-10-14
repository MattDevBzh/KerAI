import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { SessionTrace, TraceArchiveInfo } from '../shared/observation';
import { traceSchema } from '../core/observationSchemas';
import { privateFile, sessionDirectory } from './SessionFiles';
import { redact } from './process';

export class SessionArchive {
  readonly info: TraceArchiveInfo = { bytes: 0, records: 0, complete: true };
  private queue = Promise.resolve();
  private error?: Error;
  private pendingBytes = 0;
  private constructor(
    readonly root: string,
    readonly featureId: string,
    readonly limit: number,
  ) {}
  static async create(root: string, featureId: string, limit: number): Promise<SessionArchive> {
    const archive = new SessionArchive(root, featureId, limit);
    for await (const trace of archive.read()) {
      archive.info.records++;
      archive.info.bytes += Buffer.byteLength(JSON.stringify(trace) + '\n');
    }
    return archive;
  }
  append(trace: SessionTrace): void {
    if (this.error) throw this.error;
    const safe = { ...trace, data: redact(trace.data) };
    // Split payloads without dropping content. Parts retain an exact, stable source identity.
    const records: SessionTrace[] = [];
    for (let offset = 0; offset < safe.data.length || offset === 0; offset += 24000)
      records.push({
        ...safe,
        id: offset === 0 && safe.data.length <= 24000 ? safe.id : `${safe.id}:part:${offset}`,
        data: safe.data.slice(offset, offset + 24000),
      });
    const text = records.map((record) => JSON.stringify(record) + '\n').join('');
    const bytes = Buffer.byteLength(text);
    if (this.info.bytes + bytes > this.limit || this.pendingBytes + bytes > 16 * 1024 * 1024) {
      this.info.complete = false;
      this.info.reason =
        this.info.bytes + bytes > this.limit
          ? 'Limite des traces atteinte. Augmentez-la dans les réglages avant de reprendre.'
          : 'Écriture des traces trop lente ; exécution arrêtée pour préserver le stockage.';
      this.error = new Error(this.info.reason);
      throw this.error;
    }
    this.info.bytes += bytes;
    this.info.records += records.length;
    this.pendingBytes += bytes;
    this.queue = this.queue
      .then(async () => {
        const file = await privateFile(
          this.root,
          `${sessionDirectory(this.featureId)}/traces.jsonl`,
          true,
        );
        const handle = await open(
          file,
          constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          if ((await handle.stat()).nlink !== 1) throw new Error('Journal lié refusé.');
          await handle.writeFile(text);
          await handle.sync();
        } finally {
          await handle.close();
          this.pendingBytes -= bytes;
        }
      })
      .catch((error) => {
        this.info.complete = false;
        this.info.reason = `Écriture des traces impossible : ${(error as Error).message}`;
        this.error = new Error(this.info.reason);
        throw this.error;
      });
    void this.queue.catch(() => undefined);
  }
  async flush(): Promise<void> {
    await this.queue;
  }
  async *read(): AsyncGenerator<SessionTrace> {
    const file = await privateFile(this.root, `${sessionDirectory(this.featureId)}/traces.jsonl`);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      },
    );
    if (!handle) return;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4 * 1024 ** 3)
        throw new Error('Journal invalide.');
      const stream = handle.createReadStream({ autoClose: false });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (line.length > 250000) throw new Error('Événement archivé trop volumineux.');
          try {
            yield traceSchema.parse(JSON.parse(line));
          } catch {
            throw new Error('Journal incomplet ou altéré ; couverture complète impossible.');
          }
        }
      } finally {
        lines.close();
        stream.destroy();
      }
    } finally {
      await handle.close();
    }
  }
  async page(
    attemptId: string,
    offset = 0,
  ): Promise<{ traces: SessionTrace[]; nextOffset?: number }> {
    const traces: SessionTrace[] = [];
    let index = 0;
    let bytes = 0;
    for await (const trace of this.read()) {
      if (trace.attemptId !== attemptId) continue;
      if (index++ < offset) continue;
      if (traces.length >= 100 || bytes + trace.data.length > 100000)
        return { traces, nextOffset: index - 1 };
      traces.push(trace);
      bytes += trace.data.length;
    }
    return { traces };
  }
}
