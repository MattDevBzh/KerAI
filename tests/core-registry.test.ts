import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, link, writeFile } from 'node:fs/promises';
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
  it('retires all workflow versions across projects without destroying definitions, and permits recreation', async () => {
    const { root, registry, userPath } = await setup();
    const original = (await registry.load()).workflows.find(
      (workflow) => workflow.id === 'feature',
    )!;
    const originalFile = await readFile(original.source!, 'utf8');
    await registry.deleteWorkflow(original.id);
    expect((await registry.load()).workflows.some((workflow) => workflow.id === original.id)).toBe(
      false,
    );
    const other = new AgentRegistry(join(root, 'other'), resolve('defaults'), userPath);
    expect((await other.load()).workflows.some((workflow) => workflow.id === original.id)).toBe(
      false,
    );
    expect(await readFile(original.source!, 'utf8')).toBe(originalFile);
    await registry.saveWorkflow(original);
    expect((await registry.load()).workflows.some((workflow) => workflow.id === original.id)).toBe(
      true,
    );
    await registry.deleteWorkflow(original.id);
    expect((await registry.load()).workflows.some((workflow) => workflow.id === original.id)).toBe(
      false,
    );
    await expect(registry.deleteWorkflow('../outside')).rejects.toThrow();
  });
  it('provides five derived agents and three valid defaults without guessed model IDs or dotnet commands', async () => {
    const { registry } = await setup();
    const data = await registry.load();
    expect(data.notices).toEqual([]);
    expect(data.agents.map((a) => a.id)).toEqual(
      expect.arrayContaining(['fs-dev', 'fs-plan', 'fs-tests', 'fs-review', 'fs-specs']),
    );
    expect(data.workflows.map((w) => w.id)).toEqual(
      expect.arrayContaining(['code-review', 'feature', 'single']),
    );
    expect(data.workflows.find((w) => w.id === 'feature')?.steps.map((s) => s.id)).toEqual([
      'specs',
      'plan',
      'dev',
      'tests',
      'review',
    ]);
    expect(
      data.agents.every(
        (a) =>
          !a.model &&
          (['fs-tests', 'fs-visual-tests', 'fs-counterexamples', 'fs-delivery'].includes(a.id) ||
            !a.tools.includes('execute')),
      ),
    ).toBe(true);
    expect(data.agents.find((a) => a.id === 'fs-tests')?.tools).toEqual([
      'read',
      'search',
      'edit',
      'execute',
    ]);
    expect(data.skills.some((s) => s.id === 'ai-tdd')).toBe(true);
  });
  it('saves user agents and reports malformed workspace workflows', async () => {
    const { root, registry } = await setup();
    const original = (await registry.load()).agents[0];
    await registry.saveAgent({
      ...original,
      instructions: 'Workspace instructions',
      name: 'Mon agent',
      nickname: 'Gandalf',
      avatar: 'wizard',
      emptyContextByDefault: true,
      discussionAgent: true,
    });
    await mkdir(join(root, '.feature-studio/workflows'), { recursive: true });
    await writeFile(join(root, '.feature-studio/workflows/bad.yaml'), 'id: broken\nsteps: []\n');
    const data = await registry.load();
    expect(data.agents.find((a) => a.id === original.id)?.source).toBe('user');
    expect(data.agents.find((a) => a.id === original.id)?.instructions).toBe(
      'Workspace instructions',
    );
    expect(data.agents.find((a) => a.id === original.id)?.nickname).toBe('Gandalf');
    expect(data.agents.find((a) => a.id === original.id)?.avatar).toBe('wizard');
    expect(data.agents.find((a) => a.id === original.id)?.emptyContextByDefault).toBe(true);
    expect(data.agents.find((a) => a.id === original.id)?.discussionAgent).toBe(true);
    await expect(registry.saveAgent({ ...original, avatar: 'invalid' })).rejects.toThrow();
    expect(data.notices.some((n) => n.includes('bad.yaml'))).toBe(true);
    expect(data.workflows.map((w) => w.id)).toEqual(
      expect.arrayContaining(['code-review', 'feature', 'single']),
    );
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
    expect((await registry.load()).agents).toHaveLength(19);
    expect((await registry.load()).agents.every((agent) => agent.source === 'user')).toBe(true);
    const other = new AgentRegistry(join(root, 'another-project'), resolve('defaults'), userPath);
    expect((await other.load()).agents).toHaveLength(19);
    expect((await other.load()).skills).toHaveLength(15);
    expect((await other.load()).workflows.map((w) => w.id)).toEqual(
      expect.arrayContaining(['code-review', 'feature', 'single']),
    );
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
    await symlink(other, join(userPath, 'agents'), 'junction');
    await expect(registry.saveAgent(agent)).rejects.toThrow(/symbolique/);
    const report = await registry.installKit();
    expect(report.conflicts.some((c) => c.includes('symbolique'))).toBe(true);
  });
  it('loads workspace overrides before personal overrides before bundled defaults', async () => {
    const { registry, userPath, root } = await setup();
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
    await mkdir(join(root, '.github/agents'), { recursive: true });
    await writeFile(
      join(root, '.github/agents/fs-plan.agent.md'),
      '---\nname: Project plan\ndescription: Project\n---\nWorkspace instructions\n',
    );
    const versions = (await registry.load()).agents.find((a) => a.id === personal.id)!;
    await registry.saveAgent(
      { ...personal, instructions: 'Hidden personal override' },
      { scope: 'user', expectedRevision: versions.targets!.user.revision },
    );
    expect((await registry.load()).agents.find((a) => a.id === 'fs-plan')).toMatchObject({
      source: 'workspace',
      instructions: 'Workspace instructions',
    });
    expect(await readFile(join(userPath, 'agents/fs-plan.agent.md'), 'utf8')).toContain(
      'Hidden personal override',
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
  it('saves strict user workflows shared across projects without changing snapshots or following symlinks', async () => {
    const { root, userPath, registry } = await setup(),
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
    expect(reloaded.source).toBe(join(userPath, 'feature-studio/workflows/single.yaml'));
    await expect(readdir(join(root, '.feature-studio'))).rejects.toMatchObject({ code: 'ENOENT' });
    const otherProject = new AgentRegistry(
      join(root, 'other-project'),
      resolve('defaults'),
      userPath,
    );
    expect((await otherProject.load()).workflows.find((w) => w.id === 'single')?.name).toBe(
      'Customized',
    );
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
      join(userPath, 'feature-studio/workflows/linked.yaml'),
    );
    await expect(registry.saveWorkflow({ ...original, id: 'linked' })).rejects.toThrow(
      /symbolique/,
    );
  });
});

describe('personal profile editing', () => {
  it('keeps the edited profile excluded from supporting kit installation with either path separator', async () => {
    const { registry, userPath } = await setup();
    const report = await registry.installKit([
      'agents\\fs-dev.agent.md',
      'agents/fs-plan.agent.md',
    ]);
    expect(report.conflicts).toEqual([]);
    for (const id of ['fs-dev', 'fs-plan'])
      await expect(readFile(join(userPath, 'agents', `${id}.agent.md`))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    expect(await readFile(join(userPath, 'skills/ai-plan/SKILL.md'), 'utf8')).toContain('ai-plan');
  });
  it('preserves additional agent metadata and relocates bundled skill links', async () => {
    const { registry, userPath } = await setup();
    const bundled = (await registry.load()).agents[0];
    await registry.saveAgent({ ...bundled, instructions: 'Edited' });
    expect(await readFile(join(userPath, 'agents', `${bundled.id}.agent.md`), 'utf8')).toContain(
      'disable-model-invocation: true',
    );
    const original = (await registry.load()).skills.find((skill) => skill.id === 'ai-debug')!;
    await registry.saveSkill(original.id, original.content, {
      scope: 'user',
      expectedRevision: original.targets!.user.revision,
      sourceScope: original.source,
      sourceRevision: original.revision,
    });
    expect(await readFile(join(userPath, 'skills/ai-debug/SKILL.md'), 'utf8')).toContain(
      '../../feature-studio/kit/templates/debug.md',
    );
  });

  it('shares new and edited agents and skills between projects without writing to either project', async () => {
    const { root, userPath, registry } = await setup();
    const agent = (await registry.load()).agents[0];
    await registry.saveAgent({ ...agent, instructions: 'My global custom instructions' });
    await registry.saveSkill(
      'personal',
      '---\nname: Personal\ndescription: Method\n---\nMy method',
    );
    expect(await readdir(root)).toEqual([]);
    const other = new AgentRegistry(join(root, 'another-project'), resolve('defaults'), userPath);
    expect((await other.load()).agents.find((item) => item.id === agent.id)).toMatchObject({
      source: 'user',
      instructions: 'My global custom instructions',
    });
    expect((await other.load()).skills.find((item) => item.id === 'personal')).toMatchObject({
      source: 'user',
    });
    await other.saveAgent({
      ...(await other.load()).agents.find((item) => item.id === agent.id)!,
      instructions: 'Updated in another project',
    });
    expect((await registry.load()).agents.find((item) => item.id === agent.id)?.instructions).toBe(
      'Updated in another project',
    );
    expect(await readdir(root)).toEqual([]);
  });
});

describe('explicit profile scopes and concurrent saves', () => {
  it('edits both scopes, exposes all versions and preserves unknown metadata and bundled resources', async () => {
    const { registry, root, userPath } = await setup();
    const original = (await registry.load()).agents.find((a) => a.id === 'fs-dev')!;
    const bundledBefore = await readFile(original.path, 'utf8');
    await registry.saveAgent({ ...original, instructions: 'Personal body' });
    const personal = (await registry.load()).agents.find((a) => a.id === original.id)!;
    await registry.saveAgent(
      { ...personal, instructions: 'Project body\n\n```delivery-rules\ntypes: [fix]\n```' },
      {
        scope: 'workspace',
        expectedRevision: null,
        sourceScope: 'user',
        sourceRevision: personal.revision,
      },
    );
    let active = (await registry.load()).agents.find((a) => a.id === original.id)!;
    expect(active.source).toBe('workspace');
    expect(active.versions?.map((v) => v.source)).toEqual(['bundled', 'user', 'workspace']);
    expect(active.targets?.workspace.path).toBe(join(root, '.github/agents/fs-dev.agent.md'));
    expect(active.targets?.user.path).toBe(join(userPath, 'agents/fs-dev.agent.md'));
    await registry.saveAgent(
      { ...personal, instructions: 'Personal edit beneath project' },
      { scope: 'user', expectedRevision: active.targets!.user.revision },
    );
    active = (await registry.load()).agents.find((a) => a.id === original.id)!;
    expect(active.instructions).toContain('Project body');
    const current = active.versions!.find((v) => v.source === 'user')!;
    expect(current.instructions).toBe('Personal edit beneath project');
    expect(await readFile(original.path, 'utf8')).toBe(bundledBefore);
    expect(await readFile(active.path, 'utf8')).toContain('disable-model-invocation: true');
    await writeFile(
      active.path,
      (await readFile(active.path, 'utf8')).replace(
        'name:',
        '# Personal YAML comment\ncustom-property: [one, two] # Keep my annotation\nname:',
      ),
    );
    active = (await registry.load()).agents.find((a) => a.id === original.id)!;
    await registry.saveAgent(
      { ...active, nickname: 'Edited' },
      { scope: 'workspace', expectedRevision: active.revision! },
    );
    expect(await readFile(active.path, 'utf8')).toContain('custom-property:');
    expect(await readFile(active.path, 'utf8')).toContain('# Keep my annotation');
    expect(await readFile(active.path, 'utf8')).toContain('```delivery-rules');
  });
  it('saves complete skill frontmatter in both scopes and keeps project priority', async () => {
    const { registry, userPath } = await setup();
    const content =
      '---\nname: Custom\ndescription: Skill\nallowed-tools: [read]\nextra: {color: blue}\n---\n\n# Personal method\n';
    await registry.saveSkill('custom', content, { scope: 'user', expectedRevision: null });
    await registry.saveSkill('custom', content.replace('Personal', 'Project'), {
      scope: 'workspace',
      expectedRevision: null,
    });
    const skill = (await registry.load()).skills.find((s) => s.id === 'custom')!;
    expect(skill.source).toBe('workspace');
    expect(skill.versions).toHaveLength(2);
    await registry.saveSkill('custom', content.replace('Personal', 'Updated personal'), {
      scope: 'user',
      expectedRevision: skill.targets!.user.revision,
    });
    expect((await registry.load()).skills.find((s) => s.id === 'custom')?.content).toContain(
      'Project method',
    );
    expect(await readFile(join(userPath, 'skills/custom/SKILL.md'), 'utf8')).toBe(
      content.replace('Personal', 'Updated personal'),
    );
  });
  it('rejects stale saves across two registries, external changes and targets created after load', async () => {
    const { registry, root, userPath } = await setup();
    const other = new AgentRegistry(join(root, 'other'), resolve('defaults'), userPath);
    const initial = (await registry.load()).agents[0];
    await registry.saveAgent({ ...initial, instructions: 'Initial' });
    const first = (await registry.load()).agents.find((a) => a.id === initial.id)!;
    const second = (await other.load()).agents.find((a) => a.id === initial.id)!;
    await registry.saveAgent({ ...first, instructions: 'Winner' });
    await expect(other.saveAgent({ ...second, instructions: 'Lost update' })).rejects.toThrow(
      /changé/,
    );
    expect((await registry.load()).agents.find((a) => a.id === initial.id)?.instructions).toBe(
      'Winner',
    );
    const refreshed = (await registry.load()).agents.find((a) => a.id === initial.id)!;
    await writeFile(refreshed.path, (await readFile(refreshed.path, 'utf8')) + '\nExternal edit');
    await expect(
      registry.saveAgent({ ...refreshed, instructions: 'Replace external' }),
    ).rejects.toThrow(/changé/);
    await registry.saveSkill('new-skill', '---\nname: New\ndescription: x\n---\nWinner');
    await expect(
      other.saveSkill('new-skill', '---\nname: New\ndescription: x\n---\nLoser', {
        scope: 'user',
        expectedRevision: null,
      }),
    ).rejects.toThrow(/changé/);
    await expect(
      registry.saveAgent(
        { ...initial, id: initial.id, instructions: 'Create collision' },
        { scope: 'user', expectedRevision: null },
      ),
    ).rejects.toThrow(/changé/);
  });
  it('serializes overlapping global saves using an exclusive cross-instance lock', async () => {
    const { registry, root, userPath } = await setup();
    const other = new AgentRegistry(root, resolve('defaults'), userPath);
    const input = {
      id: 'race',
      name: 'Race',
      description: '',
      instructions: 'Winner',
      tools: ['read'],
      skills: [],
    };
    const result = await Promise.allSettled([
      registry.saveAgent(input),
      other.saveAgent({ ...input, instructions: 'Other winner' }),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await readdir(join(userPath, 'agents'))).toEqual(['race.agent.md']);
    const loaded = (await registry.load()).agents.find((a) => a.id === 'race')!;
    await registry.saveAgent({ ...loaded, instructions: 'Lock released' });
  });
  it('refuses project symlink and hardlink writes and preserves linked content', async () => {
    const { registry, root, userPath } = await setup();
    const original = (await registry.load()).agents[0];
    await mkdir(join(root, '.github/agents'), { recursive: true });
    const outside = join(userPath, 'outside.md');
    await writeFile(outside, 'Untouched');
    const target = join(root, '.github/agents', `${original.id}.agent.md`);
    await symlink(outside, target);
    await expect(
      registry.saveAgent(original, { scope: 'workspace', expectedRevision: null }),
    ).rejects.toThrow(/symbolique/);
    await rm(target);
    await link(outside, target);
    await expect(
      registry.saveAgent(original, { scope: 'workspace', expectedRevision: null }),
    ).rejects.toThrow(/physique/);
    expect(await readFile(outside, 'utf8')).toBe('Untouched');
  });
});
