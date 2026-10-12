import { open, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from './PolicyEngine';

/** One cockpit per workspace, including windows with different VS Code profiles. */
export class WorkspaceLease {
  private token = randomUUID();
  private acquired = false;
  readonly path: string;
  constructor(workspacePath: string) {
    this.path = join(tmpdir(), `feature-studio-${sha256(workspacePath).slice(0, 24)}.lock`);
  }
  async acquire(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(this.path, 'wx', 0o600);
        await file.writeFile(JSON.stringify({ token: this.token, pid: process.pid }));
        await file.close();
        this.acquired = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let owner: { pid: number; token: string };
        try {
          owner = JSON.parse(await readFile(this.path, 'utf8'));
        } catch {
          throw new Error(
            'Verrou Feature Studio illisible. Ferme les autres cockpits avant de réessayer.',
          );
        }
        let alive = true;
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
        }
        if (alive)
          throw new Error(
            'Feature Studio est déjà ouvert pour ce dossier dans une autre fenêtre. Ferme cet autre cockpit avant de continuer ici.',
          );
        await unlink(this.path).catch(() => undefined);
      }
    }
    throw new Error('Impossible d’acquérir le verrou du workspace.');
  }
  async release(): Promise<void> {
    if (!this.acquired) return;
    try {
      if (JSON.parse(await readFile(this.path, 'utf8')).token === this.token)
        await unlink(this.path);
    } catch {
      /* already released */
    }
    this.acquired = false;
  }
}
