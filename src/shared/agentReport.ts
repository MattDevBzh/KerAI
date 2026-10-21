import type { Feature } from './types';

/** Capture the selected saved report before opening the native save dialog. */
export function agentReport(
  feature: Feature,
  stepId: string,
  attemptId: string,
  revision: number,
): { filename: string; content: string } {
  const step = feature.steps.find((entry) => entry.id === stepId);
  const index = step?.attempts.findIndex((entry) => entry.id === attemptId) ?? -1;
  const attempt = step?.attempts[index];
  if (!step || !attempt?.artifact) throw new Error('Ce compte rendu est indisponible.');
  if (attempt.status === 'running')
    throw new Error('Attends la fin de cette tentative pour télécharger son compte rendu.');
  if ((attempt.revision ?? 0) !== revision)
    throw new Error('Le compte rendu a changé. Actualise-le avant de le télécharger.');
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'agent';
  return {
    filename: `rapport-${slug(feature.title)}-${slug(step.name)}-t${index + 1}-v${revision + 1}.md`,
    content: attempt.artifact.content,
  };
}
