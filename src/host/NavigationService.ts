import { navigationMetrics } from '../shared/navigationMetrics';
import { NavigationEvaluationStore } from './NavigationEvaluationStore';
import type { NavigationEvaluationCommand } from '../shared/navigationEvaluation';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type {
  ApplicationProfile,
  BrowserInspection,
  NavigationActor,
  NavigationCapture,
  NavigationCommand,
  NavigationContextSnapshot,
  NavigationJourney,
  NavigationRun,
  NavigationSnapshot,
} from '../shared/navigation';
import { navigationCaptureSchema, navigationJourneySchema } from '../core/navigationSchemas';
import { NavigationStore } from './NavigationStore';
import { BrowserSessionManager } from './navigation/BrowserSessionManager';
import { CodeAnchorIndex } from './CodeAnchorIndex';
import { sameApplicationAuthority } from './NavigationContext';
import { importNavigationJSON, exportNavigationJourney } from './ChromeRecorderImport';

type Project = { id: string; path: string };
export interface NavigationServiceOptions {
  storageRoot: string;
  workerPath: string;
  trusted(): boolean;
  features?(): import('../shared/types').Feature[];
  projects(): Project[];
  browser?: BrowserSessionManager;
}

/** The only managed bridge between UI/agents, the private library, and the browser worker. */
export class NavigationService extends EventEmitter {
  readonly store: NavigationStore;
  readonly browser: BrowserSessionManager;
  readonly anchors: CodeAnchorIndex;
  readonly evaluation: NavigationEvaluationStore;
  private captures: NavigationCapture[] = [];
  private inspection?: BrowserInspection;
  private revisions?: NavigationJourney[];
  private agentLease?: { attemptId: string; context: NavigationContextSnapshot };
  private activeCommand = false;
  private receiptQueue: Promise<unknown> = Promise.resolve();
  constructor(readonly options: NavigationServiceOptions) {
    super();
    this.store = new NavigationStore(join(options.storageRoot, 'library'));
    this.anchors = new CodeAnchorIndex(join(options.storageRoot, 'index'));
    this.evaluation = new NavigationEvaluationStore({
      storageRoot: options.storageRoot,
      features: () => options.features?.() ?? [],
    });
    this.browser =
      options.browser ??
      new BrowserSessionManager({
        storageRoot: join(options.storageRoot, 'browser'),
        workerPath: options.workerPath,
        onChange: () => this.publish(),
      });
  }
  async initialize() {
    await this.store.load();
    await this.anchors.load();
    await this.evaluation.initialize();
    await this.browser.initialize();
    for (const run of this.browser.recoveryRuns()) {
      await this.store.recordRun(run);
      await this.browser.clearRecoveredRuns([run.id]);
    }
    try {
      const raw = JSON.parse(
        await readFile(join(this.options.storageRoot, 'captures.json'), 'utf8'),
      );
      if (!Array.isArray(raw) || raw.length > 1000) throw new Error('Index de captures invalide.');
      this.captures = raw.map((x) => navigationCaptureSchema.parse(x));
      for (const capture of this.captures.slice(-12))
        await this.previewCapture(capture).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  snapshot(): NavigationSnapshot {
    return {
      ...this.store.snapshot(),
      evaluation: this.evaluation.snapshot(),
      metrics: navigationMetrics(this.options.features?.() ?? []),
      browser: this.browser.status(),
      inspection: this.inspection,
      captures: structuredClone(this.captures.slice(-100)),
      codeAnchors: this.anchors.snapshot(),
      revisions: this.revisions,
    };
  }
  publish() {
    this.emit('state', this.snapshot());
  }
  private trusted() {
    if (!this.options.trusted())
      throw new Error('Approuve cet espace de travail avant de contrôler le navigateur.');
  }
  application(id: string) {
    const app = this.store.snapshot().applications.find((a) => a.id === id);
    if (!app) throw new Error('Application inconnue.');
    return app;
  }
  activeApplication() {
    const state = this.browser.status();
    if (!state || state.state === 'closed')
      throw new Error('Prépare une application dans Applications.');
    return this.application(state.applicationId);
  }
  beginAgent(attemptId: string, context: NavigationContextSnapshot) {
    this.trusted();
    if (this.agentLease && this.agentLease.attemptId !== attemptId)
      throw new Error('Un autre agent utilise le navigateur.');
    if (this.agentLease && this.agentLease.context.digest !== context.digest)
      throw new Error('Le contexte a changé. Prépare une nouvelle tentative.');
    if (
      this.activeCommand ||
      ['recording', 'human', 'stopping'].includes(this.browser.status()?.state ?? '')
    )
      throw new Error(
        'Termine la démonstration ou rends le contrôle à KerAI avant de lancer cet agent.',
      );
    this.agentLease = { attemptId, context: structuredClone(context) };
  }
  endAgent(attemptId: string) {
    if (this.agentLease?.attemptId === attemptId) {
      this.agentLease = undefined;
      this.publish();
    }
  }
  async interruptAgentBrowser(attemptId: string) {
    if (this.agentLease?.attemptId !== attemptId) return;
    await this.browser.stop();
  }
  assertAgent(attemptId: string) {
    this.trusted();
    const lease = this.agentLease;
    if (!lease || lease.attemptId !== attemptId)
      throw new Error('Le contrôle du navigateur a été repris. Prépare une nouvelle tentative.');
    if (
      !sameApplicationAuthority(
        lease.context.application,
        this.application(lease.context.application.id),
      )
    )
      throw new Error(
        'Le profil ou les droits de l’application ont changé. Prépare une nouvelle tentative.',
      );
    return lease.context;
  }
  assertBrowser(applicationId: string) {
    const state = this.browser.status();
    if (
      !state ||
      state.applicationId !== applicationId ||
      ['human', 'recording', 'closed', 'stopping', 'interrupted'].includes(state.state)
    )
      throw new Error(
        'Le navigateur n’est pas prêt pour cette application. Prépare-le ou rends le contrôle depuis Applications.',
      );
  }
  actor(attemptId: string, agentId: string): NavigationActor {
    const context = this.assertAgent(attemptId);
    if (context.application.ownerNavigatorId !== agentId)
      throw new Error(
        'Seul le Navigateur désigné peut entretenir les parcours de cette application.',
      );
    return { kind: 'navigator', agentId, attemptId, applicationId: context.application.id };
  }
  async replay(
    journey: NavigationJourney,
    parameters: Record<string, string>,
    options: {
      mode?: 'reach' | 'reproduce' | 'verify';
      prerequisitesConfirmed?: boolean;
      binding?: NavigationRun['binding'];
    } = {},
  ) {
    this.assertBrowser(journey.applicationId);
    const run = await this.browser.replay(journey, parameters, options);
    await this.store.recordRun(run);
    await this.browser.clearRecoveredRuns([run.id]);
    this.publish();
    return run;
  }
  async inspect(
    target?: Parameters<BrowserSessionManager['inspect']>[0],
    context?: NavigationContextSnapshot,
  ) {
    const application = this.activeApplication();
    this.assertBrowser(application.id);
    if (context && !sameApplicationAuthority(context.application, application))
      throw new Error('Le profil de navigation a changé ; prépare un nouveau contexte.');
    const binding = context?.binding;
    if (
      binding &&
      (binding.applicationId !== application.id ||
        binding.projectIds.length !== binding.roots.length)
    )
      throw new Error('Binding de dépôts incohérent.');
    // Agent roots are the frozen host/worktree roots. UI uses only configured project roots.
    const projects = context
      ? (binding?.projectIds.map((id, index) => ({ id, path: binding.roots[index] })) ?? [])
      : this.options.projects();
    this.inspection = await this.browser.inspect(target);
    await this.anchors.observe(
      application,
      this.inspection,
      projects.filter((project) => application.projectIds.includes(project.id)),
    );
    this.publish();
    return this.inspection;
  }
  async verifyAnchors(
    applicationId?: string,
    projects: Project[] = this.options.projects(),
    queries: string[] = [],
  ) {
    if (!applicationId) return this.anchors.snapshot();
    const application = this.application(applicationId);
    return this.anchors.verify(
      projects.filter((project) => application.projectIds.includes(project.id)),
      { applicationId, queries, limit: 64 },
    );
  }
  async capture(context?: NavigationContextSnapshot, attemptId?: string) {
    const application = this.activeApplication();
    const raw = await this.browser.capture();
    const capture: NavigationCapture = {
      ...raw,
      id: randomUUID(),
      applicationId: application.id,
      role: application.role,
      binding: context?.binding ?? {
        applicationId: application.id,
        origin: application.origin,
        projectIds: application.projectIds,
        roots: application.projectIds.map(
          (id) => this.options.projects().find((project) => project.id === id)?.path ?? '',
        ),
        verification: 'unknown',
        reason: 'Observation libre ; version servie non vérifiée.',
      },
      journeyId: context?.journey?.id,
      revision: context?.journey?.revision,
      attemptId,
    };
    await this.previewCapture(capture);
    const task = this.receiptQueue
      .catch(() => undefined)
      .then(async () => {
        if (this.captures.reduce((n, c) => n + c.bytes, 0) + capture.bytes > 512 * 1024 * 1024)
          throw new Error(
            'Quota de preuves atteint (512 Mio). Exporte et archive les preuves avant de continuer.',
          );
        if (this.captures.length >= 1000) throw new Error('Limite de 1 000 captures atteinte.');
        const next = [...this.captures, capture];
        for (const old of next.slice(0, -12)) delete old.previewUrl;
        const tmp = join(this.options.storageRoot, `captures-${randomUUID()}.tmp`);
        await mkdir(this.options.storageRoot, { recursive: true });
        await writeFile(tmp, JSON.stringify(next.map(({ previewUrl: _, ...rest }) => rest)), {
          flag: 'wx',
          mode: 0o600,
        });
        await rename(tmp, join(this.options.storageRoot, 'captures.json'));
        this.captures = next;
      });
    this.receiptQueue = task;
    await task;
    this.publish();
    return capture;
  }
  async verifiedCapture(capture: NavigationCapture) {
    const root = await realpath(join(this.options.storageRoot, 'browser'));
    const path = await realpath(capture.path);
    const rel = relative(root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
      throw new Error('Capture hors stockage privé.');
    const stat = await lstat(capture.path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== capture.bytes ||
      stat.size > 16 * 1024 * 1024
    )
      throw new Error('Capture invalide ou trop volumineuse.');
    const bytes = await readFile(path);
    if (
      createHash('sha256').update(bytes).digest('hex') !== capture.sha256 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error('Empreinte ou format de capture invalide.');
    return bytes;
  }
  private async previewCapture(capture: NavigationCapture) {
    capture.previewUrl = `data:image/png;base64,${(await this.verifiedCapture(capture)).toString('base64')}`;
  }
  async handle(command: NavigationCommand): Promise<{
    message?: string;
    exportText?: string;
    exportName?: string;
    openPath?: string;
    description?: { application: ApplicationProfile; title: string; description: string };
  }> {
    if (command.action === 'load') {
      await this.store.load();
      await this.anchors.verify(this.options.projects());
      this.publish();
      return {};
    }
    this.trusted();
    if (command.action.startsWith('evaluation')) {
      try {
        return await this.evaluation.handle(command as NavigationEvaluationCommand);
      } finally {
        this.publish();
      }
    }
    if (['stop', 'takeControl', 'authenticate', 'closeBrowser'].includes(command.action)) {
      this.agentLease = undefined;
      if (command.action === 'closeBrowser') await this.browser.close();
      else if (command.action === 'takeControl' || command.action === 'authenticate')
        await this.browser.takeControl();
      else await this.browser.stop();
      this.publish();
      return {};
    }
    if (this.agentLease)
      throw new Error('Un agent utilise le navigateur. Reprends la main avant cette opération.');
    if (this.activeCommand) throw new Error('Une opération de navigation est en cours.');
    this.activeCommand = true;
    try {
      const human: NavigationActor = { kind: 'human' };
      switch (command.action) {
        case 'saveApplication': {
          if (
            command.application.projectIds.some(
              (id) => !this.options.projects().some((p) => p.id === id),
            )
          )
            throw new Error('Dépôt non autorisé dans ce cockpit.');
          if (this.browser.status()?.applicationId === command.application.id)
            await this.browser.close();
          await this.store.saveApplication(command.application);
          break;
        }
        case 'saveDraft':
          await this.store.saveDraft(command.journey, command.expectedRevision, human);
          break;
        case 'commit':
          if (!command.runId) throw new Error('Un rejeu de vérification est requis.');
          await this.store.commit(
            command.journeyId,
            command.expectedRevision,
            command.runId,
            human,
          );
          break;
        case 'archive':
          await this.store.archive(command.journeyId, command.expectedRevision, human);
          break;
        case 'history':
          this.revisions = await this.store.history(command.journeyId);
          break;
        case 'import': {
          const result = importNavigationJSON(command.json, command.applicationId);
          await this.store.saveDraft(result.journey, 0, human);
          return {
            message:
              result.warnings?.join('\n') ||
              'Import enregistré en brouillon. Vérifie les étapes puis lance un rejeu.',
          };
        }
        case 'describe':
          return {
            description: {
              application: this.application(command.applicationId),
              title: command.title || 'Apprendre un parcours',
              description: command.description,
            },
          };
        case 'prepare':
          await this.browser.prepare();
          await this.browser.open(this.application(command.applicationId));
          break;
        case 'resumeControl':
          await this.browser.resumeControl();
          break;
        case 'replay': {
          const journey = this.store.snapshot().journeys.find((j) => j.id === command.journeyId);
          if (!journey) throw new Error('Parcours inconnu.');
          const app = this.application(journey.applicationId);
          if (app.interactionPolicy === 'inspect' || !command.confirmInteractions)
            throw new Error('Confirme les interactions du parcours et les droits du profil.');
          if (journey.status !== 'available' && command.mode !== 'verify')
            throw new Error('Ce brouillon exige un rejeu de vérification.');
          await this.replay(journey, command.parameters, {
            mode: command.mode,
            prerequisitesConfirmed: command.prerequisitesConfirmed,
          });
          break;
        }
        case 'recordStart':
          this.assertBrowser(command.applicationId);
          await this.browser.startRecording();
          break;
        case 'recordPause':
          await this.browser.pauseRecording();
          break;
        case 'recordResume':
          await this.browser.resumeRecording();
          break;
        case 'recordCancel':
          await this.browser.stopRecording();
          await this.browser.acknowledgeRecording();
          break;
        case 'recordFinish': {
          const recording = await this.browser.stopRecording();
          const now = new Date().toISOString();
          const journey = navigationJourneySchema.parse({
            id: randomUUID(),
            applicationId: recording.applicationId,
            revision: 0,
            title: command.title,
            intent: command.intent,
            tags: [],
            prerequisites: [],
            parameters: [],
            steps: recording.recordedSteps,
            arrival: command.arrival,
            status: 'draft',
            provenance: { mode: 'demonstration', notes: recording.warnings.join('\n') },
            createdAt: now,
            updatedAt: now,
          });
          await this.store.saveDraft(journey, 0, human);
          await this.browser.acknowledgeRecording();
          break;
        }
        case 'inspect':
          await this.inspect({ target: command.target });
          break;
        case 'capture':
          await this.capture();
          break;
        case 'contribute':
          await this.store.contribute({
            ...command.contribution,
            author: 'human',
            status: 'pending',
          });
          break;
        case 'resolveContribution':
          await this.store.resolveContribution(command.id, command.status, human);
          break;
        case 'sourceSearch': {
          const app = this.activeApplication();
          const project = this.options
            .projects()
            .find((p) => p.id === (command.projectId || app.projectIds[0]));
          if (!project || !app.projectIds.includes(project.id))
            throw new Error('Dépôt non associé à cette application.');
          await this.anchors.search(app.id, project, command.query, command.directory);
          break;
        }
        case 'openSource': {
          const project = this.options.projects().find((p) => p.id === command.projectId);
          if (!project) throw new Error('Projet inconnu.');
          return { openPath: await this.anchors.resolve(project, command.relativePath) };
        }
        case 'export': {
          const journey = this.store.snapshot().journeys.find((j) => j.id === command.journeyId);
          if (!journey) throw new Error('Parcours inconnu.');
          return { exportText: exportNavigationJourney(journey), exportName: 'parcours.json' };
        }
        case 'exportMetrics':
          return {
            exportText: JSON.stringify(this.aggregateMetrics(), null, 2),
            exportName: 'navigation-mesures.json',
          };
      }
      return {};
    } finally {
      this.activeCommand = false;
      this.publish();
    }
  }
  aggregateMetrics() {
    const runs = this.store.snapshot().runs;
    return {
      provider: navigationMetrics(this.options.features?.() ?? []),
      version: 1,
      createdAt: new Date().toISOString(),
      runs: runs.length,
      succeeded: runs.filter((r) => r.status === 'succeeded').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      interrupted: runs.filter((r) => r.status === 'interrupted').length,
      actions: runs.reduce((n, r) => n + r.metrics.actions, 0),
      durationMs: runs.reduce((n, r) => n + r.metrics.durationMs, 0),
      outputChars: runs.reduce((n, r) => n + r.metrics.outputChars, 0),
      providerCalls: runs.reduce((n, r) => n + r.metrics.providerCalls, 0),
      economicGain: null,
      reason:
        'Mesures locales de rejeu uniquement ; apprentissage, entretien et usages des agents à joindre depuis les sessions pour comparer les coûts complets.',
    };
  }
  async dispose() {
    this.agentLease = undefined;
    await this.browser.dispose();
  }
}
