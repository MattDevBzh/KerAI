import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeStatistics, statsRange, parseDay } from '../src/core/statistics';
import { defaultStatsFilters } from '../src/shared/statistics';
import { parseMessage } from '../src/host/messages';
import { StudioService } from '../src/host/StudioService';
import { sessionDirectory } from '../src/host/SessionFiles';
import { statsAttempt, statsFeature, statsProjects, statisticsState } from './statistics-fixture';

const all = { ...defaultStatsFilters, period: 'all' as const };
const now = new Date('2026-10-20T12:00:00Z');
afterEach(() => vi.unstubAllEnvs());
describe('session statistics', () => {
  it('deduplicates multi-project sessions, keeps archives, and uses frozen launch identities', () => {
    const features = statisticsState().features;
    const result = analyzeStatistics(features, all, statsProjects, [], now);
    expect(result.selected).toHaveLength(4);
    expect(result.attempts).toBe(3);
    expect(result.completed).toBe(1);
    expect(result.undatedCompleted).toBe(1);
    expect(result.agents.map((agent) => [agent.id, agent.attempts])).toEqual([
      ['developer', 2],
      ['reviewer', 1],
    ]);
    expect(result.models.map((model) => [model.id, model.attempts])).toEqual([
      ['sol', 2],
      ['luna', 1],
    ]);
    expect(result.projects.find((project) => project.id === 'lms')?.sessions).toBe(2);
    expect(result.projects.find((project) => project.id === 'lxp')?.sessions).toBe(2);
    expect(analyzeStatistics(features, { ...all, project: 'lxp' }, [], [], now).attempts).toBe(1);
    expect(
      analyzeStatistics(features, { ...all, includeArchived: false }, [], [], now).attempts,
    ).toBe(2);
    expect(
      analyzeStatistics(features, { ...all, project: '__none' }, [], [], now).selected.map(
        (feature) => feature.id,
      ),
    ).toEqual(['legacy']);
    expect(
      analyzeStatistics(features, { ...all, workflow: 'absent' }, [], [], now).selected,
    ).toEqual([]);
  });
  it('retains zero, partial and missing credits without summing event snapshots or model breakdowns twice', () => {
    const features = [
      statsFeature('x', [
        statsAttempt('zero', { usage: { source: 'measured', unit: 'nano-AIU', cost: 0 } }),
        statsAttempt('unknown'),
        statsAttempt('partial', {
          usage: {
            source: 'measured',
            unit: 'nano-AIU',
            cost: 2000000000,
            incompleteCost: true,
            byModel: { m: { cost: 2000000000 } },
          },
          logs: [{ id: 'usage', at: now.toISOString(), kind: 'usage', message: 'cost:2000000000' }],
        }),
        statsAttempt('usd', { usage: { source: 'measured', unit: 'USD', cost: 5000 } }),
      ]),
    ];
    const result = analyzeStatistics(features, all, [], [], now);
    expect(result.credits).toEqual({ value: 2, known: 2, partial: 1, missing: 2 });
    expect(result.timeline.reduce((sum, point) => sum + (point.credits.value ?? 0), 0)).toBe(2);
    expect(
      analyzeStatistics([statsFeature('no', [statsAttempt('n')])], all).credits.value,
    ).toBeNull();
    expect(analyzeStatistics([], all).averageSteps).toBeNull();
  });
  it('uses inclusive local dates through DST and counts starts separately from creations and finalizations', () => {
    vi.stubEnv('TZ', 'Europe/Paris');
    const filters = { ...all, period: 'custom' as const, from: '2026-03-29', to: '2026-03-29' };
    const range = statsRange(filters, now);
    expect(+range.to! - +range.from!).toBe(23 * 3600000);
    const feature = statsFeature(
      'old',
      [
        statsAttempt('before', { startedAt: '2026-03-28T22:59:59Z' }),
        statsAttempt('first', { startedAt: '2026-03-28T23:00:00Z', finishedAt: undefined }),
        statsAttempt('last', { startedAt: '2026-03-29T21:59:59.999Z', finishedAt: undefined }),
        statsAttempt('after', { startedAt: '2026-03-29T22:00:00Z' }),
      ],
      {
        createdAt: '2025-01-01T00:00:00Z',
        status: 'completed',
        finalValidation: { id: 'v', at: '2026-03-29T12:00:00Z', author: 'human', stateKey: 's' },
      },
    );
    const result = analyzeStatistics([feature], filters, [], [], now);
    expect(result.attempts).toBe(2);
    expect(result.created).toBe(0);
    expect(result.completed).toBe(1);
    expect(result.selected).toHaveLength(1);
    expect(result.duration).toEqual({ value: null, known: 0, partial: 0, missing: 2 });
    expect(result.heatmap[6][0]).toBe(1);
    expect(result.heatmap[6][23]).toBe(1);
    expect(parseDay('2026-02-30')).toBeUndefined();
    expect(statsRange({ ...filters, from: '2026-03-30' }, now).error).toBeTruthy();
  });
  it('counts retried work across the date boundary, missing durations and retained report sizes honestly', () => {
    const result = analyzeStatistics(
      statisticsState().features,
      { ...all, period: 'custom', from: '2026-10-20', to: '2026-10-20' },
      [],
      [],
      now,
    );
    expect(result.attempts).toBe(1);
    expect(result.retries).toBe(1);
    expect(result.failures).toBe(1);
    expect(result.prompts.value).toBe(3000);
    expect(result.reports.value).toBeNull();
    expect(result.duration.value).toBe(60000);
    expect(result.credits.value).toBe(2);
  });
  it('fills missing days, computes streaks, and switches large timelines to months without dropping old events', () => {
    vi.stubEnv('TZ', 'Europe/Paris');
    const feature = statsFeature(
      'timeline',
      ['2026-10-01', '2026-10-02', '2026-10-04'].map((day, i) =>
        statsAttempt(String(i), { startedAt: `${day}T10:00:00Z` }),
      ),
    );
    const result = analyzeStatistics(
      [feature],
      { ...all, period: 'custom', from: '2026-10-01', to: '2026-10-04' },
      [],
      [],
      now,
    );
    expect(result.timeline.map((point) => point.attempts)).toEqual([1, 1, 0, 1]);
    expect(result.longestStreak).toBe(2);
    expect(result.activeDays).toBe(3);
    const extended = analyzeStatistics(
      [feature],
      { ...all, period: 'custom', from: '2024-01-01', to: '2026-10-20' },
      [],
      [],
      now,
    );
    expect(extended.grain).toBe('month');
    expect(extended.timeline[0].key).toBe('2024-01-01');
    expect(extended.timeline.reduce((sum, point) => sum + point.attempts, 0)).toBe(3);
  });
  it('validates bounded storage requests and only measures the owning session’s private files', async () => {
    expect(() => parseMessage({ type: 'statsStorage', requestId: 'r', featureIds: [] })).toThrow();
    expect(() =>
      parseMessage({ type: 'statsStorage', requestId: 'r', featureIds: Array(51).fill('f') }),
    ).toThrow();
    expect(parseMessage({ type: 'statsStorage', requestId: 'r', featureIds: ['f'] }).type).toBe(
      'statsStorage',
    );
    const root = await mkdtemp(join(tmpdir(), 'stats-storage-'));
    const feature = statsFeature('f', [statsAttempt('attempt')]);
    try {
      for (const [fragment, content] of [
        [`${sessionDirectory('f')}/state.json`, '12345'],
        ['existing-changes/attempt/backup', '123'],
        ['quality/shared.png', 'not included'],
        [`${sessionDirectory('other')}/state.json`, 'other session'],
      ]) {
        const file = join(root, fragment);
        await mkdir(join(file, '..'), { recursive: true });
        await writeFile(file, content);
      }
      const owner = {
        store: { rootPath: root },
        engine: {
          getFeature: (id: string) => {
            if (id !== 'f') throw new Error('Unknown');
            return feature;
          },
        },
      } as unknown as StudioService;
      expect(await StudioService.prototype.statisticsStorage.call(owner, 'f')).toBe(8);
      await expect(StudioService.prototype.statisticsStorage.call(owner, 'other')).rejects.toThrow(
        'Unknown',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
