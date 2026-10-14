import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionTrace, TraceArchiveInfo } from '../shared/observation';
import { traceSchema } from '../core/observationSchemas';
import { digest, privateFile, sessionDirectory, writePrivate } from './SessionFiles';
import { redact } from './process';

export class SessionArchive {
  readonly info: TraceArchiveInfo = { bytes: 0, records: 0, complete: true };
  private queue = Promise.resolve();
  private error?: Error;
  private pendingBytes = 0;
  private tail?: { offset: number; bytes: Buffer; size: number };
  private separatorAt?: number;
  private markRecovered(): void {
    this.info.complete = false;
    this.info.reason =
      'Fin de journal interrompue : les événements intacts sont disponibles. Le fragment incomplet est conservé séparément avant la reprise ; la couverture reste partielle.';
  }
  private constructor(
    readonly root: string,
    readonly featureId: string,
    readonly limit: number,
  ) {}
  static async create(root: string, featureId: string, limit: number): Promise<SessionArchive> {
    const archive = new SessionArchive(root, featureId, limit);
    const recoveryDirectory = dirname(
      await privateFile(root, `${sessionDirectory(featureId)}/trace-recovery/placeholder`),
    );
    const recovered = await readdir(recoveryDirectory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (recovered.some((name) => /^[a-f0-9]{64}\.json$/.test(name))) archive.markRecovered();
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
          constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          if ((await handle.stat()).nlink !== 1) throw new Error('Journal lié refusé.');
          if (this.tail) {
            // Save the exact bytes before truncation. A crash at either point is recoverable.
            const tail = this.tail;
            if ((await handle.stat()).size !== tail.size)
              throw new Error('Journal modifié pendant sa récupération.');
            const saved = Buffer.alloc(tail.bytes.length);
            const read = await handle.read(saved, 0, saved.length, tail.offset);
            if (read.bytesRead !== saved.length || !saved.equals(tail.bytes))
              throw new Error('Fin de journal modifiée pendant sa récupération.');
            await writePrivate(
              this.root,
              `${sessionDirectory(this.featureId)}/trace-recovery/${digest(`${tail.offset}:${tail.bytes.toString('base64')}`)}.json`,
              JSON.stringify({
                offset: tail.offset,
                originalSize: tail.size,
                dataBase64: tail.bytes.toString('base64'),
              }),
            );
            if ((await handle.stat()).size !== tail.size)
              throw new Error('Journal modifié pendant sa récupération.');
            await handle.truncate(tail.offset);
            await handle.sync();
            this.tail = undefined;
          }
          if (this.separatorAt !== undefined) {
            if ((await handle.stat()).size !== this.separatorAt)
              throw new Error('Journal modifié avant sa reprise.');
            await handle.writeFile('\n');
            this.separatorAt = undefined;
          }
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
      let pending = Buffer.alloc(0),
        position = 0,
        lineOffset = 0;
      const buffer = Buffer.alloc(65536);
      const parse = (bytes: Buffer) => {
        const text = bytes.toString('utf8');
        if (text.length > 250000 || !Buffer.from(text).equals(bytes))
          throw new Error('Événement archivé trop volumineux ou non UTF-8.');
        return traceSchema.parse(JSON.parse(text));
      };
      while (position < stat.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, stat.size - position),
          position,
        );
        if (!bytesRead) throw new Error('Journal modifié pendant la lecture.');
        position += bytesRead;
        pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
        let start = 0,
          newline: number;
        while ((newline = pending.indexOf(10, start)) !== -1) {
          try {
            yield parse(pending.subarray(start, newline));
          } catch {
            throw new Error('Journal incomplet ou altéré ; couverture complète impossible.');
          }
          lineOffset += newline + 1 - start;
          start = newline + 1;
        }
        pending = Buffer.from(pending.subarray(start));
        if (pending.length > 1000000) throw new Error('Événement archivé trop volumineux.');
      }
      if (pending.length) {
        // Only an unterminated JSON tail is recoverable. Corruption in committed lines fails closed.
        try {
          JSON.parse(pending.toString('utf8'));
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          this.tail = { offset: lineOffset, bytes: pending, size: stat.size };
          this.markRecovered();
          return;
        }
        const trace = parse(pending);
        this.separatorAt = stat.size;
        yield trace;
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
