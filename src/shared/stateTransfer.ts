import type { Feature, StudioState } from './types';

type StateFields = Omit<StudioState, 'features'>;
export type StateTransfer =
  | { type: 'state'; state: StudioState; revision?: number; streamId?: string }
  | {
      type: 'stateDelta';
      streamId: string;
      baseRevision: number;
      revision: number;
      fields: Partial<StateFields>;
      removedFields: (keyof StateFields)[];
      upsert: Feature[];
      removed: string[];
      order?: string[];
    };

/** Each webview has its own baseline. Only detached host snapshots enter this encoder. */
export class StateEncoder {
  private revision = 0;
  private streamId = crypto.randomUUID();
  private fields = new Map<string, string>();
  private features = new Map<string, string>();
  private order: string[] = [];
  reset() {
    this.revision = 0;
    this.streamId = crypto.randomUUID();
    this.fields.clear();
    this.features.clear();
    this.order = [];
  }
  encode(state: StudioState): StateTransfer {
    const fields = new Map<string, string>();
    const changed: Partial<StateFields> = {};
    for (const [key, value] of Object.entries(state)) {
      if (key === 'features' || value === undefined) continue;
      const serialized = JSON.stringify(value);
      fields.set(key, serialized);
      if (this.fields.get(key) !== serialized) Object.assign(changed, { [key]: value });
    }
    const features = new Map(
      state.features.map((feature) => [feature.id, JSON.stringify(feature)]),
    );
    const order = state.features.map((feature) => feature.id);
    // Ambiguous legacy IDs cannot safely be addressed by a keyed patch.
    const full =
      !this.revision ||
      features.size !== state.features.length ||
      this.order.length !== this.features.size;
    const message: StateTransfer = full
      ? { type: 'state', state, revision: this.revision + 1, streamId: this.streamId }
      : {
          type: 'stateDelta',
          streamId: this.streamId,
          baseRevision: this.revision,
          revision: this.revision + 1,
          fields: changed,
          removedFields: [...this.fields.keys()].filter(
            (key) => !fields.has(key),
          ) as (keyof StateFields)[],
          upsert: state.features.filter(
            (feature) => this.features.get(feature.id) !== features.get(feature.id),
          ),
          removed: [...this.features.keys()].filter((id) => !features.has(id)),
          ...(order.length !== this.order.length ||
          order.some((id, index) => id !== this.order[index])
            ? { order }
            : {}),
        };
    this.revision++;
    this.fields = fields;
    this.features = features;
    this.order = order;
    return message;
  }
}

/** Reject a gap atomically; the caller requests a fresh snapshot before applying more deltas. */
export class StateReceiver {
  private revision?: number;
  private streamId?: string;
  private state?: StudioState;
  receive(message: StateTransfer): StudioState | undefined {
    if (message.type === 'state') {
      this.state = message.state;
      this.revision = message.revision;
      this.streamId = message.streamId;
      return this.state;
    }
    if (
      !this.state ||
      !this.streamId ||
      this.streamId !== message.streamId ||
      this.revision !== message.baseRevision ||
      message.revision !== message.baseRevision + 1
    )
      return undefined;
    const features = new Map(this.state.features.map((feature) => [feature.id, feature]));
    for (const id of message.removed) features.delete(id);
    for (const feature of message.upsert) features.set(feature.id, feature);
    const order = message.order ?? this.state.features.map((feature) => feature.id);
    if (
      new Set(order).size !== order.length ||
      order.length !== features.size ||
      order.some((id) => !features.has(id))
    )
      return undefined;
    const state = { ...this.state, ...message.fields };
    for (const key of message.removedFields) delete (state as Partial<StudioState>)[key];
    state.features =
      message.upsert.length || message.removed.length || message.order
        ? order.map((id) => features.get(id)!)
        : this.state.features;
    this.state = state;
    this.revision = message.revision;
    return state;
  }
}
