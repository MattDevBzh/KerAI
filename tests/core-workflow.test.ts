import { describe, expect, it } from 'vitest';
import { WorkflowEngine, validateWorkflow } from '../src/core/workflow';
import type { RunResult, Workflow } from '../src/shared/types';

const step = (id: string, dependsOn: string[] = []) => ({
  id,
  name: id,
  description: '',
  agentId: 'agent',
  policy: 'read-only' as const,
  skills: [],
  maxAttempts: 3,
  artifact: `${id}.md`,
  dependsOn,
});
const workflow: Workflow = {
  id: 'feature',
  name: 'Feature',
  description: '',
  icon: '',
  steps: [step('specs'), step('plan', ['specs']), step('dev', ['plan']), step('parallel')],
};
const result = (content = 'Livrable'): RunResult => ({ content, questions: [], changedFiles: [] });
function setup() {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(workflow, { title: 'Feature', description: 'Objectif' });
  return { engine, feature, id: feature.id };
}
function complete(engine: WorkflowEngine, id: string, stepId: string) {
  engine.beginRun(id, stepId);
  engine.finishRun(id, stepId, result());
  engine.approveStep(id, stepId);
}

describe('workflow transitions', () => {
  it('requires approvals between dependencies, and only completes after every step', () => {
    const { engine, id, feature } = setup();
    expect(() => engine.beginRun(id, 'plan')).toThrow(/préalables/);
    engine.beginRun(id, 'specs');
    expect(feature.status).toBe('running');
    expect(() => engine.beginRun(id, 'parallel')).toThrow(/en cours/);
    engine.finishRun(id, 'specs', result());
    expect(feature.status).toBe('attention');
    expect(() => engine.beginRun(id, 'plan')).toThrow(/préalables/);
    engine.approveStep(id, 'specs');
    complete(engine, id, 'plan');
    complete(engine, id, 'dev');
    expect(feature.status).toBe('attention');
    complete(engine, id, 'parallel');
    expect(feature.status).toBe('completed');
  });
  it('keeps a question unanswered until it receives a real answer and reruns with history', () => {
    const { engine, id } = setup();
    const first = engine.beginRun(id, 'specs');
    engine.setSession(id, 'specs', 'session');
    engine.finishRun(id, 'specs', { ...result(), questions: [{ id: 'audience', text: 'Qui ?' }] });
    expect(() => engine.approveStep(id, 'specs')).toThrow();
    expect(() => engine.beginRun(id, 'specs', '', true)).toThrow(/questions/);
    expect(() => engine.answerQuestions(id, 'specs', { unknown: 'x' })).toThrow(/inconnue/);
    engine.answerQuestions(id, 'specs', { audience: 'Matt' });
    const next = engine.beginRun(id, 'specs', '', true);
    expect(next.id).not.toBe(first.id);
    expect(next.sessionId).toBe('session');
    expect(next.answers.audience).toBe('Matt');
    expect(next.artifact?.content).toBe('Livrable');
    expect(first.questions).toHaveLength(1);
    expect(first.status).toBe('waiting_input');
    engine.finishRun(id, 'specs', result());
    engine.approveStep(id, 'specs');
  });
  it('refuses blank artifacts, retains outcomes and enforces max attempts', () => {
    const { engine, id } = setup();
    engine.beginRun(id, 'specs');
    engine.finishRun(id, 'specs', result(' '));
    expect(() => engine.approveStep(id, 'specs')).toThrow(/non vide/);
    engine.saveArtifact(id, 'specs', 'Modifié');
    engine.approveStep(id, 'specs');
    engine.beginRun(id, 'specs');
    engine.failRun(id, 'specs', 'Erreur CLI');
    engine.beginRun(id, 'specs');
    engine.cancelRun(id);
    expect(engine.getStep(id, 'specs').attempts.map((a) => a.status)).toEqual([
      'approved',
      'failed',
      'cancelled',
    ]);
    expect(() => engine.beginRun(id, 'specs')).toThrow(/maximal/);
  });
  it('rejects duplicated and prototype property question IDs before finishing the run', () => {
    const { engine, id } = setup();
    engine.beginRun(id, 'specs');
    for (const questions of [
      [{ id: '__proto__', text: 'Bad' }],
      [
        { id: 'q', text: 'One' },
        { id: 'q', text: 'Two' },
      ],
    ])
      expect(() => engine.finishRun(id, 'specs', { ...result(), questions })).toThrow(/invalides/);
    expect(engine.getStep(id, 'specs').status).toBe('running');
    engine.finishRun(id, 'specs', result());
  });
  it('invalidates all transitive descendants without erasing history or independent branches', () => {
    const { engine, id } = setup();
    for (const stepId of ['specs', 'plan', 'dev', 'parallel']) complete(engine, id, stepId);
    engine.beginRun(id, 'specs');
    expect(engine.getFeature(id).steps.map((s) => s.status)).toEqual([
      'running',
      'stale',
      'stale',
      'approved',
    ]);
    expect(engine.getStep(id, 'dev').attempts[0].artifact?.content).toBe('Livrable');
    engine.interruptRun(id, 'specs');
    expect(engine.getStep(id, 'specs').status).toBe('interrupted');
    expect(() => engine.finishRun(id, 'specs', result())).toThrow(/tourne/);
  });
  it('invalidates approved artifacts after editing or changing agent configuration', () => {
    const { engine, id } = setup();
    complete(engine, id, 'specs');
    complete(engine, id, 'plan');
    engine.saveArtifact(id, 'specs', 'Nouvelle spec');
    expect(engine.getStep(id, 'plan').status).toBe('stale');
    engine.approveStep(id, 'specs');
    engine.configureStep(id, 'specs', { agentId: 'new', model: 'actual-cli-id', skills: [] });
    expect(engine.getStep(id, 'specs').status).toBe('stale');
    expect(engine.getStep(id, 'specs').attempts[0].approvedAt).toBeTruthy();
    engine.archiveFeature(id, true);
    expect(() => engine.beginRun(id, 'specs')).toThrow(/archivée/);
  });
  it('raises max attempts without invalidating a waiting question or blocking its session resume', () => {
    const { engine, id } = setup();
    const step = engine.getStep(id, 'specs');
    step.maxAttempts = 1;
    engine.beginRun(id, 'specs');
    engine.setSession(id, 'specs', 'question-session');
    engine.finishRun(id, 'specs', { ...result(), questions: [{ id: 'q', text: 'Choix ?' }] });
    engine.answerQuestions(id, 'specs', { q: 'Réponse' });
    expect(() => engine.beginRun(id, 'specs', '', true)).toThrow(/maximal/);
    engine.configureStep(id, 'specs', {
      agentId: step.agentId,
      model: '',
      reasoning: '',
      skills: [...step.skills],
      maxAttempts: 2,
    });
    expect(step.status).toBe('waiting_input');
    expect(step.maxAttempts).toBe(2);
    const next = engine.beginRun(id, 'specs', '', true);
    expect(next.sessionId).toBe('question-session');
    expect(next.answers.q).toBe('Réponse');
  });
  it('validates max attempts against history, retains approvals for a limit change and invalidates selection changes', () => {
    const { engine, id } = setup();
    complete(engine, id, 'specs');
    complete(engine, id, 'plan');
    const step = engine.getStep(id, 'specs'),
      selection = {
        agentId: step.agentId,
        model: step.model,
        reasoning: step.reasoning,
        skills: [...step.skills],
      };
    for (const maxAttempts of [0, 101, 1.5])
      expect(() => engine.configureStep(id, 'specs', { ...selection, maxAttempts })).toThrow(
        /maximum/,
      );
    engine.configureStep(id, 'specs', { ...selection, maxAttempts: 1 });
    expect(step.status).toBe('approved');
    expect(engine.getStep(id, 'plan').status).toBe('approved');
    engine.configureStep(id, 'specs', { ...selection, maxAttempts: 4, agentId: 'changed' });
    expect(step.status).toBe('stale');
    expect(engine.getStep(id, 'plan').status).toBe('stale');
    engine.beginRun(id, 'specs');
    engine.cancelRun(id);
    expect(() => engine.configureStep(id, 'specs', { ...selection, maxAttempts: 1 })).toThrow(
      /tentatives/,
    );
  });
});
describe('strict workflow DAG validation', () => {
  it('preserves output when only run confirmation changes, and invalidates context/MCP changes', () => {
    const { engine, id } = setup();
    complete(engine, id, 'specs');
    complete(engine, id, 'plan');
    const specs = engine.getStep(id, 'specs'),
      selection = {
        agentId: specs.agentId,
        model: specs.model,
        reasoning: specs.reasoning,
        skills: [...specs.skills],
      };
    engine.configureStep(id, 'specs', { ...selection, askBeforeRun: true });
    expect(specs.status).toBe('approved');
    expect(engine.getStep(id, 'plan').status).toBe('approved');
    engine.configureStep(id, 'specs', {
      ...selection,
      initialContext: 'A revised user story',
      mcpServerIds: ['server'],
    });
    expect(specs.status).toBe('stale');
    expect(engine.getStep(id, 'plan').status).toBe('stale');
    engine.configureStep(id, 'specs', selection);
    expect(specs.initialContext).toBe('A revised user story');
    expect(specs.mcpServerIds).toEqual(['server']);
    expect(specs.askBeforeRun).toBe(true);
  });
  it('rejects unknown keys, duplicate IDs, missing dependencies and cycles', () => {
    expect(() => validateWorkflow({ ...workflow, unexpected: true })).toThrow();
    expect(() => validateWorkflow({ ...workflow, steps: [step('a'), step('a')] })).toThrow(
      /dupliquée/,
    );
    expect(() => validateWorkflow({ ...workflow, steps: [step('a', ['missing'])] })).toThrow(
      /inconnue/,
    );
    expect(() =>
      validateWorkflow({ ...workflow, steps: [step('a', ['b']), step('b', ['a'])] }),
    ).toThrow(/Cycle/);
    expect(() =>
      validateWorkflow({ ...workflow, steps: [{ ...step('a'), artifact: '../secret.md' }] }),
    ).toThrow();
  });
  it('accepts unsorted acyclic dependencies and starts the first available step', () => {
    const engine = new WorkflowEngine();
    const feature = engine.createFeature(
      { ...workflow, steps: [step('b', ['a']), step('a')] },
      { title: 'Title', description: '' },
    );
    expect(feature.activeStepId).toBe('a');
  });
});
