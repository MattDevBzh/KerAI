import { z } from 'zod';
import { discussionAgentSchema } from '../core/discussionSchemas';
import type { Attempt, Feature, FeatureStep } from '../shared/types';
import type { DiscussionSource } from '../shared/discussions';
import type { SessionArchive } from './SessionArchive';
import { redact } from './process';

const launchSchema = z.object({
  prompt: z.string(),
  agent: discussionAgentSchema,
  settings: z.object({ defaultModel: z.string().optional() }).optional(),
  execution: z
    .object({ model: z.string().optional(), reasoning: z.string().optional() })
    .optional(),
  resumeSessionId: z.string().optional(),
});

/** Reuses archived inputs, never today's agent profile or today's dependency reports. */
export async function reportDiscussionSource(
  feature: Feature,
  step: FeatureStep,
  attempt: Attempt,
  archive: SessionArchive,
): Promise<DiscussionSource> {
  if (!attempt.artifact || attempt.status === 'running')
    throw new Error('Attendez la fin de cette tentative et son compte rendu.');
  const warnings: string[] = [];
  const related = new Set(
    step.attempts
      .slice(0, step.attempts.findIndex((item) => item.id === attempt.id) + 1)
      .filter(
        (item) =>
          item.id === attempt.id || (attempt.sessionId && item.sessionId === attempt.sessionId),
      )
      .map((item) => item.id),
  );
  let launchText = '';
  const journal: { type: string; data: string }[] = [];
  let journalSize = 0,
    omitted = false;
  // Archive splits long records into ordered 24k-character parts. Joining the launch parts
  // before JSON parsing is necessary for real prompts, including large selected skills.
  for await (const trace of archive.read()) {
    if (!trace.attemptId || !related.has(trace.attemptId)) continue;
    if (trace.type === 'host.launch' && trace.attemptId === attempt.id) {
      launchText += trace.data;
      if (launchText.length > 2_000_000) throw new Error('Contexte archivé trop volumineux.');
      continue;
    }
    if (
      trace.type !== 'host.launch' &&
      !/^sdk\.(user\.message|assistant\.message|tool\.|subagent\.|session\.compaction)/.test(
        trace.type,
      )
    )
      continue;
    if (journalSize + trace.data.length > 100_000) {
      omitted = true;
      continue;
    }
    journal.push({ type: trace.type, data: trace.data });
    journalSize += trace.data.length;
  }
  if (!launchText)
    throw new Error(
      'Cette ancienne tentative ne possède pas de contexte archivé. Une nouvelle exécution permettra de discuter avec sa configuration d’origine.',
    );
  const parsed = launchSchema.safeParse(JSON.parse(launchText));
  if (!parsed.success)
    throw new Error('La configuration archivée de cet agent est incomplète ou illisible.');
  const launch = parsed.data;
  const contextValue = () =>
    JSON.stringify({
      launchPrompt: launch.prompt,
      journal,
      questions: attempt.questions,
      answers: attempt.answers,
    });
  const originalOutput = attempt.artifactVersions?.find(
    (version) => version.author === 'agent',
  )?.content;
  const outputSize =
    JSON.stringify(attempt.artifact.content).length +
    (originalOutput && originalOutput !== attempt.artifact.content
      ? JSON.stringify(originalOutput).length
      : 0);
  // Keep launch instructions and the report intact; bound supplemental traces explicitly.
  while (journal.length && contextValue().length + outputSize > 130000) {
    journal.shift();
    omitted = true;
  }
  if (!launch.execution)
    warnings.push('Ancienne exécution : le niveau de raisonnement d’origine n’a pas été archivé.');
  if (!archive.info.complete || attempt.traceArchive?.complete === false)
    warnings.push('Le journal de cette exécution est incomplet.');
  if (omitted)
    warnings.push(
      'Le journal dépasse la capacité du chat : une partie des échanges et résultats d’outils est omise. Le contexte de lancement et le compte rendu sont conservés.',
    );
  if (launch.resumeSessionId && related.size === 1)
    warnings.push('L’historique précédant la reprise de cette tentative n’est pas disponible.');
  const model =
    attempt.model ||
    launch.execution?.model ||
    launch.agent.model ||
    launch.settings?.defaultModel ||
    undefined;
  if (!model)
    warnings.push(
      'Le modèle d’origine n’a pas été communiqué ; le modèle automatique sera utilisé.',
    );
  return {
    featureId: feature.id,
    featureTitle: feature.title,
    stepId: step.id,
    stepName: step.name,
    attemptId: attempt.id,
    revision: attempt.revision ?? 0,
    capturedAt: new Date().toISOString(),
    agent: { ...launch.agent, roastLevel: attempt.roastLevel ?? launch.agent.roastLevel },
    model,
    reasoning: launch.execution?.reasoning,
    context: redact(contextValue()),
    output: redact(attempt.artifact.content),
    ...(originalOutput && originalOutput !== attempt.artifact.content
      ? { originalOutput: redact(originalOutput) }
      : {}),
    warnings,
  };
}
