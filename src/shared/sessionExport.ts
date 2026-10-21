import { usageCredits } from './credits';
import type { Feature } from './types';

/** A local, deterministic export of the session, including the human editorial history. */
export function sessionMarkdown(feature: Feature, workspacePath: string): string {
  const parts = [
    `# ${feature.title}`,
    feature.description,
    `Branche : ${feature.branch}\nWorkflow : ${feature.workflowName}\nÉtat : ${feature.status}`,
    `Espace : ${feature.worktree?.path ?? workspacePath}`,
  ];
  if (feature.finalValidation)
    parts.push(
      `Validation définitive humaine : ${feature.finalValidation.at} · ${feature.finalValidation.id}`,
    );
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
      `## ${step.name} — ${step.status === 'skipped' ? 'Passée par l’humain — non exécutée' : step.status}`,
    );
    if (step.optional) parts.push('Intervention facultative.');
    for (const decision of step.optionalDecisionHistory ?? [])
      parts.push(
        `Décision humaine : ${decision.action === 'skip' ? 'Passer sans exécuter' : 'Exécuter'} · ${decision.at}${decision.id === step.optionalDecision?.id ? ' · décision actuelle' : ' · historique'}`,
      );
    if (step.status === 'skipped')
      parts.push('Aucun livrable ni preuve de tests : cette intervention n’a pas été exécutée.');
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
