import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StudioHub, type HubEntry } from '../src/host/StudioHub';
import { StudioService } from '../src/host/StudioService';
import { ProjectCatalog } from '../src/host/ProjectCatalog';
import { Store } from '../src/core/store';
import { startupDiagnostics } from '../src/host/StartupDiagnostics';
import { runProcess } from '../src/host/process';
import { selectionContext } from '../src/host/CodeSelection';
import { sha256 } from '../src/host/PolicyEngine';
import { demoState } from '../webview/demo';
import { EventEmitter } from 'node:events';

const roots: string[] = [],
  disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kerai-startup-')));
  roots.push(root);
  return root;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function entry(project: HubEntry['project']): HubEntry {
  const state = structuredClone(demoState);
  state.features = [{ ...state.features[0], id: project!.id, projects: undefined }];
  const service = Object.assign(new EventEmitter(), {
    state,
    snapshot: () => structuredClone(state),
    dispose: vi.fn(async () => {}),
  });
  return {
    project,
    service: service as unknown as StudioService,
    devops: { dispose: vi.fn(async () => {}) } as unknown as HubEntry['devops'],
  };
}
it('makes the active project usable while another is blocked and routes its session after loading', async () => {
  const root = await directory(),
    gate = deferred();
  await Promise.all(['a', 'b', 'c', 'd'].map((name) => mkdir(join(root, name))));
  const catalog = new ProjectCatalog(join(root, 'catalog'));
  const projects = await catalog.add(['a', 'b', 'c', 'd'].map((name) => join(root, name)));
  await catalog.select([projects[0].id]);
  let concurrent = 0,
    maximum = 0;
  const hub = new StudioHub(
    catalog,
    async (project) => {
      if (project!.id !== projects[0].id) {
        concurrent++;
        maximum = Math.max(maximum, concurrent);
        await gate.promise;
        concurrent--;
      }
      if (project!.id === projects[2].id) throw new Error('Projet indisponible');
      return entry(project);
    },
    false,
    false,
  );
  disposers.push(() => hub.dispose());
  await hub.initialize();
  expect(hub.snapshot()?.features.map((f) => f.id)).toEqual([projects[0].id]);
  expect(hub.snapshot()?.projectCatalog?.partial).toBe(true);
  let routed = false;
  const routing = hub.activateFeature(projects[1].id).then(() => {
    routed = true;
  });
  await Promise.resolve();
  expect(routed).toBe(false);
  gate.resolve();
  await routing;
  await hub.waitForProjects();
  expect(maximum).toBeLessThanOrEqual(2);
  expect((await hub.current()).project?.id).toBe(projects[1].id);
  expect(hub.snapshot()?.projectCatalog?.loading?.[projects[2].id].status).toBe('error');
  expect(hub.snapshot()?.features).toHaveLength(3);
});
it('closing during background initialization disposes loaded entries and does not start queued projects', async () => {
  const root = await directory(),
    gate = deferred();
  const catalog = new ProjectCatalog(join(root, 'catalog'));
  await Promise.all(['a', 'b', 'c', 'd'].map((name) => mkdir(join(root, name))));
  const projects = await catalog.add(['a', 'b', 'c', 'd'].map((name) => join(root, name)));
  await catalog.select([projects[0].id]);
  const created: HubEntry[] = [];
  const hub = new StudioHub(
    catalog,
    async (project) => {
      if (project!.id !== projects[0].id) await gate.promise;
      const item = entry(project);
      created.push(item);
      return item;
    },
    false,
    false,
  );
  await hub.initialize();
  const closing = hub.dispose();
  gate.resolve();
  await closing;
  expect(created.length).toBeLessThanOrEqual(3);
  expect(hub.entries.size).toBe(0);
  for (const item of created) expect(item.service.dispose).toHaveBeenCalledOnce();
});
it('initialization reads Git identity without status, diffs or untracked inventories', async () => {
  const root = await directory();
  await runProcess('git', ['init', '-b', 'main'], root);
  await writeFile(join(root, 'human.txt'), 'untracked human work');
  const start = startupDiagnostics.snapshot().length;
  const service = new StudioService(
    root,
    resolve('defaults'),
    new Store(join(root, 'storage')),
    () => true,
  );
  disposers.push(() => service.dispose());
  await service.initialize();
  const commands = startupDiagnostics
    .snapshot()
    .slice(start)
    .filter((row) => row.stage.startsWith('git.process'))
    .map((row) => row.stage);
  expect(commands).toContain('git.process.symbolic-ref');
  for (const forbidden of ['git.process.status', 'git.process.diff', 'git.process.ls-files'])
    expect(commands).not.toContain(forbidden);
  expect(service.state.workspace.branch).toBe('main');
  expect(service.state.workspace.canIsolate).toBe(false); // no HEAD, still protected
  expect(JSON.stringify(startupDiagnostics.snapshot().slice(start))).not.toContain(root);
});
it('keeps quoted code frozen, identifies changed sources and rejects another project', async () => {
  const root = await directory(),
    other = await directory();
  const file = join(root, 'source.ts');
  const text = 'const value = "\\n";';
  await writeFile(file, text);
  const selection = { path: file, text, hash: sha256(text), startLine: 1, endLine: 1 };
  expect(await selectionContext(selection, [root])).toContain(text);
  await writeFile(file, 'changed');
  expect(await selectionContext(selection, [root])).toContain('le fichier a changé');
  await expect(selectionContext(selection, [other])).rejects.toThrow('autre projet');
});
