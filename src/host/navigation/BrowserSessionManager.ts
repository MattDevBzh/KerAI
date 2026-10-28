import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, lstat, realpath, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ApplicationProfile,
  BrowserSessionState,
  BrowserInspection,
  NavigationJourney,
  NavigationRun,
  NavigationStep,
  ExecutionBinding,
  NavigationLocator,
} from '../../shared/navigation';
import { hasSensitiveNavigationUrl, isNavigationUrl } from '../../core/navigationSchemas';
import { NavigationRecovery } from './NavigationRecovery';
import { navigationDefinitionHash } from '../NavigationStore';
import { NAVIGATION_LIMITS } from '../../shared/navigation';
import type {
  BrowserActionResult,
  BrowserCapture,
  InspectionRequest,
  WorkerCommand,
  WorkerResponse,
} from './protocol';
export type { BrowserActionResult, BrowserCapture, InspectionRequest } from './protocol';
export type BrowserPreparation = {
  runtime: string;
  executablePath?: string;
  ready: boolean;
  reason?: string;
};
export type BrowserSessionOptions = {
  storageRoot: string;
  workerPath?: string;
  executablePath?: string;
  headless?: boolean;
  onChange?: (state: BrowserSessionState) => void;
};

/** One host owner, one outstanding command, one generation. No model or provider dependency. */
export class BrowserSessionManager {
  private worker?: ChildProcess;
  private state?: BrowserSessionState;
  private application?: ApplicationProfile;
  private sequence = 0;
  private commandId = 0;
  private generation = 0;
  private busy = false;
  private recordingBeforeHuman = false;
  private capturedBytes = 0;
  private recordingActive = false;
  private currentRun?: NavigationRun;
  private recoveredRuns: NavigationRun[] = [];
  private readonly recovery: NavigationRecovery;
  private recoveryError?: Error;
  private initialized = false;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(private readonly options: BrowserSessionOptions) {
    this.recovery = new NavigationRecovery(path.join(options.storageRoot, 'navigation'));
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const saved = await this.recovery.read();
    this.initialized = true;
    if (!saved) return;
    this.state = saved.state;
    this.recordingActive = Boolean(this.state?.recordingActive);
    if (this.state) {
      this.generation = this.state.generation + 1;
      this.state.generation = this.generation;
      if (this.state.state !== 'closed') this.state.state = 'interrupted';
      this.state.recordingPaused = true;
      if (this.state.state === 'interrupted')
        this.state.warnings.push(
          'Session récupérée après interruption ; dernières interactions potentiellement incomplètes. Reprise explicite requise.',
        );
    }
    this.recoveredRuns = saved.runs.map((run) =>
      run.status === 'running'
        ? {
            ...run,
            status: 'interrupted',
            arrivalVerified: false,
            finishedAt: new Date().toISOString(),
            error:
              'Processus interrompu pendant le rejeu ; dernier effet éventuellement non observé.',
          }
        : run,
    );
    this.changed();
    await this.recovery.flush();
  }
  recoveryRuns(): NavigationRun[] {
    return structuredClone(this.recoveredRuns);
  }
  async clearRecoveredRuns(ids?: string[]): Promise<void> {
    this.recoveredRuns = ids ? this.recoveredRuns.filter((run) => !ids.includes(run.id)) : [];
    this.changed();
    await this.recovery.flush();
  }
  async acknowledgeRecording(): Promise<void> {
    if (this.state) this.state.recordedSteps = [];
    this.recordingActive = false;
    this.changed();
    await this.recovery.flush();
  }
  status(): BrowserSessionState | undefined {
    return this.state
      ? { ...structuredClone(this.state), recordingActive: this.recordingActive }
      : undefined;
  }
  private changed() {
    if (this.state) this.state.warnings = this.state.warnings.slice(-100);
    const snapshot = this.status();
    void this.recovery
      .write({
        version: 1,
        state: snapshot,
        runs: [...this.recoveredRuns, ...(this.currentRun ? [this.currentRun] : [])],
      })
      .catch((error) => {
        this.recoveryError =
          error instanceof Error ? error : new Error('Journal navigateur indisponible.');
        if (this.state) {
          this.state.recordingPaused = true;
          this.state.warnings = [
            ...this.state.warnings.slice(-99),
            'Journal privé indisponible : reprise suspendue.',
          ];
          this.options.onChange?.(this.status()!);
        }
        if (this.worker) void this.request('recordPause').catch(() => {});
      });
    if (snapshot) this.options.onChange?.(snapshot);
  }
  private startWorker() {
    if (this.worker) return;
    const worker = fork(
      this.options.workerPath ?? path.join(__dirname, 'navigation-runtime', 'worker.cjs'),
      [],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: [],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    );
    this.worker = worker;
    worker.on('message', (message: WorkerResponse) => {
      if ('event' in message) {
        if (!this.state || message.generation !== this.generation) return;
        if (message.event === 'interrupted') {
          this.generation++;
          this.state.generation = this.generation;
          this.state.state = 'interrupted';
          this.state.recordingPaused = true;
          this.state.warnings.push(message.message);
        } else if (message.event === 'record') {
          if (this.state.state !== 'recording' || this.state.recordingPaused) return;
          if (message.sequence !== this.sequence + 1) {
            this.state.warnings.push('Enregistrement incomplet : séquence interrompue.');
            this.state.recordingPaused = true;
          } else if (this.state.recordedSteps.length < NAVIGATION_LIMITS.steps) {
            this.sequence = message.sequence;
            this.state.recordedSteps.push(message.step);
          } else {
            this.state.recordingPaused = true;
            this.state.warnings.push('Limite de 80 étapes atteinte ; enregistrement suspendu.');
            void this.request('recordPause').catch(() => {});
          }
        } else this.state.warnings.push(message.message);
        this.changed();
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.generation !== this.generation)
        pending.reject(new Error('Bail navigateur périmé.'));
      else if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    worker.on('error', () => this.workerFailed(worker));
    worker.on('exit', () => this.workerFailed(worker));
  }
  private workerFailed(worker: ChildProcess) {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Processus navigateur interrompu.'));
    }
    this.pending.clear();
    if (this.state && this.state.state !== 'closed') {
      this.state.state = 'interrupted';
      this.state.recordingPaused = true;
      this.changed();
    }
  }
  private request<T = unknown>(
    command: WorkerCommand,
    payload?: unknown,
    timeoutMs = 20000,
  ): Promise<T> {
    this.startWorker();
    const id = ++this.commandId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Délai du navigateur dépassé ; session interrompue.'));
        if (this.worker) {
          const worker = this.worker;
          this.worker = undefined;
          worker.kill();
        }
        if (this.state) {
          this.state.state = 'interrupted';
          this.changed();
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.send({ id, generation: this.generation, command, payload }, (error) => {
        if (error) {
          const p = this.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            reject(new Error('Communication navigateur interrompue.'));
          }
        }
      });
    });
  }
  private async exclusive<T>(task: () => Promise<T>, allowRecording = false): Promise<T> {
    if (this.recoveryError)
      throw new Error('Journal navigateur indisponible ; aucune nouvelle action autorisée.');
    if (this.busy) throw new Error('Le navigateur possède déjà une commande active.');
    if (!this.state || ['human', 'stopping', 'interrupted', 'closed'].includes(this.state.state))
      throw new Error('Reprise explicite du navigateur nécessaire.');
    if (this.state.state === 'recording' && !allowRecording)
      throw new Error('Arrêtez la démonstration avant une commande agent.');
    this.busy = true;
    try {
      return await task();
    } finally {
      this.busy = false;
      await this.recovery.flush();
    }
  }
  async prepare(): Promise<BrowserPreparation> {
    return this.request('prepare', { executablePath: this.options.executablePath });
  }
  async open(application: ApplicationProfile): Promise<BrowserSessionState> {
    const origin = navigationOrigin(application.origin);
    const entryUrl = application.startUrl ?? application.origin;
    if (navigationOrigin(entryUrl) !== origin)
      throw new Error('L’URL de démarrage doit appartenir au site de l’application.');
    const startUrl = new URL(entryUrl).href;
    const origins = [...new Set([origin, ...application.allowedOrigins.map(navigationOrigin)])];
    await this.initialize();
    if (this.recordingActive)
      throw new Error(
        'Terminez ou annulez la démonstration conservée avant d’ouvrir une nouvelle session.',
      );
    if (this.busy) throw new Error('Le navigateur possède déjà une commande active.');
    await this.close();
    this.application = structuredClone({
      ...application,
      origin,
      startUrl,
      allowedOrigins: origins,
    });
    this.recordingBeforeHuman = false;
    this.recordingActive = false;
    this.capturedBytes = 0;
    this.generation++;
    this.state = {
      id: randomUUID(),
      applicationId: application.id,
      state: 'idle',
      generation: this.generation,
      recordedSteps: [],
      recordingPaused: true,
      warnings: [],
    };
    this.changed();
    this.busy = true;
    try {
      // Browser credentials are separated from exportable navigation objects and never imported from personal profiles.
      const profilePath = path.join(
        this.options.storageRoot,
        'browser-profiles',
        createHash('sha256')
          .update(JSON.stringify([application.id, origin, application.role ?? 'default']))
          .digest('hex'),
      );
      await mkdir(profilePath, { recursive: true, mode: 0o700 });
      const result = await this.request<{ url: string }>(
        'open',
        {
          origin,
          startUrl,
          allowedOrigins: origins,
          authenticationOrigins: application.authenticationOrigins ?? [],
          profilePath,
          executablePath: application.browserExecutable ?? this.options.executablePath,
          headless: this.options.headless ?? false,
        },
        30000,
      );
      this.state.url = result.url;
      this.changed();
      return this.status()!;
    } catch (error) {
      this.state.state = 'interrupted';
      this.changed();
      throw error;
    } finally {
      this.busy = false;
      await this.recovery.flush();
    }
  }
  async act(
    step: NavigationStep,
    parameters: Record<string, string> = {},
  ): Promise<BrowserActionResult> {
    return this.exclusive(async () => {
      if (this.application?.interactionPolicy === 'inspect' && !['wait'].includes(step.action))
        throw new Error('Ce profil autorise uniquement l’inspection.');
      this.state!.state = 'agent';
      this.changed();
      try {
        const result = await this.request<BrowserActionResult>('act', { step, parameters });
        this.state!.url = result.url;
        return result;
      } finally {
        if (this.state?.state === 'agent') this.state.state = 'idle';
        this.changed();
      }
    });
  }
  async inspect(request: InspectionRequest = {}): Promise<BrowserInspection> {
    return this.exclusive(() => this.request('inspect', request));
  }
  async capture(request: { target?: NavigationLocator } = {}): Promise<BrowserCapture> {
    return this.exclusive(async () => {
      const result = await this.request<{
        data: string;
        url: string;
        viewport: { width: number; height: number };
        browser: string;
      }>('capture', request);
      const data = Buffer.from(result.data, 'base64');
      if (this.capturedBytes + data.length > 64 * 1024 * 1024)
        throw new Error('Quota de captures de cette session atteint (64 Mio).');
      if (
        data.length > 16 * 1024 * 1024 ||
        !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error('Capture invalide ou trop volumineuse.');
      const sha256 = createHash('sha256').update(data).digest('hex');
      const directory = path.join(this.options.storageRoot, 'navigation', 'objects');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (!(await lstat(directory)).isDirectory())
        throw new Error('Répertoire de captures non conforme.');
      const files = await readdir(directory, { withFileTypes: true });
      let total = 0;
      for (const file of files)
        if (file.isFile()) total += (await lstat(path.join(directory, file.name))).size;
      if (total + data.length > 512 * 1024 * 1024)
        throw new Error('Quota de captures du projet atteint (512 Mio).');
      const target = path.join(await realpath(directory), `${sha256}.png`);
      try {
        await writeFile(target, data, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
          !(await lstat(target)).isFile() ||
          createHash('sha256')
            .update(await readFile(target))
            .digest('hex') !== sha256
        )
          throw error;
      }
      this.capturedBytes += data.length;
      return {
        path: target,
        sha256,
        bytes: data.length,
        url: result.url,
        createdAt: new Date().toISOString(),
        viewport: result.viewport,
        browser: result.browser,
      };
    });
  }
  async startRecording(): Promise<BrowserSessionState> {
    if (this.recordingActive) throw new Error('Une démonstration reste à sauvegarder ou annuler.');
    return this.exclusive(async () => {
      this.state!.recordedSteps = [];
      this.sequence = 0;
      this.recordingActive = true;
      this.state!.state = 'recording';
      this.state!.recordingPaused = false;
      try {
        const initial = await this.request<{ url: string }>('recordStart');
        this.state!.url = initial.url;
        this.state!.recordedSteps.unshift({
          id: randomUUID(),
          action: 'navigate',
          url: initial.url,
          effect: 'read',
        });
      } catch (error) {
        this.state!.state = 'idle';
        this.recordingActive = false;
        this.state!.recordingPaused = true;
        throw error;
      }
      this.changed();
      return this.status()!;
    });
  }
  async pauseRecording(): Promise<BrowserSessionState> {
    return this.exclusive(async () => {
      await this.request('recordPause');
      this.state!.recordingPaused = true;
      this.changed();
      return this.status()!;
    }, true);
  }
  async resumeRecording(): Promise<BrowserSessionState> {
    if (this.state?.state === 'human' && this.recordingBeforeHuman) {
      await this.resumeControl();
      this.state!.state = 'recording';
    }
    return this.exclusive(async () => {
      if (this.state!.state !== 'recording') throw new Error('Aucune démonstration active.');
      this.state!.recordingPaused = false;
      await this.request('recordResume');
      this.changed();
      return this.status()!;
    }, true);
  }
  async stopRecording(): Promise<BrowserSessionState> {
    if (
      this.state &&
      ['human', 'interrupted', 'closed'].includes(this.state.state) &&
      this.recordingActive &&
      !this.busy
    ) {
      if (this.state.state === 'human') await this.request('recordStop');
      this.state.recordingPaused = true;
      this.recordingBeforeHuman = false;
      // Keep recovery active until the host acknowledges that the reviewed draft was persisted.
      this.changed();
      await this.recovery.flush();
      return this.status()!;
    }
    return this.exclusive(async () => {
      await this.request('recordStop');
      this.state!.recordingPaused = true;
      this.state!.state = 'idle';
      this.recordingBeforeHuman = false;
      this.changed();
      return this.status()!;
    }, true);
  }
  async takeControl(): Promise<BrowserSessionState> {
    if (this.busy) await this.stop();
    if (!this.state || this.state.state === 'closed' || this.state.state === 'interrupted')
      throw new Error('Rouvrez le navigateur pour une reprise après interruption.');
    this.recordingBeforeHuman = this.state.state === 'recording';
    await this.request('human');
    this.state.recordingPaused = true;
    this.state.state = 'human';
    this.changed();
    await this.recovery.flush();
    return this.status()!;
  }
  async resumeControl(): Promise<BrowserSessionState> {
    if (!this.state || this.state.state !== 'human')
      throw new Error('Aucune reprise manuelle active.');
    await this.request('resume');
    this.state.state = 'idle';
    this.changed();
    await this.recovery.flush();
    return this.status()!;
  }
  async replay(
    journey: NavigationJourney,
    parameters: Record<string, string>,
    options: {
      binding?: ExecutionBinding;
      mode?: NavigationRun['mode'];
      prerequisitesConfirmed?: boolean;
    } = {},
  ): Promise<NavigationRun> {
    if (journey.applicationId !== this.application?.id || !this.state)
      throw new Error('Le parcours ne correspond pas à l’application ouverte.');
    if (journey.steps.length > NAVIGATION_LIMITS.steps)
      throw new Error('Limite de 80 étapes dépassée.');
    if (journey.prerequisites.length && !options.prerequisitesConfirmed)
      throw new Error('Prérequis du parcours non confirmés.');
    for (const parameter of journey.parameters) {
      if (parameter.sensitive)
        throw new Error('Les paramètres secrets doivent être renseignés manuellement.');
      if (
        parameter.required &&
        !(parameter.name in parameters) &&
        parameter.defaultValue === undefined
      )
        throw new Error(`Paramètre manquant : ${parameter.name}`);
    }
    const resolved = Object.fromEntries(
      journey.parameters.map((p) => [p.name, parameters[p.name] ?? p.defaultValue ?? '']),
    );
    const started = Date.now();
    const run: NavigationRun = {
      id: randomUUID(),
      journeyId: journey.id,
      revision: journey.revision,
      definitionHash: navigationDefinitionHash(journey),
      applicationId: journey.applicationId,
      mode: options.mode ?? 'verify',
      status: 'running',
      startedAt: new Date().toISOString(),
      arrivalVerified: false,
      prerequisitesConfirmed: options.prerequisitesConfirmed ?? journey.prerequisites.length === 0,
      binding: options.binding ?? {
        applicationId: journey.applicationId,
        origin: this.application.origin,
        projectIds: this.application.projectIds,
        roots: [],
        verification: 'declared',
        reason: 'Serveur existant ; build non vérifié.',
      },
      events: [],
      evidencePaths: [],
      metrics: { actions: 0, durationMs: 0, outputChars: 0, providerCalls: 0 },
    };
    await this.exclusive(async () => {
      if (this.recoveredRuns.length >= 63)
        throw new Error('Trop de reçus en attente de sauvegarde ; reprise requise.');
      this.currentRun = run;
      this.state!.state = 'agent';
      this.changed();
      const generation = this.generation;
      await this.recovery.flush();
      try {
        if (this.application!.interactionPolicy === 'inspect')
          throw new Error('Le rejeu exige une autorisation d’interaction.');
        // Fresh documents and tabs; preserve only the explicit private authentication profile.
        // Existing server/application data are prerequisites, never silently reset.
        const initial = await this.request<{ url: string }>('reset', undefined, 30000);
        this.state!.url = initial.url;
        run.metrics.actions++;
        run.events.push({
          stepId: 'browser-reset',
          status: 'succeeded',
          at: new Date().toISOString(),
        });
        this.changed();
        await this.recovery.flush();
        for (const step of journey.steps) {
          if (generation !== this.generation) throw new Error('Rejeu interrompu.');
          if (Date.now() - started > NAVIGATION_LIMITS.replayTimeoutMs)
            throw new Error('Durée maximale du rejeu dépassée.');
          try {
            const result = await this.request<BrowserActionResult>(
              'act',
              {
                step,
                parameters: resolved,
              },
              Math.min(
                20000,
                Math.max(1, NAVIGATION_LIMITS.replayTimeoutMs - (Date.now() - started)),
              ),
            );
            this.state!.url = result.url;
            run.metrics.actions++;
            run.events.push({ stepId: step.id, status: 'succeeded', at: new Date().toISOString() });
            this.changed();
            await this.recovery.flush();
          } catch (error) {
            run.events.push({
              stepId: step.id,
              status: generation !== this.generation ? 'interrupted' : 'failed',
              message: (error as Error).message,
              at: new Date().toISOString(),
            });
            throw error;
          }
        }
        const conditions = await this.request<boolean[]>('conditions', journey.arrival);
        run.arrivalVerified = journey.arrival.length > 0 && conditions.every(Boolean);
        if (!run.arrivalVerified)
          throw new Error('Conditions d’arrivée absentes ou non vérifiées.');
        run.status = 'succeeded';
      } catch (error) {
        run.status =
          generation !== this.generation || this.status()?.state === 'interrupted'
            ? 'interrupted'
            : 'failed';
        run.error = (error as Error).message;
      } finally {
        if (this.state?.state === 'agent') this.state.state = 'idle';
        this.changed();
      }
    });
    run.finishedAt = new Date().toISOString();
    run.metrics.durationMs = Date.now() - started;
    this.currentRun = undefined;
    this.recoveredRuns.push(structuredClone(run));
    this.changed();
    await this.recovery.flush();
    return run;
  }
  async stop(): Promise<void> {
    this.generation++;
    if (this.state) {
      this.state.generation = this.generation;
      this.state.state = 'stopping';
      this.state.recordingPaused = true;
      this.changed();
    }
    const worker = this.worker;
    if (worker) {
      try {
        await this.request('close', undefined, 3000);
      } catch {
        /* terminate below */
      }
      if (this.worker === worker) {
        this.worker = undefined;
        worker.kill();
      }
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error('Commande interrompue ; effet déjà produit éventuellement conservé.'),
      );
    }
    this.pending.clear();
    if (this.state) {
      this.state.state = 'interrupted';
      this.changed();
    }
    await this.recovery.flush();
  }
  async close(): Promise<void> {
    if (this.worker) await this.stop();
    if (this.state) {
      this.state.state = this.recordingActive ? 'interrupted' : 'closed';
      this.changed();
    }
    await this.recovery.flush();
  }
  async dispose(): Promise<void> {
    await this.close();
  }
}
export function navigationOrigin(value: string): string {
  if (!isNavigationUrl(value) || hasSensitiveNavigationUrl(value))
    throw new Error('Une URL HTTP ou HTTPS sans identifiants est requise.');
  return new URL(value).origin;
}
