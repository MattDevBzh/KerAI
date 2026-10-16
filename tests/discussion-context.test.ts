import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { reportDiscussionSource } from '../src/host/DiscussionContext';
import { SessionArchive } from '../src/host/SessionArchive';
import { WorkflowEngine } from '../src/core/workflow';
import type { AgentProfile, Attempt } from '../src/shared/types';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'discussion-context-'));
  roots.push(root);
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'w',
      name: 'W',
      description: '',
      icon: '',
      steps: [
        {
          id: 's',
          name: 'Plan',
          description: 'Cadrer',
          agentId: 'a',
          policy: 'read-only',
          skills: [],
          maxAttempts: 3,
          artifact: 'plan.md',
          dependsOn: [],
        },
      ],
    },
    { title: 'Feature', description: 'Original need' },
  );
  const step = feature.steps[0];
  const attempt: Attempt = {
    id: 'a1',
    startedAt: new Date().toISOString(),
    status: 'awaiting_review',
    model: 'actual-model',
    feedback: '',
    logs: [],
    questions: [],
    answers: {},
    changedFiles: [],
    artifact: { name: 'plan.md', content: 'Report', updatedAt: new Date().toISOString() },
  };
  step.attempts.push(attempt);
  const agent: AgentProfile = {
    id: 'a',
    name: 'Agent original',
    description: '',
    instructions: 'Original instructions',
    tools: [],
    skills: [],
    source: 'user',
    path: '',
  };
  const archive = await SessionArchive.create(root, feature.id, 1000000);
  const trace = (type: string, data: unknown, attemptId = attempt.id) =>
    archive.append({
      id: randomUUID(),
      at: new Date().toISOString(),
      type,
      attemptId,
      data: JSON.stringify(data),
    });
  return { feature, step, attempt, agent, archive, trace };
}
describe('archived report context', () => {
  it('reassembles large launch records and keeps actual model, reasoning, tool results and answers', async () => {
    const f = await fixture();
    f.trace('host.launch', {
      agent: f.agent,
      prompt: 'selected-skill\n' + 'x'.repeat(40000),
      execution: { model: 'requested-model', reasoning: 'high' },
    });
    f.trace('sdk.tool.execution_complete', { result: 'Historical file contents' });
    f.trace('sdk.assistant.message', { content: 'Other attempt' }, 'unrelated');
    f.attempt.questions.push({ id: 'q', text: 'La couleur ?' });
    f.attempt.answers.q = 'Bleue';
    await f.archive.flush();
    const source = await reportDiscussionSource(f.feature, f.step, f.attempt, f.archive);
    expect(source).toMatchObject({
      model: 'actual-model',
      reasoning: 'high',
      agent: { name: 'Agent original' },
      output: 'Report',
      warnings: [],
    });
    expect(source.context).toContain('selected-skill');
    expect(source.context).toContain('Historical file contents');
    expect(source.context).toContain('Bleue');
    expect(source.context).not.toContain('Other attempt');
  });
  it('includes the previous attempt when a Copilot session was resumed', async () => {
    const f = await fixture();
    f.attempt.sessionId = 'sdk';
    f.step.attempts.unshift({ ...f.attempt, id: 'prior' });
    f.trace('host.launch', { agent: f.agent, prompt: 'Previous context' }, 'prior');
    f.trace('sdk.tool.execution_complete', { result: 'Previous read' }, 'prior');
    f.trace('host.launch', {
      agent: f.agent,
      prompt: 'Resume context',
      execution: {},
      resumeSessionId: 'sdk',
    });
    await f.archive.flush();
    const source = await reportDiscussionSource(f.feature, f.step, f.attempt, f.archive);
    expect(source.context).toContain('Previous context');
    expect(source.context).toContain('Previous read');
    expect(source.warnings).toEqual([]);
  });
  it('labels legacy and bounded context instead of claiming complete recovery', async () => {
    const f = await fixture();
    f.trace('host.launch', { agent: f.agent, prompt: 'Original context' });
    for (let i = 0; i < 6; i++) f.trace('sdk.tool.execution_complete', { data: 'z'.repeat(22000) });
    await f.archive.flush();
    const source = await reportDiscussionSource(f.feature, f.step, f.attempt, f.archive);
    expect(source.warnings.join(' ')).toContain('raisonnement');
    expect(source.warnings.join(' ')).toContain('omise');
    expect(source.context).toContain('Original context');
    expect(source.output).toBe('Report');
  });
  it('never substitutes a current profile when no original launch exists or a report is still running', async () => {
    const f = await fixture();
    await expect(reportDiscussionSource(f.feature, f.step, f.attempt, f.archive)).rejects.toThrow(
      'contexte archivé',
    );
    f.attempt.status = 'running';
    await expect(reportDiscussionSource(f.feature, f.step, f.attempt, f.archive)).rejects.toThrow(
      'Attendez',
    );
  });
});
