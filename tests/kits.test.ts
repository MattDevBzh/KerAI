import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { AgentRegistry } from '../src/core/registry';
import { KitService, validateKit } from '../src/host/KitService';
import {
  kitNodes,
  resolveKitSelection,
  type KitBundle,
  type KitFile,
  type KitMetadata,
} from '../src/shared/kits';
import { parseMessage } from '../src/host/messages';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const metadata: KitMetadata = {
  id: 'mon-kit',
  name: 'Mon équipe',
  description: 'Test',
  version: '1.0.0',
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'feature-kits-'));
  roots.push(root);
  const registry = new AgentRegistry(join(root, 'repo'), resolve('defaults'), join(root, 'user'));
  await mkdir(registry.workspacePath);
  await mkdir(registry.userPath);
  return { root, registry, kits: new KitService(registry) };
}
function file(path: string, content: string): KitFile {
  return {
    path,
    base64: Buffer.from(content).toString('base64'),
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}
describe('portable kit dependency and file contracts', () => {
  it('roundtrips optional intervention defaults through a portable team kit', async () => {
    const source = await fixture();
    const workflow = structuredClone(
      (await source.registry.load()).workflows.find((item) => item.steps.length > 1)!,
    );
    workflow.id = 'optional-team';
    workflow.steps[0].optional = true;
    await source.registry.saveWorkflow(workflow);
    const bundle = await source.kits.compose(metadata, ['workflow:optional-team']);
    const destination = await fixture();
    const preview = await destination.kits.preview(bundle);
    expect(preview.canInstall).toBe(true);
    await destination.kits.install(preview.token);
    const restored = (await destination.registry.load()).workflows.find(
      (item) => item.id === workflow.id,
    )!;
    expect(restored.steps[0].optional).toBe(true);
    expect(restored.steps[1].optional).toBeUndefined();
  });

  it('offers two independent presets including original Copilot profiles and DevOps resources', async () => {
    const f = await fixture();
    const catalog = await f.kits.catalog();
    expect(catalog.map((k) => k.metadata.id)).toEqual(['copilot', 'devops']);
    expect(catalog[0].nodes.filter((n) => n.kind === 'agent')).toHaveLength(14);
    expect(catalog[1].nodes.filter((n) => n.kind === 'agent')).toHaveLength(6);
    expect(catalog[1].nodes.filter((n) => n.kind === 'skill')).toHaveLength(8);
    expect(catalog.every((k) => !k.installed)).toBe(true);
    const copilot = await f.kits.preset('copilot');
    expect(copilot.files.some((f) => f.path === 'feature-studio/kit/templates/plan.md')).toBe(true);
    expect(copilot.files.some((f) => f.path === 'copilot-instructions.md')).toBe(false);
  });
  it('adds transitive dependencies once and removes only dependencies no longer needed', async () => {
    const f = await fixture(),
      nodes = kitNodes(await f.registry.load());
    const all = resolveKitSelection(nodes, ['workflow:devops']);
    expect(all.errors).toEqual([]);
    expect(all.refs).toHaveLength(15);
    expect(all.reasons['skill:devops-inspect']).toHaveLength(5);
    const shared = resolveKitSelection(nodes, ['agent:fs-devops-plan', 'agent:fs-devops-review']);
    expect(shared.refs.filter((r) => r === 'skill:devops-azure-preflight')).toHaveLength(1);
    const remaining = resolveKitSelection(nodes, ['agent:fs-devops-review']);
    expect(remaining.refs).toContain('skill:devops-azure-preflight');
    expect(remaining.refs).not.toContain('skill:devops-plan');
    expect(resolveKitSelection(nodes, ['skill:absent']).errors).toHaveLength(1);
  });
  it.each(['LF', 'CRLF'] as const)(
    'exports an agent with its skills and discussion marker, then installs locally (%s)',
    async (lineEndings) => {
      const f = await fixture();
      const bundle = await f.kits.compose(metadata, ['agent:fs-devops-plan']);
      const agentFile = bundle.files.find(
        (entry) => entry.path === 'agents/fs-devops-plan.agent.md',
      )!;
      Object.assign(
        agentFile,
        file(
          agentFile.path,
          Buffer.from(agentFile.base64, 'base64')
            .toString('utf8')
            .replace(/\r?\n/g, lineEndings === 'LF' ? '\n' : '\r\n')
            .replace(/^---(\r?\n)/, '---$1discussionAgent: true$1'),
        ),
      );
      expect(validateKit(bundle).nodes).toHaveLength(4);
      expect(
        validateKit(bundle).nodes.find((node) => node.id === 'fs-devops-plan')?.discussionAgent,
      ).toBe(true);
      expect(bundle.files.map((f) => f.path)).toContain(
        'skills/devops-inspect/scripts/ado-readonly.cjs',
      );
      expect(bundle.files.map((f) => f.path)).toContain('skills/devops-azure-preflight/LICENSE');
      const path = join(f.root, 'roundtrip.fskit.json');
      await writeFile(path, JSON.stringify(bundle));
      const imported = await f.kits.readBundle(path);
      expect(imported).toEqual(bundle);
      const preview = await f.kits.preview(imported);
      expect(preview.canInstall).toBe(true);
      await f.kits.install(preview.token);
      expect((await f.registry.load()).agents.find((a) => a.id === 'fs-devops-plan')?.source).toBe(
        'user',
      );
      expect(
        (await f.registry.load()).agents.find((a) => a.id === 'fs-devops-plan')?.discussionAgent,
      ).toBe(true);
      expect((await f.kits.preview(imported)).files.every((f) => f.status === 'identical')).toBe(
        true,
      );
      expect(
        (await f.kits.catalog()).some((k) => k.source === 'saved' && k.metadata.id === metadata.id),
      ).toBe(true);
      await expect(f.kits.install('forged')).rejects.toThrow(/expiré/);
    },
  );
  it('retains all resources of custom skills and resolves local links to other skills', async () => {
    const f = await fixture();
    await f.registry.saveSkill(
      'shared',
      '---\nname: Shared\ndescription: dependency\n---\nMethod.',
    );
    await f.registry.saveSkill(
      'custom',
      '---\nname: Custom\ndescription: test\n---\nRead [shared](../shared/SKILL.md) and [reference](references/check.md).',
    );
    await mkdir(join(f.registry.userPath, 'skills/custom/references'));
    await writeFile(
      join(f.registry.userPath, 'skills/custom/references/check.md'),
      'Expected checks.',
    );
    const bundle = await f.kits.compose(metadata, ['skill:custom']);
    expect(validateKit(bundle).nodes.map((n) => n.ref)).toEqual(['skill:custom', 'skill:shared']);
    expect(bundle.files.map((f) => f.path)).toContain('skills/custom/references/check.md');
    expect(() =>
      validateKit({
        ...bundle,
        files: bundle.files.filter((file) => !file.path.endsWith('/check.md')),
      }),
    ).toThrow(/Référence locale absente/);
  });
  it('blocks pre-existing conflicts and changes after preview without replacing personal work', async () => {
    const f = await fixture();
    const bundle = await f.kits.compose(metadata, ['agent:fs-devops-plan']);
    const preview = await f.kits.preview(bundle);
    await mkdir(join(f.registry.userPath, 'agents'));
    const path = join(f.registry.userPath, 'agents/fs-devops-plan.agent.md');
    await writeFile(path, 'Personal work');
    expect((await f.kits.preview(bundle)).canInstall).toBe(false);
    await expect(f.kits.install(preview.token)).rejects.toThrow(/existants/);
    expect(await readFile(path, 'utf8')).toBe('Personal work');
    await expect(
      readFile(join(f.registry.userPath, 'skills/devops-plan/SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps distinct kit revisions addressable and leaves a corrupt saved kit isolated', async () => {
    const f = await fixture();
    const first = await f.kits.compose(metadata, ['agent:fs-devops-plan']);
    const second = await f.kits.compose({ ...metadata, version: '1.1.0' }, [
      'agent:fs-devops-review',
    ]);
    await f.kits.remember(first);
    await f.kits.remember(second);
    await f.kits.remember(second);
    await writeFile(join(f.registry.userPath, 'feature-studio/kits/broken.fskit.json'), '{}');
    const catalog = await f.kits.catalog();
    expect(catalog.filter((k) => k.source === 'bundled')).toHaveLength(2);
    const revisions = catalog.filter((k) => k.metadata.id === metadata.id);
    expect(revisions).toHaveLength(2);
    expect(new Set(revisions.map((k) => k.storageId)).size).toBe(2);
    for (const entry of revisions)
      expect((await f.kits.saved(entry.storageId!)).metadata.version).toBe(entry.metadata.version);
    expect(catalog.find((k) => k.storageId === 'broken')?.error).toBeTruthy();
  });
  it('does not duplicate an installed preset in saved kits', async () => {
    const f = await fixture();
    const preview = await f.kits.preview(await f.kits.preset('devops'));
    await f.kits.install(preview.token);
    const catalog = await f.kits.catalog();
    expect(catalog).toHaveLength(2);
    expect(catalog.find((k) => k.metadata.id === 'devops')?.installed).toBe(true);
  });
  it('exports the installed shared template revision instead of reverting to the bundled version', async () => {
    const f = await fixture();
    const preview = await f.kits.preview(await f.kits.preset('copilot'));
    await f.kits.install(preview.token);
    await writeFile(
      join(f.registry.userPath, 'feature-studio/kit/templates/plan.md'),
      'My project plan template.',
    );
    const bundle = await f.kits.compose(metadata, ['skill:ai-plan']);
    const template = bundle.files.find((f) => f.path === 'feature-studio/kit/templates/plan.md')!;
    expect(Buffer.from(template.base64, 'base64').toString()).toBe('My project plan template.');
  });
  it('rejects traversal, aliases, mismatched hashes, missing dependencies and active MCP settings', async () => {
    const f = await fixture(),
      bundle = await f.kits.preset('devops');
    for (const path of [
      '../outside',
      '/tmp/out',
      'skills/devops-plan/../../out',
      'skills/devops-plan/.env',
      'skills/devops-plan/CON',
      'skills/devops-plan/x:ads',
      'feature-studio/settings.json',
    ]) {
      expect(() => validateKit({ ...bundle, files: [...bundle.files, file(path, 'x')] })).toThrow();
    }
    expect(() =>
      validateKit({
        ...bundle,
        files: [...bundle.files, { ...bundle.files[0], path: bundle.files[0].path.toUpperCase() }],
      }),
    ).toThrow();
    expect(() =>
      validateKit({
        ...bundle,
        files: [{ ...bundle.files[0], sha256: '0'.repeat(64) }, ...bundle.files.slice(1)],
      }),
    ).toThrow(/empreinte/);
    expect(() =>
      validateKit({
        ...bundle,
        files: bundle.files.filter((f) => !f.path.startsWith('skills/devops-plan/')),
      }),
    ).toThrow(/Dépendance/);
    expect(() => validateKit({ ...bundle, schemaVersion: 2 })).toThrow();
    expect(() =>
      validateKit({
        ...bundle,
        files: [...bundle.files, file('skills/devops-plan/SKILL.md/child', 'x')],
      }),
    ).toThrow(/Collision/);
    const workflow = bundle.files.find((f) => f.path.endsWith('devops.yaml'))!;
    const value = JSON.parse(Buffer.from(workflow.base64, 'base64').toString());
    value.steps[0].mcpServerIds = ['production'];
    expect(() =>
      validateKit({
        ...bundle,
        files: bundle.files.map((f) => (f === workflow ? file(f.path, JSON.stringify(value)) : f)),
      }),
    ).toThrow(/MCP/);
    expect(() =>
      parseMessage({ type: 'kitInstall', requestId: 'x', token: 'forged', path: '/tmp/out' }),
    ).toThrow();
  });
  it('refuses symlink resources and destination parents without touching the target', async () => {
    const f = await fixture();
    const bundle = await f.kits.compose(metadata, ['agent:fs-devops-plan']);
    const outside = join(f.root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(f.registry.userPath, 'agents'), 'junction');
    const preview = await f.kits.preview(bundle);
    expect(preview.canInstall).toBe(false);
    await expect(f.kits.install(preview.token)).rejects.toThrow();
    await f.registry.saveSkill('custom', '---\nname: Custom\ndescription: x\n---\nTest.');
    await symlink(outside, join(f.registry.userPath, 'skills/custom/data'), 'junction');
    await expect(f.kits.compose(metadata, ['skill:custom'])).rejects.toThrow(/symbolique|absente/);
  });
});
