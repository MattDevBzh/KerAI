import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/core/store';
import { StudioService } from '../src/host/StudioService';
import {
  quests,
  questCaps,
  questStatus,
  emptyQuestState,
  QUEST_METRICS,
} from '../src/shared/quests';
import { QuestService, type QuestFact } from '../src/host/QuestService';
import { studioQuestFacts, discussionQuestFacts } from '../src/host/questFacts';
import { parseMessage } from '../src/host/messages';
import { demoState } from '../webview/demo';
import type { Feature, StudioState } from '../src/shared/types';
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'studio-quests-'));
  folders.push(path);
  const service = new QuestService(path);
  await service.initialize();
  return { path, service };
}
function stateWith(feature?: Feature): StudioState {
  const state = structuredClone(demoState);
  state.features = feature ? [feature] : [];
  state.memory = [];
  state.agents = [];
  state.skills = [];
  return state;
}
function featureWithAgents(ids: string[]): Feature {
  const feature = structuredClone(demoState.features[0]);
  feature.id = 'feature-one';
  feature.status = 'running';
  feature.activeStepId = 'step-0';
  feature.archived = false;
  feature.checkpoints = [];
  feature.observations = [];
  feature.reviewComments = [];
  feature.criteria = [];
  feature.corrections = [];
  delete feature.finalValidation;
  delete feature.worktree;
  delete feature.projects;
  delete feature.teamRevision;
  feature.steps = ids.map((id, index) => ({
    id: `step-${index}`,
    name: id,
    agentId: id,
    description: '',
    policy: 'read-only',
    skills: [],
    maxAttempts: 3,
    artifact: 'report.md',
    dependsOn: [],
    status: 'awaiting_review',
    attempts: [
      {
        id: `attempt-${index}`,
        startedAt: new Date(1000 * index).toISOString(),
        finishedAt: new Date(1000 * index + 500).toISOString(),
        status: 'awaiting_review',
        feedback: '',
        logs: [],
        questions: [],
        answers: {},
        changedFiles: [],
      },
    ],
  }));
  return feature;
}

describe('100 quests and authoritative progression', () => {
  it('has exactly 80 progressive quests and 20 unique challenges, stable IDs and bounded rewards', () => {
    expect(quests).toHaveLength(100);
    expect(new Set(quests.map((q) => q.id)).size).toBe(100);
    expect(quests.filter((q) => q.series)).toHaveLength(80);
    expect(quests.filter((q) => !q.series)).toHaveLength(20);
    for (const q of quests) {
      expect(q.reward).toBeGreaterThanOrEqual(1);
      expect(q.reward).toBeLessThanOrEqual(10);
      expect(q.help.length).toBeGreaterThan(40);
      if (q.previousId) {
        const before = quests.find((v) => v.id === q.previousId)!;
        expect(before.metric).toBe(q.metric);
        expect(before.target).toBeLessThan(q.target);
      }
    }
    expect(quests.filter((q) => questStatus(q, emptyQuestState()) === 'active')).toHaveLength(36);
    expect(questCaps.relay).toBe(6);
  });
  it('awards once, unlocks the next milestone, persists across reload and never trusts a UI claim', async () => {
    const { path, service } = await fixture();
    const earned: string[][] = [];
    service.on('state', (_state, ids) => earned.push(ids));
    const one: QuestFact = { metric: 'agentsCreated', key: 'profile-1' };
    await Promise.all([service.record([one]), service.record([one]), service.record([one])]);
    expect(service.snapshot().trophies).toBe(2);
    expect(earned.flat()).toEqual(['agentsCreated-1']);
    expect(questStatus(quests.find((q) => q.id === 'agentsCreated-2')!, service.snapshot())).toBe(
      'active',
    );
    const reopened = new QuestService(path);
    await reopened.initialize();
    await reopened.record([one]);
    expect(reopened.snapshot().trophies).toBe(2);
    await reopened.record(
      [2, 3, 4, 5].map((i) => ({ metric: 'agentsCreated', key: `profile-${i}` })),
    );
    expect(reopened.snapshot().trophies).toBe(10);
    expect(reopened.snapshot().counts.agentsCreated).toBe(5);
    expect(questStatus(quests.find((q) => q.id === 'agentsCreated-10')!, reopened.snapshot())).toBe(
      'active',
    );
    for (const malicious of [
      { type: 'claimQuest', id: 'agentsCreated-20' },
      { type: 'refreshQuests', trophies: 999 },
    ])
      expect(() => parseMessage(malicious)).toThrow();
    expect(parseMessage({ type: 'refreshQuests' })).toEqual({ type: 'refreshQuests' });
  });
  it('serializes competing instances, bounds history and keeps earned trophies after source deletion', async () => {
    const { path, service } = await fixture(),
      other = new QuestService(path);
    await other.initialize();
    await Promise.all([
      service.record([{ metric: 'featuresCreated', key: 'same' }]),
      other.record([
        { metric: 'featuresCreated', key: 'same' },
        { metric: 'featuresCreated', key: 'second' },
      ]),
    ]);
    await service.initialize();
    expect(service.snapshot().counts.featuresCreated).toBe(2);
    expect(service.snapshot().trophies).toBe(1);
    await service.record(
      Array.from({ length: 500 }, (_, i) => ({ metric: 'featuresCreated', key: `session-${i}` })),
    );
    expect(service.snapshot().counts.featuresCreated).toBe(25);
    const total = service.snapshot().trophies;
    await service.record(studioQuestFacts(stateWith()));
    await service.initialize();
    expect(service.snapshot().trophies).toBe(total);
    const saved = await readFile(join(path, 'quests.json'), 'utf8');
    expect(saved).not.toContain('session-');
    expect(saved.length).toBeLessThan(5000);
  });
  it('preserves corrupt or future data and resumes only after a successful reread', async () => {
    const { path, service } = await fixture();
    await service.record([{ metric: 'theme', key: 'halloween' }]);
    const before = await readFile(join(path, 'quests.json'), 'utf8');
    const broken = '{"version":99}';
    await writeFile(join(path, 'quests.json'), broken);
    await service.initialize();
    expect(service.snapshot().error).toBeTruthy();
    await service.record([{ metric: 'agentsCreated', key: 'new' }]);
    expect(await readFile(join(path, 'quests.json'), 'utf8')).toBe(broken);
    await writeFile(join(path, 'quests.json'), before);
    await service.initialize();
    expect(service.snapshot().error).toBeUndefined();
    expect(service.snapshot().trophies).toBe(1);
  });
  it('observes the exact saved snapshot and awards nothing when persistence fails', async () => {
    const { path } = await fixture();
    const store = new Store(join(path, 'studio'));
    const studio = new StudioService(path, resolve('defaults'), store, () => true);
    studio.state = stateWith(featureWithAgents(['a']));
    studio.engine.features.push(...studio.state.features);
    studio.state.features = studio.engine.features;
    const snapshots: StudioState[] = [];
    studio.on('persisted', (state) => snapshots.push(state));
    let finish!: () => void;
    const saving = vi.spyOn(store, 'save').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const write = studio.persist();
    studio.state.features[0].archived = true;
    finish();
    await write;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].features[0].archived).toBe(false);
    saving.mockRejectedValueOnce(new Error('disk full'));
    await expect(studio.persist()).rejects.toThrow('disk full');
    expect(snapshots).toHaveLength(1);
    saving.mockRestore();
  });
  it('projects human edits, bound answers and manual checkpoints without counting automatic copies', async () => {
    const { service } = await fixture();
    const feature = featureWithAgents(['a']);
    const attempt = feature.steps[0].attempts[0];
    attempt.answers = { question: 'Useful answer' };
    attempt.artifactVersions = [
      {
        revision: 1,
        author: 'human',
        at: '2026-10-16T00:00:00Z',
        content: 'Edited',
        reason: 'clarify',
      },
    ];
    feature.checkpoints = ['manual', 'before-run'].map((kind, index) => ({
      id: `cp-${index}`,
      label: 'snapshot',
      kind: kind as 'manual' | 'before-run',
      createdAt: '2026-10-16T00:00:00Z',
      branch: 'main',
      head: 'a'.repeat(40),
      fileCount: 1,
      totalBytes: 10,
      excludedCount: 0,
      excludedPaths: [],
    }));
    const retry = structuredClone(attempt);
    retry.id = 'retry';
    retry.answerBindings = {
      question: {
        question: { id: 'question', text: 'Question' },
        answer: 'Useful answer',
        origin: { stepId: feature.steps[0].id, attemptId: attempt.id },
      },
    };
    delete retry.artifactVersions;
    feature.steps[0].attempts.push(retry);
    await service.record(studioQuestFacts(stateWith(feature)));
    expect(service.snapshot().counts.questionsAnswered).toBe(1);
    expect(service.snapshot().counts.reportsEdited).toBe(1);
    expect(service.snapshot().counts.checkpoints).toBe(1);
    feature.teamRevision = 1;
    feature.steps = [];
    expect(studioQuestFacts(stateWith(feature)).some((f) => f.metric === 'teamsCreated')).toBe(
      false,
    );
  });
  it('can complete every catalog quest with its host metric, with no repeated award', async () => {
    const { service } = await fixture();
    const facts = QUEST_METRICS.flatMap((metric) =>
      Array.from({ length: questCaps[metric] }, (_, i) => ({ metric, key: `${metric}-${i}` })),
    );
    await service.record(facts);
    expect(Object.keys(service.snapshot().completed)).toHaveLength(100);
    expect(service.snapshot().trophies).toBe(quests.reduce((sum, q) => sum + q.reward, 0));
    const before = service.snapshot();
    await service.record(facts);
    expect(service.snapshot()).toEqual(before);
  });
  it('counts successful interventions and human decisions, never failed or automatic approvals', () => {
    const feature = featureWithAgents(['a', 'b', 'c', 'd']);
    const attempts = feature.steps.map((s) => s.attempts[0]);
    attempts[0].status = 'failed';
    attempts[0].error = 'boom';
    attempts[1].status = 'cancelled';
    attempts[2].approvedBy = 'autopilot';
    attempts[2].approvedAt = '2026-10-16T00:00:00Z';
    attempts[3].approvedBy = 'human';
    attempts[3].approvedAt = '2026-10-16T00:00:00Z';
    const facts = studioQuestFacts(stateWith(feature));
    expect(facts.filter((f) => f.metric === 'stepsRun')).toHaveLength(2);
    expect(facts.filter((f) => f.metric === 'humanApprovals')).toHaveLength(1);
    expect(facts.filter((f) => f.metric === 'featuresLaunched')).toHaveLength(1);
    expect(facts.some((f) => f.metric === 'featuresCompleted')).toBe(false);
  });
  it('requires six distinct successful agents in one consecutive sequence, not six retries or cross-feature totals', () => {
    expect(
      studioQuestFacts(stateWith(featureWithAgents(['a', 'a', 'a', 'a', 'a', 'a']))).filter(
        (f) => f.metric === 'relay',
      ),
    ).toHaveLength(1);
    const feature = featureWithAgents(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(studioQuestFacts(stateWith(feature)).filter((f) => f.metric === 'relay')).toHaveLength(
      6,
    );
    feature.steps[2].attempts[0].status = 'failed';
    expect(studioQuestFacts(stateWith(feature)).filter((f) => f.metric === 'relay')).toHaveLength(
      3,
    );
  });
  it('uses frozen execution identities, not agents, skills or models changed after a run', async () => {
    const feature = featureWithAgents(['a', 'b', 'c', 'd', 'e', 'f']);
    for (const step of feature.steps) {
      step.attempts[0].profileSnapshot = {
        agentId: step.agentId,
        policy: 'read-only',
        skillIds: [],
        modelOverride: false,
      };
      step.agentId = 'renamed';
      step.skills = ['added-later'];
      step.model = 'changed-later';
      step.status = 'stale';
    }
    const facts = studioQuestFacts(stateWith(feature));
    expect(facts.filter((f) => f.metric === 'relay')).toHaveLength(6);
    expect(facts.some((f) => f.metric === 'skillUse' || f.metric === 'modelOverride')).toBe(false);
    const { path } = await fixture();
    const store = new Store(join(path, 'snapshot-roundtrip'));
    await store.save([feature], stateWith().settings);
    const restored = (await store.load()).features[0];
    expect(restored.steps[0].attempts[0].profileSnapshot).toEqual(
      feature.steps[0].attempts[0].profileSnapshot,
    );
    for (const step of feature.steps) delete step.attempts[0].profileSnapshot;
    const legacy = studioQuestFacts(stateWith(feature));
    expect(legacy.filter((f) => f.metric === 'relay')).toHaveLength(0);
    expect(legacy.filter((f) => f.metric === 'stepsRun')).toHaveLength(6);
  });
  it('deduplicates compositions and counts only manual checkpoints, custom profiles and complete chats', async () => {
    const { service } = await fixture();
    const first = featureWithAgents(['a', 'b']);
    first.teamRevision = 2;
    const second = structuredClone(first);
    second.id = 'second';
    second.teamRevision = 5;
    const state = stateWith(first);
    state.features.push(second);
    state.agents = [
      { ...demoState.agents[0], source: 'bundled' },
      { ...demoState.agents[0], id: 'custom', path: '/custom', source: 'user' },
      {
        ...demoState.agents[0],
        id: 'override',
        path: '/override',
        source: 'user',
        versions: [{ ...demoState.agents[0], source: 'bundled' }],
      },
    ];
    await service.record(studioQuestFacts(state));
    expect(service.snapshot().counts.teamsCreated).toBe(1);
    expect(service.snapshot().counts.agentsCreated).toBe(1);
    const message = {
      id: 'msg',
      role: 'assistant' as const,
      content: 'hello',
      createdAt: '2026-10-16T00:00:00Z',
      status: 'streaming' as const,
    };
    const chat = {
      id: 'chat',
      agentKey: 'a',
      title: 'topic',
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      messages: [message],
    };
    expect(discussionQuestFacts({ agents: [], discussions: [chat] })).toHaveLength(0);
    expect(
      discussionQuestFacts({
        agents: [],
        discussions: [{ ...chat, messages: [{ ...message, status: 'complete' }] }],
      }),
    ).toEqual([{ metric: 'discussions', key: 'chat' }]);
  });
});
