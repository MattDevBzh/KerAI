export const DOCUMENT_FORMATS = ['md', 'docx', 'pptx', 'html', 'pdf', 'txt'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export const documentFormatLabels: Record<DocumentFormat, string> = {
  md: 'Markdown',
  docx: 'Word',
  pptx: 'PowerPoint',
  html: 'Page HTML',
  pdf: 'PDF',
  txt: 'Texte',
};

/** These editorial workflows need explicit acceptance, even in autopilot. */
export function requiresEditorialApproval(
  feature: { workflowId: string },
  step: { agentId: string },
) {
  return (
    ['documentation', 'presentation', 'code-audit'].includes(feature.workflowId) ||
    ['fs-doc-', 'fs-present-', 'fs-audit-'].some((prefix) => step.agentId.startsWith(prefix))
  );
}
