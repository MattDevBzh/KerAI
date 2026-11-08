export interface WorkshopChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'unchanged' | 'conflict';
  before?: string;
  after?: string;
  binary?: boolean;
  beforeBytes: number;
  afterBytes: number;
  reason?: string;
}
export interface WorkshopPreview {
  token: string;
  kind: 'import' | 'restore';
  changes: WorkshopChange[];
  report: string;
  canApply: boolean;
}
export interface WorkshopHistory {
  id: string;
  createdAt: string;
  files: number;
  state: 'pending' | 'applied' | 'restored';
}
export type WorkshopClientMessage =
  | { type: 'workshopHistory' | 'workshopExport' | 'workshopImport'; requestId: string }
  | { type: 'workshopRestorePreview'; requestId: string; id: string }
  | { type: 'workshopApply'; requestId: string; token: string };
export interface WorkshopHostMessage {
  type: 'workshopResult';
  requestId: string;
  error?: string;
  cancelled?: boolean;
  message?: string;
  preview?: WorkshopPreview;
  history?: WorkshopHistory[];
}
