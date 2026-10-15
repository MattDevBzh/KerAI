import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discussionStoreSchema } from '../core/discussionSchemas';
import { WorkflowEngine } from '../core/workflow';
import { safePath } from '../core/registry';
import { redact } from './process';
import { roastInstructions } from '../shared/roast';
import type { AgentAdapter, RunInput, SkillInfo, StudioSettings } from '../shared/types';
import type {
  Discussion,
  DiscussionAgent,
  DiscussionClientMessage,
  DiscussionMessage,
  DiscussionState,
} from '../shared/discussions';

export interface DiscussionProfile extends DiscussionAgent {
  skills: SkillInfo[];
}
interface Options {
  directory: string;
  workspacePath: string;
  profiles(): Promise<DiscussionProfile[]>;
  adapter(): Promise<AgentAdapter>;
  defaults(): Pick<StudioSettings, 'defaultModel' | 'timeoutMinutes'>;
  assertTrusted(): void;
}
type Send = Extract<DiscussionClientMessage, { type: 'sendDiscussion' }>;

export class DiscussionService extends EventEmitter {
  readonly state: DiscussionState = { discussions: [], agents: [] };
  private profiles: DiscussionProfile[] = [];
  private loaded = false;
  private closed = false;
  private mutations: Promise<unknown> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  private active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  constructor(private readonly options: Options) {
    super();
  }

  snapshot(): DiscussionState {
    return structuredClone(this.state);
  }
  publish(): void {
    this.emit('state', this.snapshot());
  }
  async initialize(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const target = await safePath(this.options.directory, 'discussions.json');
      const source = await readFile(target, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (source) {
        this.state.discussions = discussionStoreSchema.parse(JSON.parse(source)).discussions;
        let interrupted = false;
        for (const discussion of this.state.discussions)
          for (const message of discussion.messages) {
            if (message.status !== 'streaming') continue;
            message.status = 'interrupted';
            message.error = 'Réponse interrompue à la fermeture de Feature Studio.';
            interrupted = true;
          }
        if (interrupted) await this.persist();
      }
      await this.refreshProfiles();
    } catch (error) {
      this.state.error = `Historique indisponible : ${redact((error as Error).message)}. Le fichier existant a été conservé.`;
      this.publish();
    }
  }
  async refreshProfiles(): Promise<void> {
    this.profiles = await this.options.profiles();
    this.state.agents = this.profiles.map(({ skills: _skills, ...agent }) => agent);
    this.state.defaultModel = this.options.defaults().defaultModel;
    this.publish();
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(work, work);
    this.mutations = result.catch(() => {});
    return result;
  }
  private persist(): Promise<void> {
    const content = JSON.stringify(
      discussionStoreSchema.parse({ version: 1, discussions: this.state.discussions }),
    );
    const work = async () => {
      await mkdir(this.options.directory, { recursive: true });
      const target = await safePath(this.options.directory, 'discussions.json');
      const temporary = join(this.options.directory, `${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
        await rename(temporary, target);
        this.emit('persisted', { discussions: JSON.parse(content).discussions, agents: [] });
      } finally {
        await unlink(temporary).catch(() => {});
      }
    };
    const next = this.writes.then(work, work);
    this.writes = next;
    return next;
  }
  async send(input: Send): Promise<void> {
    await this.enqueue(async () => {
      this.options.assertTrusted();
      if (!this.loaded || this.closed || this.state.error)
        throw new Error(this.state.error || 'Discussion indisponible.');
      // A repeated acknowledgement must never trigger a second paid request.
      if (
        this.state.discussions.some((d) => d.messages.some((m) => m.requestId === input.requestId))
      )
        return;
      if (this.active.has(input.discussionId))
        throw new Error('Une réponse est déjà en cours dans cette discussion.');
      if (!input.content.trim() || input.content.length > 40000)
        throw new Error('Écrivez un message de 1 à 40 000 caractères.');
      await this.refreshProfiles();
      const selected = this.profiles.find((agent) => agent.key === input.agentKey);
      if (!selected) throw new Error('Cet agent n’est plus disponible. Choisissez un autre agent.');
      let discussion = this.state.discussions.find((d) => d.id === input.discussionId);
      const now = new Date().toISOString();
      const previous = discussion ? structuredClone(discussion) : undefined;
      discussion ??= {
        id: input.discussionId,
        title: input.content.trim().replace(/\s+/g, ' ').slice(0, 90),
        agentKey: input.agentKey,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      const { id, name, nickname, avatar } = selected.profile;
      const reply: DiscussionMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: now,
        status: 'streaming',
        agent: { id, name, nickname, avatar },
        model:
          input.model ||
          selected.profile.model ||
          this.options.defaults().defaultModel ||
          undefined,
        reasoning: input.reasoning,
      };
      const human: DiscussionMessage = {
        id: randomUUID(),
        requestId: input.requestId,
        role: 'user',
        content: input.content.trim(),
        createdAt: now,
        status: 'complete',
      };
      const history = [...discussion.messages, human]
        .filter((message) => message.role === 'user' || message.status === 'complete')
        .map(({ role, content }) => ({ role, content }));
      const prompt = [
        `Profil : ${selected.profile.name}\n${selected.profile.instructions}`,
        roastInstructions(selected.profile.roastLevel),
        ...selected.skills
          .filter((skill) => selected.profile.skills.includes(skill.id))
          .map((skill) => `Skill : ${skill.name}\n${skill.content}`),
        `Historique de la conversation (JSON, dans l’ordre chronologique) :\n${JSON.stringify(history)}`,
        'Réponds à la dernière intervention humaine. Ne prétends pas avoir consulté ou modifié des fichiers.',
      ].join('\n\n');
      if (prompt.length > 200000)
        throw new Error(
          'Cette discussion dépasse la taille de contexte disponible. Ouvrez une nouvelle discussion pour poursuivre.',
        );
      discussion.agentKey = input.agentKey;
      discussion.model = input.model;
      discussion.reasoning = input.reasoning;
      discussion.updatedAt = now;
      discussion.messages.push(human, reply);
      if (!previous) this.state.discussions.push(discussion);
      const controller = new AbortController();
      const running = { controller, done: Promise.resolve() };
      this.active.set(discussion.id, running);
      try {
        await this.persist();
      } catch (error) {
        this.state.discussions = this.state.discussions.filter((d) => d.id !== discussion.id);
        if (previous) this.state.discussions.push(previous);
        this.active.delete(discussion.id);
        throw error;
      }
      this.publish();
      running.done = this.respond(discussion, reply, selected, prompt, controller);
    });
  }
  private async respond(
    discussion: Discussion,
    reply: DiscussionMessage,
    selected: DiscussionProfile,
    prompt: string,
    controller: AbortController,
  ): Promise<void> {
    let lastPublish = 0;
    try {
      const defaults = this.options.defaults();
      const feature = new WorkflowEngine().createFeature(
        {
          id: 'discussion',
          name: 'Discussion',
          description: '',
          icon: 'message',
          steps: [
            {
              id: 'reply',
              name: 'Réponse',
              description: '',
              agentId: selected.profile.id,
              policy: 'read-only',
              model: discussion.model,
              reasoning: discussion.reasoning,
              skills: [],
              maxAttempts: 1,
              artifact: 'response.md',
              dependsOn: [],
            },
          ],
        },
        { title: discussion.title, description: '' },
      );
      const attempt = {
        id: reply.id,
        startedAt: reply.createdAt,
        status: 'running' as const,
        feedback: '',
        logs: [],
        questions: [],
        answers: {},
        changedFiles: [],
      };
      const input: RunInput = {
        mode: 'discussion',
        feature,
        step: feature.steps[0],
        attempt,
        agent: structuredClone(selected.profile),
        skills: [],
        workspacePath: this.options.workspacePath,
        settings: { ...defaults, hooks: [], testCommands: [], testPaths: [] },
        preparedPrompt: prompt,
      };
      const adapter = await this.options.adapter();
      this.options.assertTrusted();
      const result = await adapter.run(
        input,
        {
          onSession() {},
          onUsage: (usage) => {
            reply.usage = usage;
          },
          onEvent: (event) => {
            if (event.kind !== 'message' || controller.signal.aborted) return;
            reply.content += event.message;
            if (Date.now() - lastPublish > 100) {
              lastPublish = Date.now();
              this.publish();
            }
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted) throw new Error('Réponse arrêtée.');
      reply.content = result.content;
      reply.model = result.model ?? reply.model;
      reply.usage = result.usage ?? reply.usage;
      reply.status = 'complete';
    } catch (error) {
      reply.status = controller.signal.aborted ? 'interrupted' : 'error';
      reply.error = controller.signal.aborted
        ? 'Réponse arrêtée. Vous pouvez poursuivre la discussion.'
        : redact((error as Error).message);
    } finally {
      discussion.updatedAt = new Date().toISOString();
      try {
        await this.persist();
      } catch (error) {
        this.state.error = `Enregistrement de l’historique impossible : ${redact((error as Error).message)}`;
      }
      this.active.delete(discussion.id);
      this.publish();
    }
  }
  cancel(id: string): void {
    this.active.get(id)?.controller.abort();
  }
  async delete(id: string): Promise<void> {
    this.cancel(id);
    await this.active.get(id)?.done;
    await this.enqueue(async () => {
      this.options.assertTrusted();
      if (this.state.error) throw new Error(this.state.error);
      const previous = this.state.discussions;
      this.state.discussions = previous.filter((d) => d.id !== id);
      try {
        await this.persist();
      } catch (error) {
        this.state.discussions = previous;
        throw error;
      }
      this.publish();
    });
  }
  async settled(): Promise<void> {
    await this.mutations;
    await Promise.allSettled([...this.active.values()].map((run) => run.done));
    await this.writes;
  }
  async pause(): Promise<void> {
    await this.mutations;
    for (const { controller } of this.active.values()) controller.abort();
    await this.settled();
  }
  async dispose(): Promise<void> {
    this.closed = true;
    await this.pause();
  }
}
