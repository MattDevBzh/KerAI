export const PR_CONTEXT_CHUNK = 12000;
export const PR_CONTEXT_MAX_SELECTED = 80000;
export const PR_CONTEXT_MAX_ITEMS = 40;
export type PrSessionContextKind =
  | 'need'
  | 'document'
  | 'report'
  | 'exchange'
  | 'instruction'
  | 'launch'
  | 'decision';
export interface PrSessionContextItem {
  id: string;
  digest: string;
  kind: PrSessionContextKind;
  label: string;
  origin: string;
  content: string;
}
export interface PrSessionContextSelection {
  id: string;
  digest: string;
}
export interface PrSessionContextCatalog {
  featureId: string;
  title: string;
  summary: string;
  items: PrSessionContextItem[];
  warnings: string[];
}
export interface PrSessionContextSnapshot {
  summary: string;
  sources: PrSessionContextItem[];
  fingerprint: string;
  warnings: string[];
}
export const prSessionContextLabels: Record<PrSessionContextKind, string> = {
  need: 'Besoin',
  document: 'Document importé',
  report: 'Compte rendu',
  exchange: 'Échange',
  instruction: 'Consigne',
  launch: 'Contexte de lancement',
  decision: 'Décision et retour',
};
