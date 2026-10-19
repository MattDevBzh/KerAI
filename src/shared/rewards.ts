import type { QuestState } from './quests';
import type { ThemeId } from './themes';

export const REWARD_IDS = ['noob', 'architecte', 'eiffel', 'matrix', 'dresseur', 'kitten'] as const;
export type RewardId = (typeof REWARD_IDS)[number];
export interface RewardDefinition {
  id: RewardId;
  threshold: number;
  name: string;
  kind: 'theme' | 'title' | 'celebration' | 'mascot';
  description: string;
}
export const rewards: readonly RewardDefinition[] = [
  {
    id: 'noob',
    threshold: 5,
    name: 'Noob',
    kind: 'theme',
    description: 'Un premier atelier en papier quadrillé, post-it et ruban adhésif.',
  },
  {
    id: 'architecte',
    threshold: 20,
    name: 'Architecte du dimanche',
    kind: 'title',
    description: 'Un titre à porter fièrement dans le bandeau du cockpit.',
  },
  {
    id: 'eiffel',
    threshold: 40,
    name: 'Feu d’artifice devant la tour Eiffel',
    kind: 'celebration',
    description: 'Paris s’illumine pour fêter la validation finale de tes sessions.',
  },
  {
    id: 'matrix',
    threshold: 70,
    name: 'Matrix',
    kind: 'theme',
    description: 'Un cockpit noir et vert, rythmé par une pluie de code.',
  },
  {
    id: 'dresseur',
    threshold: 110,
    name: 'Dresseur d’agents',
    kind: 'title',
    description: 'Le titre de celles et ceux qui savent faire travailler toute une équipe.',
  },
  {
    id: 'kitten',
    threshold: 200,
    name: 'Chaton',
    kind: 'mascot',
    description: 'Un petit colocataire qui se promène, s’assoit et se repose dans le QG.',
  },
];
export const rewardById = new Map(rewards.map((reward) => [reward.id, reward]));
export const rewardKinds = {
  theme: 'Thème',
  title: 'Titre',
  celebration: 'Célébration',
  mascot: 'Mascotte du QG',
} as const;
export interface RewardSelection {
  title: 'architecte' | 'dresseur' | null;
  celebration: 'eiffel' | null;
  mascot: 'kitten' | null;
}
export interface RewardState {
  ready: boolean;
  unlocked: RewardId[];
  selection: RewardSelection;
  error?: string;
}
export const emptyRewardSelection = (): RewardSelection => ({
  title: null,
  celebration: null,
  mascot: null,
});
export function unlockedRewards(state: Pick<QuestState, 'trophies' | 'error'>): RewardId[] {
  if (state.error || !Number.isFinite(state.trophies)) return [];
  return rewards.filter((reward) => state.trophies >= reward.threshold).map((reward) => reward.id);
}
export function rewardProgress(trophies: number) {
  const total = Number.isFinite(trophies) ? Math.max(0, Math.floor(trophies)) : 0;
  const next = rewards.find((reward) => reward.threshold > total);
  const previous =
    [...rewards].reverse().find((reward) => reward.threshold <= total)?.threshold ?? 0;
  return {
    next,
    previous,
    remaining: next ? next.threshold - total : 0,
    value: next ? total - previous : 1,
    max: next ? next.threshold - previous : 1,
  };
}
export function themeReward(theme: ThemeId): RewardId | undefined {
  return theme === 'noob' || theme === 'matrix' ? theme : undefined;
}
