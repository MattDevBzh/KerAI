import type { StudioState, Attempt } from '../shared/types';
import type { DiscussionState } from '../shared/discussions';
import type { QuestMetric } from '../shared/quests';
import type { QuestFact } from './QuestService';

const succeeded = (attempt: Attempt) =>
  Boolean(
    attempt.finishedAt &&
      !attempt.error &&
      ['awaiting_review', 'approved', 'stale'].includes(attempt.status),
  );
/** Project only host-owned durable outcomes; rendering or receiving a command earns nothing. */
export function studioQuestFacts(state: StudioState): QuestFact[] {
  const facts: QuestFact[] = [];
  const add = (metric: QuestMetric, key: string) => facts.push({ metric, key });
  const scope = state.workspace.path;
  for (const [profiles, metric] of [
    [state.agents, 'agentsCreated'],
    [state.skills, 'skillsCreated'],
  ] as const)
    for (const profile of profiles)
      if (
        profile.source !== 'bundled' &&
        !profile.versions?.some((version) => version.source === 'bundled')
      )
        add(metric, profile.path);
  for (const entry of state.memory ?? []) add('memoryEntries', `${scope}:${entry.id}`);
  for (const feature of state.features) {
    const key = `${scope}:${feature.id}`;
    add('featuresCreated', key);
    if (feature.steps.some((step) => step.attempts.length)) add('featuresLaunched', key);
    if (feature.status === 'completed' && feature.finalValidation) add('featuresCompleted', key);
    if (feature.worktree) add('isolated', key);
    if ((feature.projects?.length ?? 0) > 1) add('multiProject', key);
    if (feature.archived) add('archive', key);
    if (feature.criteria?.some((criterion) => criterion.text.trim())) add('criteria', key);
    if (feature.teamRevision && feature.steps.length)
      add('teamsCreated', JSON.stringify(feature.steps.map((step) => step.agentId)));
    for (const checkpoint of feature.checkpoints ?? [])
      if (checkpoint.kind === 'manual') add('checkpoints', `${key}:${checkpoint.id}`);
    for (const comment of feature.reviewComments ?? [])
      add('reviewComments', `${key}:${comment.id}`);
    if (feature.observations?.some((observation) => observation.status === 'completed'))
      add('observations', key);
    if (feature.corrections?.some((correction) => correction.status === 'completed'))
      add('correction', key);
    const timeline: { agent?: string; attempt: Attempt }[] = [];
    for (const step of feature.steps)
      for (const attempt of step.attempts) {
        const attemptKey = `${key}:${step.id}:${attempt.id}`;
        const profile =
          attempt.profileSnapshot ??
          (step.status !== 'stale' && attempt === step.attempts.at(-1)
            ? {
                agentId: step.agentId,
                policy: step.policy,
                skillIds: step.skills,
                modelOverride: Boolean(step.model),
              }
            : undefined);
        timeline.push({ agent: profile?.agentId, attempt });
        if (attempt.approvedBy === 'human' && attempt.approvedAt) add('humanApprovals', attemptKey);
        for (const [question, answer] of Object.entries(attempt.answers))
          if (answer.trim()) {
            const origin = attempt.answerBindings?.[question]?.origin;
            add(
              'questionsAnswered',
              `${origin ? `${key}:${origin.stepId}:${origin.attemptId}` : attemptKey}:${question}`,
            );
          }
        if (attempt.artifactVersions?.some((version) => version.author === 'human'))
          add('reportsEdited', attemptKey);
        if (!succeeded(attempt)) continue;
        add('stepsRun', attemptKey);
        if (profile?.policy === 'read-only') add('readOnly', attemptKey);
        if (profile?.modelOverride) add('modelOverride', attemptKey);
        if (profile?.skillIds.length) add('skillUse', attemptKey);
        if (attempt.memorySnapshot?.length) add('memoryUse', attemptKey);
        if (
          attempt.launch?.initialContext.trim() ||
          Object.keys(attempt.launch?.contextBlocks ?? {}).length
        )
          add('context', attemptKey);
        if (attempt.review) add('review', attemptKey);
        if (
          attempt.evidence?.some(
            (evidence) => evidence.source === 'host' && evidence.exitCode === 0 && !evidence.error,
          )
        )
          add('testEvidence', attemptKey);
      }
    // A repeated agent starts a new distinct streak. Failures, interruptions and cancellations break it.
    timeline.sort((a, b) => a.attempt.startedAt.localeCompare(b.attempt.startedAt));
    let streak: string[] = [];
    let best = 0;
    for (const { agent, attempt } of timeline) {
      if (!succeeded(attempt) || !agent) {
        streak = [];
        continue;
      }
      const previous = streak.indexOf(agent);
      if (previous >= 0) streak = streak.slice(previous + 1);
      streak.push(agent);
      best = Math.max(best, streak.length);
    }
    for (let index = 1; index <= Math.min(best, 6); index++) add('relay', `relay-${index}`);
  }
  return facts;
}
export function discussionQuestFacts(state: DiscussionState): QuestFact[] {
  return state.discussions
    .filter((discussion) =>
      discussion.messages.some(
        (message) =>
          message.role === 'assistant' && message.status === 'complete' && message.content.trim(),
      ),
    )
    .map((discussion) => ({ metric: 'discussions', key: discussion.id }));
}
