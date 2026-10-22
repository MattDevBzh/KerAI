import { z } from 'zod';
import { NATIVE_PERMISSION_MODES } from '../shared/native';

export const nativePermissionModeSchema = z.enum(NATIVE_PERMISSION_MODES);
export const nativeContextLoadSchema = z
  .object({
    id: z.string().max(300),
    sessionId: z.string().max(300),
    at: z.string().max(64),
    kind: z.enum(['skill', 'instruction']),
    name: z.string().max(1000),
    path: z.string().max(4000),
    origin: z.string().max(300),
    trigger: z.string().max(300),
    triggerFile: z.string().max(4000).optional(),
    content: z.string().max(64000),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    truncated: z.boolean().optional(),
  })
  .strict();
export const nativeExecutionSchema = z
  .object({
    mode: z.literal('copilot-native'),
    permissionMode: nativePermissionModeSchema,
  })
  .strict();
export const nativeActivitySchema = z
  .object({
    id: z.string().max(300),
    source: z.literal('copilot'),
    sessionId: z.string().max(300),
    tool: z.string().max(300),
    startedAt: z.string().max(64),
    finishedAt: z.string().max(64).optional(),
    status: z.enum(['running', 'completed', 'failed', 'interrupted']),
    directory: z.string().max(4000),
    arguments: z.string().max(16000),
    command: z.string().max(16000).optional(),
    output: z.string().max(32000).optional(),
    exitCode: z.number().int().optional(),
    files: z.array(z.string().max(4000)).max(1000).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();
