import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AgentRegistry } from '../src/core/registry';
import { WorkflowEngine } from '../src/core/workflow';
import { CatalogueDeletionService } from '../src/host/CatalogueDeletionService';
import { KitService } from '../src/host/KitService';
import { WorkshopService } from '../src/host/WorkshopService';
import { decodeWorkshopArchive } from '../src/host/WorkshopArchive';
import { agentDeletionBlockers } from '../src/shared/catalogueDeletion';
import type { Feature } from '../src/shared/types';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const profile =
  '---\nname: Personnel\ndescription: Test\ntools: [read]\nskills: []\n---\n\nRelire.\n';
async function put(root: string, path: string, content: string) {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'catalogue-delete-'));
  roots.push(root);
  const registry = new AgentRegistry(
    join(root, 'project'),
    resolve('defaults'),
    join(root, 'user'),
  );
  const other = new AgentRegistry(join(root, 'other'), resolve('defaults'), registry.userPath);
  await mkdir(registry.workspacePath);
  await mkdir(other.workspacePath);
  await mkdir(registry.userPath);
  await put(registry.userPath, 'agents/personal.agent.md', profile);
  await put(registry.workspacePath, '.github/agents/personal.agent.md', profile + '\nProjet un.');
  await put(other.workspacePath, '.github/agents/personal.agent.md', profile + '\nProjet deux.');
  const features: Feature[] = [];
  const service = new CatalogueDeletionService(registry, async () => ({
    registries: [registry, other],
    features,
  }));
  const workflow = (await registry.load()).workflows.find((w) => w.id === 'single')!;
  const session = (id = 'personal') =>
    new WorkflowEngine().createFeature(
      { ...workflow, steps: workflow.steps.map((step) => ({ ...step, agentId: id })) },
      { title: 'Session protégée', description: 'Test' },
    );
  return { root, registry, other, features, service, session };
}
describe('suppression définitive dans l’atelier', () => {
  it('deletes an agent whose valid identifier exceeds the kit identifier limit', async () => {
    const f = await fixture(),
      id = `agent-${'a'.repeat(100)}`;
    await put(f.registry.userPath, `agents/${id}.agent.md`, profile);
    await f.service.apply((await f.service.preview({ kind: 'agent', id })).token);
    expect((await f.registry.load()).agents.some((agent) => agent.id === id)).toBe(false);
    await expect(
      readFile(join(f.registry.userPath, `agents/${id}.agent.md`)),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('blocks unfinished sessions, including archived drafts, pending teams and historical executions', async () => {
    const f = await fixture(),
      session = f.session();
    session.archived = true;
    f.features.push(session);
    expect((await f.service.preview({ kind: 'agent', id: 'personal' })).canDelete).toBe(false);
    session.steps[0].agentId = 'fs-dev';
    session.pendingTeam = {
      expectedRevision: 0,
      steps: [{ ...session.steps[0], agentId: 'personal' }],
    };
    expect(agentDeletionBlockers(f.features, ['personal'])).toEqual(['Session protégée']);
    delete session.pendingTeam;
    session.teamHistory = [
      {
        revision: 0,
        at: new Date().toISOString(),
        steps: [{ ...session.steps[0], agentId: 'personal' }],
      },
    ];
    expect(agentDeletionBlockers(f.features, ['personal'])).toHaveLength(1);
    session.status = 'completed';
    expect(agentDeletionBlockers(f.features, ['personal'])).toEqual([]);
  });
  it('removes every editable agent version across projects, dependent teams and masks supplied fallback', async () => {
    const f = await fixture();
    const workflow = (await f.registry.load()).workflows.find((w) => w.id === 'single')!;
    await f.registry.saveWorkflow({
      ...workflow,
      id: 'personal-team',
      steps: workflow.steps.map((step) => ({ ...step, agentId: 'personal' })),
    });
    const completed = f.session();
    completed.status = 'completed';
    f.features.push(completed);
    const preview = await f.service.preview({ kind: 'agent', id: 'personal' });
    expect(preview.canDelete).toBe(true);
    expect(preview.workflows).toContain('personal-team');
    await f.service.apply(preview.token);
    for (const [root, path] of [
      [f.registry.userPath, 'agents/personal.agent.md'],
      [f.registry.workspacePath, '.github/agents/personal.agent.md'],
      [f.other.workspacePath, '.github/agents/personal.agent.md'],
    ])
      await expect(readFile(join(root, path))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.other.load()).agents.some((agent) => agent.id === 'personal')).toBe(false);
    expect(f.features[0]).toBe(completed);
    const supplied = await f.service.preview({ kind: 'agent', id: 'fs-dev' });
    await f.service.apply(supplied.token);
    expect(
      (
        await new AgentRegistry(
          f.registry.workspacePath,
          resolve('defaults'),
          f.registry.userPath,
        ).load()
      ).agents.some((agent) => agent.id === 'fs-dev'),
    ).toBe(false);
    const archive = decodeWorkshopArchive(await new WorkshopService(f.registry).exportArchive());
    expect(Object.keys(archive.files).some((path) => path.endsWith('/fs-dev.agent.md'))).toBe(
      false,
    );
  });
  it('rechecks sessions immediately before deletion and never acts on an obsolete preview', async () => {
    const f = await fixture(),
      preview = await f.service.preview({ kind: 'agent', id: 'personal' });
    f.features.push(f.session());
    await expect(f.service.apply(preview.token)).rejects.toThrow(/sessions non terminées/);
    expect(await readFile(join(f.registry.userPath, 'agents/personal.agent.md'), 'utf8')).toBe(
      profile,
    );
    f.features.length = 0;
    await put(f.registry.userPath, 'agents/personal.agent.md', profile + '\nÉdition récente.');
    await expect(f.service.apply(preview.token)).rejects.toThrow(/catalogue a changé/);
  });
  it('blocks an entire kit when any of its agents is used, then removes it and its exclusive profiles', async () => {
    const f = await fixture(),
      kits = new KitService(f.registry);
    await kits.install((await kits.preview(await kits.preset('devops'))).token);
    const kit = (await kits.catalog()).find((kit) => kit.metadata.id === 'devops')!;
    const agent = kit.nodes.find((node) => node.kind === 'agent')!;
    f.features.push(f.session(agent.id));
    expect(
      (await f.service.preview({ kind: 'kit', id: 'devops', source: 'bundled' })).canDelete,
    ).toBe(false);
    f.features[0].status = 'completed';
    const preview = await f.service.preview({ kind: 'kit', id: 'devops', source: 'bundled' });
    expect(preview.agents).toContain(agent.id);
    await f.service.apply(preview.token);
    expect((await kits.catalog()).some((kit) => kit.metadata.id === 'devops')).toBe(false);
    expect((await f.registry.load()).agents.some((profile) => profile.id === agent.id)).toBe(false);
    await expect(
      readFile(join(f.registry.userPath, `agents/${agent.id}.agent.md`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.features[0].steps[0].agentId).toBe(agent.id);
  });
  it('removes a saved kit while preserving profiles shared with another kit', async () => {
    const f = await fixture(),
      kits = new KitService(f.registry);
    await put(
      f.registry.userPath,
      'agents/second.agent.md',
      profile.replace('name: Personnel', 'name: Second'),
    );
    const one = await kits.compose(
      { id: 'one', name: 'Premier', description: 'Test', version: '1' },
      ['agent:personal'],
    );
    const two = await kits.compose(
      { id: 'two', name: 'Second', description: 'Test', version: '1' },
      ['agent:personal', 'agent:second'],
    );
    await kits.remember(one);
    await kits.remember(two);
    const entry = (await kits.catalog()).find((kit) => kit.metadata.id === 'one')!;
    const preview = await f.service.preview({ kind: 'kit', id: entry.storageId!, source: 'saved' });
    expect(preview.agents).toEqual([]);
    expect(preview.shared).toContain('Personnel');
    await f.service.apply(preview.token);
    expect((await kits.catalog()).some((kit) => kit.metadata.id === 'one')).toBe(false);
    expect((await kits.catalog()).some((kit) => kit.metadata.id === 'two')).toBe(true);
    expect((await f.registry.load()).agents.some((agent) => agent.id === 'personal')).toBe(true);
  });
});
