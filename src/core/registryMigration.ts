import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, unlink, rmdir, chmod } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { AgentRegistry, files, safePath, userKitMarkdown } from './registry';

interface MigrationFile {
  source: string;
  target: string;
  original: Buffer;
  content: Buffer;
  previous?: Buffer;
  mode: number;
}
export interface MigrationEntry {
  id: string;
  label: string;
  source: string;
  files: MigrationFile[];
  conflict?: string;
}
export interface MigrationReport {
  migrated: string[];
  conflicts: string[];
  backupDirectory?: string;
}

async function existing(root: string, path: string): Promise<Buffer | undefined> {
  const target = await safePath(root, path);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.nlink > 1) throw new Error('Fichier non régulier ou lien physique.');
    if (info.size > 8 * 1024 * 1024)
      throw new Error('Fichier de plus de 8 Mio : migration manuelle requise.');
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
const equal = (a?: Buffer, b?: Buffer) =>
  a === undefined ? b === undefined : b !== undefined && a.equals(b);

/** No writes while planning. Only explicitly selected groups may be migrated. */
export class RegistryMigration {
  constructor(private readonly registry: AgentRegistry) {}

  async plan(): Promise<MigrationEntry[]> {
    const entries: MigrationEntry[] = [];
    const loaded = await this.registry.load();
    const agents = await files(this.registry.workspacePath, '.github/agents');
    const skills = await files(this.registry.workspacePath, '.github/skills');
    for (const source of agents.filter((path) => path.endsWith('.agent.md'))) {
      const id = basename(source, '.agent.md');
      entries.push({ id: `agent:${id}`, label: `Agent : ${id}`, source, files: [] });
    }
    for (const source of skills.filter((path) => basename(path) === 'SKILL.md')) {
      const id = basename(dirname(source));
      entries.push({
        id: `skill:${id}`,
        label: `Skill : ${id}`,
        source: dirname(source),
        files: [],
      });
    }
    for (const entry of entries) {
      try {
        const id = entry.id.slice(entry.id.indexOf(':') + 1);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('Identifiant invalide.');
        const isAgent = entry.id.startsWith('agent:');
        if (!isAgent && entry.source.replaceAll('\\', '/') !== `.github/skills/${id}`)
          throw new Error('Skill imbriquée : migration manuelle requise.');
        const profile = (isAgent ? loaded.agents : loaded.skills).find(
          (item) => item.id === id && item.source === 'workspace',
        );
        if (!profile)
          throw new Error('Profil invalide : corriger ses métadonnées avant la migration.');
        if (entries.filter((item) => item.id === entry.id).length > 1)
          throw new Error('Plusieurs profils portent le même identifiant.');
        const sources = entry.id.startsWith('agent:')
          ? [entry.source]
          : await files(this.registry.workspacePath, entry.source);
        if (sources.length > 512) throw new Error('Plus de 512 fichiers dans cette skill.');
        let size = 0;
        for (const source of sources) {
          const suffix = source
            .slice(entry.source.length)
            .replace(/^[\\/]/, '')
            .replaceAll('\\', '/');
          const target = entry.id.startsWith('agent:')
            ? `agents/${id}.agent.md`
            : `skills/${id}/${suffix}`;
          const original = await existing(this.registry.workspacePath, source);
          if (!original) throw new Error('Le fichier source a disparu.');
          size += original.length;
          if (size > 32 * 1024 * 1024) throw new Error('Ce profil dépasse 32 Mio.');
          let content = original;
          if (source.endsWith('.md')) {
            const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
              original,
            );
            content = Buffer.from(userKitMarkdown(text, target));
          }
          const previous = await existing(this.registry.userPath, target);
          if (previous && !previous.equals(content) && !(await this.isDefault(target, previous)))
            throw new Error(
              `Version utilisateur différente : ${target}. Les deux versions sont conservées ; résoudre le conflit manuellement.`,
            );
          const mode =
            (await lstat(await safePath(this.registry.workspacePath, source))).mode & 0o777;
          entry.files.push({ source, target, original, content, previous, mode });
        }
        // Copy a skill's auxiliary files as a unit; refuse links that would become dangling.
        for (const file of entry.files.filter((item) => item.source.endsWith('.md'))) {
          for (const match of file.content
            .toString('utf8')
            .matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
            const href = match[1].replace(/^<|>$/g, '');
            if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) continue;
            const destination = posix.normalize(
              posix.join(posix.dirname(file.target), decodeURIComponent(href.split('#')[0])),
            );
            if (
              !entry.files.some((candidate) => candidate.target === destination) &&
              !(await existing(this.registry.userPath, destination))
            )
              throw new Error(
                `Lien relatif à adapter avant migration : ${href}. Le profil reste dans le projet.`,
              );
          }
        }
      } catch (error) {
        entry.conflict = (error as Error).message;
      }
    }
    return entries;
  }

  private async isDefault(target: string, content: Buffer): Promise<boolean> {
    const sources = target.startsWith('agents/')
      ? [target, `kit/.github/${target}`]
      : [`kit/.github/${target}`];
    for (const source of sources) {
      const original = await existing(this.registry.defaultsPath, source);
      if (original) {
        const converted = source.endsWith('.md')
          ? Buffer.from(userKitMarkdown(original.toString('utf8'), target))
          : original;
        if (converted.equals(content)) return true;
      }
    }
    return false;
  }

  async migrate(selected: MigrationEntry[]): Promise<MigrationReport> {
    const report: MigrationReport = { migrated: [], conflicts: [] };
    if (!selected.length) return report;
    const backupRelative = `feature-studio/migrations/${randomUUID()}`;
    const backup = await safePath(this.registry.userPath, backupRelative);
    await mkdir(backup, { recursive: true });
    report.backupDirectory = backup;
    await writeFile(
      join(backup, 'manifest.json'),
      JSON.stringify(
        {
          workspace: this.registry.workspacePath,
          userDirectory: this.registry.userPath,
          createdAt: new Date().toISOString(),
          entries: selected.map((e) => ({
            id: e.id,
            files: e.files.map((f) => ({ source: f.source, target: f.target, mode: f.mode })),
          })),
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    for (const entry of selected) {
      try {
        if (entry.conflict) throw new Error(entry.conflict);
        if (entry.id.startsWith('skill:')) {
          const current = await files(this.registry.workspacePath, entry.source);
          if (JSON.stringify(current) !== JSON.stringify(entry.files.map((file) => file.source)))
            throw new Error('Le dossier a changé depuis l’aperçu ; relancer la migration.');
        }
        // Validate and back up the entire group before changing either side.
        for (const file of entry.files) {
          if (
            !equal(await existing(this.registry.workspacePath, file.source), file.original) ||
            !equal(await existing(this.registry.userPath, file.target), file.previous)
          )
            throw new Error('Un fichier a changé depuis l’aperçu ; relancer la migration.');
          for (const [fragment, bytes] of [
            [`project/${file.source}`, file.original],
            [`user/${file.target}`, file.previous],
          ] as const) {
            if (bytes === undefined) continue;
            const path = await safePath(backup, fragment);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, bytes, { flag: 'wx' });
            if (!(await readFile(path)).equals(bytes)) throw new Error('Sauvegarde non vérifiée.');
          }
        }
        for (const file of entry.files) {
          if (!equal(await existing(this.registry.userPath, file.target), file.previous))
            throw new Error('La destination a changé ; les fichiers du projet sont conservés.');
          if (!equal(file.previous, file.content)) {
            const target = await safePath(this.registry.userPath, file.target);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, file.content, {
              flag: file.previous === undefined ? 'wx' : 'w',
            });
            await chmod(target, file.mode);
          }
        }
        // Verify every destination and every source before removing any source from this group.
        for (const file of entry.files)
          if (
            !equal(await existing(this.registry.userPath, file.target), file.content) ||
            !equal(await existing(this.registry.workspacePath, file.source), file.original)
          )
            throw new Error('Copie ou source modifiée ; fichiers du projet conservés.');
        for (const file of entry.files) {
          if (
            !equal(await existing(this.registry.workspacePath, file.source), file.original) ||
            !equal(await existing(this.registry.userPath, file.target), file.content)
          )
            throw new Error('Modification concurrente ; migration interrompue.');
          await unlink(await safePath(this.registry.workspacePath, file.source));
        }
        // Only empty skill directories may be removed; never remove .github or unrelated content.
        if (entry.id.startsWith('skill:')) {
          const directories = new Set<string>([entry.source]);
          for (const file of entry.files) {
            let directory = dirname(file.source);
            while (directory.startsWith(entry.source) && directory !== entry.source) {
              directories.add(directory);
              directory = dirname(directory);
            }
          }
          for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
            try {
              await rmdir(await safePath(this.registry.workspacePath, directory));
            } catch (error) {
              if (
                !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(
                  (error as NodeJS.ErrnoException).code ?? '',
                )
              )
                throw error;
            }
          }
        }
        report.migrated.push(entry.label);
      } catch (error) {
        report.conflicts.push(`${entry.label} : ${(error as Error).message}`);
      }
    }
    await writeFile(join(backup, 'result.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    return report;
  }
}
