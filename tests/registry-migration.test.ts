import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  chmod,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { AgentRegistry } from '../src/core/registry';
import { RegistryMigration } from '../src/core/registryMigration';
const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-migration-'));
  roots.push(root);
  const project = join(root, 'project'),
    user = join(root, 'user');
  await mkdir(project);
  await mkdir(user);
  const registry = new AgentRegistry(project, resolve('defaults'), user);
  return { project, user, registry, migration: new RegistryMigration(registry) };
}
async function put(root: string, path: string, content: string | Buffer) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}
const agent = (text: string) => `---\nname: Personal\ndescription: Custom agent\n---\n${text}\n`;
const skill = (text: string) => `---\nname: Personal\ndescription: Custom method\n---\n${text}\n`;
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('reviewed user migration', () => {
  it('moves only selected agents, keeps backups, shares customizations and is idempotent', async () => {
    const { project, user, registry, migration } = await setup();
    await put(project, '.github/agents/custom.agent.md', agent('My custom work'));
    await put(project, '.github/agents/other.agent.md', agent('Leave me here'));
    const before = await readdir(user, { recursive: true });
    const plan = await migration.plan();
    expect(await readdir(user, { recursive: true })).toEqual(before);
    const report = await migration.migrate(plan.filter((entry) => entry.id === 'agent:custom'));
    expect(report.conflicts).toEqual([]);
    expect(report.migrated).toEqual(['Agent : custom']);
    expect(await readFile(join(user, 'agents/custom.agent.md'), 'utf8')).toBe(
      agent('My custom work'),
    );
    await expect(readFile(join(project, '.github/agents/custom.agent.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(project, '.github/agents/other.agent.md'), 'utf8')).toBe(
      agent('Leave me here'),
    );
    expect(
      await readFile(
        join(report.backupDirectory!, 'project/.github/agents/custom.agent.md'),
        'utf8',
      ),
    ).toBe(agent('My custom work'));
    expect((await migration.plan()).map((entry) => entry.id)).toEqual(['agent:other']);
    expect((await registry.load()).agents.find((a) => a.id === 'custom')?.source).toBe('user');
    const other = new AgentRegistry(join(project, 'another'), resolve('defaults'), user);
    expect((await other.load()).agents.find((a) => a.id === 'custom')?.instructions).toBe(
      'My custom work',
    );
    await registry.saveAgent({
      ...(await registry.load()).agents.find((a) => a.id === 'custom')!,
      instructions: 'Edited globally',
    });
    await expect(readFile(join(project, '.github/agents/custom.agent.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('replaces a pristine user kit default with a project customization and backs up both versions', async () => {
    const { project, user, registry, migration } = await setup();
    await registry.installKit();
    const initial = await readFile(join(user, 'agents/fs-dev.agent.md'));
    await put(project, '.github/agents/fs-dev.agent.md', agent('Personalized development'));
    const report = await migration.migrate(await migration.plan());
    expect(report.conflicts).toEqual([]);
    expect(await readFile(join(report.backupDirectory!, 'user/agents/fs-dev.agent.md'))).toEqual(
      initial,
    );
    expect((await registry.load()).agents.find((a) => a.id === 'fs-dev')?.instructions).toBe(
      'Personalized development',
    );
  });
  it('removes identical project duplicates but preserves conflicting user customizations', async () => {
    const { project, user, migration } = await setup();
    for (const id of ['same', 'conflict'])
      await put(project, `.github/agents/${id}.agent.md`, agent('Project custom'));
    await put(user, 'agents/same.agent.md', agent('Project custom'));
    await put(user, 'agents/conflict.agent.md', agent('User custom'));
    const plan = await migration.plan();
    expect(plan.find((entry) => entry.id === 'agent:conflict')?.conflict).toMatch(/différente/);
    const report = await migration.migrate(plan);
    expect(report.migrated).toEqual(['Agent : same']);
    expect(report.conflicts).toHaveLength(1);
    expect(await readFile(join(project, '.github/agents/conflict.agent.md'), 'utf8')).toBe(
      agent('Project custom'),
    );
    expect(await readFile(join(user, 'agents/conflict.agent.md'), 'utf8')).toBe(
      agent('User custom'),
    );
  });
  it('moves whole skill directories including binary assets, scripts and relative links', async () => {
    const { project, user, registry, migration } = await setup();
    await put(project, '.github/skills/custom/SKILL.md', skill('[Guide](references/guide.md)'));
    await put(project, '.github/skills/custom/references/guide.md', 'Custom guide');
    await put(project, '.github/skills/custom/assets/data.bin', Buffer.from([0, 1, 2, 255]));
    await put(project, '.github/skills/custom/scripts/run.sh', '#!/bin/sh\ntrue\n');
    await chmod(join(project, '.github/skills/custom/scripts/run.sh'), 0o755);
    const report = await migration.migrate(await migration.plan());
    expect(report.conflicts).toEqual([]);
    expect(await readFile(join(user, 'skills/custom/assets/data.bin'))).toEqual(
      Buffer.from([0, 1, 2, 255]),
    );
    if (process.platform !== 'win32')
      expect((await stat(join(user, 'skills/custom/scripts/run.sh'))).mode & 0o777).toBe(0o755);
    await expect(readdir(join(project, '.github/skills/custom'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await registry.load()).skills.find((s) => s.id === 'custom')?.source).toBe('user');
  });
  it('adapts kit template links and preserves the original markdown in the backup', async () => {
    const { project, user, registry, migration } = await setup();
    await registry.installKit();
    const original = await readFile(resolve('defaults/kit/.github/skills/ai-debug/SKILL.md'));
    await put(project, '.github/skills/ai-debug/SKILL.md', original);
    const report = await migration.migrate(await migration.plan());
    expect(report.conflicts).toEqual([]);
    expect(await readFile(join(user, 'skills/ai-debug/SKILL.md'), 'utf8')).toContain(
      '../../feature-studio/kit/templates/debug.md',
    );
    expect(
      await readFile(join(report.backupDirectory!, 'project/.github/skills/ai-debug/SKILL.md')),
    ).toEqual(original);
  });
  it.each(['source', 'destination', 'new-resource'])(
    'refuses %s changes after preview without removing project files',
    async (change) => {
      const { project, user, migration } = await setup();
      await put(project, '.github/skills/custom/SKILL.md', skill('My method'));
      const plan = await migration.plan();
      if (change === 'source')
        await put(project, '.github/skills/custom/SKILL.md', skill('Human edit'));
      if (change === 'destination')
        await put(user, 'skills/custom/SKILL.md', skill('Concurrent user edit'));
      if (change === 'new-resource')
        await put(project, '.github/skills/custom/new.txt', 'Human data');
      const report = await migration.migrate(plan);
      expect(report.migrated).toEqual([]);
      expect(report.conflicts).toHaveLength(1);
      expect(await readFile(join(project, '.github/skills/custom/SKILL.md'), 'utf8')).toBe(
        skill(change === 'source' ? 'Human edit' : 'My method'),
      );
    },
  );
  it('blocks a whole skill on one resource conflict, and reports external relative links', async () => {
    const { project, user, migration } = await setup();
    await put(project, '.github/skills/custom/SKILL.md', skill('[Data](data.txt)'));
    await put(project, '.github/skills/custom/data.txt', 'Project data');
    await put(user, 'skills/custom/data.txt', 'User data');
    await put(
      project,
      '.github/agents/linked.agent.md',
      agent('[Project doc](../../docs/project.md)'),
    );
    const plan = await migration.plan();
    expect(plan.every((entry) => entry.conflict)).toBe(true);
    const report = await migration.migrate(plan);
    expect(report.migrated).toEqual([]);
    expect(await readFile(join(project, '.github/skills/custom/data.txt'), 'utf8')).toBe(
      'Project data',
    );
  });
  it('refuses symlinks in migration sources and destinations', async () => {
    const { project, user, migration } = await setup();
    await put(project, '.github/agents/custom.agent.md', agent('Original'));
    await mkdir(join(user, 'outside'));
    await symlink(join(user, 'outside'), join(user, 'agents'), 'junction');
    const plan = await migration.plan();
    expect(plan[0].conflict).toMatch(/symbolique/);
    const result = await migration.migrate(plan);
    expect(result.migrated).toEqual([]);
    expect(await readdir(join(user, 'outside'))).toEqual([]);
    await symlink(join(user, 'outside'), join(project, '.github/skills'), 'junction');
    await expect(migration.plan()).rejects.toThrow(/symbolique/);
  });
});
