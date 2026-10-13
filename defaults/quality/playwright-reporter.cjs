/** Playwright custom reporter. This module has no dependencies beyond Node. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
class FeatureStudioReporter {
  constructor() { this.cases = []; this.attachments = []; this.startedAt = new Date().toISOString(); this.pending = Promise.resolve(); this.errors = []; }
  onBegin() { this.startedAt = new Date().toISOString(); }
  onError(error) { this.errors.push((error.message || String(error)).slice(0, 4000)); }
  onTestEnd(test, result) {
    this.pending = this.pending.then(() => this.collect(test, result)).catch(error => this.onError(error));
  }
  async collect(test, result) {
    const key = `case-${crypto.createHash('sha256').update(`${test.id}:${result.retry}`).digest('hex').slice(0, 20)}`;
    const attachmentIds = [];
    const reportPath = process.env.FEATURE_STUDIO_QUALITY_REPORT;
    if (!reportPath) return;
    const artifactDir = path.join(path.dirname(reportPath), 'artifacts');
    await fs.mkdir(artifactDir, { recursive: true });
    for (const attachment of result.attachments.slice(0, 30)) {
      const ext = attachment.contentType === 'image/png' ? '.png' : attachment.contentType === 'image/jpeg' ? '.jpg' : attachment.name === 'trace' && attachment.contentType === 'application/zip' ? '.zip' : undefined;
      if (!ext) continue;
      const id = `media-${crypto.randomUUID()}`;
      let bytes;
      if (attachment.path) {
        const stat = await fs.lstat(attachment.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) continue;
        bytes = await fs.readFile(attachment.path);
      } else bytes = attachment.body;
      if (!bytes || bytes.length > 16 * 1024 * 1024) continue;
      await fs.writeFile(path.join(artifactDir, `${id}${ext}`), bytes, { flag: 'wx', mode: 0o600 });
      this.attachments.push({ id, name: attachment.name.slice(0, 160), kind: ext === '.zip' ? 'trace' : 'screenshot', path: `artifacts/${id}${ext}` });
      attachmentIds.push(id);
    }
    const steps = [];
    const visit = (items) => { for (const step of items) { if (steps.length < 100) steps.push(step.title.slice(0, 4000)); visit(step.steps || []); } };
    visit(result.steps);
    const annotations = test.annotations || [];
    const note = type => annotations.find(a => a.type === type)?.description?.slice(0, 4000);
    this.cases.push({
      id: key, title: test.titlePath().join(' › ').slice(0, 400),
      criterionIds: annotations.filter(a => a.type === 'criterion' && a.description).map(a => a.description.slice(0, 128)).slice(0, 50),
      // Unexpected success is a failed counterexample oracle, never evidence of acceptance.
      status: result.status === 'skipped' ? 'skipped' : result.status === 'passed' && test.expectedStatus === 'passed' ? 'passed' : 'failed',
      steps, errors: result.errors.slice(0, 20).map(e => (e.message || String(e)).slice(0, 4000)),
      expected: note('expected'), actual: note('actual'),
      reproduction: annotations.filter(a => a.type === 'reproduction' && a.description).map(a => a.description.slice(0, 4000)).slice(0, 30),
      attachmentIds,
    });
  }
  async onEnd(result) {
    await this.pending;
    const env = process.env;
    if (!env.FEATURE_STUDIO_QUALITY_REPORT || !env.FEATURE_STUDIO_QUALITY_NONCE) throw new Error('Feature Studio host evidence environment missing. Run the approved quality command from a test agent.');
    // Framework/global failures must remain visible even when no individual test reports them.
    if (this.errors.length || (result.status !== 'passed' && !this.cases.some(c => c.status === 'failed'))) this.cases.push({ id: 'runner-error', title: 'Playwright runner', criterionIds: [], status: 'failed', steps: [], errors: [`Runner status: ${result.status}`, ...this.errors].slice(0, 20), attachmentIds: [] });
    const report = {
      version: 1, nonce: env.FEATURE_STUDIO_QUALITY_NONCE,
      featureId: env.FEATURE_STUDIO_QUALITY_FEATURE, attemptId: env.FEATURE_STUDIO_QUALITY_ATTEMPT,
      commandId: env.FEATURE_STUDIO_QUALITY_COMMAND, kind: env.FEATURE_STUDIO_QUALITY_KIND,
      runner: 'playwright', startedAt: this.startedAt, finishedAt: new Date().toISOString(),
      cases: this.cases, attachments: this.attachments,
    };
    await fs.mkdir(path.dirname(env.FEATURE_STUDIO_QUALITY_REPORT), { recursive: true });
    await fs.writeFile(env.FEATURE_STUDIO_QUALITY_REPORT, JSON.stringify(report), { mode: 0o600 });
  }
}
module.exports = FeatureStudioReporter;
