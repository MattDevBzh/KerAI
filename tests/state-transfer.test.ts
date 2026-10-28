import { describe, expect, it } from 'vitest';
import { StateEncoder, StateReceiver, type StateTransfer } from '../src/shared/stateTransfer';
import { demoState } from '../webview/demo';

const wire = (message: StateTransfer): StateTransfer => JSON.parse(JSON.stringify(message));
const fixture = () => structuredClone(demoState);

describe('versioned webview state transport', () => {
  it('preserves edits, deletion, insertion, ordering and removed optional fields across the wire', () => {
    const encoder = new StateEncoder(),
      receiver = new StateReceiver();
    const state = fixture();
    state.workspaceOperation = { label: 'Préparation' };
    receiver.receive(wire(encoder.encode(state)));
    state.features[0].title = 'Updated';
    state.features.splice(1, 1);
    state.features.unshift({ ...structuredClone(state.features[0]), id: 'new-session' });
    delete state.workspaceOperation;
    state.runtime.error = 'Unavailable';
    const patch = encoder.encode(state);
    expect(patch.type).toBe('stateDelta');
    expect(receiver.receive(wire(patch))).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it('keeps unchanged feature references stable during streaming and metadata changes', () => {
    const encoder = new StateEncoder(),
      receiver = new StateReceiver(),
      state = fixture();
    const previous = receiver.receive(wire(encoder.encode(state)))!;
    state.features[0].steps[0].description += ' next event';
    const next = receiver.receive(wire(encoder.encode(state)))!;
    expect(next.features[0]).not.toBe(previous.features[0]);
    expect(next.features[1]).toBe(previous.features[1]);
    state.runtime.state = 'checking';
    const metadata = receiver.receive(wire(encoder.encode(state)))!;
    expect(metadata.features).toBe(next.features);
  });

  it('rejects missed, replayed and reordered messages then recovers from a fresh snapshot', () => {
    const encoder = new StateEncoder(),
      receiver = new StateReceiver(),
      state = fixture();
    receiver.receive(wire(encoder.encode(state)));
    const missing = encoder.encode(state);
    state.features[0].title = 'Latest';
    const latest = encoder.encode(state);
    expect(receiver.receive(wire(latest))).toBeUndefined();
    expect(receiver.receive(wire(missing))).toBeDefined();
    expect(receiver.receive(wire(missing))).toBeUndefined();
    encoder.reset();
    expect(receiver.receive(wire(encoder.encode(state)))).toEqual(
      JSON.parse(JSON.stringify(state)),
    );
    expect(receiver.receive(wire(latest))).toBeUndefined();
  });

  it('does not patch ambiguous historical IDs and keeps independent surface baselines', () => {
    const state = fixture(),
      first = new StateEncoder(),
      second = new StateEncoder();
    first.encode(state);
    expect(first.encode(state).type).toBe('stateDelta');
    expect(second.encode(state).type).toBe('state');
    state.features.push(structuredClone(state.features[0]));
    expect(first.encode(state).type).toBe('state');
    expect(first.encode(state).type).toBe('state');
    state.features.pop();
    expect(first.encode(state).type).toBe('state');
    expect(first.encode(state).type).toBe('stateDelta');
  });

  it('rejects an old stream even when its revision matches the new baseline', () => {
    const encoder = new StateEncoder(),
      receiver = new StateReceiver(),
      state = fixture();
    receiver.receive(wire(encoder.encode(state)));
    state.features[0].title = 'Old stream';
    const delayed = wire(encoder.encode(state));
    encoder.reset();
    state.features[0].title = 'Fresh baseline';
    receiver.receive(wire(encoder.encode(state)));
    expect(receiver.receive(delayed)).toBeUndefined();
    state.features[0].title = 'Fresh update';
    expect(receiver.receive(wire(encoder.encode(state)))?.features[0].title).toBe('Fresh update');
  });

  it('transfers only the changed session in an archive of 1000 sessions', () => {
    const state = fixture();
    state.features = Array.from({ length: 1000 }, (_, index) => ({
      ...structuredClone(demoState.features[index % demoState.features.length]),
      id: `session-${index}`,
    }));
    const encoder = new StateEncoder(),
      receiver = new StateReceiver();
    const full = wire(encoder.encode(state));
    receiver.receive(full);
    state.features[500].steps[0].description += ' streamed event';
    const delta = wire(encoder.encode(state));
    expect(delta.type).toBe('stateDelta');
    if (delta.type !== 'stateDelta') throw Error('Expected delta');
    expect(delta.upsert.map((feature) => feature.id)).toEqual(['session-500']);
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(full).length / 100);
    expect(receiver.receive(delta)).toEqual(JSON.parse(JSON.stringify(state)));
  });
});
