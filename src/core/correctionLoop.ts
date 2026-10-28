import { createHash } from 'node:crypto';
import type { Feature } from '../shared/types';
import type {
  CorrectionLoopState,
  CorrectionObservation,
  CorrectionProblem,
  ScopedCorrectionCommand,
} from '../shared/correctionLoop';
import { currentTestEvidence, evidenceIsCurrent } from './validation';

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ');
const problem = (identity: unknown, message: string): CorrectionProblem => ({
  key: hash(identity),
  message: message.slice(0, 2000),
});
function contractData(feature: Feature, commands: ScopedCorrectionCommand[]) {
  return {
    description: feature.description,
    workflowFingerprint: hash({
      checkpoints: [...(feature.autopilot?.checkpoints ?? [])].sort(),
      stepInputs: feature.autopilot?.stepInputs,
      steps: feature.steps.map((s) => ({
        id: s.id,
        agentId: s.agentId,
        description: s.description,
        policy: s.policy,
        dependsOn: [...s.dependsOn].sort(),
        optional: s.optional,
        requiredQuality: s.requiredQuality,
        requiredDevOpsEvidence: s.requiredDevOpsEvidence,
        skills: s.skills,
        initialContext: s.initialContext,
        askBeforeRun: s.askBeforeRun,
        subplan: s.subplan,
      })),
    }),
    criteria: (feature.criteria ?? [])
      .map(({ id, text }) => ({ id, text }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    correctionStepId: feature.autopilot?.correctionStepId,
    reviewStepId: feature.autopilot?.reviewStepId,
    commands: commands
      .map((c) => ({
        projectId: c.projectId,
        id: c.id,
        name: c.name,
        command: c.command,
        args: [...c.args],
        quality: c.quality ? { kind: c.quality.kind, reportPath: c.quality.reportPath } : undefined,
      }))
      .sort((a, b) => `${a.projectId ?? ''}:${a.id}`.localeCompare(`${b.projectId ?? ''}:${b.id}`)),
  };
}
export function createCorrectionLoopState(
  feature: Feature,
  commands: ScopedCorrectionCommand[],
  at: string,
  id?: string,
): CorrectionLoopState {
  const data = contractData(feature, commands);
  return {
    contract: { ...data, id: id ?? hash([at, data]), createdAt: at, fingerprint: hash(data) },
    observations: [],
    stagnantCycles: 0,
    readiness: 'unverified',
  };
}
export function correctionContractMatches(
  state: CorrectionLoopState,
  feature: Feature,
  commands: ScopedCorrectionCommand[],
): boolean {
  return state.contract.fingerprint === hash(contractData(feature, commands));
}
const signature = (problems: CorrectionProblem[]): string =>
  problems
    .map((p) => p.key)
    .sort()
    .join(':');
/** Call only after the host has verified proof snapshots against the current workspace. */
export function observeCorrectionStep(
  state: CorrectionLoopState,
  feature: Feature,
  stepId: string,
  currentWorkspaceFingerprint?: string,
): CorrectionLoopState {
  if (!correctionContractMatches(state, feature, state.contract.commands))
    return { ...state, pause: 'contract_changed', readiness: 'unverified' };
  const step = feature.steps.find((s) => s.id === stepId);
  const attempt = step?.attempts.at(-1);
  if (!attempt || !step || !['awaiting_review', 'approved'].includes(step.status) || state.pause)
    return state;
  if (attempt.correctionLoop?.contractId !== state.contract.id)
    return { ...state, readiness: 'unverified' };
  const snapshotMatches = Boolean(
    currentWorkspaceFingerprint &&
      attempt.correctionLoop.workspaceFingerprint === currentWorkspaceFingerprint,
  );
  let next = state;
  const record = (
    kind: 'review' | 'test',
    checkKey: string,
    evidenceIds: string[],
    incoming: CorrectionProblem[],
    covered?: Set<string>,
  ) => {
    if (next.pause) return;
    // Failures remain useful without a snapshot; they cannot prove any resolution.
    if (!snapshotMatches) {
      if (!incoming.length) return;
      covered = new Set();
    }
    const id = hash([checkKey, attempt.id, evidenceIds]);
    if (next.observations.some((o) => o.id === id)) return;
    if (next.observations.length >= 80) {
      next = { ...next, pause: 'history_limit', readiness: 'unverified' };
      return;
    }
    const history = next.observations.filter((o) => o.checkKey === checkKey);
    const previous = history.at(-1);
    const problems = [
      ...new Map(
        [
          ...incoming,
          ...(covered ? (previous?.problems.filter((p) => !covered.has(p.key)) ?? []) : []),
        ].map((p) => [p.key, p]),
      ).values(),
    ].slice(0, 100);
    const before = new Set(previous?.problems.map((p) => p.key));
    const current = new Set(problems.map((p) => p.key));
    const persistent = [...current].filter((k) => before.has(k));
    const resolved = [...before].filter((k) => !current.has(k));
    const introduced = [...current].filter((k) => !before.has(k));
    // Progress requires actual resolution without replacing it with other failures.
    const stagnantCycles =
      previous && problems.length && (!resolved.length || introduced.length > 0)
        ? previous.stagnantCycles + 1
        : 0;
    const oscillating =
      problems.length > 0 &&
      history.length >= 2 &&
      signature(problems) === signature(history.at(-2)!.problems) &&
      signature(problems) !== signature(previous!.problems);
    const observation: CorrectionObservation = {
      id,
      stepId,
      attemptId: attempt.id,
      evidenceIds,
      ...(snapshotMatches ? { workspaceFingerprint: currentWorkspaceFingerprint } : {}),
      kind,
      checkKey,
      problems,
      persistent,
      resolved,
      introduced,
      stagnantCycles,
    };
    const observations = [...next.observations, observation];
    next = {
      ...next,
      observations,
      stagnantCycles,
      ...(oscillating
        ? { pause: 'oscillation' as const }
        : stagnantCycles >= (feature.autopilot?.correctionLoop?.maxStagnantCycles ?? 2)
          ? { pause: 'stagnation' as const }
          : {}),
      readiness: 'unverified',
    };
  };
  if (stepId === state.contract.reviewStepId && attempt.review) {
    const review = attempt.review;
    const findings = review.findings.filter(
      (f) =>
        f.severity === 'blocking' ||
        (review.verdict === 'changes_requested' && f.severity !== 'info'),
    );
    const problems = findings.map((f) =>
      problem([normalize(f.file ?? ''), normalize(f.message)], f.message),
    );
    if (review.verdict === 'changes_requested' && !problems.length)
      problems.push(problem(['review', normalize(review.summary)], review.summary));
    record('review', `review:${stepId}`, [], problems);
  }
  for (const proof of currentTestEvidence(attempt)) {
    const command = state.contract.commands.find(
      (c) => c.id === proof.commandId && c.projectId === proof.projectId,
    );
    if (
      !command ||
      command.command !== proof.command ||
      JSON.stringify(command.args) !== JSON.stringify(proof.args) ||
      proof.source !== 'host' ||
      proof.error ||
      proof.truncated ||
      !proof.finishedAt ||
      proof.exitCode === null ||
      !evidenceIsCurrent(attempt, proof)
    )
      continue;
    const quality = proof.quality;
    if (
      quality &&
      (quality.featureId !== feature.id ||
        quality.attemptId !== attempt.id ||
        quality.evidenceId !== proof.id ||
        quality.commandId !== proof.commandId ||
        !quality.reportSha256 ||
        !quality.cases.some((c) => c.status !== 'skipped') ||
        !['passed', 'failed'].includes(quality.status))
    )
      continue;
    const checkKey = `test:${proof.projectId ?? ''}:${proof.commandId}`;
    const caseProblem = (c: NonNullable<typeof quality>['cases'][number]) =>
      problem(
        [checkKey, normalize(c.title), [...c.criterionIds].sort(), normalize(c.expected ?? '')],
        c.title,
      );
    const problems = quality
      ? quality.cases.filter((c) => c.status === 'failed').map(caseProblem)
      : proof.exitCode !== 0
        ? [
            problem(
              [checkKey, 'process_failure'],
              `${proof.name}: échec du processus (code ${proof.exitCode}). Consulter la preuve ${proof.id}.`,
            ),
          ]
        : [];
    if (quality && proof.exitCode !== 0 && !problems.length) continue;
    record(
      'test',
      checkKey,
      [proof.id],
      problems,
      quality
        ? new Set(
            quality.cases.filter((c) => c.status !== 'skipped').map((c) => caseProblem(c).key),
          )
        : undefined,
    );
  }
  const latest = new Map(next.observations.map((o) => [o.checkKey, o]));
  const hasIssues = [...latest.values()].some((o) => o.problems.length);
  const freshObservation = (observation: CorrectionObservation | undefined): boolean => {
    if (
      !observation ||
      !currentWorkspaceFingerprint ||
      observation.workspaceFingerprint !== currentWorkspaceFingerprint
    )
      return false;
    const observedAttempt = feature.steps.find((s) => s.id === observation.stepId)?.attempts.at(-1);
    if (
      !observedAttempt ||
      observedAttempt.id !== observation.attemptId ||
      observedAttempt.correctionLoop?.contractId !== state.contract.id ||
      observedAttempt.correctionLoop.workspaceFingerprint !== currentWorkspaceFingerprint
    )
      return false;
    if (observation.kind === 'review') return true;
    return observation.evidenceIds.every((id) => {
      const proof = currentTestEvidence(observedAttempt).find((p) => p.id === id);
      return (
        proof &&
        proof.source === 'host' &&
        !proof.error &&
        !proof.truncated &&
        proof.exitCode === 0 &&
        evidenceIsCurrent(attempt, proof) &&
        (!proof.quality ||
          (proof.quality.status === 'passed' &&
            proof.quality.cases.length > 0 &&
            proof.quality.cases.every((c) => c.status === 'passed' && !c.errors.length)))
      );
    });
  };
  const testsCovered =
    next.contract.commands.length > 0 &&
    next.contract.commands.every((c) =>
      freshObservation(latest.get(`test:${c.projectId ?? ''}:${c.id}`)),
    );
  const reviewCovered =
    !next.contract.reviewStepId ||
    freshObservation(latest.get(`review:${next.contract.reviewStepId}`));
  return {
    ...next,
    readiness: hasIssues
      ? 'issues'
      : testsCovered && reviewCovered
        ? 'ready_for_human'
        : 'unverified',
  };
}
export function correctionLoopPauseReason(state?: CorrectionLoopState): string | undefined {
  if (state?.pause === 'contract_changed')
    return 'Le contrat de réussite a changé. Relis-le et renouvelle-le explicitement avant de reprendre.';
  if (state?.pause === 'history_limit')
    return 'La limite de 80 observations est atteinte. Relis le bilan et renouvelle explicitement le contrat pour poursuivre.';
  if (state?.pause === 'stagnation')
    return 'La boucle de correction stagne : aucun progrès vérifié. Une décision humaine est requise.';
  if (state?.pause === 'oscillation')
    return 'La boucle de correction oscille : des problèmes précédemment résolus réapparaissent. Une décision humaine est requise.';
  return undefined;
}
export function correctionLoopFeedback(state?: CorrectionLoopState): string {
  const last = state?.observations.at(-1);
  if (!last) return '';
  return `Suivi du contrat figé : ${last.resolved.length} problème(s) résolu(s), ${last.persistent.length} persistant(s), ${last.introduced.length} nouveau(x).\n${last.problems.map((p) => `- ${p.message}`).join('\n')}`.slice(
    0,
    12000,
  );
}
