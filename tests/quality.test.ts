import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  prepareQualityRun,
  collectQualityEvidence,
  resolveQualityAttachment,
} from '../src/host/QualityRunner';
import { qualityCommandSchema } from '../src/core/qualitySchemas';
import { runProcess } from '../src/host/process';
import type { TestEvidence } from '../src/shared/types';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-quality-'));
  dirs.push(root);
  const storage = path.join(root, 'private');
  const context = await prepareQualityRun({
    workspacePath: root,
    storagePath: storage,
    featureId: 'f1',
    attemptId: 'a1',
    commandId: 'visual',
    criterionIds: ['C1'],
    config: { kind: 'visual', reportPath: '.feature-studio/quality/report.json' },
  });
  const proof: TestEvidence = {
    id: randomUUID(),
    source: 'host',
    commandId: 'visual',
    name: 'visual',
    command: 'node',
    args: [],
    startedAt: context.startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    stdout: '',
    stderr: '',
    truncated: false,
    fileHashes: { 'app.ts': 'abc' },
  };
  const report = {
    version: 1,
    nonce: context.nonce,
    featureId: 'f1',
    attemptId: 'a1',
    commandId: 'visual',
    kind: 'visual',
    runner: 'playwright',
    startedAt: context.startedAt,
    finishedAt: context.startedAt,
    cases: [
      {
        id: 'journey',
        title: 'Local journey',
        criterionIds: ['C1'],
        status: 'passed',
        steps: ['Open', 'Assert'],
        errors: [] as string[],
        attachmentIds: ['image'],
      },
    ],
    attachments: [
      { id: 'image', name: 'Screenshot', kind: 'screenshot', path: 'artifacts/screen.png' },
    ],
  };
  const image = path.join(root, '.feature-studio/quality/artifacts/screen.png');
  await mkdir(path.dirname(image), { recursive: true });
  await writeFile(
    image,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6htEAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const save = () => writeFile(context.env.FEATURE_STUDIO_QUALITY_REPORT, JSON.stringify(report));
  await save();
  return { root, storage, context, proof, report, image, save };
}
describe('host quality evidence', () => {
  it('copies verified media privately and binds criteria to host provenance', async () => {
    const f = await fixture();
    const result = await collectQualityEvidence(f.context, f.proof);
    expect(result.status).toBe('passed');
    expect(result.evidenceId).toBe(f.proof.id);
    expect(result.cases[0].criterionIds).toEqual(['C1']);
    const stored = await resolveQualityAttachment(f.storage, result, 'image');
    expect(await readFile(stored)).toEqual(await readFile(f.image));
    expect(stored.startsWith(await realpath(f.storage))).toBe(true);
    await writeFile(stored, 'tampered');
    await expect(resolveQualityAttachment(f.storage, result, 'image')).rejects.toThrow('modifiée');
  });
  it.each(['nonce', 'attemptId', 'commandId', 'featureId'])(
    'rejects stale or mismatched %s',
    async (field) => {
      const f = await fixture();
      (f.report as Record<string, unknown>)[field] = field === 'nonce' ? randomUUID() : 'other';
      await f.save();
      expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('invalid');
    },
  );
  it('rejects missing and malformed reports without claiming pass', async () => {
    const f = await fixture();
    await writeFile(f.context.env.FEATURE_STUDIO_QUALITY_REPORT, '{');
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('invalid');
    await rm(f.context.env.FEATURE_STUDIO_QUALITY_REPORT);
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('unavailable');
  });
  it.each([
    '../secret.png',
    '/tmp/image.png',
    'artifacts/../screen.png',
    'artifacts\\screen.png',
    'artifacts/screen.svg',
  ])('rejects unsafe attachment %s', async (unsafe) => {
    const f = await fixture();
    f.report.attachments[0].path = unsafe;
    await f.save();
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('invalid');
  });
  it('rejects symlinked sources and directories', async () => {
    const f = await fixture();
    await rm(f.image);
    await symlink(path.join(f.root, 'secret.png'), f.image);
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('invalid');
    await rm(f.image);
    await rm(path.dirname(f.image), { recursive: true });
    await symlink(f.storage, path.dirname(f.image));
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('invalid');
  });
  it('rejects duplicate identifiers, missing references and oversized files', async () => {
    const f = await fixture();
    f.report.attachments.push({ ...f.report.attachments[0] });
    await f.save();
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('invalid');
    f.report.attachments.pop();
    f.report.cases[0].attachmentIds.push('missing');
    await f.save();
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('invalid');
    f.report.cases[0].attachmentIds.pop();
    await f.save();
    await writeFile(f.image, Buffer.alloc(16 * 1024 * 1024 + 1));
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('invalid');
  });
  it('does not accept process failure, errors or skipped cases as pass', async () => {
    const f = await fixture();
    expect((await collectQualityEvidence(f.context, { ...f.proof, exitCode: 1 })).status).toBe(
      'failed',
    );
    expect(
      (await collectQualityEvidence(f.context, { ...f.proof, error: 'Files changed' })).status,
    ).toBe('failed');
    f.report.cases[0].status = 'skipped';
    await f.save();
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('incomplete');
  });
  it('rejects unknown criterion references instead of accepting a passed case', async () => {
    const f = await fixture();
    f.report.cases[0].criterionIds = ['C1', 'UNKNOWN'];
    await f.save();
    const result = await collectQualityEvidence(f.context, f.proof);
    expect(result.status).toBe('invalid');
    expect(result.error).toContain('critère inconnu');
  });
  it('freezes allowed criterion ids and permits infrastructure failure without a criterion', async () => {
    const f = await fixture();
    const allowed = ['C1'];
    const context = await prepareQualityRun({
      workspacePath: f.root,
      storagePath: f.storage,
      featureId: 'f1',
      attemptId: 'a1',
      commandId: 'visual',
      criterionIds: allowed,
      config: f.context.config,
    });
    allowed.push('LATER');
    expect(context.criterionIds).toEqual(['C1']);
    expect(Object.isFrozen(context.criterionIds)).toBe(true);
    f.report.nonce = context.nonce;
    f.report.startedAt = context.startedAt;
    f.report.finishedAt = context.startedAt;
    f.report.cases[0].criterionIds = ['LATER'];
    await f.save();
    const proof = { ...f.proof, finishedAt: new Date().toISOString() };
    expect((await collectQualityEvidence(context, proof)).status).toBe('invalid');
    f.report.cases[0].criterionIds = [];
    f.report.cases[0].status = 'failed';
    f.report.cases[0].errors = ['Browser failed to start'];
    await f.save();
    const failed = await collectQualityEvidence(context, proof);
    expect(failed.status).toBe('failed');
    expect(failed.cases[0].errors).toEqual(['Browser failed to start']);
  });
  it('requires an exact dedicated report path', () => {
    for (const reportPath of [
      'report.json',
      '.feature-studio/quality/../report.json',
      '.feature-studio/quality//report.json',
      '.feature-studio/quality/.hidden.json',
    ])
      expect(qualityCommandSchema.safeParse({ kind: 'visual', reportPath }).success).toBe(false);
  });
  it('does not call an unlinked or screenshot-free visual journey complete', async () => {
    const f = await fixture();
    f.report.cases[0].criterionIds = [];
    await f.save();
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('incomplete');
    f.report.cases[0].criterionIds = ['C1'];
    f.report.cases[0].attachmentIds = [];
    await f.save();
    expect((await collectQualityEvidence(f.context, f.proof)).status).toBe('incomplete');
  });
  it('collects real Chromium journey screenshot, trace and criterion from the bundled reporter', async () => {
    const f = await fixture();
    const project = process.cwd();
    const requirePath = path.join(project, 'node_modules/@playwright/test/index.js');
    const reporter = path.join(project, 'defaults/quality/playwright-reporter.cjs');
    await writeFile(
      path.join(f.root, 'playwright.config.cjs'),
      `module.exports={testDir:'.',testMatch:'real.spec.cjs',workers:1,retries:0,reporter:[['line'],[${JSON.stringify(reporter)}]],use:{headless:true,trace:'on',screenshot:'on'}}`,
    );
    const html = `<label>Name<input aria-label="Name" /></label><button onclick="document.querySelector('output').textContent=document.querySelector('input').value">Save</button><output></output>`;
    await writeFile(
      path.join(f.root, 'real.spec.cjs'),
      `const {test,expect}=require(${JSON.stringify(requirePath)});test('criterion with screenshot',async({page},info)=>{info.annotations.push({type:'criterion',description:'C1'});await test.step('Render local form',async()=>page.setContent(${JSON.stringify(html)}));await test.step('Save typed name',async()=>{await page.getByRole('textbox',{name:'Name'}).fill('Matt');await page.getByRole('button',{name:'Save'}).click();await expect(page.locator('output')).toHaveText('Matt');});});`,
    );
    const run = await runProcess(
      process.execPath,
      [
        path.join(project, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        path.join(f.root, 'playwright.config.cjs'),
      ],
      f.root,
      { env: f.context.env, timeoutMs: 30000 },
    );
    expect(run.code, run.stderr + run.stdout).toBe(0);
    const result = await collectQualityEvidence(f.context, {
      ...f.proof,
      finishedAt: new Date().toISOString(),
    });
    expect(result.status, result.error).toBe('passed');
    expect(result.cases[0].criterionIds).toEqual(['C1']);
    expect(result.cases[0].steps.join(' ')).toContain('Save typed name');
    expect(result.attachments.some((a) => a.kind === 'screenshot')).toBe(true);
    expect(result.attachments.some((a) => a.kind === 'trace')).toBe(true);
  }, 45000);
});
