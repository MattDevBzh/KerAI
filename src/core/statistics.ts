import type { AgentProfile, Attempt, Feature } from '../shared/types';
import type { StudioProject } from '../shared/projects';
import type { StatsFilters, StatsGrain } from '../shared/statistics';
import { sessionProjects } from '../shared/sessionList';
import { effectiveModel } from './analytics';
import { toCredits } from '../shared/credits';

export const localDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function parseDay(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(+date) && localDay(date) === value ? date : undefined;
}
const shiftDay = (date: Date, count: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
export function statsRange(filters: StatsFilters, now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from: Date | undefined;
  let to: Date | undefined = shiftDay(today, 1);
  switch (filters.period) {
    case 'all':
      to = undefined;
      break;
    case 'custom':
      from = parseDay(filters.from);
      to = parseDay(filters.to);
      if (!from || !to || +from > +to)
        return { error: 'Choisis des dates valides, avec le début avant la fin.' };
      to = shiftDay(to, 1);
      break;
    case 'today':
      from = today;
      break;
    case '7d':
      from = shiftDay(today, -6);
      break;
    case '30d':
      from = shiftDay(today, -29);
      break;
    case '90d':
      from = shiftDay(today, -89);
      break;
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'previousMonth':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      break;
  }
  return { from, to, error: undefined };
}
export interface StatMeasure {
  value: number | null;
  known: number;
  partial: number;
  missing: number;
}
const measure = (): StatMeasure => ({ value: null, known: 0, partial: 0, missing: 0 });
const valid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
function add(target: StatMeasure, value: number | undefined, partial = false) {
  if (!valid(value)) {
    target.missing++;
    return;
  }
  target.value = (target.value ?? 0) + value;
  target.known++;
  if (partial) target.partial++;
}
export function attemptCredits(attempt: Attempt): number | undefined {
  const usage = attempt.usage;
  return usage?.source === 'measured' && usage.unit === 'nano-AIU' && valid(usage.cost)
    ? toCredits(usage.cost)
    : undefined;
}
export function attemptDuration(attempt: Attempt): number | undefined {
  if (!attempt.finishedAt) return;
  const value = Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt);
  return valid(value) ? value : undefined;
}
export interface StatsGroup {
  id: string;
  label: string;
  avatar?: string;
  attempts: number;
  sessionIds: Set<string>;
  credits: StatMeasure;
}
export interface ActivityBucket {
  key: string;
  created: number;
  completed: number;
  attempts: number;
  credits: StatMeasure;
}
function bucketKey(date: Date, grain: StatsGrain): string {
  if (grain === 'month') return localDay(new Date(date.getFullYear(), date.getMonth(), 1));
  if (grain === 'week') return localDay(shiftDay(date, -(date.getDay() + 6) % 7));
  return localDay(date);
}
export function analyzeStatistics(
  features: Feature[],
  filters: StatsFilters,
  catalog: StudioProject[] = [],
  agents: AgentProfile[] = [],
  now = new Date(),
) {
  const range = statsRange(filters, now);
  const inRange = (at?: string) => {
    if (!at || range.error) return false;
    const time = Date.parse(at);
    return (
      Number.isFinite(time) &&
      (!range.from || time >= +range.from) &&
      (!range.to || time < +range.to)
    );
  };
  const scoped = features.filter(
    (feature) =>
      (filters.includeArchived || !feature.archived) &&
      (!filters.workflow || feature.workflowId === filters.workflow) &&
      (!filters.project ||
        (filters.project === '__none'
          ? !feature.projects?.length
          : feature.projects?.some((project) => project.id === filters.project))),
  );
  const records = scoped
    .flatMap((feature) =>
      feature.steps.flatMap((step) =>
        step.attempts.map((attempt, index) => ({ feature, step, attempt, index })),
      ),
    )
    .filter(({ attempt }) => inRange(attempt.startedAt));
  const created = scoped.filter((feature) => inRange(feature.createdAt));
  const completed = scoped.filter(
    (feature) => feature.status === 'completed' && inRange(feature.finalValidation?.at),
  );
  const activeIds = new Set(
    [...created, ...completed, ...records.map((record) => record.feature)].map(
      (feature) => feature.id,
    ),
  );
  // Include undated legacy sessions only for an unbounded inventory; never invent activity dates.
  if (filters.period === 'all') scoped.forEach((feature) => activeIds.add(feature.id));
  const selected = scoped.filter((feature) => activeIds.has(feature.id));
  const dates = [
    ...created.map((feature) => feature.createdAt),
    ...completed.map((feature) => feature.finalValidation!.at),
    ...records.map(({ attempt }) => attempt.startedAt),
  ].map((at) => new Date(at));
  const earliest = dates.reduce((best, date) => (+date < +best ? date : best), now);
  const latest = dates.reduce((best, date) => (+date > +best ? date : best), now);
  const first = range.from ?? earliest;
  const last = range.to ? shiftDay(range.to, -1) : latest;
  const days = Math.max(
    1,
    Math.round(
      (Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
        Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) /
        86400000,
    ) + 1,
  );
  // Keep long histories bounded, including gaps: no silent truncation to the last N days.
  const grain: StatsGrain =
    (days > 366 && filters.grain === 'day') || (days > 2562 && filters.grain === 'week')
      ? 'month'
      : filters.grain;
  const buckets = new Map<string, ActivityBucket>();
  const bucket = (at: string) => {
    const key = bucketKey(new Date(at), grain);
    let item = buckets.get(key);
    if (!item) {
      item = { key, created: 0, completed: 0, attempts: 0, credits: measure() };
      buckets.set(key, item);
    }
    return item;
  };
  if (!range.error && selected.length) {
    let cursor = parseDay(bucketKey(first, grain))!;
    // Very long ranges display occupied buckets only.
    const maxBuckets = grain === 'month' ? Math.ceil(days / 28) : days;
    if (maxBuckets <= 600)
      while (+cursor <= +last) {
        bucket(cursor.toISOString());
        cursor =
          grain === 'month'
            ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
            : shiftDay(cursor, grain === 'week' ? 7 : 1);
      }
  }
  created.forEach((feature) => bucket(feature.createdAt).created++);
  completed.forEach((feature) => bucket(feature.finalValidation!.at).completed++);
  const agentGroups = new Map<string, StatsGroup>();
  const modelGroups = new Map<string, StatsGroup>();
  const credits = measure(),
    duration = measure(),
    prompts = measure(),
    reports = measure();
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const activeDays = new Map<string, number>();
  const sessionRuns = new Map<string, number>();
  const sessionCredits = new Map<string, StatMeasure>();
  const states = new Map<string, number>();
  const agentProfiles = new Map(agents.map((agent) => [agent.id, agent]));
  let retries = 0,
    failures = 0,
    cancelled = 0,
    interrupted = 0,
    fallbackModels = 0,
    legacyAgents = 0;
  const group = (
    map: Map<string, StatsGroup>,
    id: string,
    label: string,
    feature: Feature,
    attempt: Attempt,
    avatar?: string,
  ) => {
    const item = map.get(id) ?? {
      id,
      label,
      avatar,
      attempts: 0,
      sessionIds: new Set<string>(),
      credits: measure(),
    };
    item.attempts++;
    item.sessionIds.add(feature.id);
    add(item.credits, attemptCredits(attempt), attempt.usage?.incompleteCost);
    map.set(id, item);
  };
  for (const { feature, step, attempt, index } of records) {
    const cost = attemptCredits(attempt);
    add(credits, cost, attempt.usage?.incompleteCost);
    add(duration, attemptDuration(attempt));
    add(prompts, attempt.promptCharacters);
    add(reports, attempt.artifact ? attempt.artifact.content.length : undefined);
    const bar = bucket(attempt.startedAt);
    bar.attempts++;
    add(bar.credits, cost, attempt.usage?.incompleteCost);
    const date = new Date(attempt.startedAt);
    heatmap[(date.getDay() + 6) % 7][date.getHours()]++;
    activeDays.set(localDay(date), (activeDays.get(localDay(date)) ?? 0) + 1);
    sessionRuns.set(feature.id, (sessionRuns.get(feature.id) ?? 0) + 1);
    const sum = sessionCredits.get(feature.id) ?? measure();
    add(sum, cost, attempt.usage?.incompleteCost);
    sessionCredits.set(feature.id, sum);
    if (index > 0) retries++;
    if (attempt.status === 'failed') failures++;
    if (attempt.status === 'cancelled') cancelled++;
    if (attempt.status === 'interrupted') interrupted++;
    const agentId = attempt.profileSnapshot?.agentId ?? step.agentId;
    if (!attempt.profileSnapshot) legacyAgents++;
    const profile = agentProfiles.get(agentId);
    group(
      agentGroups,
      agentId,
      attempt.agentName || profile?.name || agentId,
      feature,
      attempt,
      profile?.avatar,
    );
    const model = effectiveModel(attempt);
    if (!attempt.usage?.model?.trim()) fallbackModels++;
    group(modelGroups, model, model, feature, attempt);
  }
  selected.forEach((feature) => states.set(feature.status, (states.get(feature.status) ?? 0) + 1));
  const rank = (groups: Map<string, StatsGroup>) =>
    [...groups.values()].sort(
      (a, b) => b.attempts - a.attempts || a.label.localeCompare(b.label, 'fr'),
    );
  const projects = new Map<
    string,
    { id: string; label: string; sessions: number; attempts: number }
  >();
  const workflows = new Map<
    string,
    { id: string; label: string; sessions: number; attempts: number }
  >();
  for (const feature of selected) {
    const targets = sessionProjects(feature, catalog);
    for (const target of targets.length
      ? targets
      : [{ id: '__none', name: 'Sans projet associé' }]) {
      const item = projects.get(target.id) ?? {
        id: target.id,
        label: target.name,
        sessions: 0,
        attempts: 0,
      };
      item.sessions++;
      item.attempts += sessionRuns.get(feature.id) ?? 0;
      projects.set(target.id, item);
    }
    const item = workflows.get(feature.workflowId) ?? {
      id: feature.workflowId,
      label: feature.workflowName || 'Équipe personnalisée',
      sessions: 0,
      attempts: 0,
    };
    item.sessions++;
    item.attempts += sessionRuns.get(feature.id) ?? 0;
    workflows.set(feature.workflowId, item);
  }
  let longestStreak = 0,
    streak = 0,
    previous: Date | undefined;
  for (const key of [...activeDays.keys()].sort()) {
    const current = parseDay(key)!;
    streak = previous && localDay(shiftDay(previous, 1)) === key ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    previous = current;
  }
  const busiest = [...activeDays].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const topSessions = selected
    .map((feature) => ({
      feature,
      attempts: sessionRuns.get(feature.id) ?? 0,
      credits: sessionCredits.get(feature.id) ?? measure(),
    }))
    .sort(
      (a, b) => b.attempts - a.attempts || a.feature.title.localeCompare(b.feature.title, 'fr'),
    );
  return {
    range,
    grain,
    sparseTimeline: days > 16800,
    selected,
    created: created.length,
    completed: completed.length,
    attempts: records.length,
    credits,
    duration,
    prompts,
    reports,
    agents: rank(agentGroups),
    models: rank(modelGroups),
    timeline: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    heatmap,
    states,
    averageSteps: selected.length
      ? selected.reduce((sum, feature) => sum + feature.steps.length, 0) / selected.length
      : null,
    averageRuns: selected.length ? records.length / selected.length : null,
    projects: [...projects.values()].sort(
      (a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label, 'fr'),
    ),
    workflows: [...workflows.values()].sort(
      (a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label, 'fr'),
    ),
    retries,
    failures,
    cancelled,
    interrupted,
    fallbackModels,
    legacyAgents,
    activeDays: activeDays.size,
    longestStreak,
    busiest,
    topSessions,
    undatedCompleted: scoped.filter(
      (feature) =>
        feature.status === 'completed' &&
        !Number.isFinite(Date.parse(feature.finalValidation?.at ?? '')),
    ).length,
    invalidDates: scoped.reduce(
      (sum, feature) =>
        sum +
        feature.steps.reduce(
          (n, step) =>
            n +
            step.attempts.filter((attempt) => !Number.isFinite(Date.parse(attempt.startedAt)))
              .length,
          0,
        ),
      0,
    ),
  };
}
