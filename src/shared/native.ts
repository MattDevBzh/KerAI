/** Collaboration pace and Copilot permissions are independent. */
export const NATIVE_PERMISSION_MODES = ['manual', 'assisted', 'allow-all'] as const;
export type NativePermissionMode = (typeof NATIVE_PERMISSION_MODES)[number];
export const permissionLabels: Record<NativePermissionMode, string> = {
  manual: 'Manuel',
  assisted: 'Assisté',
  'allow-all': 'Tout autoriser',
};
export interface NativeExecution {
  mode: 'copilot-native';
  permissionMode: NativePermissionMode;
}
export interface NativeCapabilities {
  available: boolean;
  tools: string[];
  permissionModes: NativePermissionMode[];
  error?: string;
}
/** Runtime events, never a claim made by the assistant. */
export interface NativeActivity {
  id: string;
  source: 'copilot';
  sessionId: string;
  tool: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  directory: string;
  arguments: string;
  command?: string;
  output?: string;
  exitCode?: number;
  files?: string[];
  truncated?: boolean;
}
export interface NativePermissionPrompt {
  kind: string;
  question: string;
  details: string;
}
export function usesNativeTools(input: {
  feature: { execution?: NativeExecution };
  mode?: 'discussion';
  observation?: boolean;
}): boolean {
  return input.feature.execution?.mode === 'copilot-native' && !input.mode && !input.observation;
}
