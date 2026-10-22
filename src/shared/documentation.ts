export const DOCUMENT_FORMATS = ['md', 'docx', 'pptx', 'html'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export const documentFormatLabels: Record<DocumentFormat, string> = {
  md: 'Markdown',
  docx: 'Word',
  pptx: 'PowerPoint',
  html: 'Page HTML',
};
