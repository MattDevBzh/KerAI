import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { SessionEvent, SkillProvider } from '@github/copilot-sdk';
import type { RunInput } from '../shared/types';
import type { NativeContextLoad } from '../shared/native';
import { promptSections } from '../core/context';
import { nativeSkill } from '../core/nativeSkills';

/** An immutable view of the human-selected catalogue, including preview edits and exclusions. */
export function nativeSkillCatalog(input: RunInput) {
  const selected = promptSections(input)
    .filter((section) => section.source === 'skill')
    .flatMap((section) => {
      const item = nativeSkill(input, section);
      return item ? [item] : [];
    });
  const byName = new Map(selected.map((item) => [item.descriptor.name, item]));
  const provider: SkillProvider = {
    listSkills: () => selected.map((item) => ({ ...item.descriptor })),
    readSkill: (name, { signal }) => {
      if (signal.aborted) throw new Error('Chargement annulé.');
      return byName.get(name)?.content ?? null;
    },
  };
  return { provider, byName };
}

/** Only runtime receipts count; catalogue discovery and assistant prose never do. */
export function nativeContextReceipt(
  event: SessionEvent,
  sessionId: string,
  catalog: ReturnType<typeof nativeSkillCatalog>,
  redact: (text: string) => string,
): NativeContextLoad | undefined {
  let item: Omit<
    NativeContextLoad,
    'id' | 'sessionId' | 'at' | 'content' | 'digest' | 'truncated'
  > & { content: string };
  if (event.type === 'skill.invoked') {
    const selected = catalog.byName.get(event.data.name);
    item = {
      kind: 'skill',
      name: selected?.skill.name ?? event.data.name,
      path: selected?.skill.path ?? event.data.path,
      origin: selected?.skill.source ?? event.data.source ?? 'copilot',
      trigger: event.data.trigger ?? 'agent-invoked',
      content: event.data.content,
    };
  } else if (
    event.type === 'system.notification' &&
    event.data.kind.type === 'instruction_discovered'
  ) {
    item = {
      kind: 'instruction',
      name: event.data.kind.description || event.data.kind.sourcePath,
      path: event.data.kind.sourcePath,
      origin: 'project',
      trigger: event.data.kind.triggerTool,
      triggerFile: event.data.kind.triggerFile,
      content: event.data.content,
    };
  } else return undefined;
  const content = redact(item.content);
  return {
    ...item,
    name: redact(item.name).slice(0, 1000),
    path: redact(item.path).slice(0, 4000),
    triggerFile: item.triggerFile ? redact(item.triggerFile).slice(0, 4000) : undefined,
    id: event.id,
    sessionId,
    at: event.timestamp,
    content: content.slice(0, 64000),
    digest: createHash('sha256').update(content).digest('hex'),
    truncated: content.length > 64000,
  };
}

/** A file view is also evidence: root applyTo instructions can be offered as a table,
 * then read by the agent, rather than injected through instruction_discovered. */
export class NativeInstructionReads {
  private readonly pending = new Map<
    string,
    { sourcePath: string; label: string; location?: string }
  >();
  constructor(
    private readonly directory: string,
    private readonly sources: { sourcePath: string; label: string; location?: string }[],
  ) {}

  receive(
    event: SessionEvent,
    sessionId: string,
    redact: (text: string) => string,
  ): NativeContextLoad | undefined {
    if (event.type === 'tool.execution_start' && event.data.toolName === 'view') {
      const path = (event.data.arguments as { path?: unknown } | undefined)?.path;
      if (typeof path === 'string') {
        const source = this.sources.find(
          (item) => resolve(this.directory, item.sourcePath) === resolve(this.directory, path),
        );
        if (source) this.pending.set(event.data.toolCallId, source);
      }
    }
    if (event.type !== 'tool.execution_complete') return undefined;
    const source = this.pending.get(event.data.toolCallId);
    this.pending.delete(event.data.toolCallId);
    if (!source || !event.data.success || !event.data.result?.content) return undefined;
    const content = redact(event.data.result.content);
    return {
      id: event.id,
      sessionId,
      at: event.timestamp,
      kind: 'instruction',
      name: redact(source.label).slice(0, 1000),
      path: redact(source.sourcePath).slice(0, 4000),
      origin:
        source.location === 'user'
          ? 'user-instructions'
          : source.location === 'plugin'
            ? 'plugin'
            : 'project',
      trigger: 'view-instruction',
      content: content.slice(0, 64000),
      digest: createHash('sha256').update(content).digest('hex'),
      truncated: content.length > 64000,
    };
  }
}
