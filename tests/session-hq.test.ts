import { describe, expect, it } from 'vitest';
import { sessionHqStation } from '../src/shared/sessionHq';
import { demoState } from '../webview/demo';
import { parseMessage } from '../src/host/messages';

describe('session HQ projection', () => {
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
