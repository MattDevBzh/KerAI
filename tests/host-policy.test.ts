import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
  link,
  realpath,
  readdir,
  lstat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@github/copilot-sdk';
import type { RunInput, TestEvidence } from '../src/shared/types';
import { PolicyEngine, sha256, isSensitivePath } from '../src/host/PolicyEngine';
import { ToolHost, gitInfo } from '../src/host/ToolHost';
import { runProcess } from '../src/host/process';
import { WorkflowEngine } from '../src/core/workflow';
import { defaultSettings } from '../src/core/store';
import { inspectExistingChanges } from '../src/host/ExistingChanges';
import { canonicalCaseless } from '../src/host/UnicodeCaseFold';

const roots: string[] = [];
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-policy-')));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function git(root: string, ...args: string[]) {
  const result = await runProcess('git', args, root);
  if (result.code) throw new Error(result.stderr);
  return result.stdout;
}
async function gitRepo(root: string) {
  await git(root, 'init');
  await git(root, 'config', 'user.name', 'Tests');
  await git(root, 'config', 'user.email', 'tests@example.invalid');
}
function input(root: string, profile: 'read-only' | 'workspace-write' | 'tests'): RunInput {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'single',
      name: 'Single',
      description: '',
      icon: '',
      steps: [
        {
          id: 'run',
          name: 'Run',
          description: '',
          agentId: 'agent',
          skills: [],
          policy: profile,
          artifact: 'run.md',
          maxAttempts: 3,
          dependsOn: [],
        },
      ],
    },
    { title: 'Title', description: '' },
  );
  const attempt = engine.beginRun(feature.id, 'run');
  return {
    feature,
    step: feature.steps[0],
    attempt,
    agent: {
      id: 'agent',
      name: 'Agent',
      description: '',
      instructions: '',
      tools: ['read', 'search', 'edit', ...(profile === 'tests' ? ['execute'] : [])],
      skills: [],
      source: 'bundled',
      path: '',
    },
    skills: [],
    workspacePath: root,
    settings: structuredClone(defaultSettings),
  };
}
async function invoke(tools: Tool[], name: string, args: unknown) {
  const tool = tools.find((tool) => tool.name === name);
  if (!tool?.handler) throw new Error(`Missing tool ${name}`);
  return (await tool.handler(args, {
    sessionId: 'session',
    toolCallId: 'call',
    toolName: name,
    arguments: args,
  })) as { resultType: string; textResultForLlm: string };
}

describe('host file and command policy', () => {
  it('allows project Azure pipelines but protects CLI identities, caches and configuration', async () => {
    const root = await setup();
    const policy = new PolicyEngine(root, 'workspace-write', []);
    const pipeline = '.azure/GitflowPipeLines/Fork-PipeLines/Forks-TAG.yml';
    expect(isSensitivePath(pipeline)).toBe(false);
    await expect(policy.resolve(pipeline, true)).resolves.toBe(join(root, pipeline));
    for (const file of [
      '.azure/accessTokens.json',
      '.azure/msal_token_cache.bin',
      '.azure/msal_http_cache.bin',
      '.azure/service_principal_entries.json',
      '.azure/azureProfile.json',
      '.azure/personalAccessTokens',
      '.azure/config',
      '.azure/clouds.config',
      '.azure/az.json',
      '.azure/az.sess',
      '.azure/commands/run.log',
      '.azure/logs/run.txt',
      '.azure/telemetry/run.txt',
      '.azure/azuredevops/cli/credentialstore',
      '.azure/templates/.env',
      '.azure/scripts/credentials.json',
      '.azure/scripts/private.key',
      'nested/.AZURE/MSAL_TOKEN_CACHE.JSON.bak',
    ]) {
      expect(isSensitivePath(file)).toBe(true);
      expect(isSensitivePath(file.replaceAll('/', '\\'))).toBe(true);
      await expect(policy.resolve(file)).rejects.toThrow('sensible');
      await expect(policy.resolve(file, true)).rejects.toThrow('sensible');
    }
  });
  it('uses complete Unicode default case folding, including expansions and non-lowercase folds', () => {
    expect(canonicalCaseless('σ.ts')).toBe(canonicalCaseless('ς.ts'));
    expect(canonicalCaseless('ß.ts')).toBe(canonicalCaseless('SS.ts'));
    expect(canonicalCaseless('Ꭰ.ts')).toBe(canonicalCaseless('ꭰ.ts'));
    expect(canonicalCaseless('CAFÉ.ts')).toBe(canonicalCaseless('cafe\u0301.ts'));
    expect(canonicalCaseless('İ.ts')).not.toBe(canonicalCaseless('i.ts'));
  });
  it.each([
    ['σ.ts', 'ς.ts'],
    ['ß.ts', 'SS.ts'],
  ])('protects deleted Unicode filesystem aliases %s / %s', async (original, alias) => {
    const root = await setup();
    await writeFile(join(root, original), 'Human edit');
    const originalStat = await lstat(join(root, original));
    const aliasStat = await lstat(join(root, alias)).catch(() => undefined);
    const equivalent = aliasStat?.ino === originalStat.ino && aliasStat?.dev === originalStat.dev;
    const policy = new PolicyEngine(root, 'workspace-write', [], new Set([original]));
    await policy.initialize();
    if (equivalent) await expect(policy.resolve(alias, true)).rejects.toThrow(/Alias/);
    await rm(join(root, original));
    if (equivalent) {
      await expect(policy.assertWrite(alias)).rejects.toThrow(/protég|supprim/i);
      await expect(lstat(join(root, alias))).rejects.toThrow();
    } else {
      // This spelling is an independent legitimate new file on a sensitive filesystem.
      await writeFile(join(root, alias), 'Distinct legitimate file');
      await policy.recordRead(alias, 'Distinct legitimate file');
      await expect(policy.assertWrite(alias)).resolves.toBe(join(root, alias));
    }
    await expect(policy.assertWrite('無関係.ts')).resolves.toBe(join(root, '無関係.ts'));
  });
  it('blocks reserved-directory case aliases, including nonexistent write targets', async () => {
    const root = await setup();
    const policy = new PolicyEngine(root, 'workspace-write', []);
    for (const file of ['.Git/config', 'nested/Node_Modules/a.js', '.Feature-Studio/state.json'])
      await expect(policy.resolve(file)).rejects.toThrow(/sensible/);
    for (const file of ['.GitHub/workflows/ci.yml', '.VsCode/settings.json'])
      await expect(policy.resolve(file, true)).rejects.toThrow(/catalogue/);
    await mkdir(join(root, 'Source'), { recursive: true });
    await writeFile(join(root, 'Source/Code.ts'), 'Legitimate mixed case');
    await expect(policy.resolve('Source/Code.ts')).resolves.toBe(join(root, 'Source/Code.ts'));
    const tests = new PolicyEngine(root, 'tests', ['Tests']);
    await expect(tests.resolve('Tests/unit/New.test.ts', true)).resolves.toBe(
      join(root, 'Tests/unit/New.test.ts'),
    );
    await expect(tests.resolve('tests/unit/New.test.ts', true)).rejects.toThrow(/Tests/);
  });
  it('protects dirty existing and deleted aliases while distinguishing real case-sensitive files', async () => {
    const root = await setup();
    await writeFile(join(root, 'code.ts'), 'Human edit');
    const sensitive = await lstat(join(root, 'CODE.ts')).then(
      () => false,
      () => true,
    );
    const policy = new PolicyEngine(
      root,
      'workspace-write',
      [],
      new Set(['code.ts', 'deleted.ts']),
    );
    if (!sensitive) {
      await expect(policy.resolve('CODE.ts')).rejects.toThrow(/Alias/);
      await expect(policy.recordRead('CODE.ts', 'Human edit')).rejects.toThrow(/Alias/);
      await expect(policy.assertWrite('CODE.ts')).rejects.toThrow(/Alias|protégée/);
      await expect(policy.assertWrite('DELETED.ts')).rejects.toThrow(/protég|supprim/i);
    } else {
      await writeFile(join(root, 'CODE.ts'), 'Distinct legitimate file');
      await policy.recordRead('CODE.ts', 'Distinct legitimate file');
      await expect(policy.assertWrite('CODE.ts')).resolves.toBe(join(root, 'CODE.ts'));
      await expect(policy.assertWrite('DELETED.ts')).resolves.toBe(join(root, 'DELETED.ts'));
    }
    await policy.recordRead('code.ts', 'Human edit');
    await expect(policy.assertWrite('code.ts')).rejects.toThrow(/protégée/);
    expect(await readFile(join(root, 'code.ts'), 'utf8')).toBe('Human edit');
  });
  it('rejects traversal, secrets at every depth, symlinks and physical links for writes', async () => {
    const root = await setup();
    const policy = new PolicyEngine(root, 'workspace-write', []);
    for (const path of [
      '../escape',
      '/tmp/escape',
      'C:/escape',
      'src/../../escape',
      '.env',
      'nested/.npmrc',
      'nested/credentials.json',
      'a/private.key',
      '.git/config',
      '.feature-studio/state.json',
    ])
      await expect(policy.resolve(path)).rejects.toThrow();
    await symlink(tmpdir(), join(root, 'outside'));
    await expect(policy.resolve('outside/file')).rejects.toThrow(/symboliques/);
    await writeFile(join(root, 'original'), 'Original');
    await link(join(root, 'original'), join(root, 'hardlink'));
    await expect(policy.resolve('hardlink', true)).rejects.toThrow(/physique/);
  });
  it('requires a fresh read, protects dirty files, and accepts a matching owned hash', async () => {
    const root = await setup();
    await writeFile(join(root, 'clean.ts'), 'Initial');
    const policy = new PolicyEngine(root, 'workspace-write', []);
    await expect(policy.assertWrite('clean.ts')).rejects.toThrow(/Relis/);
    await policy.recordRead('clean.ts', 'Initial');
    await expect(policy.assertWrite('clean.ts')).resolves.toBe(join(root, 'clean.ts'));
    await writeFile(join(root, 'clean.ts'), 'Human edit');
    await expect(policy.assertWrite('clean.ts')).rejects.toThrow(/Relis/);
    const dirty = new PolicyEngine(root, 'workspace-write', [], new Set(['clean.ts']));
    await dirty.recordRead('clean.ts', 'Human edit');
    await expect(dirty.assertWrite('clean.ts')).rejects.toThrow(/protégée/);
    const owned = new PolicyEngine(root, 'workspace-write', [], new Set(['clean.ts']), {
      'clean.ts': sha256('Human edit'),
    });
    await owned.recordRead('clean.ts', 'Human edit');
    await expect(owned.assertWrite('clean.ts')).resolves.toBe(join(root, 'clean.ts'));
  });
  it('preserves a user deletion instead of recreating the dirty missing file', async () => {
    const root = await setup();
    const policy = new PolicyEngine(root, 'workspace-write', [], new Set(['deleted.ts']));
    await expect(policy.assertWrite('deleted.ts')).rejects.toThrow(/protég|supprim/i);
  });
  it('enforces readonly, test folder boundaries and command allowlisting', async () => {
    const root = await setup();
    const readonly = new PolicyEngine(root, 'read-only', ['tests']);
    await expect(readonly.resolve('tests/a.test.ts', true)).rejects.toThrow(/lecture seule/);
    const tests = new PolicyEngine(root, 'tests', ['tests']);
    await expect(tests.resolve('tests/unit/a.test.ts', true)).resolves.toBe(
      join(root, 'tests/unit/a.test.ts'),
    );
    for (const path of [
      'src/a.ts',
      'tests-other/a.ts',
      'tests/../src/a.ts',
      '.github/agents/hacker.agent.md',
    ])
      await expect(tests.resolve(path, true)).rejects.toThrow();
    const commands = [{ id: 'unit', name: 'Unit', command: 'node', args: ['--test'] }];
    expect(tests.assertCommand('unit', commands)).toEqual(commands[0]);
    expect(() => tests.assertCommand('unknown', commands)).toThrow(/autorisé/);
    expect(() => readonly.assertCommand('unit', commands)).toThrow(/réservées/);
  });
});

describe('host tools and Git boundaries', () => {
  it('reads and patches a tracked project pipeline under .azure with the existing policy guards', async () => {
    const root = await setup();
    await gitRepo(root);
    const file = '.azure/GitflowPipeLines/Fork-PipeLines/Forks-TAG.yml';
    await mkdir(join(root, '.azure/GitflowPipeLines/Fork-PipeLines'), { recursive: true });
    const source = 'trigger: none\nsteps: []\n';
    await writeFile(join(root, file), source);
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'Pipeline fixture');
    const tools = await new ToolHost(
      input(root, 'workspace-write'),
      {
        onEvent: () => {},
        onSession: () => {},
      },
      new AbortController().signal,
    ).createTools();
    const read = await invoke(tools, 'studio_read_file', { path: file });
    expect(read.resultType).toBe('success');
    expect(JSON.parse(read.textResultForLlm).content).toBe(source);
    const edit = await invoke(tools, 'studio_replace_text', {
      path: file,
      oldText: 'steps: []',
      newText: 'steps: [checkout: self]',
      expectedSha256: sha256(source),
    });
    expect(edit.resultType).toBe('success');
    expect(await readFile(join(root, file), 'utf8')).toContain('steps: [checkout: self]');
  });
  it('accepts Git precomposed names for decomposed filesystem entries, with grants and safe read spans', async () => {
    const root = await setup();
    await gitRepo(root);
    await git(root, 'config', 'core.precomposeUnicode', 'true');
    const physical = 'cafe\u0301.ts';
    const composed = 'café.ts';
    const source = 'first line\nsecond line\n';
    await writeFile(join(root, physical), 'Committed\n');
    const physicalStat = await lstat(join(root, physical));
    const composedStat = await lstat(join(root, composed)).catch(() => undefined);
    const equivalent =
      composedStat?.ino === physicalStat.ino && composedStat?.dev === physicalStat.dev;
    await git(root, 'add', '--', physical);
    await git(root, 'commit', '-m', 'Accented source');
    await writeFile(join(root, physical), source);
    const dirty = (await gitInfo(root)).dirty;
    const selected = [...dirty].find((name) => name.normalize('NFD') === physical)!;
    if (equivalent) expect(selected).toBe(composed);
    const data = input(root, 'workspace-write');
    data.launch = {
      initialContext: '',
      memoryIds: [],
      useProjectMemory: false,
      mcpServerIds: [],
      editableExistingFiles: [selected],
    };
    await inspectExistingChanges(data, dirty);
    expect(data.existingChangeGrants?.[selected]).toBe(sha256(source));
    const host = new ToolHost(data, { onEvent() {}, onSession() {} }, new AbortController().signal);
    const tools = await host.createTools();
    const read = await invoke(tools, 'studio_read_file', {
      path: selected,
      startLine: 1,
      endLine: 1,
    });
    expect(read.resultType).toBe('success');
    expect(JSON.parse(read.textResultForLlm).truncated).toBe(true);
    const alternate = selected === composed ? physical : composed;
    if (equivalent) {
      expect(
        (
          await invoke(tools, 'studio_write_file', {
            path: alternate,
            content: 'Lost unread content',
          })
        ).resultType,
      ).toBe('failure');
      expect(await readFile(join(root, physical), 'utf8')).toBe(source);
      expect(
        (
          await invoke(tools, 'studio_replace_text', {
            path: alternate,
            oldText: 'second line\n',
            newText: 'Unread line overwritten\n',
            expectedSha256: sha256(source),
          })
        ).resultType,
      ).toBe('failure');
    }
    expect((await invoke(tools, 'studio_read_file', { path: selected })).resultType).toBe(
      'success',
    );
    expect(
      (
        await invoke(tools, 'studio_write_file', {
          path: selected,
          content: 'Human edit preserved\nAgent addition\n',
        })
      ).resultType,
    ).toBe('success');
    expect(await readFile(join(root, physical), 'utf8')).toBe(
      'Human edit preserved\nAgent addition\n',
    );
    if (equivalent) {
      expect((await invoke(tools, 'studio_read_file', { path: alternate })).resultType).toBe(
        'success',
      );
      expect(
        (
          await invoke(tools, 'studio_write_file', {
            path: alternate,
            content: 'Human edit preserved\nSecond agent addition\n',
          })
        ).resultType,
      ).toBe('success');
      expect(Object.keys(host.fileHashes)).toEqual([composed]);
      data.attempt.fileHashes = { ...host.fileHashes };
      delete data.existingChangeGrants;
      const nextTools = await new ToolHost(
        data,
        { onEvent() {}, onSession() {} },
        new AbortController().signal,
      ).createTools();
      expect((await invoke(nextTools, 'studio_read_file', { path: composed })).resultType).toBe(
        'success',
      );
      expect(
        (
          await invoke(nextTools, 'studio_write_file', {
            path: physical,
            content: 'Human edit preserved\nNext attempt addition\n',
          })
        ).resultType,
      ).toBe('success');
      expect(await readFile(join(root, physical), 'utf8')).toBe(
        'Human edit preserved\nNext attempt addition\n',
      );
    }
  });
  it('requires a host grant, still requires reading and rejects later human edits to adopted files', async () => {
    const root = await setup();
    await gitRepo(root);
    await writeFile(join(root, 'existing.ts'), 'human code\n');
    const data = input(root, 'workspace-write');
    data.launch = {
      initialContext: '',
      memoryIds: [],
      useProjectMemory: false,
      mcpServerIds: [],
      editableExistingFiles: ['existing.ts'],
    };
    const unapproved = await new ToolHost(
      data,
      { onEvent() {}, onSession() {} },
      new AbortController().signal,
    ).createTools();
    await invoke(unapproved, 'studio_read_file', { path: 'existing.ts' });
    expect(
      (await invoke(unapproved, 'studio_write_file', { path: 'existing.ts', content: 'changed' }))
        .resultType,
    ).toBe('failure');
    await inspectExistingChanges(data, (await gitInfo(root)).dirty);
    const tools = await new ToolHost(
      data,
      { onEvent() {}, onSession() {} },
      new AbortController().signal,
    ).createTools();
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'existing.ts', content: 'changed' }))
        .resultType,
    ).toBe('failure');
    await writeFile(join(root, 'existing.ts'), 'later human edit\n');
    await invoke(tools, 'studio_read_file', { path: 'existing.ts' });
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'existing.ts', content: 'changed' }))
        .resultType,
    ).toBe('failure');
    expect(await readFile(join(root, 'existing.ts'), 'utf8')).toBe('later human edit\n');
    data.step.policy = 'read-only';
    await expect(inspectExistingChanges(data, (await gitInfo(root)).dirty)).rejects.toThrow(
      /édition non autorisée/,
    );
    data.step.policy = 'tests';
    await expect(inspectExistingChanges(data, (await gitInfo(root)).dirty)).rejects.toThrow(
      /dossiers de tests/,
    );
    data.step.policy = 'workspace-write';
    for (const path of ['../outside', '.env', 'C:/outside', 'missing.ts']) {
      data.launch.editableExistingFiles = [path];
      await expect(inspectExistingChanges(data, new Set([path]))).rejects.toThrow();
    }
  });
  it('serializes host writes behind running tests so proof observes a stable host version', async () => {
    const root = await setup();
    const data = input(root, 'tests');
    data.settings.testCommands = [
      {
        id: 'read',
        name: 'Read fixture',
        command: process.execPath,
        args: [
          '-e',
          "setTimeout(()=>console.log(require('fs').readFileSync('tests/code.ts','utf8')),80)",
        ],
      },
    ];
    const proofs: TestEvidence[] = [];
    const host = new ToolHost(
      data,
      {
        onEvent() {},
        onSession() {},
        onEvidence(proof) {
          proofs.push(proof);
        },
      },
      new AbortController().signal,
    );
    const tools = await host.createTools();
    await invoke(tools, 'studio_write_file', { path: 'tests/code.ts', content: 'before' });
    const running = invoke(tools, 'studio_run_test', { id: 'read' });
    const editing = invoke(tools, 'studio_write_file', { path: 'tests/code.ts', content: 'after' });
    const [result, write] = await Promise.all([running, editing]);
    expect(result.textResultForLlm).toContain('before');
    expect(write.resultType).toBe('success');
    expect(proofs[0]).toMatchObject({
      exitCode: 0,
      fileHashes: { 'tests/code.ts': sha256('before') },
    });
    expect(proofs[0].error).toBeUndefined();
    expect(await readFile(join(root, 'tests/code.ts'), 'utf8')).toBe('after');
  });
  it('uses chronological write ownership across a development correction and older test attempts', async () => {
    const root = await setup();
    await gitRepo(root);
    await mkdir(join(root, 'tests'));
    await writeFile(join(root, 'tests/code.ts'), 'C');
    const data = input(root, 'workspace-write');
    const first = {
      ...structuredClone(data.attempt),
      id: 'first',
      startedAt: '2026-01-01',
      fileHashes: { 'tests/code.ts': sha256('A') },
    };
    const second = {
      ...structuredClone(data.attempt),
      id: 'second',
      startedAt: '2026-01-02',
      fileHashes: { 'tests/code.ts': sha256('B') },
    };
    data.attempt.startedAt = '2026-01-03';
    data.attempt.fileHashes = { 'tests/code.ts': sha256('C') };
    data.feature.steps[0].attempts = [first, data.attempt];
    data.feature.steps.push({ ...structuredClone(data.step), id: 'tests', attempts: [second] });
    const host = new ToolHost(data, { onEvent() {}, onSession() {} }, new AbortController().signal);
    const tools = await host.createTools();
    await invoke(tools, 'studio_read_file', { path: 'tests/code.ts' });
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'tests/code.ts', content: 'D' }))
        .resultType,
    ).toBe('success');
  });
  it('records actual failing test output and marks files changed by a command as obsolete', async () => {
    const root = await setup();
    await writeFile(join(root, 'source.ts'), 'before');
    const data = input(root, 'tests');
    data.settings.testCommands = [
      {
        id: 'failing',
        name: 'Failing test',
        command: process.execPath,
        args: ['-e', "console.error('assertion failed'); process.exitCode=3"],
      },
      {
        id: 'mutating',
        name: 'Mutating test',
        command: process.execPath,
        args: ['-e', "require('fs').writeFileSync('source.ts','after')"],
      },
    ];
    const evidence: TestEvidence[] = [];
    const host = new ToolHost(
      data,
      {
        onEvent() {},
        onSession() {},
        onEvidence(proof) {
          evidence.push(proof);
        },
      },
      new AbortController().signal,
    );
    const tools = await host.createTools();
    await invoke(tools, 'studio_read_file', { path: 'source.ts' });
    await invoke(tools, 'studio_run_test', { id: 'failing' });
    expect(evidence[0]).toMatchObject({
      source: 'host',
      exitCode: 3,
      stderr: 'assertion failed\n',
      fileHashes: { 'source.ts': sha256('before') },
    });
    await invoke(tools, 'studio_run_test', { id: 'mutating' });
    expect(evidence[1].exitCode).toBe(0);
    expect(evidence[1].error).toMatch(/changé pendant/);
  });
  it('does not expose write or command tools to a readonly session', async () => {
    const root = await setup();
    const data = input(root, 'read-only');
    data.settings.testCommands.push({
      id: 'unit',
      name: 'Unit',
      command: 'node',
      args: ['--test'],
    });
    const host = new ToolHost(data, { onEvent() {}, onSession() {} }, new AbortController().signal);
    const tools = await host.createTools();
    expect(tools.map((t) => t.name)).not.toContain('studio_write_file');
    expect(tools.map((t) => t.name)).not.toContain('studio_replace_text');
    expect(tools.map((t) => t.name)).not.toContain('studio_run_test');
    expect((await invoke(tools, 'studio_read_file', { path: '.env' })).resultType).toBe('failure');
  });
  it('allows repeated writes by the same run and detects a human edit after read', async () => {
    const root = await setup();
    await gitRepo(root);
    const data = input(root, 'workspace-write');
    await writeFile(join(root, 'created.ts'), 'previous agent result');
    data.attempt.fileHashes = { 'created.ts': sha256('previous agent result') };
    const host = new ToolHost(data, { onEvent() {}, onSession() {} }, new AbortController().signal);
    const tools = await host.createTools();
    expect((await invoke(tools, 'studio_read_file', { path: 'created.ts' })).resultType).toBe(
      'success',
    );
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'created.ts', content: 'first' }))
        .resultType,
    ).toBe('success');
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'created.ts', content: 'second' }))
        .resultType,
    ).toBe('success');
    await writeFile(join(root, 'created.ts'), 'Human override');
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'created.ts', content: 'overwrite' }))
        .resultType,
    ).toBe('failure');
    expect(await readFile(join(root, 'created.ts'), 'utf8')).toBe('Human override');
  });
  it('preserves pre-existing untracked files and protects dirty deleted tracked files', async () => {
    const root = await setup();
    await gitRepo(root);
    await writeFile(join(root, 'tracked.ts'), 'Tracked');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'Fixture');
    await rm(join(root, 'tracked.ts'));
    await writeFile(join(root, 'human.ts'), 'Human work');
    const host = new ToolHost(
      input(root, 'workspace-write'),
      { onEvent() {}, onSession() {} },
      new AbortController().signal,
    );
    const tools = await host.createTools();
    await invoke(tools, 'studio_read_file', { path: 'human.ts' });
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'human.ts', content: 'agent' })).resultType,
    ).toBe('failure');
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'tracked.ts', content: 'recreated' }))
        .resultType,
    ).toBe('failure');
  });
  it('includes staged and unstaged safe diffs while excluding tracked nested secrets', async () => {
    const root = await setup();
    await gitRepo(root);
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'safe.ts'), 'Initial\n');
    await writeFile(join(root, 'config/credentials.json'), 'PRIVATE_BEFORE\n');
    await writeFile(join(root, '.npmrc'), 'PRIVATE_NPM_BEFORE\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'Fixture');
    await writeFile(join(root, 'safe.ts'), 'Staged\n');
    await git(root, 'add', 'safe.ts');
    await writeFile(join(root, 'safe.ts'), 'Final safe code\n');
    await writeFile(join(root, 'config/credentials.json'), 'PRIVATE_AFTER\n');
    await writeFile(join(root, '.npmrc'), 'PRIVATE_NPM_AFTER\n');
    const host = new ToolHost(
      input(root, 'read-only'),
      { onEvent() {}, onSession() {} },
      new AbortController().signal,
    );
    const tools = await host.createTools();
    const response = await invoke(tools, 'studio_git_diff', {});
    expect(response.resultType).toBe('success');
    expect(response.textResultForLlm).toContain('Final safe code');
    expect(response.textResultForLlm).not.toContain('PRIVATE_');
    expect(
      (await invoke(tools, 'studio_git_diff', { path: 'config/credentials.json' })).resultType,
    ).toBe('failure');
    expect((await gitInfo(root)).dirty).toContain('safe.ts');
  });
  it('rejects every tool call after cancellation', async () => {
    const root = await setup();
    const controller = new AbortController();
    const host = new ToolHost(
      input(root, 'workspace-write'),
      { onEvent() {}, onSession() {} },
      controller.signal,
    );
    const tools = await host.createTools();
    controller.abort();
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'new.ts', content: 'never written' }))
        .resultType,
    ).toBe('failure');
    await expect(readFile(join(root, 'new.ts'))).rejects.toThrow();
  });
  it('does not execute queued writes when cancellation arrives after tool dispatch', async () => {
    const root = await setup();
    const controller = new AbortController();
    const host = new ToolHost(
      input(root, 'workspace-write'),
      { onEvent() {}, onSession() {} },
      controller.signal,
    );
    const tools = await host.createTools();
    const first = invoke(tools, 'studio_write_file', { path: 'first.ts', content: 'cancelled' });
    const second = invoke(tools, 'studio_write_file', { path: 'second.ts', content: 'cancelled' });
    controller.abort();
    await Promise.all([first, second]);
    await expect(readFile(join(root, 'second.ts'))).rejects.toThrow();
  });
});

describe('local process lifecycle', () => {
  it('passes shell syntax as literal arguments rather than executing it', async () => {
    const root = await setup();
    const literal = '$(touch SHOULD_NOT_EXIST); echo unsafe';
    const result = await runProcess(
      process.execPath,
      ['-e', 'console.log(process.argv[1])', literal],
      root,
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(literal);
    await expect(readFile(join(root, 'SHOULD_NOT_EXIST'))).rejects.toThrow();
  });
  it.skipIf(process.platform === 'win32')(
    'terminates descendants that ignore SIGTERM when the parent closes early',
    async () => {
      const root = await setup();
      const pidPath = join(root, 'descendant.pid');
      const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
      let pid = 0;
      try {
        await expect(
          runProcess(process.execPath, ['-e', script, pidPath], root, { timeoutMs: 800 }),
        ).rejects.toThrow(/Délai/);
        pid = Number(await readFile(pidPath, 'utf8'));
        await new Promise((resolve) => setTimeout(resolve, 1800));
        let alive = false;
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          /* expected: process group terminated */
        }
        expect(alive).toBe(false);
      } finally {
        if (pid) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* already terminated */
          }
        }
      }
    },
  );
});

describe('large source files and exact partial edits', () => {
  const largeSource =
    '\uFEFF' +
    Array.from({ length: 6000 }, (_, i) =>
      i === 3200
        ? 'public void SyncUsers() { ImportUsers(); }\r\n'
        : `// Ligne ${i + 1} : données à conserver éè 🧪 ${'x'.repeat(40)}\r\n`,
    ).join('');
  async function fixture(
    content = largeSource,
    profile: 'workspace-write' | 'tests' | 'read-only' = 'workspace-write',
  ) {
    const root = await setup();
    await writeFile(join(root, 'Job.cs'), content);
    const data = input(root, profile);
    const controller = new AbortController();
    const host = new ToolHost(data, { onEvent() {}, onSession() {} }, controller.signal);
    const tools = await host.createTools();
    return { root, host, tools, controller };
  }
  async function page(tools: Tool[], args: Record<string, unknown>) {
    const result = await invoke(tools, 'studio_read_file', { path: 'Job.cs', ...args });
    expect(result.resultType).toBe('success');
    return JSON.parse(result.textResultForLlm);
  }
  const patch = (hash: string, oldText = 'ImportUsers();', newText = 'ImportUsers(userIds);') => ({
    path: 'Job.cs',
    oldText,
    newText,
    expectedSha256: hash,
  });

  it('finds a method beyond 256KB, reads its lines, patches it and preserves every other byte', async () => {
    const { root, host, tools } = await fixture();
    expect(Buffer.byteLength(largeSource)).toBeGreaterThan(256_000);
    const found = await invoke(tools, 'studio_search', { path: 'Job.cs', query: 'SyncUsers' });
    expect(found.resultType).toBe('success');
    expect(JSON.parse(found.textResultForLlm).matches[0]).toMatchObject({
      path: 'Job.cs',
      line: 3201,
    });
    const read = await page(tools, { startLine: 3200, endLine: 3202 });
    expect(read).toMatchObject({
      startLine: 3200,
      endLine: 3202,
      totalLines: 6000,
      truncated: true,
      sha256: sha256(largeSource),
    });
    expect(read.content).toContain('SyncUsers');
    expect(read.content.split('\r\n')).toHaveLength(4);
    expect((await invoke(tools, 'studio_replace_text', patch(read.sha256))).resultType).toBe(
      'success',
    );
    const expected = largeSource.replace('ImportUsers();', 'ImportUsers(userIds);');
    expect(await readFile(join(root, 'Job.cs'))).toEqual(Buffer.from(expected));
    expect(host.changedFiles.has('Job.cs')).toBe(true);
    expect(host.fileHashes['Job.cs']).toBe(sha256(expected));
    expect(await readdir(root)).toEqual(['Job.cs']);
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'Job.cs', content: 'truncated' }))
        .resultType,
    ).toBe('failure');
    expect(
      (
        await invoke(
          tools,
          'studio_replace_text',
          patch(sha256(expected), 'ImportUsers(userIds);', 'Again();'),
        )
      ).resultType,
    ).toBe('failure');
    const updated = await page(tools, { startLine: 3201, endLine: 3201 });
    expect(
      (
        await invoke(
          tools,
          'studio_replace_text',
          patch(updated.sha256, 'ImportUsers(userIds);', 'Again();'),
        )
      ).resultType,
    ).toBe('success');
  });

  it('paginates within a bounded response and never allows a partial read to replace the entire file', async () => {
    const { root, tools } = await fixture();
    const first = await page(tools, {});
    expect(first).toMatchObject({
      startLine: 1,
      endLine: 200,
      nextStartLine: 201,
      truncated: true,
    });
    expect(Buffer.byteLength(first.content)).toBeLessThanOrEqual(64_000);
    const next = await page(tools, { startLine: first.nextStartLine });
    expect(next.startLine).toBe(201);
    expect(next.sha256).toBe(first.sha256);
    expect(
      (await invoke(tools, 'studio_write_file', { path: 'Job.cs', content: first.content }))
        .resultType,
    ).toBe('failure');
    expect((await invoke(tools, 'studio_replace_text', patch(first.sha256))).resultType).toBe(
      'failure',
    );
    expect(await readFile(join(root, 'Job.cs'), 'utf8')).toBe(largeSource);
  });

  it('rejects stale hashes, missing reads, absent and ambiguous blocks, without modifying bytes', async () => {
    const source = 'same\nsame\nunique\n';
    const { root, tools } = await fixture(source);
    expect(
      (await invoke(tools, 'studio_replace_text', patch(sha256(source), 'unique', 'changed')))
        .resultType,
    ).toBe('failure');
    const read = await page(tools, {});
    for (const request of [
      patch('0'.repeat(64), 'unique', 'changed'),
      patch(read.sha256, 'same', 'changed'),
      patch(read.sha256, 'absent', 'changed'),
    ])
      expect((await invoke(tools, 'studio_replace_text', request)).resultType).toBe('failure');
    await writeFile(join(root, 'Job.cs'), 'Human edit\n' + source);
    expect(
      (await invoke(tools, 'studio_replace_text', patch(read.sha256, 'unique', 'changed')))
        .resultType,
    ).toBe('failure');
    expect(await readFile(join(root, 'Job.cs'), 'utf8')).toBe('Human edit\n' + source);
  });

  it('preserves literal replacement text, including dollar substitution syntax, and a missing final newline', async () => {
    const { root, tools } = await fixture('prefix\r\ntarget\r\nsuffix');
    const read = await page(tools, { startLine: 2, endLine: 2 });
    expect(
      (await invoke(tools, 'studio_replace_text', patch(read.sha256, 'target', '$& $1 $$ é🧪')))
        .resultType,
    ).toBe('success');
    expect(await readFile(join(root, 'Job.cs'), 'utf8')).toBe('prefix\r\n$& $1 $$ é🧪\r\nsuffix');
  });

  it('serializes two concurrent patches and refuses the second stale version', async () => {
    const { root, tools } = await fixture('unique');
    const read = await page(tools, {});
    const results = await Promise.all([
      invoke(tools, 'studio_replace_text', patch(read.sha256, 'unique', 'first')),
      invoke(tools, 'studio_replace_text', patch(read.sha256, 'unique', 'second')),
    ]);
    expect(results.map((r) => r.resultType)).toEqual(['success', 'failure']);
    expect(await readFile(join(root, 'Job.cs'), 'utf8')).toBe('first');
    expect(await readdir(root)).toEqual(['Job.cs']);
  });

  it('caps multibyte output by bytes and reads adjacent pages without gaps', async () => {
    const source = ('🧪é'.repeat(2000) + '\r\n').repeat(10);
    const { tools } = await fixture(source);
    const first = await page(tools, { startLine: 1, endLine: 10 });
    expect(Buffer.byteLength(first.content)).toBeLessThanOrEqual(64_000);
    expect(first.nextStartLine).toBe(6);
    const next = await page(tools, { startLine: first.nextStartLine, endLine: 10 });
    expect(first.content + next.content).toBe(source);
    expect(next.nextStartLine).toBeUndefined();
    expect(
      (
        await invoke(tools, 'studio_write_file', {
          path: 'Job.cs',
          content: 'replacement after complete paged read',
        })
      ).resultType,
    ).toBe('success');
  });

  it('retains dirty file protection and test-only scope for partial edits', async () => {
    const root = await setup();
    await gitRepo(root);
    await writeFile(join(root, 'Job.cs'), 'human work');
    const host = new ToolHost(
      input(root, 'workspace-write'),
      { onEvent() {}, onSession() {} },
      new AbortController().signal,
    );
    const tools = await host.createTools();
    const read = await page(tools, {});
    expect(
      (await invoke(tools, 'studio_replace_text', patch(read.sha256, 'human', 'agent'))).resultType,
    ).toBe('failure');
    const test = await fixture('production', 'tests');
    const production = await page(test.tools, {});
    expect(
      (
        await invoke(
          test.tools,
          'studio_replace_text',
          patch(production.sha256, 'production', 'modified'),
        )
      ).resultType,
    ).toBe('failure');
    expect(await readFile(join(root, 'Job.cs'), 'utf8')).toBe('human work');
    expect(await readFile(join(test.root, 'Job.cs'), 'utf8')).toBe('production');
  });

  it('rejects binary, invalid UTF-8, oversized files and overlong lines explicitly', async () => {
    const { root, tools } = await fixture();
    for (const bytes of [
      Buffer.from([0]),
      Buffer.from([0xc3, 0x28]),
      Buffer.alloc(4 * 1024 * 1024 + 1, 65),
      Buffer.alloc(64_001, 65),
    ]) {
      await writeFile(join(root, 'Job.cs'), bytes);
      expect((await invoke(tools, 'studio_read_file', { path: 'Job.cs' })).resultType).toBe(
        'failure',
      );
    }
    for (const range of [
      { startLine: 0 },
      { startLine: 3, endLine: 1 },
      { startLine: 1, endLine: 2001 },
      { startLine: 99999 },
    ])
      expect(
        (await invoke(tools, 'studio_read_file', { path: 'Job.cs', ...range })).resultType,
      ).toBe('failure');
    const search = await invoke(tools, 'studio_search', { path: '.', query: 'AAA' });
    expect(search.resultType).toBe('success');
    expect(JSON.parse(search.textResultForLlm).matches[0].text.length).toBeLessThanOrEqual(400);
  });

  it('searches directories, reports skipped files and supports continuation inside a single file', async () => {
    const { root, tools } = await fixture('match\n'.repeat(102));
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1]));
    const first = JSON.parse(
      (await invoke(tools, 'studio_search', { path: 'Job.cs', query: 'match' })).textResultForLlm,
    );
    expect(first.matches).toHaveLength(100);
    expect(first.next).toMatchObject({ path: 'Job.cs', startLine: 101 });
    const next = JSON.parse(
      (await invoke(tools, 'studio_search', { ...first.next, query: 'match' })).textResultForLlm,
    );
    expect(next.matches.map((m: { line: number }) => m.line)).toEqual([101, 102]);
    expect(next.truncated).toBe(false);
    const absent = JSON.parse(
      (await invoke(tools, 'studio_search', { path: '.', query: 'absent' })).textResultForLlm,
    );
    expect(absent.skipped).toEqual([expect.objectContaining({ path: 'binary.bin' })]);
    expect((await invoke(tools, 'studio_read_file', { path: '.env' })).resultType).toBe('failure');
  });

  it('does not write after cancellation and exposes patching only to agents with edit capability', async () => {
    const { root, tools, controller } = await fixture('unique');
    const read = await page(tools, {});
    controller.abort();
    expect(
      (await invoke(tools, 'studio_replace_text', patch(read.sha256, 'unique', 'changed')))
        .resultType,
    ).toBe('failure');
    expect(await readFile(join(root, 'Job.cs'), 'utf8')).toBe('unique');
    const data = input(root, 'workspace-write');
    data.agent.tools = ['read', 'search'];
    const limited = await new ToolHost(
      data,
      { onEvent() {}, onSession() {} },
      new AbortController().signal,
    ).createTools();
    expect(limited.map((t) => t.name)).not.toContain('studio_replace_text');
  });
});
