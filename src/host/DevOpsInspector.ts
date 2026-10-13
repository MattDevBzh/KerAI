import type { DevOpsConfig } from '../shared/devops';
import type {
  DevOpsObservation,
  DevOpsQuery,
  DevOpsTestTarget,
  DevOpsVerification,
} from '../shared/devopsKit';
import { devOpsQuerySchema, devOpsTestTargetSchema } from '../core/devopsKitSchemas';
import { redact } from './process';

export type DevOpsReader = (
  path: string,
  query: Record<string, string>,
) => Promise<{ data: Record<string, unknown>; continuation?: string }>;
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? redact(value).slice(0, 500) : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const list = (value: unknown) => {
  if (!Array.isArray(value)) throw new Error('Liste Azure DevOps absente ou invalide.');
  return value.map(obj);
};
const ref = (value: unknown) => {
  const v = obj(value);
  return {
    id: typeof v.id === 'number' ? number(v.id) : text(v.id),
    name: text(v.name),
    revision: number(v.revision),
  };
};
const build = (v: Record<string, unknown>) => ({
  id: number(v.id),
  buildNumber: text(v.buildNumber),
  status: text(v.status),
  result: text(v.result),
  sourceVersion: text(v.sourceVersion),
  sourceBranch: text(v.sourceBranch),
  queueTime: text(v.queueTime),
  startTime: text(v.startTime),
  finishTime: text(v.finishTime),
  definition: ref(v.definition),
  repository: { ...ref(v.repository), type: text(obj(v.repository).type) },
});

/** Only fixed GET routes. Values, credentials, log bodies and artifact download URLs never leave this layer. */
export class DevOpsInspector {
  constructor(
    private config: DevOpsConfig,
    private get: DevOpsReader,
  ) {}
  private base() {
    return `https://dev.azure.com/${encodeURIComponent(this.config.organization)}/${encodeURIComponent(this.config.project)}`;
  }
  async inspect(raw: DevOpsQuery): Promise<DevOpsObservation> {
    const query = devOpsQuerySchema.parse(raw);
    const repository = (
      await this.get(`git/repositories/${encodeURIComponent(this.config.repository)}`, {})
    ).data;
    const repositoryId = text(repository.id);
    if (!repositoryId) throw new Error('Identité du dépôt Azure DevOps indisponible.');
    const assertRepository = (value: Record<string, unknown>) => {
      const repo = obj(value.repository);
      if (repo.id !== repositoryId || repo.type !== 'TfsGit')
        throw new Error(
          'Ce pipeline ou cette exécution ne correspond pas au dépôt Azure Repos configuré.',
        );
    };
    let path: string;
    const params: Record<string, string> = {};
    if (query.kind === 'pipelines') {
      path = 'build/definitions';
      Object.assign(params, {
        repositoryId,
        repositoryType: 'TfsGit',
        $top: '50',
        includeAllProperties: 'true',
      });
    } else if (query.kind === 'pipeline' || query.kind === 'builds') {
      path = `build/definitions/${query.pipelineId}`;
      if (query.kind === 'pipeline' && query.revision) params.revision = String(query.revision);
      if (query.kind === 'builds') {
        assertRepository((await this.get(path, {})).data);
        path = 'build/builds';
        Object.assign(params, {
          definitions: String(query.pipelineId),
          repositoryId,
          repositoryType: 'TfsGit',
          $top: '20',
          queryOrder: 'queueTimeDescending',
        });
      }
    } else {
      path = `build/builds/${query.buildId}`;
      if (query.kind !== 'build') {
        assertRepository((await this.get(path, {})).data);
        path += `/${query.kind}`;
        if (query.kind === 'test-runs') {
          path = 'test/runs';
          Object.assign(params, {
            buildUri: `vstfs:///Build/Build/${query.buildId}`,
            includeRunDetails: 'true',
            $top: '101',
          });
        }
      }
    }
    if ('continuationToken' in query && query.continuationToken)
      params.continuationToken = query.continuationToken;
    const response = await this.get(path, params);
    const rawData = response.data;
    let data: Record<string, unknown>;
    let truncated = Boolean(response.continuation);
    if (query.kind === 'pipeline') {
      assertRepository(rawData);
      const variables = obj(rawData.variables);
      const triggers = Array.isArray(rawData.triggers) ? rawData.triggers : [];
      truncated ||= triggers.length > 50 || Object.keys(variables).length > 200;
      data = {
        ...ref(rawData),
        path: text(rawData.path),
        queueStatus: text(rawData.queueStatus),
        repository: ref(rawData.repository),
        defaultBranch: text(obj(rawData.repository).defaultBranch),
        yamlFilename: text(obj(rawData.process).yamlFilename),
        processType: number(obj(rawData.process).type),
        queue: ref(rawData.queue),
        variables: Object.entries(variables)
          .slice(0, 200)
          .map(([name, v]) => ({
            name: text(name),
            isSecret: typeof obj(v).isSecret === 'boolean' ? obj(v).isSecret : undefined,
            value: '<non collectée>',
          })),
        triggers: triggers.slice(0, 50).map((v) => ({
          triggerType: text(obj(v).triggerType),
          branchFilters: Array.isArray(obj(v).branchFilters)
            ? (obj(v).branchFilters as unknown[]).slice(0, 50).map(text)
            : undefined,
        })),
      };
    } else if (query.kind === 'build') {
      assertRepository(rawData);
      data = build(rawData);
    } else {
      const values = list(query.kind === 'timeline' ? rawData.records : rawData.value);
      const limit =
        query.kind === 'timeline'
          ? 1000
          : query.kind === 'test-runs'
            ? 100
            : query.kind === 'builds'
              ? 20
              : 50;
      truncated ||= values.length > limit;
      const selected = values.slice(0, limit);
      if (query.kind === 'pipelines' || query.kind === 'builds') selected.forEach(assertRepository);
      data = {
        items: selected.map((v) => {
          if (query.kind === 'pipelines')
            return {
              ...ref(v),
              path: text(v.path),
              queueStatus: text(v.queueStatus),
              repository: ref(v.repository),
            };
          if (query.kind === 'builds') return build(v);
          if (query.kind === 'timeline')
            return {
              id: text(v.id),
              parentId: text(v.parentId),
              identifier: text(v.identifier),
              name: text(v.name),
              type: text(v.type),
              state: text(v.state),
              result: text(v.result),
              attempt: number(v.attempt),
              errorCount: number(v.errorCount),
              warningCount: number(v.warningCount),
              startTime: text(v.startTime),
              finishTime: text(v.finishTime),
            };
          if (query.kind === 'artifacts')
            return { id: number(v.id), name: text(v.name), type: text(obj(v.resource).type) };
          const associatedBuild = obj(v.build);
          if (String(associatedBuild.id) !== String(query.buildId))
            throw new Error(
              'Résultats de tests associés à une autre exécution ou sans provenance.',
            );
          return {
            ...ref(v),
            state: text(v.state),
            buildId: number(Number(associatedBuild.id)),
            totalTests: number(v.totalTests),
            passedTests: number(v.passedTests),
            unanalyzedTests: number(v.unanalyzedTests),
            notApplicableTests: number(v.notApplicableTests),
            incompleteTests: number(v.incompleteTests),
            startedDate: text(v.startedDate),
            completedDate: text(v.completedDate),
          };
        }),
      };
    }
    // Large timelines or metadata stay explicitly incomplete; never silently drop evidence.
    for (const key of ['items', 'variables', 'triggers']) {
      const values = data[key];
      if (!Array.isArray(values)) continue;
      while (values.length && JSON.stringify(data).length > 48000) {
        values.pop();
        truncated = true;
      }
    }
    return {
      kind: query.kind,
      projectKey:
        `${this.config.organization}/${this.config.project}/${this.config.repository}`.toLowerCase(),
      collectedAt: new Date().toISOString(),
      sourceUrl: `${this.base()}/_apis/${path}?${new URLSearchParams({ ...params, 'api-version': '7.1' })}`,
      data,
      truncated,
      ...(response.continuation ? { continuationToken: response.continuation } : {}),
    };
  }
  async verify(raw: DevOpsTestTarget): Promise<DevOpsVerification> {
    const target = devOpsTestTargetSchema.parse(raw);
    if (!target.isolationConfirmed)
      throw new Error('Confirme la mise en place du test hors production avant sa vérification.');
    const observations: DevOpsObservation[] = [];
    const observe = async (query: DevOpsQuery) => {
      const observation = await this.inspect(query);
      observations.push(observation);
      return observation.data;
    };
    const checks: DevOpsVerification['checks'] = [];
    const check = (name: string, passed: boolean, detail: string) =>
      checks.push({ name, passed, detail });
    const run = await observe({ kind: 'build', buildId: target.buildId });
    check('Exécution demandée', run.id === target.buildId, String(run.id ?? 'inconnue'));
    check(
      'Pipeline attendu',
      obj(run.definition).id === target.pipelineId,
      String(obj(run.definition).id ?? 'inconnu'),
    );
    check(
      'Commit exact',
      run.sourceVersion === target.commit,
      String(run.sourceVersion ?? 'inconnu'),
    );
    check(
      'Branche attendue',
      run.sourceBranch === target.branch,
      String(run.sourceBranch ?? 'inconnue'),
    );
    check(
      'Exécution terminée et réussie',
      run.status === 'completed' && run.result === 'succeeded' && Boolean(run.finishTime),
      `${run.status ?? 'inconnu'} / ${run.result ?? 'inconnu'}`,
    );
    // Do not collect unrelated evidence after an identity mismatch.
    if (checks.slice(0, 4).every((item) => item.passed)) {
      const timeline = list((await observe({ kind: 'timeline', buildId: target.buildId })).items);
      for (const stage of target.expectedStages) {
        const matches = timeline.filter(
          (item) => item.type === 'Stage' && (item.identifier === stage || item.name === stage),
        );
        const latestAttempt = Math.max(...matches.map((item) => number(item.attempt) ?? 1));
        const current = matches.filter((item) => (number(item.attempt) ?? 1) === latestAttempt);
        check(
          `Étape ${stage}`,
          current.length === 1 &&
            current[0].state === 'completed' &&
            current[0].result === 'succeeded',
          current.length === 1
            ? `${current[0].state} / ${current[0].result}`
            : 'Absente ou ambiguë',
        );
      }
      if (target.expectedArtifacts.length) {
        const artifacts = list(
          (await observe({ kind: 'artifacts', buildId: target.buildId })).items,
        );
        for (const name of target.expectedArtifacts)
          check(
            `Artefact ${name}`,
            artifacts.some((item) => item.name === name),
            'Présence uniquement ; contenu non téléchargé.',
          );
      }
      if (target.requireTestResults) {
        const runs = list((await observe({ kind: 'test-runs', buildId: target.buildId })).items);
        check(
          'Résultats de tests publiés',
          runs.length > 0 &&
            runs.every(
              (item) =>
                item.state === 'Completed' &&
                typeof item.totalTests === 'number' &&
                item.totalTests > 0 &&
                item.passedTests === item.totalTests &&
                Boolean(item.completedDate),
            ),
          runs.length
            ? `${runs.length} campagne(s) ; chaque test doit avoir réussi.`
            : 'Aucun résultat publié.',
        );
      }
    }
    const incomplete = observations.some((item) => item.truncated);
    check(
      'Collecte complète',
      !incomplete,
      incomplete
        ? 'Réponse tronquée : verdict suspendu.'
        : 'Réponses bornées complètes pour les contrôles sélectionnés.',
    );
    return {
      target,
      projectKey: observations[0].projectKey,
      buildUrl: `${this.base()}/_build/results?buildId=${target.buildId}`,
      collectedAt: new Date().toISOString(),
      status: incomplete ? 'incomplete' : checks.every((item) => item.passed) ? 'passed' : 'failed',
      checks,
      observations,
    };
  }
}
