export const PAIR_PACES = ['guided', 'batches', 'autonomous'] as const;
export type PairPace = (typeof PAIR_PACES)[number];
export const pairPaces: Record<PairPace, { label: string; description: string }> = {
  guided: { label: 'Guidé', description: 'Une petite action, puis un point ensemble.' },
  batches: {
    label: 'Par lots',
    description: 'Un lot convenu, puis une pause pour décider de la suite.',
  },
  autonomous: {
    label: 'Autonome après cadrage',
    description: 'Organisation validée, puis réalisation jusqu’au livrable.',
  },
};
export type PairAction = 'discuss' | 'work' | 'solo' | 'finish';
export interface PairState {
  pace: PairPace;
  phase: 'planning' | 'paused' | 'working' | 'review';
  revision: number;
  turns: number;
  organizationApproved: boolean;
  inputHash: string;
  sourceKey: string;
  sessionIds: string[];
  turnStartedAt?: string;
  soloRequested?: boolean;
  messages: { id: string; at: string; role: 'user' | 'assistant' | 'system'; content: string }[];
}
export interface PairTurn {
  attemptId: string;
  expectedRevision: number;
  action: PairAction;
  message: string;
  pace: PairPace;
}
export type PairClientMessage =
  | ({ type: 'pairTurn'; requestId: string; featureId: string; stepId: string } & PairTurn)
  | {
      type: 'pairContext';
      requestId: string;
      featureId: string;
      stepId: string;
      attemptId: string;
    };
export type PairHostMessage =
  | { type: 'pairTurnResult'; requestId: string; error?: string }
  | { type: 'pairContextResult'; requestId: string; context?: string; error?: string };
