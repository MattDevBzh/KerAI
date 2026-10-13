/** Host-owned scopes: the client never supplies a destination path. */
export type ProfileScope = 'user' | 'workspace';
export type ProfileSource = ProfileScope | 'bundled';
export interface ProfileTarget {
  path: string;
  /** null means the target was absent when the editor opened. */
  revision: string | null;
}
export interface ProfileSaveOptions {
  scope: ProfileScope;
  expectedRevision: string | null;
  /** Metadata for an explicit copy from another scope. */
  sourceScope?: ProfileSource;
  sourceRevision?: string;
}
export interface ProfileSaveResult {
  path: string;
  revision: string;
  scope: ProfileScope;
}
