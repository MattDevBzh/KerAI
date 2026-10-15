import type { Feature, StudioSettings } from './types';

export interface StudioProject {
  id: string;
  name: string;
  path: string;
  hidden?: boolean;
}
export interface FeatureProject extends StudioProject {
  branch: string;
}
export interface RunProject extends FeatureProject {
  settings: StudioSettings;
  devopsProjectKey?: string;
}
export interface ProjectCatalogState {
  projects: StudioProject[];
  selectedProjectIds: string[];
  activeProjectId?: string;
  dedicated: boolean;
  windows: boolean;
  errors?: string[];
}
export type ProjectClientMessage =
  | { type: 'addProjects'; requestId: string }
  | { type: 'renameProject'; projectId: string; name: string; requestId: string }
  | { type: 'hideProject'; projectId: string; hidden: boolean; requestId: string }
  | { type: 'selectProjects'; projectIds: string[]; requestId: string }
  | { type: 'activateFeature'; featureId: string }
  | { type: 'activateProject'; projectId: string }
  | { type: 'openDedicatedWindow' | 'createWindowsShortcut'; requestId: string };

export function projectFile(feature: Feature, projectId: string, relative: string): string {
  return (feature.projects?.length ?? 0) > 1 ? `@${projectId}/${relative}` : relative;
}
export function splitProjectFile(
  feature: Feature,
  file: string,
): { project?: FeatureProject; path: string } {
  const projects = feature.projects ?? [];
  if (projects.length < 2) return { project: projects[0], path: file };
  const match = /^@([a-zA-Z0-9_-]+)\/(.+)$/.exec(file);
  const project = match && projects.find((item) => item.id === match[1]);
  if (!match || !project)
    throw new Error('Précise un fichier dans un des projets de cette session.');
  return { project, path: match[2] };
}
export function projectHashes(
  feature: Feature,
  projectId: string,
  values: Record<string, string> = {},
) {
  if ((feature.projects?.length ?? 0) < 2) return { ...values };
  const prefix = `@${projectId}/`;
  return Object.fromEntries(
    Object.entries(values)
      .filter(([file]) => file.startsWith(prefix))
      .map(([file, hash]) => [file.slice(prefix.length), hash]),
  );
}
