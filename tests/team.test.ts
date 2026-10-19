import { describe, expect, it } from 'vitest';
import {
  agentStep,
  assertTeamOrder,
  effectiveTeamModel,
  insertTeam,
  instantiateTeam,
  moveTeamStep,
  orderedAgents,
  orderTeam,
  removeTeamStep,
  teamLocked,
} from '../src/shared/team';
import { demoState } from '../webview/demo';
import { WorkflowEngine } from '../src/core/workflow';
import { finalValidationReady } from '../src/shared/collaboration';
import { parseMessage } from '../src/host/messages';
import { inheritTeamProfiles, resolveAgentProfile } from '../src/shared/agentInheritance';

describe('feature team composition', () => {
  it('inherits the live solo profile and only keeps explicit team model/reasoning overrides', () => {
    const agent = {
      ...structuredClone(demoState.agents[0]),
      model: 'original',
      reasoning: 'high',
      skills: ['live-skill'],
      policy: 'read-only' as const,
    };
    const solo = agentStep(agent);
    expect(solo.model).toBeUndefined();
    expect(solo.reasoning).toBeUndefined();
    expect(solo.skills).toEqual([]);
    agent.model = 'updated';
    agent.reasoning = 'medium';
    agent.skills = ['changed-skill'];
    expect(resolveAgentProfile(solo, agent)).toMatchObject({
      model: 'updated',
      reasoning: 'medium',
      skills: ['changed-skill'],
    });
    const [member] = inheritTeamProfiles(
      [{ ...solo, skills: ['stale-copy'], model: 'team-model', reasoning: '' }],
      [agent],
    );
    expect(resolveAgentProfile(member, agent)).toMatchObject({
      model: 'team-model',
      reasoning: 'medium',
      skills: ['changed-skill'],
    });
    expect(resolveAgentProfile({ ...member, model: ' ', reasoning: 'low' }, agent)).toMatchObject({
      model: 'updated',
      reasoning: 'low',
    });
    const state = structuredClone(demoState);
    state.agents = [agent];
    expect(effectiveTeamModel(solo, state.features[0], state)).toMatchObject({
      modelId: 'updated',
      reasoning: 'medium',
    });
  });
  it('copies a complete team twice without identity, artifact or dependency collisions', () => {
    const template = structuredClone(demoState.workflows[0]);
    const before = structuredClone(template);
    const first = instantiateTeam(template.steps),
      second = instantiateTeam(template.steps);
    const combined = insertTeam(first, second, first.length);
    expect(combined).toHaveLength(template.steps.length * 2);
    expect(new Set(combined.map((step) => step.id)).size).toBe(combined.length);
    expect(new Set(combined.map((step) => step.artifact)).size).toBe(combined.length);
    for (const [index, step] of combined.entries())
      expect(step.dependsOn).toEqual(index ? [combined[index - 1].id] : []);
    combined[0].skills.push('local-only');
    expect(template).toEqual(before);
  });
  it('reorders a linear journey and reconnects prerequisites when removing a member', () => {
    const steps = instantiateTeam(demoState.workflows[0].steps);
    const reordered = moveTeamStep(steps, 2, 0);
    expect(reordered[0].agentId).toBe(steps[2].agentId);
    expect(reordered[0].dependsOn).toEqual([]);
    const removed = removeTeamStep(steps, steps[1].id);
    expect(removed[1].dependsOn).toEqual([steps[0].id]);
    expect(() => assertTeamOrder(removed)).not.toThrow();
  });
  it('preserves a fork/join graph and rejects a move before a prerequisite', () => {
    const graph = demoState.workflows[0].steps.slice(0, 4).map((step, i) => ({
      ...step,
      id: `s${i}`,
      dependsOn: i === 0 ? [] : i === 3 ? ['s1', 's2'] : ['s0'],
    }));
    const ordered = orderTeam([graph[3], graph[2], graph[0], graph[1]]);
    expect(ordered.map((step) => step.id)).toEqual(['s0', 's2', 's1', 's3']);
    expect(() => moveTeamStep(graph, 3, 0)).toThrow('préalables');
    const incoming = instantiateTeam(graph);
    const before = agentStep(demoState.agents[0]),
      after = agentStep(demoState.agents[1]);
    after.dependsOn = [before.id];
    const joined = insertTeam([before, after], incoming, 1);
    expect(joined[1].dependsOn).toEqual([before.id]);
    expect(joined[4].dependsOn).toEqual([incoming[1].id, incoming[2].id]);
    expect(joined[5].dependsOn).toContain(incoming[3].id);
    expect(() => assertTeamOrder(joined)).not.toThrow();
    expect(removeTeamStep(graph, 's1')[2].dependsOn).toEqual(['s0', 's2']);
  });
  it('allows many interventions and a solo profile repeated without granting write access implicitly', () => {
    const steps = Array.from({ length: 150 }, () => agentStep(demoState.agents[0]));
    expect(new Set(steps.map((step) => step.id)).size).toBe(150);
    expect(steps.every((step) => step.policy === 'read-only')).toBe(true);
    expect(
      parseMessage({
        type: 'saveFeatureTeam',
        featureId: 'f',
        requestId: 'r',
        expectedRevision: 0,
        steps,
      }),
    ).toMatchObject({ steps });
    expect(() =>
      parseMessage({
        type: 'saveFeatureTeam',
        featureId: 'f',
        requestId: 'r',
        expectedRevision: 0,
        steps: [{ ...steps[0], attempts: [] }],
      }),
    ).toThrow();
  });
  it('ranks favorites without mutating the catalog or execution order, and resolves budget priority', () => {
    const state = structuredClone(demoState),
      original = state.agents.map((agent) => agent.id);
    const favorite = state.agents.at(-1)!;
    expect(orderedAgents(state.agents, [favorite.id])[0].id).toBe(favorite.id);
    expect(state.agents.map((agent) => agent.id)).toEqual(original);
    const feature = state.features[0],
      step = feature.steps[0];
    step.model = 'own-model';
    step.reasoning = 'low';
    feature.budget = { modelProfile: 'quality', maxRuns: 10, maxPromptChars: 100000 };
    state.settings.modelProfiles = { quality: { model: 'budget-model', reasoning: 'high' } };
    expect(effectiveTeamModel(step, feature, state)).toMatchObject({
      model: 'budget-model',
      reasoning: 'high',
      profile: 'quality',
    });
  });
  it('keeps empty features in draft and remembers the lock after a failed attempt', () => {
    const engine = new WorkflowEngine();
    const blank = engine.createFeature(undefined, { title: 'Blank', description: '' });
    engine.refreshFeatureStatus(blank.id);
    expect(blank.steps).toEqual([]);
    expect(blank.status).toBe('draft');
    expect(finalValidationReady(blank)).toBe(false);
    const ready = engine.createFeature(demoState.workflows[0], { title: 'Ready', description: '' });
    expect(teamLocked(ready)).toBe(false);
    engine.beginRun(ready.id, ready.steps[0].id);
    engine.interruptRun(ready.id, ready.steps[0].id);
    expect(teamLocked(ready)).toBe(true);
    expect(ready.teamLockedAt).toBeTruthy();
  });
});
