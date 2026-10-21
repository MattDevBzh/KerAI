import { pairSourceKey } from '../core/pairSource';
import {
  createPair,
  pairMessage,
  pairTurnPrompt,
  completePairTurn,
  pairReport,
  addPairUsage,
} from '../core/pair';
import { pairPlan, nextPairBlock, type PairAction, type PairTurn } from '../shared/pair';
import { pairActionSchema } from '../core/pairSchemas';
import { inheritTeamProfiles, resolveAgentProfile } from '../shared/agentInheritance';
import { EventEmitter } from 'node:events';
import { basename, join } from 'node:path';
import { open, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  AgentAdapter,
  Feature,
  RunCallbacks,
  RunInput,
  StudioSettings,
  StudioState,
  RunLaunchOptions,
  RunPreview,
  AutopilotConfig,
  FeatureBudget,
  MemoryEntry,
  HumanRequest,
  ReviewComment,
  AcceptanceCriterion,
  FeatureCheckpoint,
  CheckpointComparison,
  WorkflowStep,
} from '../shared/types';
import { AgentRegistry } from '../core/registry';
import { installQualityKit, resolveQualityAttachment } from './QualityRunner';
import { Store, settingsSchema } from '../core/store';
import { WorkflowEngine, validateWorkflow } from '../core/workflow';
import { assertTeamOrder, teamLocked } from '../shared/team';
import { boundAnswers } from '../core/questions';
import { gitInfo, ToolHost } from './ToolHost';
import { PersonalReviewTools } from './PersonalReviewTools';
import { runProcess, redact } from './process';
import { emptyLaunch, previewContext, selectMemory } from '../core/context';
import { defaultBudget, budgetBlockReason } from '../core/budgets';
import { nextAutopilotAction } from '../core/autopilot';
import { currentTestEvidence, approvalBlockers } from '../core/validation';
import { currentOwnedFileHashes } from '../core/ownership';
import { featureStateKey, finalValidationReady } from '../shared/collaboration';
import type { CorrectionRequest, EditorialSaveOptions } from '../shared/collaboration';
import { normalizeRoastLevel } from '../shared/roast';
import {
  launchSchema,
  autopilotConfigSchema,
  budgetSchema,
  memorySchema,
  criterionSchema,
  commentSchema,
} from '../core/evolutionSchemas';
import { PolicyEngine, sha256 } from './PolicyEngine';
import { CHECKPOINT_LIMITS, FeatureWorkspace } from './FeatureWorkspace';
import { WorkspaceLease } from './WorkspaceLease';
import {
  inspectProjectChanges,
  backupProjectChanges,
  MultiProjectTools,
  projectInput,
} from './MultiProjectTools';
import type { StudioProject } from '../shared/projects';
import { splitProjectFile, projectFile } from '../shared/projects';
import type { DevOpsInspector } from './DevOpsInspector';
import { needsDevOpsEvidence } from '../shared/devopsKit';
import { gitRead } from './gitRead';
import { KitService } from './KitService';
import { SessionArchive } from './SessionArchive';
import { reportDiscussionSource } from './DiscussionContext';
import { discussionFeaturePlanSchema } from '../core/discussionSchemas';
import {
  DEFAULT_TRACE_BYTES,
  type ObservationOptions,
  type SessionObservation,
  type SessionStorageInfo,
} from '../shared/observation';
import { prepareObservation, runObservation, observationSource } from './SessionObserver';
import { sessionDirectory } from './SessionFiles';
import {
  pendingDeletions,
  markDeletion,
  cleanSessionFiles,
  finishDeletion,
  privateSize,
  deletionRecord,
} from './SessionCleanup';
import { assertDistinctProjects } from './ProjectCatalog';

export class StudioService extends EventEmitter {
  async discussionSource(featureId: string, stepId: string, attemptId: string, revision: number) {
    this.assertTrusted();
    const feature = this.engine.getFeature(featureId),
      step = this.engine.getStep(featureId, stepId);
    const attempt = step.attempts.find((item) => item.id === attemptId);
    if (!attempt || (attempt.revision ?? 0) !== revision)
      throw new Error('Le compte rendu a changé. Rouvrez sa version actuelle avant de discuter.');
    const source = await reportDiscussionSource(
      structuredClone(feature),
      structuredClone(step),
      structuredClone(attempt),
      await this.archiveFor(featureId),
    );
    this.assertTrusted();
    const current = this.engine
      .getStep(featureId, stepId)
      .attempts.find((item) => item.id === attemptId);
    if (
      !current ||
      current.status === 'running' ||
      redact(current.artifact?.content ?? '') !== source.output ||
      (current.revision ?? 0) !== revision
    )
      throw new Error('Le compte rendu a changé pendant l’ouverture de la discussion.');
    return source;
  }
  private pairTasks = new Map<string, Promise<void>>();
  private archives = new Map<string, Promise<SessionArchive>>();
  private async archiveFor(featureId: string): Promise<SessionArchive> {
    let pending = this.archives.get(featureId);
    if (!pending) {
      pending = SessionArchive.create(
        this.store.rootPath,
        featureId,
        this.state.settings.traceLimitBytes ?? DEFAULT_TRACE_BYTES,
      );
      this.archives.set(featureId, pending);
      void pending.catch(() => {
        if (this.archives.get(featureId) === pending) this.archives.delete(featureId);
      });
    }
    const archive = await pending;
    await archive.flush();
    return archive;
  }
  async recordHumanAction(message: import('../shared/types').ClientMessage): Promise<void> {
    if (this.disposed || !this.isTrusted() || (this.workspaceTask && !this.active)) return;
    if (!('featureId' in message) || !message.featureId) return;
    const tracked = new Set([
      'runStep',
      'pairAction',
      'resolveOptionalStep',
      'approveStep',
      'rejectStep',
      'answerQuestions',
      'cancelRun',
      'saveArtifact',
      'requestCorrection',
      'finalizeFeature',
      'configureStep',
      'archiveFeature',
      'saveAutopilot',
      'startAutopilot',
      'pauseAutopilot',
      'saveBudget',
      'saveCriteria',
      'addReviewComment',
      'resolveReviewComment',
      'createCheckpoint',
      'restoreCheckpoint',
    ]);
    if (!tracked.has(message.type)) return;
    const feature = this.engine.getFeature(message.featureId);
    try {
      const archive = await this.archiveFor(feature.id);
      archive.append({
        id: randomUUID(),
        at: new Date().toISOString(),
        type: 'host.human_request',
        stepId: 'stepId' in message ? message.stepId : feature.activeStepId,
        data: JSON.stringify({
          intent: 'Demande humaine reçue ; les états et preuves déterminent son résultat effectif.',
          command: message,
        }),
      });
      await archive.flush();
    } catch (error) {
      feature.traceWarnings = [
        ...new Set([
          ...(feature.traceWarnings ?? []),
          `Intervention humaine non archivée : ${redact((error as Error).message)}`,
        ]),
      ];
      this.error(error);
    }
  }
  engine = new WorkflowEngine();
  state!: StudioState;
  adapter!: AgentAdapter;
  devopsInspector?: (signal: AbortSignal) => DevOpsInspector;
  projectInspector?: (projectId: string, signal: AbortSignal) => DevOpsInspector;
  projectDevOpsKey?: (projectId: string) => string | undefined;
  projectSettings?: (projectId: string) => StudioSettings | undefined;
  projectResolver?: (projectId: string) => StudioProject | undefined;
  globalGuard?: () => void;
  devopsProjectKey?: () => string | undefined;
  readonly registry: AgentRegistry;
  readonly kits: KitService;
  readonly workspaces: FeatureWorkspace;
  private workspaceTask?: Promise<void>;
  private active?: {
    featureId: string;
    stepId: string;
    controller: AbortController;
    done: Promise<void>;
  };
  private saveTimer?: NodeJS.Timeout;
  private publishTimer?: NodeJS.Timeout;
  private disposed = false;
  private toolHosts = new Map<string, ToolHost | MultiProjectTools>();
  private automation?: { featureId: string; done: Promise<void> };
  private pendingHumans = new Map<
    string,
    {
      request: HumanRequest;
      resolve: (answer: string) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  constructor(
    readonly workspacePath: string,
    private readonly defaultsPath: string,
    readonly store: Store,
    private isTrusted: () => boolean,
  ) {
    super();
    this.registry = new AgentRegistry(workspacePath, defaultsPath);
    this.kits = new KitService(this.registry);
    this.workspaces = new FeatureWorkspace(workspacePath, join(store.rootPath, 'workspaces'));
  }
  async initialize(): Promise<void> {
    const persisted = await this.store.load();
    this.engine = new WorkflowEngine(persisted.features);
    const data = await this.registry.load();
    const info = await gitInfo(this.workspacePath).catch(() => ({ branch: 'sans Git' }));
    this.state = {
      schemaVersion: 7,
      profileDirectories: { user: this.registry.userPath, workspace: this.registry.workspacePath },
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
      memory: persisted.memory ?? [],
      mcpCatalogs: {},
      humanRequests: [],
    };
    for (const deletion of await pendingDeletions(this.store.rootPath)) {
      this.engine.features.splice(
        0,
        this.engine.features.length,
        ...this.engine.features.filter((f) => f.id !== deletion.featureId),
      );
      this.state.memory = (this.state.memory ?? []).filter(
        (m) => m.source?.featureId !== deletion.featureId,
      );
    }
    await this.refreshIsolationSupport();
  }
  private async refreshIsolationSupport(): Promise<void> {
    try {
      await this.workspaces.inspectRepository();
      this.state.workspace.canIsolate = true;
      this.state.workspace.isolationReason = undefined;
    } catch (error) {
      this.state.workspace.canIsolate = false;
      this.state.workspace.isolationReason = (error as Error).message;
    }
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
    const persisted = this.listenerCount('persisted') ? this.snapshot() : undefined;
    await this.store.save(this.engine.features, this.state.settings, this.state.memory ?? []);
    if (persisted) this.emit('persisted', persisted);
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
    this.state.profileDirectories = {
      user: this.registry.userPath,
      workspace: this.registry.workspacePath,
    };
    Object.assign(this.state, data);
    this.state.workspace.branch = (await gitInfo(this.workspacePath)).branch;
    await this.refreshIsolationSupport();
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
    requestId?: string;
    ticketSource?: import('../shared/devopsTickets').TicketSourceSnapshot;
    worktreeChoice?: { baseRef: string; baseCommit: string; branchName: string };
    expectedCurrentBranch?: string;
    title: string;
    description: string;
    workflowId?: string;
    projects?: StudioProject[];
    agentId?: string;
    model?: string;
    isolated?: boolean;
    discussionId?: string;
    criteria?: string[];
    team?: import('../shared/discussions').DiscussionFeatureMember[];
  }): Promise<Feature> {
    return this.workspaceAction(undefined, 'Création de l’espace de la feature', async () => {
      const existing =
        input.requestId &&
        this.engine.features.find((feature) => feature.creationRequestId === input.requestId);
      if (existing) {
        await this.persist();
        return existing;
      }
      let workflow = this.state.workflows.find((item) => item.id === input.workflowId);
      if (input.workflowId && !workflow) throw new Error('Workflow inconnu.');
      if (input.agentId && !this.state.agents.some((agent) => agent.id === input.agentId))
        throw new Error('Agent inconnu.');
      if ((input.projects?.length ?? 0) > 1 && input.isolated)
        throw new Error('Le worktree isolé nécessite une session à un seul projet.');
      if (input.projects?.length && input.projects[0].path !== this.workspacePath)
        throw new Error('Le projet principal ne correspond pas à la session.');
      if (input.projects) assertDistinctProjects(input.projects);
      if (input.team) {
        const team = discussionFeaturePlanSchema.shape.team.parse(input.team);
        Object.assign(this.state, await this.registry.load());
        const ids = team.map(() => `step-${randomUUID()}`);
        workflow = validateWorkflow({
          id: 'custom',
          name: 'Équipe issue de la discussion',
          description: '',
          icon: 'users',
          steps: team.map((member, index) => {
            const agent = this.state.agents.find((item) => item.id === member.agentId);
            if (!agent)
              throw new Error(
                `L’agent de « ${member.name} » n’est plus disponible dans ce projet. Ajustez l’équipe.`,
              );
            return {
              ...member,
              id: ids[index],
              skills: [],
              inheritAgent: true,
              maxAttempts: 3,
              artifact: `${ids[index]}.md`,
              dependsOn: index ? [ids[index - 1]] : [],
            };
          }),
        });
      }
      const criteria = input.criteria
        ? discussionFeaturePlanSchema.shape.criteria.parse(input.criteria)
        : [];
      const info = await gitInfo(this.workspacePath);
      this.assertTrusted();
      this.state.workspace.branch = info.branch;
      if (
        !input.isolated &&
        input.expectedCurrentBranch !== undefined &&
        input.expectedCurrentBranch !== info.branch
      )
        throw new Error(
          'La branche du dossier courant a changé. Rouvre la préparation du ticket avant de créer la session.',
        );
      // Do not publish a partially created feature while Git prepares its checkout.
      const feature = new WorkflowEngine().createFeature(
        workflow
          ? { ...workflow, steps: inheritTeamProfiles(workflow.steps, this.state.agents) }
          : undefined,
        {
          ...input,
          branch: info.branch,
        },
      );
      feature.steps = inheritTeamProfiles(feature.steps, this.state.agents);
      feature.discussionId = input.discussionId;
      feature.creationRequestId = input.requestId;
      feature.ticketSource = input.ticketSource ? structuredClone(input.ticketSource) : undefined;
      feature.criteria = criteria.map((text) => ({
        id: randomUUID(),
        text,
        status: 'pending',
        evidence: '',
      }));
      if (input.projects?.length) {
        feature.projects = [];
        for (const project of input.projects) {
          if (this.projectResolver && this.projectResolver(project.id)?.path !== project.path)
            throw new Error('Projet non enregistré.');
          if ((await realpath(project.path)) !== project.path)
            throw new Error('Le chemin du projet a changé. Ajoute à nouveau son dossier.');
          feature.projects.push({
            id: project.id,
            name: project.name,
            path: project.path,
            branch: (await gitInfo(project.path)).branch,
          });
        }
      }
      feature.budget = structuredClone(this.state.settings.budgetDefaults ?? defaultBudget);
      if (input.isolated) {
        feature.worktree = await this.workspaces.createWorktree(feature, input.worktreeChoice);
        feature.branch = feature.worktree.branch;
      }
      this.engine.features.push(feature);
      await this.persist();
      return feature;
    });
  }
  async saveFeatureTeam(
    featureId: string,
    expectedRevision: number,
    steps: WorkflowStep[],
  ): Promise<number> {
    return this.workspaceAction(featureId, 'Enregistrement de l’équipe', async () => {
      Object.assign(this.state, await this.registry.load());
      this.assertTrusted();
      const feature = this.engine.getFeature(featureId);
      if (feature.archived) throw new Error('Réactive la feature avant de modifier son équipe.');
      if (teamLocked(feature))
        throw new Error('L’équipe est verrouillée : le parcours a déjà commencé.');
      if ((feature.teamRevision ?? 0) !== expectedRevision)
        throw new Error('L’équipe a changé. Ferme le panneau puis rouvre la composition actuelle.');
      const validated = steps.length
        ? validateWorkflow({
            id: 'custom',
            name: 'Équipe personnalisée',
            description: '',
            icon: 'users',
            steps,
          }).steps
        : [];
      const inherited = inheritTeamProfiles(validated, this.state.agents);
      assertTeamOrder(inherited);
      const artifacts = new Set<string>();
      for (const step of validated) {
        if (!this.state.agents.some((agent) => agent.id === step.agentId))
          throw new Error(`Agent introuvable pour « ${step.name} » : ${step.agentId}.`);
        const artifact = step.artifact.toLowerCase();
        if (artifacts.has(artifact))
          throw new Error(`Deux interventions utilisent le même livrable : ${step.artifact}.`);
        artifacts.add(artifact);
      }
      const previous = structuredClone(feature);
      feature.steps = inherited.map((step) => ({
        ...structuredClone(step),
        status: 'pending',
        attempts: [],
      }));
      feature.activeStepId = feature.steps[0]?.id ?? '';
      feature.workflowId = 'custom';
      feature.workflowName = 'Équipe personnalisée';
      feature.teamRevision = expectedRevision + 1;
      feature.status = 'draft';
      feature.updatedAt = new Date().toISOString();
      delete feature.autopilot;
      delete feature.optionalRequest;
      delete feature.finalValidation;
      try {
        await this.persist();
      } catch (error) {
        for (const key of Object.keys(feature))
          delete (feature as unknown as Record<string, unknown>)[key];
        Object.assign(feature, previous);
        throw error;
      }
      return feature.teamRevision!;
    });
  }
  /** Dedicated delivery uses the same reservation, trust checks and source workspace lease. */
  withWorkspaceMutation<T>(label: string, action: () => Promise<T>): Promise<T> {
    return this.workspaceAction(undefined, label, action);
  }
  /** Reserve before the first await; another window also must acquire the target lease. */
  private async workspaceAction<T>(
    featureId: string | undefined,
    label: string,
    action: () => Promise<T>,
    automated = false,
    readOnly = false,
  ): Promise<T> {
    this.assertTrusted();
    this.globalGuard?.();
    if (this.active || this.workspaceTask)
      throw new Error('Attends la fin de l’opération en cours dans le cockpit.');
    if (this.automation && (!automated || this.automation.featureId !== featureId))
      throw new Error('Mets le pilote en pause avant cette opération.');
    let complete!: () => void;
    this.workspaceTask = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.state.workspaceOperation = { featureId, label, readOnly };
    this.publish();
    const leases: WorkspaceLease[] = [];
    try {
      const roots = featureId
        ? await this.featureRoots(this.engine.getFeature(featureId))
        : [this.workspacePath];
      for (const root of [...new Set(roots)].sort()) {
        const lease = new WorkspaceLease(root);
        await lease.acquire();
        leases.push(lease);
      }
      this.assertTrusted();
      return await action();
    } finally {
      try {
        for (const lease of leases.reverse()) await lease.release();
      } finally {
        this.workspaceTask = undefined;
        this.state.workspaceOperation = undefined;
        complete();
        this.publish();
      }
    }
  }
  private async featureRoots(feature: Feature): Promise<string[]> {
    const primary = await this.workspaces.validate(feature);
    if (!feature.projects?.length) return [primary];
    assertDistinctProjects(feature.projects);
    if (feature.projects[0].path !== this.workspacePath)
      throw new Error('Projet principal incohérent.');
    for (const project of feature.projects) {
      if (this.projectResolver && this.projectResolver(project.id)?.path !== project.path)
        throw new Error(`Le projet ${project.name} n’est plus enregistré à ce chemin.`);
      if ((await realpath(project.path)) !== project.path)
        throw new Error(`Le dossier de ${project.name} a changé. Vérifie les espaces de travail.`);
    }
    return feature.projects.map((project, index) => (index === 0 ? primary : project.path));
  }
  async projectPath(featureId: string, projectId: string): Promise<string> {
    const feature = this.engine.getFeature(featureId);
    const index = feature.projects?.findIndex((project) => project.id === projectId) ?? -1;
    if (index < 0) throw new Error('Projet absent de cette session.');
    return (await this.featureRoots(feature))[index];
  }
  async fileLocation(
    featureId: string | undefined,
    file: string,
  ): Promise<{ root: string; path: string }> {
    if (!featureId) return { root: this.workspacePath, path: file };
    const feature = this.engine.getFeature(featureId);
    const roots = await this.featureRoots(feature);
    const selected = splitProjectFile(feature, file);
    const index = selected.project
      ? feature.projects!.findIndex((project) => project.id === selected.project!.id)
      : 0;
    return { root: roots[index], path: selected.path };
  }
  async featurePath(featureId?: string): Promise<string> {
    return featureId
      ? (await this.featureRoots(this.engine.getFeature(featureId)))[0]
      : this.workspacePath;
  }
  async installQualityKit(featureId?: string) {
    return this.workspaceAction(featureId, 'Installation du reporter qualité', async () =>
      installQualityKit(await this.featurePath(featureId), join(this.defaultsPath, 'quality')),
    );
  }
  async qualityAttachment(featureId: string, evidenceId: string, attachmentId: string) {
    this.assertTrusted();
    const feature = this.engine.getFeature(featureId);
    const evidence = feature.steps
      .flatMap((step) => step.attempts)
      .flatMap((attempt) => attempt.evidence ?? [])
      .find((proof) => proof.id === evidenceId);
    if (
      evidence?.source !== 'host' ||
      !evidence.quality ||
      evidence.quality.featureId !== featureId ||
      evidence.quality.evidenceId !== evidence.id
    )
      throw new Error('Preuve qualité inconnue pour cette session.');
    const attachment = evidence.quality.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new Error('Pièce jointe inconnue.');
    const file = await resolveQualityAttachment(
      join(this.store.rootPath, 'quality', ...(evidence.projectId ? [evidence.projectId] : [])),
      evidence.quality,
      attachmentId,
    );
    return { file, attachment };
  }
  private projectWorkspaces = new Map<string, FeatureWorkspace>();
  async checkpointWorkspace(featureId: string, checkpointId?: string, projectId?: string) {
    const feature = this.engine.getFeature(featureId);
    const roots = await this.featureRoots(feature);
    const checkpoint = checkpointId
      ? feature.checkpoints?.find((item) => item.id === checkpointId)
      : undefined;
    if (checkpointId && !checkpoint) throw new Error('Point de restauration inconnu.');
    const selectedId = checkpoint?.projectId ?? projectId;
    if ((feature.projects?.length ?? 0) < 2) {
      if (selectedId && selectedId !== feature.projects?.[0]?.id)
        throw new Error('Projet inconnu pour cette session.');
      return { manager: this.workspaces, feature, root: roots[0], projectId: undefined };
    }
    const index = feature.projects!.findIndex((project) => project.id === selectedId);
    if (index < 0) throw new Error('Choisis le projet du point de restauration.');
    const project = feature.projects![index];
    let manager = this.projectWorkspaces.get(project.id);
    if (!manager) {
      manager = new FeatureWorkspace(
        roots[index],
        join(this.store.rootPath, 'workspaces', project.id),
      );
      this.projectWorkspaces.set(project.id, manager);
    }
    return {
      manager,
      root: roots[index],
      projectId: project.id,
      feature: {
        ...feature,
        branch: project.branch,
        worktree: undefined,
        checkpoints: feature.checkpoints?.filter((point) => point.projectId === project.id),
      },
    };
  }
  private rememberCheckpoint(feature: Feature, checkpoint: FeatureCheckpoint): void {
    feature.checkpoints ??= [];
    feature.checkpoints.push(checkpoint);
    feature.updatedAt = new Date().toISOString();
  }
  async createCheckpoint(featureId: string, label: string, projectId?: string): Promise<void> {
    await this.workspaceAction(featureId, 'Sauvegarde locale des fichiers', async () => {
      const feature = this.engine.getFeature(featureId);
      if (feature.archived) throw new Error('Réactive cette session avant de créer un point.');
      const target = await this.checkpointWorkspace(featureId, undefined, projectId);
      const checkpoint = await target.manager.capture(target.feature, { kind: 'manual', label });
      this.rememberCheckpoint(feature, {
        ...checkpoint,
        ...(target.projectId ? { projectId: target.projectId } : {}),
      });
      await this.persist();
    });
  }
  async compareCheckpoint(
    featureId: string,
    checkpointId: string,
    targetCheckpointId?: string,
  ): Promise<CheckpointComparison> {
    return this.workspaceAction(
      featureId,
      'Comparaison des fichiers',
      async () => {
        const target = await this.checkpointWorkspace(featureId, checkpointId);
        return target.manager.compare(target.feature, checkpointId, targetCheckpointId);
      },
      false,
      true,
    );
  }
  async checkpointDiff(
    featureId: string,
    checkpointId: string,
    file: string,
    targetCheckpointId?: string,
  ): Promise<{ before?: Buffer; after?: Buffer }> {
    return this.workspaceAction(
      featureId,
      'Ouverture de la comparaison',
      async () => {
        const target = await this.checkpointWorkspace(featureId, checkpointId);
        const feature = target.feature;
        const comparison = await target.manager.compare(feature, checkpointId, targetCheckpointId);
        const change = comparison.files.find((item) => item.path === file);
        if (!change) throw new Error('Ce fichier n’appartient pas à la comparaison.');
        if (!change.restorable) throw new Error(change.reason ?? 'Ce fichier est exclu du point.');
        const before = await target.manager.readFile(feature, checkpointId, file);
        let after: Buffer | undefined;
        if (targetCheckpointId)
          after = await target.manager.readFile(feature, targetCheckpointId, file);
        else {
          const policy = new PolicyEngine(target.root, 'read-only', []);
          try {
            const handle = await open(
              await policy.resolve(file),
              constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
            );
            try {
              const stat = await handle.stat();
              if (!stat.isFile() || stat.nlink > 1 || stat.size > CHECKPOINT_LIMITS.fileBytes)
                throw new Error('Fichier actuel non régulier ou trop volumineux.');
              const buffer = Buffer.alloc(CHECKPOINT_LIMITS.fileBytes + 1);
              let length = 0;
              while (length < buffer.length) {
                const { bytesRead } = await handle.read(
                  buffer,
                  length,
                  buffer.length - length,
                  length,
                );
                if (!bytesRead) break;
                length += bytesRead;
              }
              after = buffer.subarray(0, length);
              if (length > CHECKPOINT_LIMITS.fileBytes || sha256(after) !== change.afterHash)
                throw new Error('Les fichiers ont changé. Actualise la comparaison.');
            } finally {
              await handle.close();
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            if (change.afterHash)
              throw new Error('Les fichiers ont changé. Actualise la comparaison.');
          }
        }
        return { before, after };
      },
      false,
      true,
    );
  }
  async restoreCheckpoint(
    featureId: string,
    checkpointId: string,
    paths: string[],
    expectedFingerprint: string,
    beforeWrite?: () => Promise<void>,
  ): Promise<void> {
    await this.workspaceAction(featureId, 'Restauration des fichiers sélectionnés', async () => {
      const feature = this.engine.getFeature(featureId);
      if (feature.archived) throw new Error('Réactive cette session avant de restaurer.');
      const target = await this.checkpointWorkspace(featureId, checkpointId);
      const comparison = await target.manager.compare(target.feature, checkpointId);
      if (comparison.fingerprint !== expectedFingerprint)
        throw new Error('Les fichiers ont changé. Actualise la comparaison avant de restaurer.');
      let recoverySaved = false;
      try {
        const result = await target.manager.restore(
          target.feature,
          checkpointId,
          paths,
          expectedFingerprint,
          async (recovery) => {
            this.rememberCheckpoint(feature, {
              ...recovery,
              ...(target.projectId ? { projectId: target.projectId } : {}),
            });
            this.engine.invalidateAfterRestore(featureId);
            await this.persist();
            recoverySaved = true;
            this.assertTrusted();
            await beforeWrite?.();
          },
        );
        feature.workspaceFileHashes ??= {};
        for (const file of result.restoredFiles)
          feature.workspaceFileHashes[
            target.projectId ? projectFile(feature, target.projectId, file) : file
          ] = comparison.files.find((item) => item.path === file)?.beforeHash ?? '<missing>';
      } finally {
        // Even an interrupted restore leaves the recovery point and invalidated reviews visible.
        if (recoverySaved) await this.persist();
      }
    });
  }
  async getTools(input: RunInput, callbacks: RunCallbacks, signal: AbortSignal) {
    if (input.mode === 'discussion') return [];
    if (input.observation)
      return [
        {
          name: 'studio_observation_context',
          description:
            'The entire review context is already in the prompt. No filesystem, shell, MCP or human access.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          skipPermission: true,
          defer: 'never' as const,
          handler: async () => ({
            resultType: 'success' as const,
            textResultForLlm:
              'Use only the frozen sources already supplied. Return the required JSON.',
          }),
        },
      ];
    const host =
      (input.projects?.length ?? 0) > 1
        ? new MultiProjectTools(input, callbacks, signal, this.projectInspector)
        : new ToolHost(input, callbacks, signal, this.devopsInspector);
    this.toolHosts.set(input.attempt.id, host);
    const personal = new PersonalReviewTools(
      this.registry.userPath,
      join(this.registry.defaultsPath, '..', 'dist', 'remote-review-worker.cjs'),
      input,
      callbacks,
      signal,
    );
    return [...(await host.createTools()), ...personal.createTools()];
  }
  private prepareInput(
    featureId: string,
    stepId: string,
    feedback = '',
    resume = false,
    launch?: RunLaunchOptions,
  ): RunInput {
    const originalFeature = this.engine.getFeature(featureId);
    const originalStep = this.engine.getStep(featureId, stepId);
    const feature = structuredClone(originalFeature);
    const step = feature.steps.find((item) => item.id === stepId)!;
    const agent = this.state.agents.find((item) => item.id === step.agentId);
    if (!agent) throw new Error('Agent introuvable.');
    Object.assign(step, resolveAgentProfile(step, agent));
    const skillIds = step.skills;
    const selected = launchSchema.parse(
      launch ?? {
        ...emptyLaunch(),
        initialContext: step.initialContext ?? '',
        mcpServerIds: step.mcpServerIds ?? [],
      },
    );
    if (needsDevOpsEvidence(step) && !selected.devopsTest?.isolationConfirmed)
      throw new Error(
        'Renseigne le test exécuté et confirme sa mise en place hors production dans le formulaire de lancement.',
      );
    const mcpServers = selected.mcpServerIds.map((id) => {
      const server = this.state.settings.mcpServers?.find((item) => item.id === id);
      if (!server?.enabled || !server.tools.length)
        throw new Error(`Le MCP ${id} doit être activé avec des outils autorisés avant lancement.`);
      return structuredClone(server);
    });
    const selectedMemory = selectMemory(this.state.memory ?? [], selected, agent.id);
    const memory = selectedMemory.filter(
      (entry) =>
        selected.contextBlocks?.[`memory:${entry.id}`]?.enabled ??
        (selected.contextMode ?? (agent.emptyContextByDefault ? 'empty' : 'all')) === 'all',
    );
    if (
      selected.useProjectMemory &&
      selected.memoryIds.some((id) => !selectedMemory.some((entry) => entry.id === id))
    )
      throw new Error(
        'Une mémoire sélectionnée est absente, désactivée ou ne concerne pas cet agent.',
      );
    for (const entry of memory) {
      if (!entry.source) continue;
      const sourceStep = this.engine.features
        .find((item) => item.id === entry.source!.featureId)
        ?.steps.find((item) => item.id === entry.source!.stepId);
      if (
        !sourceStep ||
        sourceStep.status !== 'approved' ||
        sourceStep.attempts.at(-1)?.id !== entry.source.attemptId ||
        entry.source.revision === undefined ||
        (sourceStep.attempts.at(-1)?.revision ?? 0) !== entry.source.revision
      )
        throw new Error(
          `La mémoire « ${entry.title} » provient d’un livrable qui n’est plus validé. Révise cette entrée avant utilisation.`,
        );
    }
    const budget = feature.budget ?? this.state.settings.budgetDefaults ?? defaultBudget;
    if (budget.modelProfile !== 'current') {
      const profile = this.state.settings.modelProfiles?.[budget.modelProfile];
      if (!profile?.model)
        throw new Error(
          `Configure le modèle du profil ${budget.modelProfile} dans Réglages avant de l’utiliser.`,
        );
      step.model = profile.model;
      step.reasoning = profile.reasoning;
    }
    // A replay must never send approved descendants that it is about to invalidate.
    const invalid = new Set([step.id]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const candidate of feature.steps)
        if (!invalid.has(candidate.id) && candidate.dependsOn.some((id) => invalid.has(id))) {
          invalid.add(candidate.id);
          changed = true;
        }
    }
    for (const candidate of feature.steps)
      if (candidate.id !== step.id && invalid.has(candidate.id) && candidate.status !== 'pending')
        candidate.status = 'stale';
    for (const criterion of feature.criteria ?? []) {
      criterion.status = 'pending';
      criterion.evidence = '';
    }
    for (const entry of memory)
      if (entry.source?.featureId === featureId && invalid.has(entry.source.stepId))
        throw new Error(
          `La mémoire « ${entry.title} » provient d’une étape que cette tentative va invalider. Désélectionne-la avant de continuer.`,
        );
    const previous = originalStep.attempts.at(-1);
    const answerBindings = boundAnswers(
      (previous?.descriptionRevision ?? 0) === (feature.descriptionRevision ?? 0)
        ? previous
        : undefined,
      step.id,
    );
    const attempt = {
      id: 'preview',
      startedAt: '',
      status: 'running' as const,
      feedback,
      logs: [],
      questions: [],
      answers: Object.fromEntries(
        Object.entries(answerBindings).map(([id, binding]) => [id, binding.answer]),
      ),
      answerBindings,
      changedFiles: [],
      roastLevel: normalizeRoastLevel(agent.roastLevel),
      descriptionRevision: feature.descriptionRevision ?? 0,
      correctionId: feature.activeCorrectionId,
      ...(!feature.activeCorrectionId &&
      previous?.artifact &&
      (previous.descriptionRevision ?? 0) === (feature.descriptionRevision ?? 0)
        ? { artifact: structuredClone(previous.artifact) }
        : {}),
      launch: selected,
    };
    return {
      devopsProjectKey: this.devopsProjectKey?.(),
      feature,
      step,
      attempt,
      agent: structuredClone(agent),
      skills: this.state.skills.filter((skill) => skillIds.includes(skill.id)),
      projects: feature.projects?.map((project, index) => {
        const settings = this.projectSettings
          ? this.projectSettings(project.id)
          : this.state.settings;
        if (!settings) throw new Error(`Les réglages de ${project.name} sont indisponibles.`);
        return {
          ...project,
          ...(index === 0
            ? { path: this.workspaces.executionPath(feature), branch: feature.branch }
            : {}),
          settings: structuredClone(settings),
          devopsProjectKey:
            this.projectDevOpsKey?.(project.id) ??
            (index === 0 ? this.devopsProjectKey?.() : undefined),
        };
      }),
      workspacePath: this.workspaces.executionPath(feature),
      qualityStoragePath: join(this.store.rootPath, 'quality'),
      settings: structuredClone(this.state.settings),
      // A resumed transcript could reintroduce blocks removed from the new prompt.
      resumeSessionId:
        resume &&
        (previous?.descriptionRevision ?? 0) === (feature.descriptionRevision ?? 0) &&
        normalizeRoastLevel(previous?.roastLevel) === normalizeRoastLevel(agent.roastLevel) &&
        !agent.emptyContextByDefault &&
        selected.contextMode === undefined &&
        !Object.keys(selected.contextBlocks ?? {}).length
          ? previous?.sessionId
          : undefined,
      launch: selected,
      memory: structuredClone(selectedMemory),
      mcpServers,
      automation: feature.autopilot
        ? {
            reviewStepId: feature.autopilot.reviewStepId,
            correctionStepId: feature.autopilot.correctionStepId,
          }
        : undefined,
    };
  }
  async previewRun(
    featureId: string,
    stepId: string,
    feedback = '',
    resume = false,
    launch?: RunLaunchOptions,
  ): Promise<RunPreview> {
    this.assertTrusted();
    await this.featurePath(featureId);
    Object.assign(this.state, await this.registry.load());
    const input = this.prepareInput(featureId, stepId, feedback, resume, launch);
    const blocked = budgetBlockReason(input.feature);
    const existingChanges = await inspectProjectChanges(input);
    this.assertTrusted();
    return { ...previewContext(input, blocked ? [blocked] : []), existingChanges };
  }
  async runStep(
    featureId: string,
    stepId: string,
    feedback = '',
    resume = false,
    launch?: RunLaunchOptions,
    previewFingerprint?: string,
    automated = false,
  ): Promise<void> {
    await this.workspaceAction(
      featureId,
      'Tentative et points de restauration',
      () =>
        this.executeRun(featureId, stepId, feedback, resume, launch, previewFingerprint, automated),
      automated,
    );
    const attempt = this.engine.getStep(featureId, stepId).attempts.at(-1);
    if (
      attempt?.pair?.pendingMessages.length &&
      !['paused', 'interrupted'].includes(attempt.pair.phase)
    )
      this.startPairTurns(featureId, stepId, attempt.id, { kind: 'chat' });
  }
  private async executeRun(
    featureId: string,
    stepId: string,
    feedback = '',
    resume = false,
    launch?: RunLaunchOptions,
    previewFingerprint?: string,
    automated = false,
    pairContinuation?: PairTurn,
  ): Promise<void> {
    this.assertTrusted();
    if (this.automation && !automated)
      throw new Error('Mets le pilote en pause avant de lancer une tentative manuelle.');
    if (this.active) throw new Error('Une exécution est déjà active dans ce workspace.');
    if (this.state.runtime.state !== 'ready' || !this.state.runtime.authenticated)
      throw new Error('Connecte le CLI Copilot avant de lancer un agent.');
    const info = await gitInfo(await this.featurePath(featureId));
    this.assertTrusted();
    if (this.automation && !automated)
      throw new Error('Mets le pilote en pause avant de lancer une tentative manuelle.');
    if (
      automated &&
      (this.automation?.featureId !== featureId ||
        this.engine.getFeature(featureId).autopilot?.status !== 'running')
    )
      throw new Error('Le pilote a été mis en pause avant le lancement.');
    if (this.active) throw new Error('Une exécution est déjà active dans ce workspace.');
    const feature = this.engine.getFeature(featureId),
      step = this.engine.getStep(featureId, stepId);
    if (feature.branch !== info.branch)
      throw new Error(
        `Cette session est liée à la branche ${feature.branch}. Reviens sur cette branche avant de la lancer.`,
      );
    Object.assign(this.state, await this.registry.load());
    this.assertTrusted();
    const continued = pairContinuation ? step.attempts.at(-1) : undefined;
    const input = pairContinuation
      ? this.pairInput(featureId, stepId)
      : this.prepareInput(featureId, stepId, feedback, resume, launch);
    if (!pairContinuation && input.launch?.editableExistingFiles?.length && !previewFingerprint)
      throw new Error(
        'L’autorisation de reprendre des fichiers existants exige un aperçu confirmé au lancement manuel.',
      );
    for (const project of feature.projects?.slice(1) ?? []) {
      const actual = await gitInfo(project.path);
      if (actual.branch !== project.branch)
        throw new Error(`Le projet ${project.name} doit être sur la branche ${project.branch}.`);
    }
    if (!pairContinuation) await inspectProjectChanges(input);
    const preview = pairContinuation ? undefined : previewContext(input);
    if (preview?.errors.length) throw new Error(preview.errors.join(' '));
    if (previewFingerprint && previewFingerprint !== preview?.fingerprint)
      throw new Error(
        'Le contexte a changé depuis son aperçu. Actualise l’aperçu avant de lancer.',
      );
    const blocked = budgetBlockReason(feature);
    if (blocked) throw new Error(blocked);
    const attempt = continued ?? this.engine.beginRun(featureId, stepId, feedback, resume);
    if (continued) {
      step.status = attempt.status = 'running';
      delete attempt.error;
      delete attempt.finishedAt;
    }
    if (!input.resumeSessionId) delete attempt.sessionId;
    attempt.roastLevel = input.attempt.roastLevel;
    attempt.agentName = input.agent.nickname || input.agent.name;
    attempt.profileSnapshot = {
      agentId: input.agent.id,
      policy: input.step.policy,
      skillIds: input.skills.map((skill) => skill.id),
      modelOverride: Boolean(step.model),
    };
    attempt.launch = structuredClone(input.launch!);
    if (!continued) attempt.memorySnapshot = structuredClone(input.memory ?? []);
    if (preview) {
      attempt.promptFingerprint = preview.fingerprint;
      attempt.promptCharacters = preview.characters;
    }
    if (!continued) {
      attempt.evidence = [];
      attempt.revision = 0;
    }
    input.attempt = structuredClone(attempt);
    input.preparedPrompt = preview?.prompt;
    if (input.launch?.pair && !continued) {
      attempt.pair = createPair(input);
      attempt.pair.sourceKey = pairSourceKey(feature, step);
    }
    const pair = attempt.pair;
    const turn = pairContinuation ?? (pair ? { kind: 'planning' as const } : undefined);
    const usageBefore = structuredClone(attempt.usage);
    let usageReported = false,
      pairCallStarted = false;
    const reply = pair ? pairMessage(pair, 'assistant', '') : undefined;
    if (pair && turn && reply) {
      pair.busy = true;
      pair.pauseRequested = false;
      pair.turn = turn;
      pair.error = undefined;
      if (turn.kind !== 'work') pair.pendingMessages = [];
      if (turn.kind === 'work') pair.phase = 'working';
      reply.status = 'streaming';
      input.resumeSessionId = undefined;
      input.mode = turn.kind === 'work' ? undefined : 'discussion';
    }
    if (automated && feature.autopilot) {
      feature.autopilot.runs++;
      feature.autopilot.updatedAt = new Date().toISOString();
    }
    let complete!: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const controller = new AbortController();
    this.active = { featureId, stepId, controller, done };
    let streamText = '',
      streamId = '';
    let archive: SessionArchive | undefined;
    let attemptBytes = continued?.traceArchive?.bytes ?? 0,
      attemptRecords = continued?.traceArchive?.records ?? 0;
    const trace = (event: import('../shared/observation').SessionTrace) => {
      if (!archive) throw new Error('Archive de session indisponible.');
      const beforeBytes = archive.info.bytes,
        beforeRecords = archive.info.records;
      try {
        archive.append({ ...event, stepId, attemptId: attempt.id });
      } catch (error) {
        controller.abort(error);
        throw error;
      } finally {
        attemptBytes += archive.info.bytes - beforeBytes;
        attemptRecords += archive.info.records - beforeRecords;
        attempt.traceArchive = {
          ...archive.info,
          bytes: attemptBytes,
          records: attemptRecords,
        };
      }
    };
    const callbacks: RunCallbacks = {
      onTrace: trace,
      onUsage: (usage) => {
        usageReported = true;
        attempt.usage = pair ? addPairUsage(usageBefore, usage) : structuredClone(usage);
        if (usage.model) attempt.model = usage.model;
        this.schedule();
      },
      onEvidence: (evidence) => {
        attempt.evidence ??= [];
        attempt.evidence.push(structuredClone(evidence));
        attempt.revision = (attempt.revision ?? 0) + 1;
        this.schedule();
      },
      onQuestion: async (question) => {
        const id = 'q-' + randomUUID();
        attempt.questions.push({
          id,
          text: question.question,
          ...(question.choices ? { choices: question.choices } : {}),
        });
        if (pair) pairMessage(pair, 'system', `Question de l’agent : ${question.question}`);
        await this.persist();
        const answer = await this.askHuman(
          { id, featureId, stepId, kind: 'question', ...question },
          controller.signal,
        );
        attempt.answers[id] = answer;
        if (pair) pairMessage(pair, 'user', answer);
        await this.persist();
        return answer;
      },
      onMcpPermission: async (request) => {
        const answer = await this.askHuman(
          {
            id: 'mcp-' + randomUUID(),
            featureId,
            stepId,
            kind: 'mcp-permission',
            question: `Autoriser ${request.toolName} sur ${request.serverId} pour cet appel ?`,
            choices: ['allow', 'deny'],
            allowFreeform: false,
            details: redact(request.args).slice(0, 6000),
          },
          controller.signal,
        );
        return answer === 'allow';
      },
      onEvent: (event) => {
        if (reply && event.kind === 'message') reply.content += redact(event.message);
        trace({ id: event.id, at: event.at, type: `activity.${event.kind}`, data: event.message });
        const last = attempt.logs.at(-1);
        if (event.kind === 'message' && last?.id === streamId) {
          streamText = (streamText + event.message).slice(-12000);
          last.message = redact(streamText).slice(-12000);
        } else {
          streamText = event.kind === 'message' ? event.message : '';
          streamId = event.kind === 'message' ? event.id : '';
          this.engine.appendEvent(featureId, stepId, {
            ...event,
            message: redact(event.message).slice(0, 12000),
          });
        }
        if (attempt.logs.length > 500) attempt.logs.splice(0, attempt.logs.length - 500);
        this.schedule();
      },
      onSession: (id) => {
        this.engine.setSession(featureId, stepId, id);
        if (pair && !pair.sessionIds.includes(id)) pair.sessionIds.push(id);
        this.schedule();
      },
    };
    try {
      if (pair && turn) {
        input.preparedPrompt = pairTurnPrompt(pair, turn);
        if (continued && attempt.questions.length)
          input.preparedPrompt += `\n\nRéponses humaines conservées : ${JSON.stringify(attempt.questions.map((question) => ({ question, answer: attempt.answers[question.id] })))}`;
        const maximum =
          feature.budget?.maxPromptChars ??
          this.state.settings.budgetDefaults?.maxPromptChars ??
          60000;
        if (input.preparedPrompt.length > maximum)
          throw new Error(
            `Le contexte pair atteint ${input.preparedPrompt.length} caractères pour une limite de ${maximum}. Ajuste le budget de contexte avant de reprendre ; aucun échange n’a été supprimé.`,
          );
      }
      archive = await this.archiveFor(featureId);
      trace({
        id: randomUUID(),
        at: continued ? new Date().toISOString() : attempt.startedAt,
        type: continued ? 'host.pair_turn' : 'host.launch',
        data: JSON.stringify({
          prompt: input.preparedPrompt,
          agent: input.agent,
          skills: input.skills,
          settings: input.settings,
          launch: input.launch,
          resumeSessionId: input.resumeSessionId,
          execution: {
            model:
              input.step.model || input.agent.model || input.settings.defaultModel || undefined,
            reasoning: input.step.reasoning,
          },
        }),
      });
      await archive.flush();
      await this.persist();
      this.assertTrusted();
      if (feature.worktree && (!pair || turn?.kind === 'work')) {
        const before = await this.workspaces.capture(feature, {
          kind: 'before-run',
          label: `Avant ${step.name}`.slice(0, 200),
          stepId,
          attemptId: attempt.id,
        });
        this.rememberCheckpoint(feature, before);
        attempt.checkpointBeforeId = before.id;
        await this.persist();
      }
      if (!continued)
        attempt.existingChangesBackup = await backupProjectChanges(
          input,
          this.store.rootPath,
          controller.signal,
        );
      if (attempt.existingChangesBackup) {
        callbacks.onEvent({
          id: randomUUID(),
          at: new Date().toISOString(),
          kind: 'info',
          message: `Sauvegarde des modifications existantes : ${attempt.existingChangesBackup}`,
        });
        await this.persist();
      }
      if (!pair || turn?.kind === 'work')
        await this.hooks('beforeRun', input, controller.signal, callbacks);
      this.assertTrusted();
      if (pair) {
        pair.calls++;
        await this.persist();
        pairCallStarted = true;
      }
      const result = await this.adapter.run(input, callbacks, controller.signal);
      await archive.flush();
      if (controller.signal.aborted) throw new Error('Exécution annulée.');
      const host = this.toolHosts.get(attempt.id);
      result.changedFiles = [
        ...new Set([...(pair ? attempt.changedFiles : []), ...(host?.changedFiles ?? [])]),
      ];
      result.fileHashes = { ...(pair ? attempt.fileHashes : {}), ...host?.fileHashes };
      result.content = redact(result.content);
      if (!pair || turn?.kind === 'work')
        await this.hooks('afterRun', input, controller.signal, callbacks);
      if (pair && turn && reply) {
        if (result.usage) {
          usageReported = true;
          attempt.usage = addPairUsage(usageBefore, result.usage);
        }
        attempt.changedFiles = result.changedFiles;
        attempt.fileHashes = result.fileHashes;
        completePairTurn(pair, turn, result, reply);
        for (const question of result.questions) {
          const previous = attempt.questions.find((q) => q.id === question.id);
          if (previous && JSON.stringify(previous) !== JSON.stringify(question))
            delete attempt.answers[question.id];
          attempt.questions = [...attempt.questions.filter((q) => q.id !== question.id), question];
          reply.content += `\n\nQuestion : ${question.text}`;
        }
        if (pair.phase === 'review' && turn.kind === 'work') {
          this.engine.finishRun(featureId, stepId, {
            ...result,
            content: pairReport(pair),
            usage: attempt.usage,
          });
        } else {
          step.status = attempt.status =
            pair.phase === 'review' ? 'awaiting_review' : 'waiting_input';
          this.engine.refreshFeatureStatus(featureId);
        }
      } else this.engine.finishRun(featureId, stepId, result);
    } catch (error) {
      const host = this.toolHosts.get(attempt.id);
      attempt.changedFiles = [
        ...new Set([...(pair ? attempt.changedFiles : []), ...(host?.changedFiles ?? [])]),
      ];
      attempt.fileHashes = { ...(pair ? attempt.fileHashes : {}), ...host?.fileHashes };
      if (pair) {
        pair.phase = pair.pauseRequested ? 'paused' : 'interrupted';
        pair.error = pair.pauseRequested
          ? undefined
          : redact(error instanceof Error ? error.message : String(error));
        if (reply) reply.status = 'interrupted';
      }
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
      if (pair) {
        if (pairCallStarted && !usageReported)
          attempt.usage = {
            ...(attempt.usage ?? { source: 'measured' as const }),
            incompleteTokens: true,
            incompleteCost: true,
          };
        pair.busy = false;
        pair.version++;
        if (pair.pauseRequested) pair.phase = 'paused';
      }
      const owned = this.toolHosts.get(attempt.id)?.fileHashes;
      if (owned) feature.workspaceFileHashes = { ...feature.workspaceFileHashes, ...owned };
      if (feature.worktree && attempt.checkpointBeforeId && (!pair || turn?.kind === 'work')) {
        try {
          const after = await this.workspaces.capture(feature, {
            kind: 'after-run',
            label: `Après ${step.name}`.slice(0, 200),
            stepId,
            attemptId: attempt.id,
          });
          this.rememberCheckpoint(feature, after);
          attempt.checkpointAfterId = after.id;
        } catch (error) {
          attempt.logs.push({
            id: randomUUID(),
            at: new Date().toISOString(),
            kind: 'warning',
            message: `Point après tentative indisponible : ${redact((error as Error).message)}`,
          });
          this.error(error);
        }
      }
      this.toolHosts.delete(attempt.id);
      if (archive) {
        try {
          await archive.flush();
        } catch (error) {
          attempt.error = redact((error as Error).message);
        }
        attempt.traceArchive = {
          ...archive.info,
          bytes: attemptBytes,
          records: attemptRecords,
        };
      }
      try {
        await this.persist();
      } finally {
        this.active = undefined;
        complete();
      }
    }
  }
  private pairInput(featureId: string, stepId: string): RunInput {
    const feature = this.engine.getFeature(featureId),
      step = this.engine.getStep(featureId, stepId);
    const attempt = step.attempts.at(-1),
      pair = attempt?.pair;
    if (!attempt || !pair || feature.archived || ['approved', 'stale'].includes(step.status))
      throw new Error(
        'Cette tentative pair ne peut plus être poursuivie. Ouvre la version actuelle de l’étape.',
      );
    if (
      (attempt.descriptionRevision ?? 0) !== (feature.descriptionRevision ?? 0) ||
      !step.dependsOn.every((id) =>
        ['approved', 'skipped'].includes(feature.steps.find((s) => s.id === id)?.status ?? ''),
      )
    )
      throw new Error('Le contexte de la feature a changé. Prépare une nouvelle tentative.');
    if (pair.sourceKey && pair.sourceKey !== pairSourceKey(feature, step))
      throw new Error('Les sources ont changé depuis le cadrage. Prépare une nouvelle tentative.');
    if (!isDeepStrictEqual(pair.snapshot.settings, this.state.settings))
      throw new Error(
        'Les réglages du projet ont changé depuis le cadrage. Prépare une nouvelle tentative avec les permissions actuelles.',
      );
    for (const project of pair.snapshot.projects ?? []) {
      if (
        this.projectSettings &&
        !isDeepStrictEqual(project.settings, this.projectSettings(project.id))
      )
        throw new Error(
          `Les réglages de ${project.name} ont changé. Prépare une nouvelle tentative.`,
        );
    }
    if (attempt.questions.some((q) => !attempt.answers[q.id]?.trim()))
      throw new Error('Réponds aux questions conservées avant de reprendre le travail.');
    const { prompt: _prompt, ...snapshot } = structuredClone(pair.snapshot);
    return {
      ...snapshot,
      feature: structuredClone(feature),
      step: { ...snapshot.step, status: step.status, attempts: [] },
      attempt: structuredClone({ ...attempt, pair: undefined }),
      launch: structuredClone(attempt.launch),
      existingChangeGrants: { ...snapshot.existingChangeGrants, ...attempt.fileHashes },
    };
  }
  /** UI actions only. Model tools cannot approve an organisation or change collaboration mode. */
  async pairAction(value: PairAction): Promise<void> {
    const command = pairActionSchema.parse(value);
    this.assertTrusted();
    const feature = this.engine.getFeature(command.featureId),
      step = this.engine.getStep(feature.id, command.stepId);
    const attempt = step.attempts.at(-1),
      pair = attempt?.pair;
    if (
      !attempt ||
      !pair ||
      attempt.id !== command.attemptId ||
      feature.archived ||
      ['approved', 'stale'].includes(step.status)
    )
      throw new Error(
        'Cette action ne concerne plus la tentative actuelle. Rouvre le travail en pair.',
      );
    if (pair.requests.includes(command.requestId)) return;
    if (command.expectedVersion !== pair.version)
      throw new Error('Le travail en pair a évolué. Relis son état actuel avant de réessayer.');
    const liveAction = ['message', 'solo', 'pair', 'pause'].includes(command.action);
    if (!liveAction && (pair.busy || this.pairTasks.has(attempt.id) || this.workspaceTask))
      throw new Error('Attends la fin du bloc en cours avant de changer son organisation.');
    if (this.active && this.active.featureId !== feature.id)
      throw new Error('Une autre session travaille actuellement. Reviens après son exécution.');
    let next: PairTurn | undefined;
    const plan = pairPlan(pair);
    const humanState = () => ({
      mode: pair.mode,
      phase: pair.phase,
      preferences: pair.preferences,
      approvedRevision: pair.approvedRevision,
      pauseRequested: pair.pauseRequested,
    });
    const previous = humanState();
    const previousAcceptedAt = plan?.acceptedAt,
      previousUpdatedAt = feature.updatedAt,
      messageCount = pair.messages.length;
    const approved = Boolean(plan && pair.approvedRevision === plan.revision && plan.acceptedAt);
    const requirePlan = () => {
      if (!approved || !nextPairBlock(pair))
        throw new Error('Valide une organisation comportant du travail restant avant de démarrer.');
      return { kind: 'work' as const, blockId: nextPairBlock(pair)!.id };
    };
    switch (command.action) {
      case 'message': {
        if (!command.content) throw new Error('Écris ton message avant de l’envoyer.');
        pair.mode = 'pair';
        const message = pairMessage(pair, 'user', redact(command.content), command.requestId);
        pair.pendingMessages.push(message.id);
        if (!pair.busy) next = { kind: approved ? 'chat' : 'planning' };
        break;
      }
      case 'reorganize':
      case 'revise':
        if (!command.content && !command.preferences)
          throw new Error('Précise la nouvelle organisation ou la correction souhaitée.');
        if (command.preferences) pair.preferences = command.preferences;
        pair.mode = 'pair';
        pair.approvedRevision = undefined;
        pair.phase = 'planning';
        pairMessage(
          pair,
          'user',
          redact(
            command.content ??
              `Adapte l’organisation à ces préférences : ${JSON.stringify(pair.preferences)}`,
          ),
          command.requestId,
        );
        next = { kind: 'planning' };
        break;
      case 'approve-plan':
        if (!plan || pair.phase !== 'planning' || pair.error)
          throw new Error('Attends une proposition d’organisation complète avant de la valider.');
        if (!nextPairBlock(pair))
          throw new Error(
            'Cette organisation est déjà terminée. Demande une nouvelle proposition.',
          );
        pair.approvedRevision = plan.revision;
        plan.acceptedAt = new Date().toISOString();
        pairMessage(
          pair,
          'system',
          `Organisation ${plan.revision} validée explicitement par l’utilisateur.`,
        );
        next = { kind: 'work', blockId: nextPairBlock(pair)?.id };
        break;
      case 'continue':
        next = requirePlan();
        break;
      case 'resume':
        if (pair.pendingMessages.length) next = { kind: approved ? 'chat' : 'planning' };
        else if (
          ['paused', 'interrupted'].includes(pair.phase) &&
          pair.turn &&
          pair.turn.kind !== 'work'
        )
          next = { ...pair.turn };
        else if (!approved) next = { kind: 'planning' };
        else if (nextPairBlock(pair)) next = requirePlan();
        else next = { kind: 'chat' };
        break;
      case 'solo':
        if (!approved)
          throw new Error(
            'Valide d’abord l’organisation ; le passage en solo ne vaut pas validation.',
          );
        pair.mode = 'solo';
        pairMessage(
          pair,
          'system',
          'L’utilisateur confie la fin de cette étape à l’agent. Les permissions restent identiques et la validation finale reste humaine.',
        );
        if (!pair.busy && nextPairBlock(pair)) next = requirePlan();
        break;
      case 'pair':
        pair.mode = 'pair';
        pairMessage(
          pair,
          'system',
          'L’utilisateur reprend le travail en pair. Arrêt au prochain point de contrôle.',
        );
        break;
      case 'pause':
        pair.pauseRequested = true;
        pair.mode = 'pair';
        pair.phase = 'paused';
        pairMessage(
          pair,
          'system',
          'Pause demandée par l’utilisateur. Les changements déjà réalisés sont conservés.',
        );
        break;
    }
    if (next) pair.pauseRequested = false;
    pair.requests.push(command.requestId);
    pair.version++;
    feature.updatedAt = new Date().toISOString();
    const changed = humanState();
    const addedMessages = new Set(pair.messages.slice(messageCount).map((message) => message.id));
    const updatedAt = feature.updatedAt,
      acceptedAt = plan?.acceptedAt;
    try {
      await this.persist();
    } catch (error) {
      // Undo only this command. A streaming reply or a completed block may have advanced meanwhile.
      for (const key of Object.keys(previous) as (keyof typeof previous)[]) {
        if (key === 'phase' && pair.version !== command.expectedVersion + 1) continue;
        if (pair[key] === changed[key]) Object.assign(pair, { [key]: previous[key] });
      }
      pair.messages = pair.messages.filter((message) => !addedMessages.has(message.id));
      pair.pendingMessages = pair.pendingMessages.filter((id) => !addedMessages.has(id));
      pair.requests = pair.requests.filter((id) => id !== command.requestId);
      if (pair.version === command.expectedVersion + 1) pair.version = command.expectedVersion;
      if (plan?.acceptedAt === acceptedAt && plan) plan.acceptedAt = previousAcceptedAt;
      if (feature.updatedAt === updatedAt) feature.updatedAt = previousUpdatedAt;
      this.publish();
      throw error;
    }
    if (
      command.action === 'pause' &&
      this.active?.featureId === feature.id &&
      this.active.stepId === step.id
    )
      this.active.controller.abort(new Error('Pause demandée par l’utilisateur.'));
    if (next) {
      const requested = next;
      const start = () => {
        if (step.attempts.at(-1)?.id === attempt.id && !pair.pauseRequested)
          this.startPairTurns(feature.id, step.id, attempt.id, requested);
      };
      if (this.workspaceTask) void this.workspaceTask.then(start);
      else start();
    }
  }
  private startPairTurns(
    featureId: string,
    stepId: string,
    attemptId: string,
    first: PairTurn,
  ): void {
    if (this.pairTasks.has(attemptId)) return;
    const task = this.runPairTurns(featureId, stepId, attemptId, first);
    this.pairTasks.set(attemptId, task);
    void task.catch((error) => this.error(error)).finally(() => this.pairTasks.delete(attemptId));
  }
  private async runPairTurns(
    featureId: string,
    stepId: string,
    attemptId: string,
    first: PairTurn,
  ): Promise<void> {
    let turn: PairTurn | undefined = first;
    try {
      while (turn && !this.disposed) {
        const attempt = this.engine.getStep(featureId, stepId).attempts.at(-1);
        if (attempt?.id !== attemptId || !attempt.pair) return;
        const pair = attempt.pair;
        await this.workspaceAction(featureId, 'Travail en pair', () =>
          this.executeRun(featureId, stepId, '', false, undefined, undefined, false, turn),
        );
        if (pair.phase === 'paused' || pair.phase === 'interrupted') return;
        if (pair.pendingMessages.length) turn = { kind: 'chat' };
        else if (
          pair.mode === 'solo' &&
          pair.phase === 'checkpoint' &&
          !pair.error &&
          pair.approvedRevision === pairPlan(pair)?.revision &&
          nextPairBlock(pair)
        )
          turn = { kind: 'work', blockId: nextPairBlock(pair)!.id };
        else turn = undefined;
      }
    } catch (error) {
      const step = this.engine.getStep(featureId, stepId),
        attempt = step.attempts.at(-1);
      if (attempt?.id === attemptId && attempt.pair) {
        attempt.pair.busy = false;
        attempt.pair.phase = 'interrupted';
        attempt.pair.error = redact((error as Error).message);
        attempt.pair.version++;
        await this.persist();
      }
      throw error;
    }
  }
  cancel(featureId: string): void {
    this.pauseAutopilot(featureId, 'Exécution arrêtée par l’utilisateur.');
    if (this.active?.featureId !== featureId)
      throw new Error('Aucune exécution active pour cette session.');
    this.active.controller.abort();
  }
  private async askHuman(request: HumanRequest, signal: AbortSignal): Promise<string> {
    this.assertTrusted();
    if (signal.aborted) throw new Error('Exécution annulée.');
    this.pauseAutopilot(
      request.featureId,
      request.kind === 'question'
        ? 'Une réponse humaine est nécessaire. Reprends le pilote après l’échange.'
        : 'Un appel MCP attend une autorisation humaine.',
    );
    return await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        this.pendingHumans.delete(request.id);
        this.state.humanRequests = [...this.pendingHumans.values()].map((item) => item.request);
        this.publish();
      };
      const abort = () => {
        cleanup();
        reject(new Error('Demande humaine interrompue avec la tentative.'));
      };
      this.pendingHumans.set(request.id, { request, resolve, reject, cleanup });
      this.state.humanRequests = [...this.pendingHumans.values()].map((item) => item.request);
      signal.addEventListener('abort', abort, { once: true });
      this.publish();
    });
  }
  answerHumanRequest(requestId: string, answer: string): void {
    this.assertTrusted();
    const pending = this.pendingHumans.get(requestId);
    if (!pending) throw new Error('Cette demande n’est plus active.');
    const value = answer.trim();
    if (!value || value.length > 30000)
      throw new Error('Une réponse de 1 à 30 000 caractères est requise.');
    if (!pending.request.allowFreeform && !pending.request.choices?.includes(value))
      throw new Error('Choisis une des réponses proposées.');
    pending.cleanup();
    pending.resolve(value);
  }
  async testMcp(serverId: string): Promise<void> {
    this.assertTrusted();
    if (this.active || this.automation || this.workspaceTask)
      throw new Error('Arrête l’exécution avant de tester une connexion MCP.');
    const server = this.state.settings.mcpServers?.find((item) => item.id === serverId);
    if (!server) throw new Error('Enregistre d’abord la configuration de ce MCP.');
    if (!this.adapter.discoverMcp)
      throw new Error('Cet adaptateur ne permet pas la découverte MCP.');
    this.state.mcpCatalogs ??= {};
    if (this.state.mcpCatalogs[serverId]?.state === 'checking') return;
    this.state.mcpCatalogs[serverId] = { state: 'checking', tools: [] };
    this.publish();
    try {
      this.state.mcpCatalogs[serverId] = await this.adapter.discoverMcp(structuredClone(server));
    } catch (error) {
      this.state.mcpCatalogs[serverId] = {
        state: 'error',
        tools: [],
        error: redact((error as Error).message),
      };
    }
    this.publish();
  }
  assertConfigurable(featureId?: string): void {
    this.assertTrusted();
    if (this.workspaceTask) throw new Error('Attends la fin de l’opération sur les fichiers.');
    if (this.active && (!featureId || this.active.featureId === featureId))
      throw new Error('Arrête la tentative avant de modifier cette configuration.');
    if (this.automation && (!featureId || this.automation.featureId === featureId))
      throw new Error(
        'Mets le pilote en pause et attends la fin de sa tentative avant de modifier sa configuration.',
      );
  }
  async saveAutopilot(featureId: string, config: AutopilotConfig): Promise<void> {
    this.assertConfigurable(featureId);
    const feature = this.engine.getFeature(featureId),
      parsed = autopilotConfigSchema.parse(config);
    if (!feature.steps.length) throw new Error('Compose une équipe avant de configurer le pilote.');
    const ids = new Set(feature.steps.map((step) => step.id));
    if (
      [
        ...parsed.checkpoints,
        ...Object.keys(parsed.stepInputs),
        parsed.reviewStepId,
        parsed.correctionStepId,
      ]
        .filter(Boolean)
        .some((id) => !ids.has(id!))
    )
      throw new Error('Une étape du pilote est inconnue.');
    if (Boolean(parsed.reviewStepId) !== Boolean(parsed.correctionStepId))
      throw new Error(
        'La boucle de correction nécessite une étape de relecture et une étape à corriger.',
      );
    if (parsed.reviewStepId && parsed.correctionStepId) {
      const reaches = (id: string, target: string, visited = new Set<string>()): boolean => {
        if (visited.has(id)) return false;
        visited.add(id);
        return feature.steps
          .find((step) => step.id === id)!
          .dependsOn.some((dep) => dep === target || reaches(dep, target, visited));
      };
      if (!reaches(parsed.reviewStepId, parsed.correctionStepId))
        throw new Error('L’étape à corriger doit précéder la relecture dans ce parcours.');
    }
    for (const [id, input] of Object.entries(parsed.stepInputs))
      this.prepareInput(featureId, id, '', false, input);
    feature.autopilot = {
      ...parsed,
      status: 'idle',
      runs: 0,
      correctionCycles: 0,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }
  pauseAutopilot(
    featureId: string,
    reason = 'Pause demandée ; la tentative en cours peut terminer.',
  ): void {
    const feature = this.engine.getFeature(featureId);
    if (feature.autopilot?.status === 'running') {
      feature.autopilot.status = 'paused';
      feature.autopilot.reason = reason.slice(0, 2000);
      feature.autopilot.updatedAt = new Date().toISOString();
      this.schedule();
    }
  }
  async resolveOptionalStep(
    message: Extract<import('../shared/types').ClientMessage, { type: 'resolveOptionalStep' }>,
  ): Promise<void> {
    await this.workspaceAction(
      message.featureId,
      'Choix de l’intervention facultative',
      async () => {
        const feature = this.engine.getFeature(message.featureId);
        if (
          message.decisionId &&
          (feature.optionalRequest?.id !== message.decisionId ||
            feature.optionalRequest.stepId !== message.stepId)
        )
          throw new Error('Cette notification n’est plus actuelle. Consulte la session.');
        if (
          message.continueAutopilot &&
          (!message.decisionId || !feature.autopilot || feature.autopilot.status !== 'paused')
        )
          throw new Error('Le pilote doit attendre cette décision avant de continuer.');
        const previous = structuredClone(feature);
        try {
          this.engine.decideOptionalStep(
            feature.id,
            message.stepId,
            message.choice,
            message.expectedStateKey,
          );
          await this.persist();
        } catch (error) {
          Object.keys(feature).forEach((key) => {
            delete (feature as unknown as Record<string, unknown>)[key];
          });
          Object.assign(feature, previous);
          throw error;
        }
      },
    );
    if (message.continueAutopilot) await this.startAutopilot(message.featureId);
  }
  private notifiedOptional = new Set<string>();
  async startAutopilot(featureId: string): Promise<void> {
    this.assertTrusted();
    if (this.active || this.automation || this.workspaceTask)
      throw new Error('Une exécution ou un pilote est déjà actif.');
    const feature = this.engine.getFeature(featureId);
    if (!feature.steps.length) throw new Error('Compose une équipe avant de lancer le pilote.');
    if (!feature.autopilot)
      throw new Error('Configure le pilote et ses limites avant de le lancer.');
    if (feature.archived) throw new Error('La session est archivée.');
    if (this.state.runtime.state !== 'ready' || !this.state.runtime.authenticated)
      throw new Error('Connecte le CLI Copilot avant de lancer le pilote.');
    let complete!: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.automation = { featureId, done };
    feature.autopilot.status = 'running';
    feature.autopilot.reason = undefined;
    feature.autopilot.updatedAt = new Date().toISOString();
    try {
      await this.persist();
      while (!this.disposed && feature.autopilot.status === 'running') {
        this.assertTrusted();
        const action = nextAutopilotAction(feature);
        if (action.kind === 'pause') {
          this.pauseAutopilot(featureId, action.reason);
          if (action.optionalStepId) {
            feature.activeStepId = action.optionalStepId;
            feature.status = 'attention';
            const stateKey = featureStateKey(feature);
            if (
              feature.optionalRequest?.stateKey !== stateKey ||
              feature.optionalRequest.stepId !== action.optionalStepId
            )
              feature.optionalRequest = {
                id: randomUUID(),
                stepId: action.optionalStepId,
                stateKey,
              };
          }
          break;
        }
        if (action.kind === 'complete') {
          feature.autopilot.status = 'completed';
          feature.autopilot.reason = 'Parcours terminé.';
          break;
        }
        if (action.kind === 'approve') {
          const attempt = this.engine.getStep(featureId, action.stepId).attempts.at(-1)!;
          await this.approveStep(
            featureId,
            action.stepId,
            attempt.id,
            attempt.revision ?? 0,
            'autopilot',
          );
        } else {
          if (action.kind === 'correct') feature.autopilot.correctionCycles++;
          await this.runStep(
            featureId,
            action.stepId,
            action.feedback ?? '',
            action.kind === 'run' && Boolean(action.resume),
            feature.autopilot.stepInputs[action.stepId],
            undefined,
            true,
          );
        }
        await this.persist();
      }
    } catch (error) {
      this.pauseAutopilot(featureId, redact((error as Error).message));
      this.error(error);
    } finally {
      if (feature.autopilot.status === 'running')
        this.pauseAutopilot(featureId, 'Pilote interrompu ; reprise manuelle requise.');
      feature.autopilot.updatedAt = new Date().toISOString();
      this.automation = undefined;
      try {
        await this.persist();
        const request = feature.optionalRequest;
        if (request && !this.disposed && !this.notifiedOptional.has(request.id)) {
          this.notifiedOptional.add(request.id);
          this.emit('optionalStep', feature.id, structuredClone(request));
        }
      } finally {
        complete();
      }
    }
  }
  async approveStep(
    featureId: string,
    stepId: string,
    expectedAttemptId: string,
    expectedRevision: number,
    actor: 'human' | 'autopilot' = 'human',
  ): Promise<void> {
    if (actor === 'human') this.assertConfigurable(featureId);
    return this.workspaceAction(
      featureId,
      'Validation des preuves de la feature',
      () => this.approveInWorkspace(featureId, stepId, expectedAttemptId, expectedRevision, actor),
      actor === 'autopilot',
    );
  }
  private async approveInWorkspace(
    featureId: string,
    stepId: string,
    expectedAttemptId: string,
    expectedRevision: number,
    actor: 'human' | 'autopilot',
  ): Promise<void> {
    this.assertTrusted();
    const step = this.engine.getStep(featureId, stepId),
      attempt = step.attempts.at(-1);
    if (
      !attempt ||
      attempt.id !== expectedAttemptId ||
      (attempt.revision ?? 0) !== expectedRevision
    )
      throw new Error('Le livrable a changé. Relis la version actuelle avant validation.');
    const feature = this.engine.getFeature(featureId);
    const related = new Set([step.id]);
    const ancestors = (id: string): void => {
      for (const dep of feature.steps.find((item) => item.id === id)!.dependsOn)
        if (!related.has(dep)) {
          related.add(dep);
          ancestors(dep);
        }
    };
    ancestors(step.id);
    await this.verifyProofFiles(feature, related);
    // Recheck revision after asynchronous reads before touching the approval.
    this.assertTrusted();
    const correctionId = feature.activeCorrectionId;
    this.engine.approveStep(featureId, stepId, actor, expectedAttemptId, expectedRevision);
    if (correctionId && !feature.activeCorrectionId && actor === 'autopilot')
      this.pauseAutopilot(
        featureId,
        'Correction relue : reprends explicitement le pilote pour les étapes hors de cette route.',
      );
    await this.persist();
  }
  private async verifyProofFiles(feature: Feature, related: Set<string>): Promise<void> {
    const root = await this.featurePath(feature.id);
    const policies = new Map<string, PolicyEngine>();
    const resolveFile = async (file: string): Promise<string> => {
      const target = await this.fileLocation(feature.id, file);
      let policy = policies.get(target.root);
      if (!policy) {
        policy = new PolicyEngine(target.root, 'read-only', []);
        policies.set(target.root, policy);
      }
      return policy.resolve(target.path);
    };
    const ownedPaths = new Set<string>();
    for (const step of feature.steps.filter((item) => related.has(item.id))) {
      for (const historical of step.attempts)
        for (const file of Object.keys(historical.fileHashes ?? {})) ownedPaths.add(file);
      const attempt = step.attempts.at(-1);
      if (!attempt) continue;
      const proofs = currentTestEvidence(attempt);
      for (const evidence of proofs) {
        if (evidence.devops) {
          const proofRoot = evidence.projectId
            ? feature.projects?.find((project) => project.id === evidence.projectId)?.path
            : root;
          if (!proofRoot) throw new Error('Projet de preuve inconnu.');
          const head = await gitRead(proofRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], {
            rawOutput: true,
          });
          if (
            head.code !== 0 ||
            head.truncated ||
            head.stdout.trim() !== evidence.devops.target.commit
          )
            throw new Error(
              'Le commit local a changé depuis la vérification du test DevOps. Relance la validation.',
            );
        }
      }
      const snapshots = proofs.map((proof) => proof.fileHashes);
      for (const hashes of snapshots)
        for (const [file, hash] of Object.entries(hashes)) {
          let current = '<missing>';
          try {
            current = sha256(await readFile(await resolveFile(file)));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          if (current !== hash)
            throw new Error(
              `La preuve de test est obsolète : ${file} a changé. Relance les tests avant validation.`,
            );
        }
    }
    if (feature.steps.every((step) => related.has(step.id)))
      for (const file of Object.keys(feature.workspaceFileHashes ?? {})) ownedPaths.add(file);
    const owned = currentOwnedFileHashes(feature, ownedPaths);
    for (const file of ownedPaths) {
      let current = '<missing>';
      try {
        current = sha256(await readFile(await resolveFile(file)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (current !== owned[file])
        throw new Error(
          `La preuve de test est obsolète : ${file} a changé hors de la dernière écriture autorisée de la feature. Relance son étape avant validation.`,
        );
    }
  }
  async saveArtifact(
    featureId: string,
    stepId: string,
    content: string,
    options: EditorialSaveOptions,
  ): Promise<void> {
    this.assertConfigurable(featureId);
    this.engine.saveArtifact(featureId, stepId, content, options);
    await this.persist();
  }
  async requestCorrection(featureId: string, request: CorrectionRequest): Promise<string> {
    this.assertConfigurable(featureId);
    const feature = this.engine.getFeature(featureId);
    const cycle = this.engine.requestCorrection(featureId, request);
    if (!feature.autopilot) {
      feature.autopilot = {
        checkpoints: [request.sourceStepId],
        maxRuns: feature.budget?.maxRuns ?? defaultBudget.maxRuns,
        maxCorrectionCycles: 3,
        stepInputs: {},
        status: 'idle',
        runs: 0,
        correctionCycles: 0,
        updatedAt: new Date().toISOString(),
      };
    }
    await this.persist();
    // The standard pilot retains checkpoints, attempts, budgets and permission gates.
    void this.startAutopilot(featureId).catch((error) => {
      this.pauseAutopilot(featureId, (error as Error).message);
      this.error(error);
    });
    return cycle.id;
  }
  async finalizeFeature(featureId: string, expectedStateKey: string): Promise<string> {
    this.assertConfigurable(featureId);
    return this.workspaceAction(
      featureId,
      'Validation définitive des preuves de la feature',
      async () => {
        this.assertTrusted();
        const feature = this.engine.getFeature(featureId);
        if (expectedStateKey !== featureStateKey(feature))
          throw new Error(
            'La session a changé. Relis sa version actuelle avant validation définitive.',
          );
        if (!finalValidationReady(feature))
          throw new Error(
            'Valide toutes les étapes, les critères et les remarques bloquantes avant de terminer.',
          );
        for (const step of feature.steps.filter((item) => item.status !== 'skipped')) {
          const blockers = approvalBlockers(
            feature,
            { ...step, status: 'awaiting_review' },
            'human',
          );
          if (blockers.length) throw new Error(`${step.name} : ${blockers.join(' ')}`);
        }
        await this.verifyProofFiles(feature, new Set(feature.steps.map((step) => step.id)));
        this.assertTrusted();
        const id = this.engine.finalizeFeature(featureId, expectedStateKey);
        await this.persist();
        return id;
      },
    );
  }
  async previewObservation(featureId: string, options: ObservationOptions) {
    return this.workspaceAction(
      undefined,
      'Préparation du dossier de surveillance',
      async () => {
        const feature = this.engine.getFeature(featureId);
        const archive = await SessionArchive.create(
          this.store.rootPath,
          featureId,
          this.state.settings.traceLimitBytes ?? DEFAULT_TRACE_BYTES,
        );
        return (
          await prepareObservation(
            this.store.rootPath,
            structuredClone(feature),
            this.state.agents,
            archive,
            options,
          )
        ).preview;
      },
      false,
      true,
    );
  }
  async observeSession(
    featureId: string,
    options: ObservationOptions,
    fingerprint: string,
  ): Promise<void> {
    return this.workspaceAction(
      undefined,
      'Analyse de la session par l’Observateur',
      async () => {
        if (this.state.runtime.state !== 'ready' || !this.state.runtime.authenticated)
          throw new Error('Connecte Copilot avant de lancer l’Observateur.');
        if (!this.state.runtime.models.some((m) => m.id === options.model))
          throw new Error('Modèle indisponible sur ce compte.');
        const feature = this.engine.getFeature(featureId);
        const archive = await SessionArchive.create(
          this.store.rootPath,
          featureId,
          this.state.settings.traceLimitBytes ?? DEFAULT_TRACE_BYTES,
        );
        const dossier = await prepareObservation(
          this.store.rootPath,
          structuredClone(feature),
          this.state.agents,
          archive,
          options,
        );
        if (dossier.preview.fingerprint !== fingerprint)
          throw new Error('La session ou les réglages ont changé. Prépare un nouvel aperçu.');
        const controller = new AbortController();
        let complete!: () => void;
        const done = new Promise<void>((resolve) => {
          complete = resolve;
        });
        this.active = { featureId, stepId: '@observer', controller, done };
        try {
          await runObservation({
            root: this.store.rootPath,
            feature,
            dossier,
            adapter: this.adapter,
            workspacePath: this.workspacePath,
            settings: structuredClone(this.state.settings),
            signal: controller.signal,
            persist: () => this.persist(),
          });
        } finally {
          this.active = undefined;
          complete();
        }
      },
      false,
      true,
    );
  }
  cancelObservation(featureId: string): void {
    if (this.active?.featureId !== featureId || this.active.stepId !== '@observer')
      throw new Error('Aucune analyse active pour cette session.');
    this.active.controller.abort();
  }
  observation(featureId: string, observationId: string): SessionObservation {
    const review = this.engine
      .getFeature(featureId)
      .observations?.find((r) => r.id === observationId);
    if (!review) throw new Error('Analyse inconnue.');
    return review;
  }
  async observationSource(featureId: string, observationId: string, sourceId: string, offset = 0) {
    return observationSource(
      this.store.rootPath,
      featureId,
      this.observation(featureId, observationId),
      sourceId,
      offset,
    );
  }
  async sessionJournal(featureId: string, attemptId: string, offset = 0) {
    if (this.active?.featureId === featureId && this.active.stepId !== '@observer')
      throw new Error(
        'Le journal complet sera disponible à la fin de la tentative. L’activité affiche les événements en cours.',
      );
    const feature = this.engine.getFeature(featureId);
    if (!feature.steps.some((s) => s.attempts.some((a) => a.id === attemptId)))
      throw new Error('Tentative inconnue.');
    const archive = await SessionArchive.create(
      this.store.rootPath,
      featureId,
      this.state.settings.traceLimitBytes ?? DEFAULT_TRACE_BYTES,
    );
    return {
      ...(await archive.page(attemptId, offset)),
      ...(!archive.info.complete ? { error: archive.info.reason } : {}),
    };
  }
  /** Read file sizes only: no journal hydration and no Copilot call. Shared checkpoints are excluded. */
  async statisticsStorage(featureId: string): Promise<number> {
    const feature = this.engine.getFeature(featureId);
    let bytes = await privateSize(this.store.rootPath, sessionDirectory(featureId));
    for (const id of new Set(deletionRecord(feature).attempts))
      bytes += await privateSize(this.store.rootPath, `existing-changes/${id}`);
    return bytes;
  }
  async sessionStorage(featureId: string): Promise<SessionStorageInfo> {
    const feature = this.engine.getFeature(featureId);
    let traces: import('../shared/observation').TraceArchiveInfo;
    try {
      const archive = await SessionArchive.create(
        this.store.rootPath,
        featureId,
        this.state.settings.traceLimitBytes ?? DEFAULT_TRACE_BYTES,
      );
      traces = {
        ...archive.info,
        complete:
          archive.info.complete &&
          feature.steps.every((s) => s.attempts.every((a) => a.traceArchive?.complete)),
      };
    } catch (error) {
      traces = {
        bytes: await privateSize(
          this.store.rootPath,
          `${sessionDirectory(featureId)}/traces.jsonl`,
        ),
        records: feature.steps.reduce(
          (n, s) => n + s.attempts.reduce((m, a) => m + (a.traceArchive?.records ?? 0), 0),
          0,
        ),
        complete: false,
        reason: `Journal illisible ; la suppression reste disponible. ${(error as Error).message}`,
      };
    }
    let sharedBytes = 0;
    const record = deletionRecord(feature);
    for (const file of record.quality)
      sharedBytes += await privateSize(this.store.rootPath, `quality/${file}`);
    for (const checkpoint of feature.checkpoints ?? []) sharedBytes += checkpoint.totalBytes;
    let bytes = await privateSize(this.store.rootPath, sessionDirectory(featureId));
    for (const id of record.attempts)
      bytes += await privateSize(this.store.rootPath, `existing-changes/${id}`);
    return {
      bytes,
      sharedBytes,
      traces,
      traceLimitBytes: this.state.settings.traceLimitBytes ?? DEFAULT_TRACE_BYTES,
    };
  }
  async recoverSessionDeletions(): Promise<void> {
    for (const record of await pendingDeletions(this.store.rootPath)) {
      this.engine.features.splice(
        0,
        this.engine.features.length,
        ...this.engine.features.filter((f) => f.id !== record.featureId),
      );
      this.state.memory = (this.state.memory ?? []).filter(
        (m) => m.source?.featureId !== record.featureId,
      );
      await this.persist();
      await this.workspaces.purgeSession(record.featureId, record.checkpoints);
      await cleanSessionFiles(this.store.rootPath, record, this.engine.features);
      this.archives.delete(record.featureId);
      await this.adapter?.deleteSessions?.(record.sessionIds);
      await finishDeletion(this.store.rootPath, record.featureId);
    }
  }
  async archiveFeature(featureId: string, archived: boolean): Promise<void> {
    this.assertConfigurable(featureId);
    const feature = this.engine.getFeature(featureId);
    const previous = { ...structuredClone(feature), archived: feature.archived };
    this.engine.archiveFeature(featureId, archived);
    try {
      await this.persist();
    } catch (error) {
      Object.assign(feature, previous);
      this.publish();
      throw error;
    }
  }
  async deleteFeature(featureId: string): Promise<number> {
    return this.workspaceAction(undefined, 'Suppression définitive de la session', async () => {
      const feature = this.engine.getFeature(featureId);
      const before = await privateSize(this.store.rootPath, 'sessions');
      const backups = await privateSize(this.store.rootPath, 'existing-changes');
      const checkpoints = await privateSize(this.store.rootPath, 'workspaces');
      const quality = await privateSize(this.store.rootPath, 'quality');
      await markDeletion(this.store.rootPath, feature);
      await this.recoverSessionDeletions();
      const after =
        (await privateSize(this.store.rootPath, 'sessions')) +
        (await privateSize(this.store.rootPath, 'existing-changes')) +
        (await privateSize(this.store.rootPath, 'workspaces')) +
        (await privateSize(this.store.rootPath, 'quality'));
      return Math.max(0, before + backups + checkpoints + quality - after);
    });
  }
  async saveBudget(featureId: string, budget: FeatureBudget): Promise<void> {
    this.assertConfigurable(featureId);
    this.engine.getFeature(featureId).budget = budgetSchema.parse(budget);
    await this.persist();
  }
  private revise(featureId: string): void {
    const feature = this.engine.getFeature(featureId);
    feature.updatedAt = new Date().toISOString();
    delete feature.finalValidation;
    for (const step of feature.steps) {
      const attempt = step.attempts.at(-1);
      if (attempt) attempt.revision = (attempt.revision ?? 0) + 1;
    }
    this.engine.refreshFeatureStatus(featureId);
  }
  async saveCriteria(featureId: string, criteria: AcceptanceCriterion[]): Promise<void> {
    this.assertConfigurable(featureId);
    const parsed = criteria.map((item) => criterionSchema.parse(item));
    if (new Set(parsed.map((item) => item.id)).size !== parsed.length)
      throw new Error('Identifiants de critères dupliqués.');
    this.engine.getFeature(featureId).criteria = parsed;
    this.revise(featureId);
    await this.persist();
  }
  async addReviewComment(
    featureId: string,
    comment: Omit<ReviewComment, 'id' | 'createdAt' | 'resolved'>,
  ): Promise<void> {
    this.assertConfigurable(featureId);
    const feature = this.engine.getFeature(featureId),
      step = this.engine.getStep(featureId, comment.stepId);
    if (!step.attempts.some((attempt) => attempt.id === comment.attemptId))
      throw new Error('La tentative commentée n’existe pas.');
    const parsed = commentSchema.parse({
      ...comment,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      resolved: false,
    });
    feature.reviewComments ??= [];
    feature.reviewComments.push(parsed);
    this.revise(featureId);
    await this.persist();
  }
  async resolveReviewComment(
    featureId: string,
    commentId: string,
    resolved: boolean,
  ): Promise<void> {
    this.assertConfigurable(featureId);
    const comment = this.engine
      .getFeature(featureId)
      .reviewComments?.find((item) => item.id === commentId);
    if (!comment) throw new Error('Remarque inconnue.');
    comment.resolved = resolved;
    this.revise(featureId);
    await this.persist();
  }
  async saveMemory(entry: MemoryEntry): Promise<void> {
    this.assertConfigurable();
    const parsed = memorySchema.parse({ ...entry, updatedAt: new Date().toISOString() });
    if (parsed.source) {
      const step = this.engine.getStep(parsed.source.featureId, parsed.source.stepId);
      const latest = step.attempts.at(-1);
      if (
        step.status !== 'approved' ||
        latest?.id !== parsed.source.attemptId ||
        (parsed.source.revision !== undefined && parsed.source.revision !== (latest?.revision ?? 0))
      )
        throw new Error('Une mémoire issue d’un livrable exige sa dernière version validée.');
      parsed.source.revision = latest.revision ?? 0;
    }
    const memory = (this.state.memory ??= []);
    const index = memory.findIndex((item) => item.id === parsed.id);
    if (index < 0) memory.push(parsed);
    else memory[index] = parsed;
    await this.persist();
  }
  async deleteMemory(id: string): Promise<void> {
    this.assertConfigurable();
    this.state.memory = (this.state.memory ?? []).filter((entry) => entry.id !== id);
    await this.persist();
  }
  private async hooks(
    event: 'beforeRun' | 'afterRun',
    input: RunInput,
    signal: AbortSignal,
    callbacks: RunCallbacks,
  ): Promise<void> {
    if (input.step.policy === 'read-only') return;
    if ((input.projects?.length ?? 0) > 1) {
      for (const project of input.projects!)
        await this.hooks(
          event,
          { ...projectInput(input, project), projects: undefined },
          signal,
          callbacks,
        );
      return;
    }
    for (const hook of input.settings.hooks.filter(
      (item) => item.enabled && item.event === event,
    )) {
      callbacks.onEvent({
        id: randomUUID(),
        at: new Date().toISOString(),
        kind: 'info',
        message: `Hook ${hook.name} (${event})`,
      });
      const result = await runProcess(hook.command, hook.args, input.workspacePath, {
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
    this.globalGuard?.();
    if (this.active || this.automation || this.workspaceTask)
      throw new Error('Arrête la tentative et le pilote avant de changer les réglages.');
    this.state.settings = settingsSchema.parse(settings);
    for (const pending of this.archives.values())
      await pending.then((archive) => archive.flush()).catch(() => undefined);
    this.archives.clear();
    await this.persist();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.automation)
      this.pauseAutopilot(this.automation.featureId, 'Cockpit fermé ; reprise manuelle requise.');
    const active = this.active;
    active?.controller.abort();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.publishTimer) clearTimeout(this.publishTimer);
    await this.adapter?.dispose();
    await active?.done;
    await this.workspaceTask;
    await Promise.allSettled([...this.pairTasks.values()]);
    await this.automation?.done;
    if (this.state)
      await this.store.save(this.engine.features, this.state.settings, this.state.memory ?? []);
  }
}
