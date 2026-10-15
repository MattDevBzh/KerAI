import type { Tool } from '@github/copilot-sdk';
import type { RunInput, RunCallbacks, RunPreview } from '../shared/types';
import type { RunProject } from '../shared/projects';
import { projectFile, projectHashes, splitProjectFile } from '../shared/projects';
import { ToolHost, gitInfo } from './ToolHost';
import { inspectExistingChanges, backupExistingChanges } from './ExistingChanges';
import type { DevOpsInspector } from './DevOpsInspector';
import path from 'node:path';

export function projectInput(input: RunInput, project: RunProject): RunInput {
  const local = structuredClone(input);
  local.workspacePath = project.path;
  local.settings = structuredClone(project.settings);
  local.devopsProjectKey = project.devopsProjectKey;
  local.feature.branch = project.branch;
  local.feature.worktree = undefined;
  local.feature.workspaceFileHashes = projectHashes(
    input.feature,
    project.id,
    input.feature.workspaceFileHashes,
  );
  for (const step of local.feature.steps)
    for (const attempt of step.attempts) {
      attempt.fileHashes = projectHashes(input.feature, project.id, attempt.fileHashes);
      attempt.changedFiles = attempt.changedFiles
        .filter((file) => file.startsWith(`@${project.id}/`))
        .map((file) => file.slice(project.id.length + 2));
    }
  local.existingChangeGrants = projectHashes(input.feature, project.id, input.existingChangeGrants);
  if (local.launch)
    local.launch.editableExistingFiles = (input.launch?.editableExistingFiles ?? [])
      .filter((file) => splitProjectFile(input.feature, file).project?.id === project.id)
      .map((file) => splitProjectFile(input.feature, file).path);
  // Evidence IDs remain globally unique, and quality artifacts have a project-owned directory.
  if (input.qualityStoragePath)
    local.qualityStoragePath = path.join(input.qualityStoragePath, project.id);
  return local;
}

export async function inspectProjectChanges(
  input: RunInput,
): Promise<NonNullable<RunPreview['existingChanges']>> {
  if (!input.projects || input.projects.length < 2)
    return inspectExistingChanges(input, (await gitInfo(input.workspacePath)).dirty);
  for (const file of input.launch?.editableExistingFiles ?? [])
    splitProjectFile(input.feature, file);
  const files: NonNullable<RunPreview['existingChanges']>['files'] = [];
  let omittedCount = 0;
  input.existingChangeGrants = {};
  for (const project of input.projects) {
    const local = projectInput(input, project);
    const result = await inspectExistingChanges(local, (await gitInfo(project.path)).dirty);
    files.push(
      ...result.files.map((file) => ({
        ...file,
        path: projectFile(input.feature, project.id, file.path),
      })),
    );
    omittedCount += result.omittedCount;
    for (const [file, hash] of Object.entries(local.existingChangeGrants ?? {}))
      input.existingChangeGrants[projectFile(input.feature, project.id, file)] = hash;
  }
  return { files, omittedCount };
}

export async function backupProjectChanges(input: RunInput, storage: string, signal: AbortSignal) {
  if (!input.projects || input.projects.length < 2)
    return backupExistingChanges(input, storage, signal);
  const backups: string[] = [];
  for (const project of input.projects) {
    const result = await backupExistingChanges(
      projectInput(input, project),
      path.join(storage, 'projects', project.id),
      signal,
    );
    if (result) backups.push(result);
  }
  return backups.length ? backups.join('\n') : undefined;
}

/** Every repository operation selects one authorized project; no filesystem alias or parent root. */
export class MultiProjectTools {
  private hosts = new Map<string, ToolHost>();
  constructor(
    private input: RunInput,
    private callbacks: RunCallbacks,
    private signal: AbortSignal,
    private inspector?: (projectId: string, signal: AbortSignal) => DevOpsInspector,
  ) {}
  get changedFiles(): Set<string> {
    return new Set(
      [...this.hosts].flatMap(([id, host]) =>
        [...host.changedFiles].map((file) => projectFile(this.input.feature, id, file)),
      ),
    );
  }
  get fileHashes(): Record<string, string> {
    return Object.fromEntries(
      [...this.hosts].flatMap(([id, host]) =>
        Object.entries(host.fileHashes).map(([file, hash]) => [
          projectFile(this.input.feature, id, file),
          hash,
        ]),
      ),
    );
  }
  async createTools(): Promise<Tool[]> {
    const available = new Map<string, Map<string, Tool>>();
    for (const project of this.input.projects ?? []) {
      const host = new ToolHost(
        projectInput(this.input, project),
        {
          ...this.callbacks,
          onEvent: (event) =>
            this.callbacks.onEvent({ ...event, message: `[${project.name}] ${event.message}` }),
          onEvidence: (evidence) =>
            this.callbacks.onEvidence?.({
              ...evidence,
              projectId: project.id,
              name: `${project.name} · ${evidence.name}`,
              fileHashes: Object.fromEntries(
                Object.entries(evidence.fileHashes).map(([file, hash]) => [
                  projectFile(this.input.feature, project.id, file),
                  hash,
                ]),
              ),
            }),
        },
        this.signal,
        this.inspector ? (signal) => this.inspector!(project.id, signal) : undefined,
      );
      this.hosts.set(project.id, host);
      for (const tool of await host.createTools()) {
        if (!available.has(tool.name)) available.set(tool.name, new Map());
        available.get(tool.name)!.set(project.id, tool);
      }
    }
    return [...available].map(([name, projectTools]) => {
      const base = projectTools.values().next().value!;
      const parameters = base.parameters as {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      return {
        ...base,
        name,
        description: `${name === 'studio_run_test' ? [...projectTools].map(([id, tool]) => `${id}: ${tool.description}`).join('\n') : base.description} Select projectId explicitly; paths are relative to that project. Projects: ${(this.input.projects ?? []).map((project) => `${project.id}=${project.name}`).join(', ')}.`,
        parameters: {
          ...parameters,
          type: 'object',
          properties: {
            ...parameters.properties,
            projectId: { type: 'string', enum: [...projectTools.keys()] },
          },
          required: [...(parameters.required ?? []), 'projectId'],
        },
        handler: async (raw, invocation) => {
          if (
            !raw ||
            typeof raw !== 'object' ||
            Array.isArray(raw) ||
            !('projectId' in raw) ||
            typeof raw.projectId !== 'string' ||
            !projectTools.has(raw.projectId)
          )
            return {
              resultType: 'failure',
              textResultForLlm: 'Choisis explicitement un projectId autorisé pour cet outil.',
              error: 'Unknown project',
            };
          const { projectId, ...args } = raw as Record<string, unknown> & { projectId: string };
          const result = await projectTools.get(projectId)!.handler!(args, {
            ...invocation,
            arguments: args,
          });
          return result;
        },
      };
    });
  }
}
