import { describe, expect, it } from 'vitest';
import { sessionHqStation, sessionHqTransfer } from '../src/shared/sessionHq';
import { demoState } from '../webview/demo';
import { parseMessage } from '../src/host/messages';

describe('session HQ projection', () => {
  it('passes context from the preceding station only when a new attempt actually starts', () => {
    const before = structuredClone(demoState.features[0]);
    const after = structuredClone(before);
    const step = after.steps[2];
    step.dependsOn = [after.steps[0].id];
    step.status = 'running';
    step.attempts.push({ ...after.steps[0].attempts[0], id: 'new-launch', status: 'running' });
    expect(sessionHqTransfer(before, after)).toEqual({
      attemptId: 'new-launch',
      fromStepId: after.steps[1].id,
      toStepId: step.id,
    });
    expect(sessionHqTransfer(after, structuredClone(after))).toBeUndefined();
    const resumed = structuredClone(after);
    resumed.steps[2].status = 'waiting_input';
    expect(sessionHqTransfer(resumed, after)).toBeUndefined();
    const retry = structuredClone(after);
    retry.steps[2].attempts.push({ ...step.attempts[0], id: 'retry' });
    expect(sessionHqTransfer(after, retry)?.attemptId).toBe('retry');
  });
  it('does not invent a transfer for the first station, a refused launch, an archive or another session', () => {
    const before = structuredClone(demoState.features[0]);
    const after = structuredClone(before);
    after.steps[0].status = 'running';
    after.steps[0].attempts.push({ ...after.steps[0].attempts[0], id: 'first', status: 'running' });
    expect(sessionHqTransfer(before, after)).toBeUndefined();
    after.steps[2].status = 'running';
    expect(sessionHqTransfer(before, after)).toBeUndefined();
    after.steps[2].attempts.push({ ...after.steps[0].attempts[0], id: 'third', status: 'running' });
    after.archived = true;
    expect(sessionHqTransfer(before, after)).toBeUndefined();
    after.archived = false;
    after.id = 'another-session';
    expect(sessionHqTransfer(before, after)).toBeUndefined();
  });
  it('distinguishes a skipped intervention and a pending optional choice from successful work', () => {
    const step = structuredClone(demoState.features[0].steps[0]);
    step.optional = true;
    step.attempts = [];
    step.status = 'skipped';
    expect(sessionHqStation(step, demoState.agents)).toMatchObject({
      status: 'skipped',
      label: 'Passée · non exécutée',
    });
    step.status = 'pending';
    expect(sessionHqStation(step, demoState.agents, false, true)).toMatchObject({
      status: 'waiting_input',
      label: 'Choix facultatif attendu',
    });
    expect(sessionHqStation(step, demoState.agents).label).toBe('À venir · Facultative');
    expect(step.status).toBe('pending');
    expect(step.attempts).toEqual([]);
  });
  it('uses recorded execution identity even when the agent was reconfigured or removed', () => {
    const step = structuredClone(demoState.features[0].steps[0]);
    step.attempts[0].profileSnapshot = {
      agentId: 'recorded-agent',
      policy: 'read-only',
      skillIds: [],
      modelOverride: false,
    };
    step.attempts[0].agentName = 'Nom de l’exécution';
    step.agentId = 'builder';
    const station = sessionHqStation(step, demoState.agents);
    expect(station.agent).toEqual({ id: 'recorded-agent', avatar: undefined });
    expect(station.name).toBe('Nom de l’exécution');
    expect(station.status).toBe('approved');
    expect(step.agentId).toBe('builder');
    step.status = 'stale';
    expect(sessionHqStation(step, demoState.agents)).toMatchObject({
      agent: { id: 'builder' },
      name: 'Pixel',
      status: 'stale',
    });
  });
  it('shows an interactive human question as waiting while the underlying run remains running', () => {
    const step = structuredClone(demoState.features[0].steps[2]);
    step.status = 'running';
    expect(sessionHqStation(step, demoState.agents, true).status).toBe('waiting_input');
    expect(sessionHqStation(step, demoState.agents, false).status).toBe('running');
    expect(step.status).toBe('running');
  });
  it('bounds the display-only preference without accepting additional commands or string booleans', () => {
    const valid = { type: 'setLivingHq', enabled: true, requestId: 'hq' };
    expect(parseMessage(valid)).toEqual(valid);
    for (const message of [
      { ...valid, enabled: 'true' },
      { ...valid, requestId: '' },
      { ...valid, key: 'cliPath' },
      { ...valid, runStep: true },
    ])
      expect(() => parseMessage(message)).toThrow();
  });
});
