import type { AgentProfile, SkillInfo, Workflow } from './types';

export type KitKind = 'workflow' | 'agent' | 'skill';
export type KitRef = `${KitKind}:${string}`;
export interface KitMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
}
export interface KitNode {
  ref: KitRef;
  kind: KitKind;
  id: string;
  name: string;
  description: string;
  dependencies: KitRef[];
  avatar?: string;
  tools?: string[];
  content?: string;
}
export interface KitSelection {
  refs: KitRef[];
  reasons: Record<string, KitRef[]>;
  errors: string[];
}
export interface KitFile {
  path: string;
  base64: string;
  sha256: string;
}
export interface KitBundle {
  format: 'feature-studio-kit';
  schemaVersion: 1;
  metadata: KitMetadata;
  roots: KitRef[];
  files: KitFile[];
}
export interface KitCatalogItem {
  metadata: KitMetadata;
  source: 'bundled' | 'saved';
  storageId?: string;
  error?: string;
  nodes: KitNode[];
  installed: boolean;
}
export interface KitPreview {
  token: string;
  metadata: KitMetadata;
  roots: KitRef[];
  nodes: KitNode[];
  files: { path: string; bytes: number; status: 'new' | 'identical' | 'conflict' }[];
  bytes: number;
  warnings: string[];
  canInstall: boolean;
}
export type KitClientMessage =
  | { type: 'kitCatalog'; requestId: string }
  | { type: 'kitPreview'; requestId: string; kitId: string; source: 'bundled' | 'saved' }
  | { type: 'kitCompose'; requestId: string; metadata: KitMetadata; roots: KitRef[] }
  | { type: 'kitImport'; requestId: string }
  | { type: 'kitInstall' | 'kitExport'; requestId: string; token: string };
export type KitHostMessage = {
  type: 'kitResult';
  requestId: string;
  error?: string;
  cancelled?: boolean;
  catalog?: KitCatalogItem[];
  preview?: KitPreview;
  message?: string;
};
export function kitNodes(data: {
  agents: AgentProfile[];
  skills: SkillInfo[];
  workflows: Workflow[];
}): KitNode[] {
  const linkedSkills = (content: string): KitRef[] => [
    ...new Set(
      [...content.matchAll(/\]\(((?![a-z]+:)[^)\s]+)\/SKILL\.md(?:#[^)]*)?\)/gi)]
        .map((match) => match[1].split('/').at(-1)!)
        .filter((id) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id))
        .map((id) => `skill:${id}` as KitRef),
    ),
  ];
  return [
    ...data.workflows.map(
      (w): KitNode => ({
        ref: `workflow:${w.id}`,
        kind: 'workflow',
        id: w.id,
        name: w.name,
        description: w.description,
        content: JSON.stringify({ ...w, source: undefined }, null, 2),
        dependencies: [
          ...new Set(
            w.steps.flatMap((s) => [
              `agent:${s.agentId}` as KitRef,
              ...s.skills.map((id) => `skill:${id}` as KitRef),
            ]),
          ),
        ],
      }),
    ),
    ...data.agents.map(
      (a): KitNode => ({
        ref: `agent:${a.id}`,
        kind: 'agent',
        id: a.id,
        name: a.nickname || a.name,
        description: a.description,
        avatar: a.avatar,
        tools: a.tools,
        content: a.instructions,
        dependencies: [
          ...new Set([
            ...a.skills.map((id) => `skill:${id}` as KitRef),
            ...linkedSkills(a.instructions),
          ]),
        ],
      }),
    ),
    ...data.skills.map(
      (s): KitNode => ({
        ref: `skill:${s.id}`,
        kind: 'skill',
        id: s.id,
        name: s.name,
        description: s.description,
        content: s.content,
        dependencies: linkedSkills(s.content),
      }),
    ),
  ];
}
export function resolveKitSelection(nodes: KitNode[], roots: KitRef[]): KitSelection {
  const index = new Map(nodes.map((n) => [n.ref, n]));
  const refs = new Set<KitRef>(),
    reasons: Record<string, KitRef[]> = Object.create(null),
    errors: string[] = [];
  const visit = (ref: KitRef, parent?: KitRef) => {
    if (parent) reasons[ref] = [...new Set([...(reasons[ref] ?? []), parent])];
    if (refs.has(ref)) return;
    const node = index.get(ref);
    if (!node) {
      errors.push(`Dépendance absente : ${ref}`);
      return;
    }
    refs.add(ref);
    for (const dep of node.dependencies) visit(dep, ref);
  };
  for (const ref of roots) visit(ref);
  return { refs: [...refs], reasons, errors: [...new Set(errors)] };
}
