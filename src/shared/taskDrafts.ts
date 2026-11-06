import type { ImageAttachment } from './images';
import type { NativePermissionMode } from './native';
import type { DiscussionFeatureDraft } from './discussions';
export interface TaskDraft {
  id: string;
  revision: number;
  title: string;
  description: string;
  starter: import('./sessionStarters').SessionStarterId;
  projectIds: string[];
  isolated: boolean;
  permissionMode: NativePermissionMode;
  images: ImageAttachment[];
  pair?: boolean;
  progression?: 'guided' | 'balanced';
  origin?: { discussionId: string; draft: DiscussionFeatureDraft };
  updatedAt: string;
}
export type TaskDraftCommand =
  | { type: 'listTaskDrafts' }
  | { type: 'saveTaskDraft'; draft: TaskDraft; requestId: string }
  | { type: 'deleteTaskDraft'; id: string; revision: number; requestId: string };
export type TaskDraftEvent = {
  type: 'taskDrafts';
  drafts: TaskDraft[];
  requestId?: string;
  error?: string;
};
