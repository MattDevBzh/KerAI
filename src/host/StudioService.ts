import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AgentAdapter,
  Feature,
  RunCallbacks,
  RunInput,
  StudioSettings,
  StudioState,
} from '../shared/types';
import { AgentRegistry } from '../core/registry';
import { Store, settingsSchema } from '../core/store';
import { WorkflowEngine } from '../core/workflow';
import { gitInfo, ToolHost } from './ToolHost';
import { runProcess, redact } from './process';

export class StudioService extends EventEmitter {
  engine = new WorkflowEngine();
  state!: StudioState;
  adapter!: AgentAdapter;
  readonly registry: AgentRegistry;
  private active?: {
    featureId: string;
    stepId: string;
    controller: AbortController;
    done: Promise<void>;
  };
  private saveTimer?: NodeJS.Timeout;
  private publishTimer?: NodeJS.Timeout;
  private disposed = false;
  private toolHosts = new Map<string, ToolHost>();
  constructor(
    readonly workspacePath: string,
    defaultsPath: string,
    readonly store: Store,
    private isTrusted: () => boolean,
  ) {
    super();
    this.registry = new AgentRegistry(workspacePath, defaultsPath);
  }
  async initialize(): Promise<void> {
    const persisted = await this.store.load();
    this.engine = new WorkflowEngine(persisted.features);
    const data = await this.registry.load();
    const info = await gitInfo(this.workspacePath).catch(() => ({ branch: 'sans Git' }));
    this.state = {
      schemaVersion: 1,
      workspace: {
        name: basename(this.workspacePath),
        path: this.workspacePath,
        branch: info.branch,
        trusted: this.isTrusted(),
      },
      features: this.engine.features,
      ...data,
      runtime: { state: 'unchecked', models: [] },
      settings: persisted.settings,
    };
  }
  snapshot(): StudioState {
    this.state.workspace.trusted = this.isTrusted();
    return structuredClone(this.state);
  }
  publish(): void {
    if (!this.disposed) this.emit('state', this.snapshot());
  }
  error(error: unknown): void {
    this.emit('errorNotice', redact(error instanceof Error ? error.message : String(error)));
  }
  assertTrusted(): void {
    if (this.disposed) throw new Error('Le cockpit est fermé.');
    if (!this.isTrusted())
      throw new Error('Approuve cet espace de travail dans VS Code avant cette action.');
  }
  async persist(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.store.save(this.engine.features, this.state.settings);
    this.publish();
  }
  private schedule(): void {
    if (!this.publishTimer)
      this.publishTimer = setTimeout(() => {
        this.publishTimer = undefined;
        this.publish();
      }, 100);
    if (!this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = undefined;
        void this.persist().catch((error) => this.error(error));
      }, 500);
  }
  async refresh(): Promise<void> {
    const data = await this.registry.load();
    Object.assign(this.state, data);
    this.state.workspace.branch = (await gitInfo(this.workspacePath)).branch;
    this.publish();
  }
  async checkRuntime(): Promise<void> {
    this.assertTrusted();
    if (this.active || this.state.runtime.state === 'checking') return;
    this.state.runtime = { ...this.state.runtime, state: 'checking' };
    this.publish();
    try {
      this.state.runtime = await this.adapter.check();
    } catch (error) {
      this.state.runtime = {
        state: 'unavailable',
        models: [],
        error: redact((error as Error).message),
      };
    }
    this.publish();
  }
  async createFeature(input: {
    title: string;
    description: string;
    workflowId: string;
    agentId?: string;
    model?: string;
  }): Promise<Feature> {
    const workflow = this.state.workflows.find((item) => item.id === input.workflowId);
    if (!workflow) throw new Error('Workflow inconnu.');
    if (input.agentId && !this.state.agents.some((agent) => agent.id === input.agentId))
      throw new Error('Agent inconnu.');
    const feature = this.engine.createFeature(workflow, {
      ...input,
      branch: this.state.workspace.branch,
    });
    await this.persist();
    return feature;
  }
  async getTools(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal) {
    const host = new ToolHost(input, callbacks, signal);
    this.toolHosts.set(input.attempt.id, host);
    return await host.createTools();
  }
  async runStep(featureId: string, stepId: string, feedback = '', resume = false): Promise<void> {
    this.assertTrusted();
    if (this.active) throw new Error('Une exécution est déjà active dans ce workspace.');
    if (this.state.runtime.state !== 'ready' || !this.state.runtime.authenticated)
      throw new Error('Connecte le CLI Copilot avant de lancer un agent.');
    const feature = this.engine.getFeature(featureId),
      step = this.engine.getStep(featureId, stepId);
    const info = await gitInfo(this.workspacePath);
    if (feature.branch !== info.branch)
      throw new Error(
        `Cette session est liée à la branche ${feature.branch}. Reviens sur cette branche avant de la lancer.`,
      );
    // Recheck after asynchronous Git inspection so rapid double clicks cannot start two runs.
    this.assertTrusted();
    if (this.active) throw new Error('Une exécution est déjà active dans ce workspace.');
    const agent = this.state.agents.find((item) => item.id === step.agentId);
    if (!agent) throw new Error('Agent introuvable.');
    const skillIds = [...new Set([...agent.skills, ...step.skills])];
    if (skillIds.some((id) => !this.state.skills.some((skill) => skill.id === id)))
      throw new Error(
        'Une skill configurée est absente. Corrige la configuration avant de lancer cette étape.',
      );
    const previousSessionId = resume ? step.attempts.at(-1)?.sessionId : undefined;
    const attempt = this.engine.beginRun(featureId, stepId, feedback, resume);
    let complete!: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const controller = new AbortController();
    this.active = { featureId, stepId, controller, done };
    const input: RunInput = {
      feature: structuredClone(feature),
      step: structuredClone(step),
      attempt: structuredClone(attempt),
      agent: structuredClone(agent),
      skills: this.state.skills.filter((skill) =>
        [...agent.skills, ...step.skills].includes(skill.id),
      ),
      workspacePath: this.workspacePath,
      settings: structuredClone(this.state.settings),
      resumeSessionId: previousSessionId,
    };
    let streamText = '',
      streamId = '';
    const callbacks: RunCallbacks = {
      onEvent: (event) => {
        const last = attempt.logs.at(-1);
        if (event.kind === 'message' && last?.id === streamId) {
          streamText += event.message;
          last.message = redact(streamText).slice(-12000);
        } else {
          streamText = event.kind === 'message' ? event.message : '';
          streamId = event.kind === 'message' ? event.id : '';
          this.engine.appendEvent(featureId, stepId, {
            ...event,
            message: redact(event.message).slice(0, 12000),
          });
        }
        if (attempt.logs.length > 3000) attempt.logs.splice(0, attempt.logs.length - 3000);
        this.schedule();
      },
      onSession: (id) => {
        this.engine.setSession(featureId, stepId, id);
        this.schedule();
      },
    };
    try {
      await this.persist();
      this.assertTrusted();
      await this.hooks('beforeRun', input, controller.signal, callbacks);
      this.assertTrusted();
      const result = await this.adapter.run(input, callbacks, controller.signal);
      if (controller.signal.aborted) throw new Error('Exécution annulée.');
      const host = this.toolHosts.get(attempt.id);
      result.changedFiles = [...(host?.changedFiles ?? [])];
      result.fileHashes = { ...host?.fileHashes };
      result.content = redact(result.content);
      await this.hooks('afterRun', input, controller.signal, callbacks);
      this.engine.finishRun(featureId, stepId, result);
    } catch (error) {
      const host = this.toolHosts.get(attempt.id);
      attempt.changedFiles = [...(host?.changedFiles ?? [])];
      attempt.fileHashes = { ...host?.fileHashes };
      if (step.status === 'running') {
        if (controller.signal.aborted) this.engine.cancelRun(featureId, stepId);
        else
          this.engine.failRun(
            featureId,
            stepId,
            redact(error instanceof Error ? error.message : String(error)),
          );
      }
    } finally {
      this.toolHosts.delete(attempt.id);
      try {
        await this.persist();
      } finally {
        this.active = undefined;
        complete();
      }
    }
  }
  cancel(featureId: string): void {
    if (this.active?.featureId !== featureId)
      throw new Error('Aucune exécution active pour cette session.');
    this.active.controller.abort();
  }
  private async hooks(
    event: 'beforeRun' | 'afterRun',
    input: RunInput,
    signal: AbortSignal,
    callbacks: RunCallbacks,
  ): Promise<void> {
    if (input.step.policy === 'read-only') return;
    for (const hook of input.settings.hooks.filter(
      (item) => item.enabled && item.event === event,
    )) {
      callbacks.onEvent({
        id: randomUUID(),
        at: new Date().toISOString(),
        kind: 'info',
        message: `Hook ${hook.name} (${event})`,
      });
      const result = await runProcess(hook.command, hook.args, this.workspacePath, {
        signal,
        timeoutMs: 60000,
        onLine: (message) =>
          callbacks.onEvent({
            id: randomUUID(),
            at: new Date().toISOString(),
            kind: 'info',
            message,
          }),
      });
      if (result.code !== 0)
        throw new Error(`Hook ${hook.name} en échec (code ${result.code}). ${result.stderr}`);
    }
  }
  async saveSettings(settings: StudioSettings): Promise<void> {
    this.assertTrusted();
    if (this.active) throw new Error('Arrête la tentative avant de changer les réglages.');
    this.state.settings = settingsSchema.parse(settings);
    await this.persist();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    const active = this.active;
    active?.controller.abort();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.publishTimer) clearTimeout(this.publishTimer);
    await this.adapter?.dispose();
    await active?.done;
    if (this.state) await this.store.save(this.engine.features, this.state.settings);
  }
}
