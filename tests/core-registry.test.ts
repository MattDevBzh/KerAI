import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AgentRegistry } from '../src/core/registry';

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-registry-'));
  roots.push(root);
  const userPath = await mkdtemp(join(tmpdir(), 'studio-user-kit-'));
  roots.push(userPath);
  return { root, userPath, registry: new AgentRegistry(root, resolve('defaults'), userPath) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('agent, skill and workflow registry', () => {
  it('provides five derived agents and three valid defaults without guessed model IDs or dotnet commands', async () => {
    const { registry } = await setup();
    const data = await registry.load();
    expect(data.notices).toEqual([]);
    expect(data.agents).toHaveLength(5);
    expect(data.workflows.map((w) => w.id).sort()).toEqual(['code-review', 'feature', 'single']);
    expect(data.workflows.find((w) => w.id === 'feature')?.steps.map((s) => s.id)).toEqual([
      'specs',
      'plan',
      'dev',
      'tests',
      'review',
    ]);
    expect(
      data.agents.every((a) => !a.model && (a.id === 'fs-tests' || !a.tools.includes('execute'))),
    ).toBe(true);
    expect(data.agents.find((a) => a.id === 'fs-tests')?.tools).toEqual([
      'read',
      'search',
      'edit',
      'execute',
    ]);
    expect(data.skills.some((s) => s.id === 'ai-tdd')).toBe(true);
  });
  it('overrides bundled agents only with explicit workspace edits and reports malformed workflows', async () => {
    const { root, registry } = await setup();
    const original = (await registry.load()).agents[0];
    await registry.saveAgent({
      ...original,
      instructions: 'Workspace instructions',
      name: 'Mon agent',
      nickname: 'Gandalf',
      avatar: 'wizard',
    });
    await mkdir(join(root, '.feature-studio/workflows'), { recursive: true });
    await writeFile(join(root, '.feature-studio/workflows/bad.yaml'), 'id: broken\nsteps: []\n');
    const data = await registry.load();
    expect(data.agents.find((a) => a.id === original.id)?.source).toBe('workspace');
    expect(data.agents.find((a) => a.id === original.id)?.instructions).toBe(
      'Workspace instructions',
    );
    expect(data.agents.find((a) => a.id === original.id)?.nickname).toBe('Gandalf');
    expect(data.agents.find((a) => a.id === original.id)?.avatar).toBe('wizard');
    await expect(registry.saveAgent({ ...original, avatar: 'invalid' })).rejects.toThrow();
    expect(data.notices.some((n) => n.includes('bad.yaml'))).toBe(true);
    expect(data.workflows).toHaveLength(3);
  });
  it('installs for the user without changing the workspace and preserves personal conflicts', async () => {
    const { root, registry, userPath } = await setup();
    await mkdir(join(root, '.ai'), { recursive: true });
    await writeFile(join(root, '.ai/project.md'), 'Personal map');
    await writeFile(join(userPath, 'copilot-instructions.md'), 'Personal rules');
    const before = await readdir(root, { recursive: true });
    const first = await registry.installKit();
    expect(first.directory).toBe(userPath);
    expect(first.installed.length).toBeGreaterThan(30);
    expect(first.conflicts).toContain('copilot-instructions.md');
    const second = await registry.installKit();
    expect(second.installed).toEqual([]);
    expect(second.unchanged.length).toBe(first.installed.length);
    expect(await readFile(join(root, '.ai/project.md'), 'utf8')).toBe('Personal map');
    expect(await readFile(join(userPath, 'copilot-instructions.md'), 'utf8')).toBe(
      'Personal rules',
    );
    expect(await readdir(root, { recursive: true })).toEqual(before);
    expect((await registry.load()).agents).toHaveLength(9);
    expect((await registry.load()).agents.every((agent) => agent.source === 'user')).toBe(true);
    const other = new AgentRegistry(join(root, 'another-project'), resolve('defaults'), userPath);
    expect((await other.load()).agents).toHaveLength(9);
    expect((await other.load()).skills).toHaveLength(7);
    expect((await other.load()).workflows).toHaveLength(3);
    const skill = await readFile(join(userPath, 'skills/ai-debug/SKILL.md'), 'utf8');
    expect(skill).toContain('../../feature-studio/kit/templates/debug.md');
    expect(skill).toContain('`.ai/project.md` dans le projet courant');
    expect(skill).not.toContain('../../../.ai/project.md');
    expect(await readFile(join(userPath, 'feature-studio/kit/templates/debug.md'), 'utf8')).toBe(
      await readFile(resolve('defaults/kit/templates/debug.md'), 'utf8'),
    );
  });
  it('rejects path traversal and refuses symlink destinations', async () => {
    const { root, registry, userPath } = await setup();
    const agent = (await registry.load()).agents[0];
    await expect(registry.saveAgent({ ...agent, id: '../../escape' })).rejects.toThrow();
    await expect(
      registry.saveSkill('../escape', '---\nname: x\ndescription: x\n---\nBody'),
    ).rejects.toThrow();
    const other = await mkdtemp(join(tmpdir(), 'studio-outside-'));
    roots.push(other);
    await symlink(other, join(root, '.github'));
    await expect(registry.saveAgent(agent)).rejects.toThrow(/symbolique/);
    await symlink(other, join(userPath, 'agents'), 'junction');
    const report = await registry.installKit();
    expect(report.conflicts.some((c) => c.includes('symbolique'))).toBe(true);
  });
  it('loads workspace overrides before personal overrides before bundled defaults', async () => {
    const { registry, userPath } = await setup();
    await registry.installKit();
    const personal = (await registry.load()).agents.find((a) => a.id === 'fs-plan')!;
    await writeFile(
      join(userPath, 'agents/fs-plan.agent.md'),
      '---\nname: Personal plan\ndescription: User\n---\nPersonal instructions\n',
    );
    expect((await registry.load()).agents.find((a) => a.id === 'fs-plan')).toMatchObject({
      source: 'user',
      instructions: 'Personal instructions',
    });
    await registry.saveAgent({ ...personal, instructions: 'Workspace instructions' });
    expect((await registry.load()).agents.find((a) => a.id === 'fs-plan')).toMatchObject({
      source: 'workspace',
      instructions: 'Workspace instructions',
    });
    expect(await readFile(join(userPath, 'agents/fs-plan.agent.md'), 'utf8')).toContain(
      'Personal instructions',
    );
  });
  it('loads official agents without name or tools and reports unsupported model arrays', async () => {
    const { root, registry } = await setup();
    await mkdir(join(root, '.github/agents'), { recursive: true });
    await writeFile(
      join(root, '.github/agents/official.agent.md'),
      '---\ndescription: Official profile\n---\nInstructions',
    );
    await writeFile(
      join(root, '.github/agents/bad-model.agent.md'),
      '---\ndescription: Invalid profile\nmodel: [one, two]\n---\nInstructions',
    );
    const data = await registry.load(),
      official = data.agents.find((a) => a.id === 'official');
    expect(official?.name).toBe('official');
    expect(official?.tools).toEqual(['read', 'search', 'edit']);
    expect(official?.source).toBe('workspace');
    expect(data.agents.some((a) => a.id === 'bad-model')).toBe(false);
    expect(data.notices.some((n) => n.includes('bad-model.agent.md') && n.includes('model'))).toBe(
      true,
    );
  });
  it('saves strict workspace workflows without changing feature snapshots or following symlinks', async () => {
    const { root, registry } = await setup(),
      original = (await registry.load()).workflows.find((w) => w.id === 'single')!;
    const { WorkflowEngine } = await import('../src/core/workflow');
    const engine = new WorkflowEngine(),
      feature = engine.createFeature(original, { title: 'Existing', description: '' });
    await registry.saveWorkflow({
      ...original,
      name: 'Customized',
      steps: original.steps.map((step) => ({
        ...step,
        initialContext: 'Manual context',
        mcpServerIds: ['local-server'],
        askBeforeRun: true,
      })),
    });
    const reloaded = (await registry.load()).workflows.find((w) => w.id === 'single')!;
    expect(reloaded.name).toBe('Customized');
    expect(reloaded.steps[0].initialContext).toBe('Manual context');
    expect(feature.workflowName).toBe(original.name);
    expect(feature.steps[0].initialContext).toBeUndefined();
    await expect(
      registry.saveWorkflow({
        ...original,
        steps: original.steps.map((s) => ({ ...s, dependsOn: [s.id] })),
      }),
    ).rejects.toThrow(/Cycle/);
    await expect(
      registry.saveWorkflow({
        ...original,
        steps: original.steps.map((s) => ({ ...s, agentId: 'unknown' })),
      }),
    ).rejects.toThrow(/inconnu/);
    const outside = await mkdtemp(join(tmpdir(), 'studio-workflow-outside-'));
    roots.push(outside);
    await symlink(
      join(outside, 'target.yaml'),
      join(root, '.feature-studio/workflows/linked.yaml'),
    );
    await expect(registry.saveWorkflow({ ...original, id: 'linked' })).rejects.toThrow(
      /symbolique/,
    );
  });
});
