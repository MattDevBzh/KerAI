import { reviewTargetLabel } from './reviews';
import { usageCredits } from './credits';
import { skippedStepLabel } from './optionalSteps';
import type { Feature } from './types';
import type { CorrectionLoopState } from './correctionLoop';

// New diagnostic fields are plain text, not user-authored Markdown documents.
const markdownText = (value: string): string =>
  value.replace(/([\\`*_{}\[\]()#+.!|<>~-])/g, '\\$1').replace(/\r?\n/g, ' ');
const readinessLabels: Record<CorrectionLoopState['readiness'], string> = {
  unverified: 'Vérification incomplète',
  issues: 'Des problèmes restent à traiter',
  ready_for_human: 'Prêt pour la relecture humaine',
};
const pauseLabels: Record<NonNullable<CorrectionLoopState['pause']>, string> = {
  contract_changed: 'Le contrat a changé ; renouvellement humain requis',
  stagnation: 'Absence de progrès vérifié ; décision humaine requise',
  oscillation: 'Réapparition de problèmes résolus ; décision humaine requise',
  history_limit: 'Limite du journal atteinte ; décision humaine requise',
};
function correctionLoopMarkdown(feature: Feature): string[] {
  const pilot = feature.autopilot;
  if (!pilot?.correctionLoopState && !pilot?.correctionLoopHistory?.length) return [];
  const parts = [
    '## Suivi de la boucle de correction',
    `Suivi : ${pilot.correctionLoop ? 'activé' : 'désactivé ; historique conservé'}. Appels consommés : ${pilot.runs}/${pilot.maxRuns}. Cycles de correction consommés : ${pilot.correctionCycles}/${pilot.maxCorrectionCycles}.`,
    'Une relecture du modèle ne constitue pas une preuve de tests exécutés. Les références ci-dessous identifient les observations conservées ; elles ne remplacent ni leur vérification ni la validation définitive humaine.',
  ];
  const state = pilot.correctionLoopState;
  if (state) {
    const contract = state.contract;
    parts.push(
      `### Contrat courant · ${markdownText(contract.id)}`,
      `Figé le ${markdownText(contract.createdAt)}. Bilan : ${readinessLabels[state.readiness]}. Cycles comparables sans progrès : ${state.stagnantCycles}${pilot.correctionLoop ? `/${pilot.correctionLoop.maxStagnantCycles}` : ''}.`,
      `Pause : ${state.pause ? pauseLabels[state.pause] : 'aucun arrêt du suivi enregistré'}.`,
      `Objectif figé : ${markdownText(contract.description)}`,
      `Critères figés :\n${contract.criteria.map((c) => `- ${markdownText(c.id)} : ${markdownText(c.text)}`).join('\n') || 'Aucun critère enregistré.'}`,
      `Route : correction ${markdownText(contract.correctionStepId ?? 'non définie')} → relecture ${markdownText(contract.reviewStepId ?? 'non définie')}.`,
      `Commandes prévues :\n${contract.commands.map((c) => `- ${markdownText(c.projectId ? `${c.projectId} / ${c.id}` : c.id)} · ${markdownText(c.name)} : ${markdownText([c.command, ...c.args].join(' '))}${c.quality ? ` · rapport ${markdownText(c.quality.kind)} : ${markdownText(c.quality.reportPath)}` : ''}`).join('\n') || 'Aucune commande ; aucun succès de tests ne peut être déduit de la seule relecture.'}`,
    );
    if (!state.observations.length) parts.push('Aucune observation dans ce contrat.');
    for (const [index, observation] of state.observations.entries()) {
      const keys = (values: string[]) => values.map(markdownText).join(', ') || 'aucun';
      parts.push(
        `#### Observation ${index + 1} · ${observation.kind === 'test' ? 'test exécuté' : 'constat de relecture'}`,
        `Identifiant : ${markdownText(observation.id)}. Étape : ${markdownText(observation.stepId)}. Tentative : ${markdownText(observation.attemptId)}.`,
        `Résolus : ${observation.resolved.length} ; persistants : ${observation.persistent.length} ; nouveaux : ${observation.introduced.length}. Cycles comparables sans progrès : ${observation.stagnantCycles}.`,
        `Identifiants résolus : ${keys(observation.resolved)}.\nIdentifiants persistants : ${keys(observation.persistent)}.\nIdentifiants nouveaux : ${keys(observation.introduced)}.`,
        `Références de preuves : ${observation.evidenceIds.length ? observation.evidenceIds.map(markdownText).join(', ') : 'aucune ; un constat du modèle ne prouve pas une exécution de tests'}.`,
      );
      if (observation.problems.length)
        parts.push(
          `Problèmes observés :\n${observation.problems.map((problem) => `- ${markdownText(problem.key)} : ${markdownText(problem.message)}`).join('\n')}`,
        );
    }
  }
  if (pilot.correctionLoopHistory?.length) {
    parts.push(
      '### Contrats précédents',
      'Résumés des contrats archivés ; leurs bilans décrivent leur état au renouvellement, pas les preuves actuelles.',
    );
    for (const previous of pilot.correctionLoopHistory)
      parts.push(
        `- ${markdownText(previous.contract.id)} · ${markdownText(previous.contract.createdAt)} · ${readinessLabels[previous.readiness]} · ${previous.observations.length} observation(s), ${previous.contract.criteria.length} critère(s), ${previous.stagnantCycles} cycle(s) comparable(s) sans progrès.${previous.pause ? ` Arrêt : ${pauseLabels[previous.pause]}.` : ''}\n  Objectif : ${markdownText(previous.contract.description)}`,
      );
  }
  return parts;
}

/** A local, deterministic export of the session, including the human editorial history. */
export function sessionMarkdown(feature: Feature, workspacePath: string): string {
  const parts = [
    `# ${feature.title}`,
    feature.description,
    `Branche : ${feature.branch}\nWorkflow : ${feature.workflowName}\nÉtat : ${feature.status}`,
    `Espace : ${feature.worktree?.path ?? workspacePath}`,
  ];
  if (feature.reviewTarget)
    parts.push(
      `Cible de relecture : ${markdownText(reviewTargetLabel(feature.reviewTarget))}${feature.reviewTarget.kind === 'pull-request' ? `\nURL : ${markdownText(feature.reviewTarget.url)}` : ''}`,
    );
  if (feature.finalValidation)
    parts.push(
      `Validation définitive humaine : ${feature.finalValidation.at} · ${feature.finalValidation.id}`,
    );
  parts.push(...correctionLoopMarkdown(feature));
  for (const version of feature.descriptionVersions ?? [])
    parts.push(
      `## Besoin · révision ${version.revision}\n${version.at} · ${version.author}${version.reason ? `\nMotif : ${version.reason}` : ''}\n\n${version.content}`,
    );
  for (const cycle of feature.corrections ?? [])
    parts.push(
      `## Correction · ${cycle.id}\n${cycle.createdAt} · ${cycle.status}\nDépart : ${cycle.rootStepIds.join(', ')}\nÉtapes concernées : ${cycle.impactedStepIds.join(', ')}\nOrigine : ${cycle.sourceStepId} · tentative ${cycle.snapshot.sourceAttemptId} · révision ${cycle.snapshot.sourceRevision}\n\n${cycle.feedback}${cycle.initialContext ? `\n\nContexte complémentaire :\n${cycle.initialContext}` : ''}`,
    );
  for (const checkpoint of feature.checkpoints ?? [])
    parts.push(
      `Point de restauration : ${checkpoint.label} · ${checkpoint.kind} · ${checkpoint.createdAt} · ${checkpoint.fileCount} fichiers · ${checkpoint.excludedCount} exclusions · ${checkpoint.id}`,
    );
  for (const step of feature.steps) {
    parts.push(
      `## ${step.name} — ${step.status === 'skipped' ? skippedStepLabel(step) : step.status}`,
    );
    if (step.optional) parts.push('Intervention facultative.');
    for (const decision of step.optionalDecisionHistory ?? [])
      parts.push(
        `Décision humaine : ${decision.action === 'skip' ? (step.attempts.some((attempt) => attempt.startedAt <= decision.at) ? 'Passer sans valider le résultat' : 'Passer sans exécuter') : 'Exécuter'} · ${decision.at}${decision.id === step.optionalDecision?.id ? ' · décision actuelle' : ' · historique'}`,
      );
    if (step.status === 'skipped')
      parts.push(
        step.attempts.length
          ? 'Tentatives et modifications conservées ; aucun résultat validé pour cette intervention.'
          : 'Aucun livrable ni preuve de tests : cette intervention n’a pas été exécutée.',
      );
    for (const [index, attempt] of step.attempts.entries()) {
      parts.push(
        `### Tentative ${index + 1}\n${attempt.startedAt} · ${attempt.model || 'modèle non communiqué'} · ${attempt.status}`,
        attempt.artifact?.content ?? attempt.error ?? 'Aucun livrable.',
      );
      for (const version of attempt.artifactVersions ?? [])
        parts.push(
          `#### Compte rendu · révision ${version.revision}\n${version.at} · ${version.author}${version.reason ? `\nMotif : ${version.reason}` : ''}\n\n${version.content}`,
        );
      if (attempt.pair) {
        parts.push(
          `#### Travail en pair\nMode : ${attempt.pair.mode} · État : ${attempt.pair.phase} · ${attempt.pair.calls} appels\nPréférences : ${JSON.stringify(attempt.pair.preferences)}`,
        );
        for (const plan of attempt.pair.plans)
          parts.push(
            `#### Organisation ${plan.revision} · ${plan.acceptedAt ? 'validée par l’humain' : 'proposée'}\n${plan.summary}\n${plan.blocks.map((block) => `- ${block.title} : ${block.description}`).join('\n')}`,
          );
        for (const message of attempt.pair.messages)
          parts.push(
            `#### Échange · ${message.role} · ${message.at} · ${message.status}\n\n${message.content}`,
          );
      }
      if (attempt.feedback) parts.push(`Feedback : ${attempt.feedback}`);
      if (attempt.launch?.initialContext)
        parts.push(`Contexte initial :\n${attempt.launch.initialContext}`);
      if (attempt.usage)
        parts.push(
          `Consommation : ${usageCredits(attempt.usage)}. Tokens entrée : ${attempt.usage.inputTokens ?? 'inconnus'} ; sortie : ${attempt.usage.outputTokens ?? 'inconnus'}.`,
        );
      for (const proof of attempt.evidence ?? [])
        parts.push(
          `#### Preuve hôte · ${proof.name}\n${proof.command} ${proof.args.join(' ')}\n${proof.startedAt} → ${proof.finishedAt}\nCode : ${proof.exitCode ?? 'inconnu'}${proof.truncated ? ' · sortie tronquée' : ''}\n\n\`\`\`text\n${proof.stdout}\n${proof.stderr}\n\`\`\``,
        );
      for (const question of attempt.questions)
        parts.push(
          `- ${question.text}\n  Réponse : ${attempt.answers[question.id] ?? 'En attente'}`,
        );
    }
  }
  return parts.join('\n\n');
}
