export interface SessionGitChoice {
  preparationId: string;
  baseRef: string;
  baseCommit: string;
  branchName: string;
  allowCached: boolean;
}
export interface GitPreparation {
  id: string;
  branch: string;
  head: string;
  dirtyCount: number;
  remotes: string[];
  remote?: string;
  fetchedAt?: string;
  fetchError?: string;
  defaultRef?: string;
  branches: { name: string; ref: string; commit: string }[];
}
export const suggestedSessionBranch = (title: string) =>
  `codex/${
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'nouvelle-session'
  }`;
