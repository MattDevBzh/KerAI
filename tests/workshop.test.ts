import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { parse } from 'yaml';
import { AgentRegistry } from '../src/core/registry';
import { WorkshopService } from '../src/host/WorkshopService';
import { decodeWorkshopArchive } from '../src/host/WorkshopArchive';
import { parseMessage } from '../src/host/messages';
import { randomUUID } from 'node:crypto';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const agent = (body: string) =>
  `---\nname: Exemple\ndescription: Profil de test\ntools: [read]\nskills: []\n---\n\n${body}\n`;
const skill =
  '---\nname: Méthode\ndescription: Exemple\n---\n\nLire la [référence](reference.txt).\n';
async function put(root: string, path: string, content: string | Buffer) {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workshop-'));
  roots.push(root);
  const registry = new AgentRegistry(
    join(root, 'project'),
    resolve('defaults'),
    join(root, 'user'),
  );
  await mkdir(registry.workspacePath);
  await mkdir(registry.userPath);
  await put(registry.userPath, 'agents/example.agent.md', agent('Version personnelle.'));
  await put(registry.workspacePath, '.github/agents/example.agent.md', agent('Version projet.'));
  const service = new WorkshopService(registry);
  return { root, registry, service };
}
function revise(archive: Buffer, change: (files: Record<string, Uint8Array>) => void): Buffer {
  const files = unzipSync(archive);
  change(files);
  return Buffer.from(zipSync(files));
}
function replace(files: Record<string, Uint8Array>, path: string, text: string) {
  files[path] = Buffer.from(text);
}
function remove(files: Record<string, Uint8Array>, path: string) {
  delete files[path];
  const manifest = JSON.parse(Buffer.from(files['atelier.json']).toString());
  manifest.deleted.push(path);
  replace(files, 'atelier.json', JSON.stringify(manifest));
}

describe('révision externe de l’atelier', () => {
  it('exports every catalogue layer and ordinary resources, with no local MCP bindings; unchanged roundtrip is a no-op', async () => {
    const f = await fixture();
    await put(f.registry.userPath, 'skills/method/SKILL.md', skill);
    await put(f.registry.userPath, 'skills/method/reference.txt', 'Ressource lisible.');
    await put(f.registry.userPath, 'skills/method/icon.png', Buffer.from([0, 1, 2, 255]));
    const workflow = (await f.registry.load()).workflows.find((w) => w.id === 'single')!;
    workflow.id = 'custom';
    workflow.steps[0].mcpServerIds = ['private-connection'];
    await f.registry.saveWorkflow(workflow);
    const exported = await f.service.exportArchive(),
      files = unzipSync(exported);
    expect(Buffer.from(files['personnel/agents/example.agent.md']).toString()).toContain(
      'Version personnelle',
    );
    expect(Buffer.from(files['projet/.github/agents/example.agent.md']).toString()).toContain(
      'Version projet',
    );
    expect(files['fourni/agents/fs-dev.agent.md']).toBeDefined();
    expect(
      files['fourni/agents/fs-audit-code.agent.md'] ??
        Object.keys(files).find((p) => p.startsWith('fourni/agents/fs-audit-')),
    ).toBeDefined();
    expect(Buffer.from(files['personnel/skills/method/icon.png'])).toEqual(
      Buffer.from([0, 1, 2, 255]),
    );
    const all = Object.values(files)
      .map((v) => Buffer.from(v).toString())
      .join('\n');
    expect(all).not.toContain(f.root);
    expect(all).not.toContain('private-connection');
    expect(all).toContain('Contrats KerAI');
    const preview = await f.service.previewImport(exported);
    expect(preview.changes).toEqual([]);
    expect(preview.canApply).toBe(false);
  });

  it('compares, applies and restores personal and project changes after recreating the service', async () => {
    const f = await fixture();
    const exported = await f.service.exportArchive();
    const revised = revise(exported, (files) => {
      replace(files, 'personnel/agents/example.agent.md', agent('Amélioration personnelle.'));
      replace(files, 'projet/.github/agents/example.agent.md', agent('Amélioration projet.'));
      replace(files, 'REVISION.md', '# Modifications\nConsignes clarifiées.');
    });
    const restarted = new WorkshopService(f.registry);
    const preview = await restarted.previewImport(revised);
    expect(preview.canApply).toBe(true);
    expect(preview.changes).toHaveLength(2);
    expect(preview.report).toContain('Consignes clarifiées');
    expect(preview.changes[0].before).toContain('Version personnelle');
    await restarted.apply(preview.token);
    expect(
      await readFile(join(f.registry.workspacePath, '.github/agents/example.agent.md'), 'utf8'),
    ).toContain('Amélioration projet');
    const again = new WorkshopService(f.registry),
      history = await again.history();
    expect(history[0].state).toBe('applied');
    expect((await again.previewImport(revised)).changes).toHaveLength(0);
    const rollback = await again.previewRestore(history[0].id);
    await again.apply(rollback.token);
    expect(await readFile(join(f.registry.userPath, 'agents/example.agent.md'), 'utf8')).toBe(
      agent('Version personnelle.'),
    );
    expect(
      await readFile(join(f.registry.workspacePath, '.github/agents/example.agent.md'), 'utf8'),
    ).toBe(agent('Version projet.'));
    expect((await again.history())[0].state).toBe('restored');
  });

  it('customizes a supplied profile with linked resources and removes those copies on restore', async () => {
    const f = await fixture();
    const exported = await f.service.exportArchive();
    const revised = revise(exported, (files) => {
      const path = 'fourni/agents/fs-review.agent.md';
      replace(
        files,
        path,
        Buffer.from(files[path]).toString() + '\nVérifier aussi les régressions.\n',
      );
    });
    const preview = await f.service.previewImport(revised);
    expect(preview.canApply).toBe(true);
    expect(preview.changes.some((c) => c.path === 'personnel/agents/fs-review.agent.md')).toBe(
      true,
    );
    await f.service.apply(preview.token);
    expect(
      await readFile(join(f.registry.userPath, 'agents/fs-review.agent.md'), 'utf8'),
    ).toContain('régressions');
    await expect(f.service.exportArchive()).resolves.toBeInstanceOf(Buffer);
    const restore = await f.service.previewRestore((await f.service.history())[0].id);
    await f.service.apply(restore.token);
    await expect(
      readFile(join(f.registry.userPath, 'agents/fs-review.agent.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves private workflow bindings for retained steps when the external revision changes instructions', async () => {
    const f = await fixture();
    const workflow = (await f.registry.load()).workflows.find((w) => w.id === 'single')!;
    workflow.id = 'custom';
    workflow.steps[0].mcpServerIds = ['local-only'];
    await f.registry.saveWorkflow(workflow);
    const revised = revise(await f.service.exportArchive(), (files) => {
      const path = 'personnel/feature-studio/workflows/custom.yaml';
      replace(
        files,
        path,
        Buffer.from(files[path])
          .toString()
          .replace('description:', 'description: Nouvelle description #'),
      );
    });
    const preview = await f.service.previewImport(revised);
    expect(JSON.stringify(preview)).not.toContain('local-only');
    await f.service.apply(preview.token);
    const result = parse(
      await readFile(join(f.registry.userPath, 'feature-studio/workflows/custom.yaml'), 'utf8'),
    );
    expect(result.steps[0].mcpServerIds).toEqual(['local-only']);
  });

  it('handles explicit deletions, additions and binary resources without treating omissions as deletion', async () => {
    const f = await fixture(),
      exported = await f.service.exportArchive();
    await expect(
      f.service.previewImport(
        revise(exported, (files) => {
          delete files['personnel/agents/example.agent.md'];
        }),
      ),
    ).rejects.toThrow(/manquant/);
    const revised = revise(exported, (files) => {
      remove(files, 'personnel/agents/example.agent.md');
      replace(files, 'personnel/skills/method/SKILL.md', skill);
      replace(files, 'personnel/skills/method/reference.txt', 'Nouvelle méthode.');
      files['personnel/skills/method/image.png'] = new Uint8Array([0, 255, 23]);
    });
    const preview = await f.service.previewImport(revised);
    expect(preview.changes.some((c) => c.status === 'deleted')).toBe(true);
    expect(preview.changes.find((c) => c.path.endsWith('image.png'))?.binary).toBe(true);
    await f.service.apply(preview.token);
    expect((await f.registry.load()).skills.some((s) => s.id === 'method')).toBe(true);
    const restore = await f.service.previewRestore((await f.service.history())[0].id);
    await f.service.apply(restore.token);
    expect(await readFile(join(f.registry.userPath, 'agents/example.agent.md'), 'utf8')).toBe(
      agent('Version personnelle.'),
    );
    await expect(
      readFile(join(f.registry.userPath, 'skills/method/SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks local edits made since export or since preview, and preserves unrelated edits', async () => {
    const f = await fixture(),
      exported = await f.service.exportArchive();
    const revised = revise(exported, (files) =>
      replace(files, 'personnel/agents/example.agent.md', agent('Révision IA.')),
    );
    await put(f.registry.userPath, 'agents/example.agent.md', agent('Modification locale.'));
    const conflict = await f.service.previewImport(revised);
    expect(conflict.canApply).toBe(false);
    expect(conflict.changes[0].status).toBe('conflict');
    await put(f.registry.userPath, 'agents/example.agent.md', agent('Version personnelle.'));
    await put(
      f.registry.workspacePath,
      '.github/agents/example.agent.md',
      agent('Modification locale conservée.'),
    );
    const preview = await f.service.previewImport(revised);
    expect(preview.canApply).toBe(true);
    await put(f.registry.userPath, 'agents/example.agent.md', agent('Modification après aperçu.'));
    await expect(f.service.apply(preview.token)).rejects.toThrow(/changé depuis l’aperçu/);
    expect(await readFile(join(f.registry.userPath, 'agents/example.agent.md'), 'utf8')).toContain(
      'après aperçu',
    );
  });

  it('does not overwrite later local edits during restoration', async () => {
    const f = await fixture();
    const revised = revise(await f.service.exportArchive(), (files) =>
      replace(files, 'personnel/agents/example.agent.md', agent('Révision.')),
    );
    await f.service.apply((await f.service.previewImport(revised)).token);
    await put(f.registry.userPath, 'agents/example.agent.md', agent('Édition plus récente.'));
    const restore = await f.service.previewRestore((await f.service.history())[0].id);
    expect(restore.canApply).toBe(false);
    expect(restore.changes[0].status).toBe('conflict');
    await expect(f.service.apply(restore.token)).rejects.toThrow(/non applicables/);
  });

  it('rolls back a partially applied import, keeping a durable record', async () => {
    const f = await fixture();
    const revised = revise(await f.service.exportArchive(), (files) => {
      replace(files, 'personnel/agents/example.agent.md', agent('Révision.'));
      replace(files, 'projet/.github/agents/example.agent.md', agent('Révision.'));
    });
    const preview = await f.service.previewImport(revised);
    const internal = f.service as unknown as { writeEdit: (edit: unknown) => Promise<void> };
    const original = internal.writeEdit.bind(internal);
    let calls = 0;
    vi.spyOn(internal, 'writeEdit').mockImplementation(async (edit) => {
      if (++calls === 2) throw Error('Disque indisponible');
      return original(edit);
    });
    await expect(f.service.apply(preview.token)).rejects.toThrow(/remis dans leur état/);
    expect(await readFile(join(f.registry.userPath, 'agents/example.agent.md'), 'utf8')).toBe(
      agent('Version personnelle.'),
    );
    expect((await f.service.history())[0].state).toBe('restored');
  });

  it('can recover an interrupted import using its persistent journal', async () => {
    const f = await fixture();
    const revised = revise(await f.service.exportArchive(), (files) =>
      replace(files, 'personnel/agents/example.agent.md', agent('Révision.')),
    );
    await f.service.apply((await f.service.previewImport(revised)).token);
    const entry = (await f.service.history())[0],
      path = join(f.service.storageRoot, 'history', `${entry.id}.json`);
    const journal = JSON.parse(await readFile(path, 'utf8'));
    journal.state = 'pending';
    await writeFile(path, JSON.stringify(journal));
    const restarted = new WorkshopService(f.registry);
    const restore = await restarted.previewRestore(entry.id);
    await restarted.apply(restore.token);
    expect(await readFile(join(f.registry.userPath, 'agents/example.agent.md'), 'utf8')).toBe(
      agent('Version personnelle.'),
    );
  });

  it('refuses a substituted archive, paths outside the workshop, missing dependencies and symbolic links', async () => {
    const f = await fixture(),
      exported = await f.service.exportArchive();
    const badId = revise(exported, (files) => {
      const manifest = JSON.parse(Buffer.from(files['atelier.json']).toString());
      manifest.exportId = randomUUID();
      replace(files, 'atelier.json', JSON.stringify(manifest));
    });
    await expect(f.service.previewImport(badId)).rejects.toThrow(/origine introuvable/);
    expect(() =>
      decodeWorkshopArchive(
        revise(exported, (files) => replace(files, 'personnel/../outside.txt', 'no')),
      ),
    ).toThrow(/Chemin interdit/);
    expect(() =>
      decodeWorkshopArchive(
        revise(exported, (files) =>
          replace(
            files,
            'personnel/agents/new.agent.md',
            agent('Test').replace('skills: []', 'skills: [missing]'),
          ),
        ),
      ),
    ).toThrow(/Skill absent/);
    await symlink(
      join(f.registry.userPath, 'agents/example.agent.md'),
      join(f.registry.userPath, 'agents/linked.agent.md'),
    );
    await expect(f.service.exportArchive()).rejects.toThrow(/symbolique/);
  });

  it('accepts a single wrapper directory and rejects unknown host message fields', async () => {
    const f = await fixture(),
      exported = await f.service.exportArchive(),
      files = unzipSync(exported);
    const wrapped = Buffer.from(
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([path, content]) => [`atelier-revise/${path}`, content]),
        ),
      ),
    );
    expect((await f.service.previewImport(wrapped)).changes).toEqual([]);
    expect(() =>
      parseMessage({
        type: 'workshopApply',
        requestId: randomUUID(),
        token: randomUUID(),
        path: '/outside',
      }),
    ).toThrow();
  });
});
