import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RewardService } from '../src/host/RewardService';
import { QuestService } from '../src/host/QuestService';
import { emptyQuestState, QUEST_METRICS, questCaps } from '../src/shared/quests';
import { rewards, REWARD_IDS, rewardProgress, unlockedRewards } from '../src/shared/rewards';
import { parseMessage } from '../src/host/messages';
import * as files from '../src/host/SessionFiles';
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture(trophies = 0) {
  const directory = await mkdtemp(join(tmpdir(), 'kerai-rewards-'));
  directories.push(directory);
  const progression = { ...emptyQuestState(), trophies };
  const service = new RewardService(directory, () => progression);
  await service.initialize();
  return { directory, progression, service };
}
describe('six rewards backed by existing trophies', () => {
  it('reveals exactly the next milestone, measures only its interval and completes at 200', () => {
    expect(rewards.map((reward) => reward.threshold)).toEqual([5, 20, 40, 70, 110, 200]);
    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i];
      expect(rewardProgress(reward.threshold - 1).next?.id).toBe(reward.id);
      expect(rewardProgress(reward.threshold).next?.id).toBe(rewards[i + 1]?.id);
      expect(unlockedRewards({ trophies: reward.threshold })).toEqual(REWARD_IDS.slice(0, i + 1));
    }
    expect(rewardProgress(28)).toMatchObject({ previous: 20, remaining: 12, value: 8, max: 20 });
    expect(rewardProgress(427)).toMatchObject({ next: undefined, remaining: 0 });
    expect(rewardProgress(NaN).next?.id).toBe('noob');
    expect(unlockedRewards({ trophies: 200, error: 'Untrusted ledger' })).toEqual([]);
  });
  it('refuses locked or client-invented unlocks', async () => {
    const { service, directory } = await fixture(19);
    await expect(service.set('architecte', true)).rejects.toThrow('pas encore');
    await expect(readFile(join(directory, 'rewards.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(() =>
      parseMessage({
        type: 'setReward',
        rewardId: 'kitten',
        enabled: true,
        requestId: 'test',
        trophies: 200,
      }),
    ).toThrow();
    expect(() =>
      parseMessage({
        type: 'setReward',
        rewardId: '../../kitten',
        enabled: true,
        requestId: 'test',
      }),
    ).toThrow();
  });
  it('retroactively unlocks from a real quest ledger without spending or rewriting trophies', async () => {
    const { service, directory } = await fixture();
    const quests = new QuestService(directory);
    await quests.initialize();
    await quests.record(
      QUEST_METRICS.flatMap((metric) =>
        Array.from({ length: questCaps[metric] }, (_, i) => ({ metric, key: `${metric}-${i}` })),
      ),
    );
    const before = await readFile(join(directory, 'quests.json'), 'utf8');
    const earned = new RewardService(directory, () => quests.snapshot());
    await earned.initialize();
    expect(earned.snapshot().unlocked).toEqual(REWARD_IDS);
    expect(earned.snapshot().selection).toEqual({ title: null, celebration: null, mascot: null });
    await earned.set('kitten', true);
    await earned.set('eiffel', true);
    await earned.set('architecte', true);
    await earned.set('dresseur', true);
    const reopened = new RewardService(directory, () => quests.snapshot());
    await reopened.initialize();
    expect(reopened.snapshot().selection).toEqual({
      title: 'dresseur',
      celebration: 'eiffel',
      mascot: 'kitten',
    });
    expect(await readFile(join(directory, 'quests.json'), 'utf8')).toBe(before);
    expect(service.snapshot().unlocked).toEqual([]);
  });
  it('merges concurrent preference edits from different windows and retains rewards after disabling', async () => {
    const { service, directory, progression } = await fixture(200);
    const other = new RewardService(directory, () => progression);
    await other.initialize();
    await Promise.all([service.set('kitten', true), other.set('architecte', true)]);
    await service.initialize();
    expect(service.snapshot().selection).toEqual({
      title: 'architecte',
      celebration: null,
      mascot: 'kitten',
    });
    await service.set('kitten', false);
    expect(service.snapshot().unlocked).toContain('kitten');
    expect(service.snapshot().selection.mascot).toBeNull();
  });
  it('preserves confirmed settings on write failure and never overwrites a corrupt preference file', async () => {
    const { service, directory } = await fixture(200);
    await service.set('architecte', true);
    const before = await readFile(join(directory, 'rewards.json'), 'utf8');
    vi.spyOn(files, 'writePrivate').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.set('dresseur', true)).rejects.toThrow('disk full');
    expect(service.snapshot().selection.title).toBe('architecte');
    expect(await readFile(join(directory, 'rewards.json'), 'utf8')).toBe(before);
    await writeFile(join(directory, 'rewards.json'), '{broken');
    await service.initialize();
    expect(service.snapshot()).toMatchObject({
      ready: false,
      error: expect.stringContaining('conservé'),
    });
    await expect(service.set('kitten', true)).rejects.toThrow();
    expect(await readFile(join(directory, 'rewards.json'), 'utf8')).toBe('{broken');
  });
  it('never enables saved cosmetics when the quest ledger is unavailable or below the threshold', async () => {
    const { service, progression } = await fixture(200);
    await service.set('kitten', true);
    progression.error = 'Progression indisponible';
    expect(service.snapshot().selection.mascot).toBeNull();
    await expect(service.set('eiffel', true)).rejects.toThrow('indisponible');
    delete progression.error;
    expect(service.snapshot().selection.mascot).toBe('kitten');
    progression.trophies = 199;
    expect(service.snapshot().selection.mascot).toBeNull();
  });
});
