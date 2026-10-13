import type { Feature } from '../shared/types';
import { needsDevOpsEvidence } from '../shared/devopsKit';
import { budgetBlockReason } from './budgets';
import {
  approvalBlockers,
  currentTestEvidence,
  evidenceIsCurrent,
  featureCompletionBlockers,
} from './validation';

export type AutopilotAction =
  | { kind: 'run'; stepId: string; feedback?: string; resume?: boolean }
  | { kind: 'approve'; stepId: string }
  | { kind: 'correct'; stepId: string; feedback: string }
  | { kind: 'pause'; reason: string }
  | { kind: 'complete' };
export function nextAutopilotAction(feature: Feature): AutopilotAction {
  const pilot = feature.autopilot;
  const pause = (reason: string): AutopilotAction => ({ kind: 'pause', reason });
  if (!pilot || pilot.status !== 'running')
    return pause(pilot?.reason ?? 'Le pilote automatique est arrêté.');
  if (feature.archived) return pause('Cette feature est archivée.');
  if (feature.steps.some((step) => step.status === 'running'))
    return pause('Une tentative est déjà en cours.');
  const stopped = feature.steps.find((step) =>
    ['failed', 'cancelled', 'interrupted'].includes(step.status),
  );
  if (stopped)
    return pause(`La tentative ${stopped.name} est ${stopped.status}. Reprise manuelle requise.`);
  if (
    feature.steps.some(
      (step) =>
        step.status === 'waiting_input' &&
        step.attempts.at(-1)?.questions.some((q) => !step.attempts.at(-1)!.answers[q.id]?.trim()),
    )
  )
    return pause('Des questions humaines attendent une réponse.');
  if (feature.steps.every((step) => step.status === 'approved')) {
    const blockers = featureCompletionBlockers(feature);
    return blockers.length ? pause(blockers.join(' ')) : { kind: 'complete' };
  }
  const available = feature.steps.filter(
    (step) =>
      step.status !== 'approved' &&
      step.dependsOn.every((dep) => feature.steps.find((s) => s.id === dep)?.status === 'approved'),
  );
  const step =
    available.find((s) => s.status === 'waiting_input') ??
    available.find((s) => s.status === 'awaiting_review') ??
    available[0];
  if (!step) return pause('Aucune étape disponible : vérifier les dépendances et validations.');
  const attempt = step.attempts.at(-1);
  if (attempt?.questions.some((q) => !attempt.answers[q.id]?.trim()))
    return pause('Des questions humaines attendent une réponse.');
  if (['failed', 'cancelled', 'interrupted'].includes(step.status))
    return pause(`La tentative est ${step.status}. Reprise manuelle requise.`);
  const callBlocker = () =>
    budgetBlockReason(feature) ??
    (pilot.runs >= pilot.maxRuns ? 'Nombre maximal de runs du pilote atteint.' : undefined);
  if (step.status === 'awaiting_review') {
    if (pilot.checkpoints.includes(step.id))
      return pause(`Validation humaine requise : ${step.name}.`);
    const failedTests = attempt
      ? currentTestEvidence(attempt).filter(
          (proof) =>
            !proof.error &&
            evidenceIsCurrent(attempt, proof) &&
            (proof.quality
              ? proof.quality.status === 'failed' &&
                proof.quality.cases.some((c) => c.status === 'failed')
              : proof.exitCode !== null && proof.exitCode !== 0),
        )
      : [];
    const requestedChanges =
      step.id === pilot.reviewStepId && attempt?.review?.verdict === 'changes_requested';
    if (failedTests.length || requestedChanges) {
      if (!pilot.correctionStepId)
        return pause(
          'Des corrections sont nécessaires ; aucune route de correction n’est configurée.',
        );
      if (pilot.correctionCycles >= pilot.maxCorrectionCycles)
        return pause('Nombre maximal de cycles de correction atteint.');
      const target = feature.steps.find((s) => s.id === pilot.correctionStepId);
      const upstream = (id: string, visited = new Set<string>()): boolean => {
        if (visited.has(id)) return false;
        visited.add(id);
        return (
          feature.steps
            .find((s) => s.id === id)
            ?.dependsOn.some((dep) => dep === target?.id || upstream(dep, visited)) ?? false
        );
      };
      if (
        !target ||
        target.id === step.id ||
        !upstream(step.id) ||
        !target.dependsOn.every(
          (dep) => feature.steps.find((s) => s.id === dep)?.status === 'approved',
        )
      )
        return pause('Route de correction indisponible.');
      if (target.askBeforeRun)
        return pause('La correction exige une confirmation avant exécution.');
      if (target.attempts.length >= target.maxAttempts)
        return pause('Nombre maximal de tentatives de correction atteint.');
      const budget = callBlocker();
      if (budget) return pause(budget);
      const feedback = failedTests.length
        ? failedTests
            .map(
              (proof) =>
                `Test ${proof.name} (${proof.commandId}) : code ${proof.exitCode}\n${proof.stderr || proof.stdout}\n${
                  proof.quality?.cases
                    .filter((c) => c.status === 'failed')
                    .map(
                      (c) =>
                        `${c.title} [${c.criterionIds.join(', ')}]\nAttendu : ${c.expected ?? ''}\nObservé : ${c.actual ?? c.errors.join('; ')}\nReproduction : ${(c.reproduction ?? c.steps).join(' → ')}\nPreuve : ${proof.id}`,
                    )
                    .join('\n\n') ?? ''
                }`,
            )
            .join('\n\n')
        : `${attempt!.review!.summary}\n${attempt!.review!.findings.map((f) => `[${f.severity}] ${f.message}`).join('\n')}`;
      return { kind: 'correct', stepId: target.id, feedback: feedback.slice(0, 20000) };
    }
    const blockers = approvalBlockers(feature, step, 'autopilot');
    return blockers.length ? pause(blockers.join(' ')) : { kind: 'approve', stepId: step.id };
  }
  if (needsDevOpsEvidence(step))
    return pause(
      'Mets en place et lance le test hors production, puis renseigne ses références dans le lancement manuel de la validation DevOps.',
    );
  if (step.askBeforeRun) return pause(`Confirmation avant exécution requise : ${step.name}.`);
  if (step.attempts.length >= step.maxAttempts)
    return pause('Nombre maximal de tentatives atteint.');
  const budget = callBlocker();
  if (budget) return pause(budget);
  return {
    kind: 'run',
    stepId: step.id,
    ...(step.status === 'waiting_input' && attempt?.sessionId ? { resume: true } : {}),
  };
}
