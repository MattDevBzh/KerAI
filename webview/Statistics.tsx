import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, ChartNoAxesCombined, HardDrive, RotateCcw, Trophy } from 'lucide-react';
import type { ClientMessage, StudioState } from '../src/shared/types';
import {
  defaultStatsFilters,
  type StatsFilters,
  type StatsStorageItem,
} from '../src/shared/statistics';
import {
  analyzeStatistics,
  parseDay,
  type ActivityBucket,
  type StatMeasure,
} from '../src/core/statistics';
import { sessionProjects } from '../src/shared/sessionList';
import { formatCredits } from '../src/shared/credits';
import { AgentImage } from './Avatar';
import { isHosted, persistView, savedStatistics, subscribe } from './bridge';
import './statistics.css';

const number = (value: number | null) =>
  value === null ? '—' : value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const average = (metric: StatMeasure) => (metric.known ? metric.value! / metric.known : null);
const credit = (value: number | null) => (value === null ? '—' : formatCredits(value));
const duration = (value: number | null) =>
  value === null
    ? '—'
    : value < 60000
      ? `${number(value / 1000)} s`
      : value < 3600000
        ? `${number(value / 60000)} min`
        : `${number(value / 3600000)} h`;
const bytes = (value: number) =>
  value < 1024
    ? `${number(value)} o`
    : value < 1048576
      ? `${number(value / 1024)} Kio`
      : value < 1073741824
        ? `${number(value / 1048576)} Mio`
        : `${number(value / 1073741824)} Gio`;
const shortDate = (value: string) =>
  parseDay(value)?.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  }) ?? value;
const measurement = (metric: StatMeasure) =>
  `${metric.known} mesure(s) · ${metric.partial} partielle(s) · ${metric.missing} absente(s)`;
const stateLabels: Record<string, string> = {
  draft: 'À démarrer',
  running: 'En cours',
  attention: 'À votre tour',
  awaiting_final_validation: 'Dernière validation',
  completed: 'Terminées',
};
const periods: [StatsFilters['period'], string][] = [
  ['today', 'Aujourd’hui'],
  ['7d', '7 derniers jours'],
  ['30d', '30 derniers jours'],
  ['90d', '90 derniers jours'],
  ['month', 'Ce mois-ci'],
  ['previousMonth', 'Mois précédent'],
  ['year', 'Cette année'],
  ['all', 'Tout l’historique'],
  ['custom', 'Dates personnalisées'],
];
function Card({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className={`stats-metric ${accent ? 'stats-metric-accent' : ''}`} aria-label={label}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function Panel({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`stats-panel ${className}`} aria-label={title}>
      <header>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
type ActivityMetric = 'attempts' | 'created' | 'completed' | 'credits';
const activityLabels: Record<ActivityMetric, string> = {
  attempts: 'Tentatives lancées',
  created: 'Sessions créées',
  completed: 'Sessions finalisées',
  credits: 'Crédits observés',
};
function Activity({ timeline, grain }: { timeline: ActivityBucket[]; grain: string }) {
  const [metric, setMetric] = useState<ActivityMetric>('attempts');
  const values = timeline.map((point) =>
    metric === 'credits' ? point.credits.value : point[metric],
  );
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  const step = 920 / Math.max(timeline.length, 1);
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return (
    <Panel
      title="Le rythme de vos sessions"
      subtitle="Créations, lancements et finalisations aux dates où ils ont réellement eu lieu."
    >
      <div className="stats-chart-tools">
        <select
          aria-label="Indicateur d’activité"
          value={metric}
          onChange={(event) => setMetric(event.target.value as ActivityMetric)}
        >
          {Object.entries(activityLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <span>
          {metric === 'credits'
            ? credit(values.some((value) => value !== null) ? total : null)
            : number(total)}{' '}
          {activityLabels[metric].toLocaleLowerCase('fr-FR')}
        </span>
      </div>
      <svg
        className="stats-activity-chart"
        viewBox="0 0 1000 228"
        role="img"
        aria-label={`${activityLabels[metric]} par ${grain === 'month' ? 'mois' : grain === 'week' ? 'semaine' : 'jour'}. Détail disponible dans le tableau ci-dessous.`}
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="60"
              x2="980"
              y1={185 - fraction * 160}
              y2={185 - fraction * 160}
              className="stats-gridline"
            />
            <text x="50" y={190 - fraction * 160} textAnchor="end">
              {number(max * fraction)}
            </text>
          </g>
        ))}
        {timeline.map((point, index) => (
          <g key={point.key}>
            <rect
              x={60 + index * step + Math.min(2, step / 5)}
              y={185 - ((values[index] ?? 0) / max) * 160}
              width={Math.max(0.2, step - Math.min(4, step / 3))}
              height={((values[index] ?? 0) / max) * 160}
              rx={Math.min(3, step / 5)}
            >
              <title>
                {shortDate(point.key)} :{' '}
                {metric === 'credits' ? credit(values[index]) : number(values[index])}
                {metric === 'credits' ? ` crédits ; ${measurement(point.credits)}` : ''}
              </title>
            </rect>
            {(index === 0 ||
              index === timeline.length - 1 ||
              (index % Math.max(1, Math.ceil(timeline.length / 6)) === 0 &&
                index < timeline.length - Math.ceil(timeline.length / 10))) && (
              <text
                x={60 + (index + 0.5) * step}
                y="214"
                textAnchor={
                  index === 0 ? 'start' : index === timeline.length - 1 ? 'end' : 'middle'
                }
              >
                {shortDate(point.key)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <details className="stats-details">
        <summary>Voir les valeurs du graphique</summary>
        <div
          className="stats-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Activité détaillée"
        >
          <table>
            <thead>
              <tr>
                <th>Période</th>
                <th>Créées</th>
                <th>Finalisées</th>
                <th>Tentatives</th>
                <th>Crédits observés</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((point) => (
                <tr key={point.key}>
                  <th>{shortDate(point.key)}</th>
                  <td>{point.created}</td>
                  <td>{point.completed}</td>
                  <td>{point.attempts}</td>
                  <td>
                    {credit(point.credits.value)}
                    {(point.credits.missing > 0 || point.credits.partial > 0) && ' *'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small>* Mesures absentes ou partielles ; une absence de mesure n’est pas un zéro.</small>
      </details>
    </Panel>
  );
}

function Storage({
  featuresKey,
  ids,
  dispatch,
}: {
  featuresKey: string;
  ids: string[];
  dispatch: (message: ClientMessage) => void;
}) {
  const request = useRef<
    { ids: string[]; index: number; items: StatsStorageItem[]; id: string } | undefined
  >(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [progress, setProgress] = useState<number>();
  const [result, setResult] = useState<StatsStorageItem[]>();
  const [error, setError] = useState('');
  const next = () => {
    const current = request.current;
    if (!current) return;
    current.id = crypto.randomUUID();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      request.current = undefined;
      setProgress(undefined);
      setError('La mesure prend trop de temps. Réessaie sur un projet ou une période plus courte.');
    }, 60000);
    dispatch({
      type: 'statsStorage',
      requestId: current.id,
      featureIds: current.ids.slice(current.index, current.index + 50),
    });
  };
  useEffect(() => {
    request.current = undefined;
    clearTimeout(timer.current);
    setResult(undefined);
    setProgress(undefined);
    setError('');
    return () => {
      request.current = undefined;
      clearTimeout(timer.current);
    };
  }, [featuresKey]);
  useEffect(
    () =>
      subscribe((message) => {
        const current = request.current;
        if (message.type !== 'statsStorageResult' || !current || message.requestId !== current.id)
          return;
        clearTimeout(timer.current);
        if (message.error) {
          request.current = undefined;
          setProgress(undefined);
          setError(message.error);
          return;
        }
        const expected = current.ids.slice(current.index, current.index + 50);
        for (const featureId of expected)
          current.items.push(
            message.items.find((item) => item.featureId === featureId) ?? {
              featureId,
              error: 'Mesure absente',
            },
          );
        current.index += expected.length;
        setProgress(current.index);
        if (current.index < current.ids.length) next();
        else {
          setResult(current.items);
          setProgress(undefined);
          request.current = undefined;
        }
      }),
    [dispatch],
  );
  const measured =
    result?.filter(
      (item) => typeof item.bytes === 'number' && Number.isFinite(item.bytes) && item.bytes >= 0,
    ) ?? [];
  const total = measured.reduce((sum, item) => sum + item.bytes!, 0);
  return (
    <Panel
      title="L’empreinte de vos sessions"
      subtitle="Stockage privé actuel : états, journaux, rapports et sauvegardes de modifications. Les fichiers du projet, worktrees, points de restauration et pièces jointes partagées sont exclus."
    >
      <div className="stats-storage">
        <HardDrive size={28} />
        <div>
          <strong>
            {result && measured.length
              ? `${bytes(total)} au total · ${bytes(total / measured.length)} / session`
              : 'Taille sur disque'}
          </strong>
          <p role="status">
            {progress !== undefined
              ? `${progress} / ${ids.length} sessions mesurées…`
              : result
                ? `${measured.length} / ${result.length} sessions mesurées${measured.length < result.length ? ' · résultat partiel' : ''}. Instantané à la demande.`
                : 'Mesure à la demande, sans appel IA.'}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!isHosted || !ids.length || progress !== undefined}
          onClick={() => {
            if (request.current) return;
            setError('');
            setResult(undefined);
            setProgress(0);
            request.current = { ids: [...ids], index: 0, items: [], id: '' };
            next();
          }}
        >
          {result ? 'Actualiser la taille' : 'Calculer le stockage'}
        </button>
      </div>
      {!isHosted && <p className="muted">La mesure disque est disponible dans VS Code.</p>}
      {error && <p role="alert">{error}</p>}
      {result?.some((item) => item.error) && (
        <details className="stats-details">
          <summary>Mesures indisponibles</summary>
          <ul>
            {result
              .filter((item) => item.error)
              .map((item) => (
                <li key={item.featureId}>
                  {item.featureId} : {item.error}
                </li>
              ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

export function Statistics({
  state,
  dispatch,
  onOpen,
}: {
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  onOpen: (id: string) => void;
}) {
  const [filters, setFilters] = useState<StatsFilters>(() => ({
    ...defaultStatsFilters,
    ...savedStatistics(),
  }));
  const [now, setNow] = useState(() => new Date());
  const [modelMetric, setModelMetric] = useState<'attempts' | 'credits'>('attempts');
  const [allAgents, setAllAgents] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => persistView({ statistics: filters }), [filters]);
  const update = (value: Partial<StatsFilters>) =>
    setFilters((previous) => ({ ...previous, ...value }));
  const catalog = state.projectCatalog?.projects;
  const projects = useMemo(() => {
    const all = new Map((catalog ?? []).map((project) => [project.id, project]));
    state.features.forEach((feature) =>
      sessionProjects(feature, catalog).forEach((project) => all.set(project.id, project)),
    );
    return [...all.values()].sort(
      (a, b) => a.name.localeCompare(b.name, 'fr') || a.path.localeCompare(b.path),
    );
  }, [catalog, state.features]);
  const workflows = useMemo(
    () =>
      [
        ...new Map(
          state.features.map((feature) => [
            feature.workflowId,
            feature.workflowName || 'Équipe personnalisée',
          ]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1], 'fr')),
    [state.features],
  );
  const data = useMemo(
    () => analyzeStatistics(state.features, filters, catalog, state.agents, now),
    [state.features, filters, catalog, state.agents, now],
  );
  const partialCredits = data.credits.partial > 0 || data.credits.missing > 0;
  const modelValues = data.models
    .map((model) => ({
      ...model,
      value: modelMetric === 'credits' ? model.credits.value : model.attempts,
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const modelMaximum = Math.max(1, ...modelValues.map((model) => model.value ?? 0));
  const heatMaximum = Math.max(1, ...data.heatmap.flat());
  const ids = data.selected.map((feature) => feature.id);
  const storageKey = JSON.stringify(
    data.selected.map((feature) => [feature.id, feature.updatedAt]),
  );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="stats-page">
      <header className="stats-heading">
        <div>
          <span className="stats-eyebrow">VOTRE ATELIER, EN CHIFFRES</span>
          <h1>
            <ChartNoAxesCombined size={28} /> Stats
          </h1>
          <p>Vos habitudes, vos agents et le chemin parcouru.</p>
        </div>
        <span className="stats-live">Données locales · aucun crédit consommé</span>
      </header>
      <section className="stats-filters" aria-label="Filtres des statistiques">
        <label>
          Projet
          <select
            aria-label="Projet des statistiques"
            value={filters.project}
            onChange={(event) => update({ project: event.target.value })}
          >
            <option value="">Tous les projets</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {projects.filter((item) => item.name === project.name).length > 1
                  ? ` — ${project.path}`
                  : ''}
              </option>
            ))}
            <option value="__none">Sans projet associé</option>
            {filters.project &&
              filters.project !== '__none' &&
              !projects.some((project) => project.id === filters.project) && (
                <option value={filters.project}>Projet indisponible</option>
              )}
          </select>
        </label>
        <label>
          Période
          <select
            aria-label="Période des statistiques"
            value={filters.period}
            onChange={(event) => update({ period: event.target.value as StatsFilters['period'] })}
          >
            {periods.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Parcours
          <select
            aria-label="Parcours des statistiques"
            value={filters.workflow}
            onChange={(event) => update({ workflow: event.target.value })}
          >
            <option value="">Tous les parcours</option>
            {workflows.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Regrouper par
          <select
            aria-label="Regroupement des statistiques"
            value={filters.grain}
            onChange={(event) => update({ grain: event.target.value as StatsFilters['grain'] })}
          >
            <option value="day">Jour</option>
            <option value="week">Semaine</option>
            <option value="month">Mois</option>
          </select>
        </label>
        {filters.period === 'custom' && (
          <>
            <label>
              Du
              <input
                type="date"
                aria-label="Début de période"
                value={filters.from}
                onChange={(event) => update({ from: event.target.value })}
              />
            </label>
            <label>
              Au (inclus)
              <input
                type="date"
                aria-label="Fin de période"
                value={filters.to}
                onChange={(event) => update({ to: event.target.value })}
              />
            </label>
          </>
        )}
        <label className="stats-checkbox">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(event) => update({ includeArchived: event.target.checked })}
          />{' '}
          Inclure les archives
        </label>
        <button className="button secondary" onClick={() => setFilters({ ...defaultStatsFilters })}>
          <RotateCcw size={15} /> Réinitialiser
        </button>
      </section>
      {data.range.error ? (
        <p className="stats-empty" role="alert">
          {data.range.error}
        </p>
      ) : (
        <>
          <p className="stats-scope" role="status">
            {data.selected.length} session(s) dans le périmètre · {data.attempts} tentative(s) ·
            calendrier {timezone}.{' '}
            {filters.includeArchived ? 'Archives incluses.' : 'Archives exclues.'}
          </p>
          {state.projectCatalog?.errors?.length ? (
            <p className="stats-warning">
              Certains projets ne sont pas chargés. Leurs sessions ne sont pas comptées :{' '}
              {state.projectCatalog.errors.join(' · ')}
            </p>
          ) : null}
          <div className="stats-metrics">
            <Card
              label="Sessions dans la période"
              value={number(data.selected.length)}
              detail="Création, lancement ou finalisation dans la période. Tout l’historique inclut les sessions sans date."
              accent
            />
            <Card
              label="Sessions créées"
              value={number(data.created)}
              detail="Nouvelles sessions, même sans agent lancé."
            />
            <Card
              label="Sessions finalisées"
              value={number(data.completed)}
              detail="Validation finale datée dans la période ; toujours terminées aujourd’hui."
            />
            <Card
              label="Tentatives lancées"
              value={number(data.attempts)}
              detail={`${data.agents.length} agent(s) · ${data.models.length} modèle(s) référencé(s).`}
            />
            <Card
              label="Crédits observés"
              value={credit(data.credits.value)}
              detail={`${partialCredits ? 'Somme partielle. ' : ''}${measurement(data.credits)}`}
              accent
            />
            <Card
              label="Durée moyenne d’une tentative"
              value={duration(average(data.duration))}
              detail={`${data.duration.known} durée(s) connue(s) ; lancement → fin, hors tentative encore ouverte.`}
            />
            <Card
              label="Étapes par session"
              value={number(data.averageSteps)}
              detail="Taille moyenne des équipes/parcours du périmètre, y compris les étapes non lancées."
            />
            <Card
              label="Tentatives par session"
              value={number(data.averageRuns)}
              detail="Lancements de la période / sessions du périmètre."
            />
          </div>
          {!data.selected.length ? (
            <div className="stats-empty">
              <ChartNoAxesCombined size={34} />
              <h2>Pas encore d’activité dans ce périmètre</h2>
              <p>Élargis la période, choisis un autre projet ou inclus les archives.</p>
              <button
                className="button secondary"
                onClick={() =>
                  update({ period: 'all', project: '', workflow: '', includeArchived: true })
                }
              >
                Voir tout l’historique
              </button>
            </div>
          ) : (
            <>
              {data.grain !== filters.grain && (
                <p className="stats-warning">
                  Cette longue période est regroupée par mois pour garder le graphique lisible.
                </p>
              )}
              {data.sparseTimeline && (
                <p className="stats-warning">
                  Pour cette période très étendue, seuls les mois contenant une activité sont
                  affichés.
                </p>
              )}
              <Activity timeline={data.timeline} grain={data.grain} />
              <div className="stats-columns">
                <Panel
                  title="Le podium des agents"
                  subtitle="Classement par tentatives lancées, sans jugement de qualité."
                >
                  {data.agents.length ? (
                    <>
                      <ol className="stats-podium">
                        {data.agents.slice(0, 3).map((agent, index) => (
                          <li key={agent.id}>
                            <span className="stats-rank">
                              <Trophy size={15} /> {index + 1}
                            </span>
                            <AgentImage
                              agentId={agent.id}
                              avatar={agent.avatar}
                              pose="approved.png"
                              alt=""
                            />
                            <strong>{agent.label}</strong>
                            <span>{agent.attempts} tentative(s)</span>
                            <small>
                              {agent.sessionIds.size} session(s) · {credit(agent.credits.value)}{' '}
                              crédits{agent.credits.partial || agent.credits.missing ? ' *' : ''}
                            </small>
                          </li>
                        ))}
                      </ol>
                      <ol className="stats-ranking">
                        {(allAgents ? data.agents : data.agents.slice(0, 8)).map((agent, index) => (
                          <li key={agent.id}>
                            <span>
                              {index + 1}. {agent.label}
                            </span>
                            <strong>{number(agent.attempts)}</strong>
                            <meter
                              min={0}
                              max={data.agents[0].attempts}
                              value={agent.attempts}
                              aria-label={`${agent.label} : ${agent.attempts} tentatives`}
                            />
                          </li>
                        ))}
                      </ol>
                      {data.agents.length > 8 && (
                        <button
                          className="text-button"
                          onClick={() => setAllAgents((value) => !value)}
                        >
                          {allAgents
                            ? 'Réduire le classement'
                            : `Voir les ${data.agents.length} agents`}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="muted">Aucun agent lancé sur cette période.</p>
                  )}
                </Panel>
                <Panel
                  title="Les modèles au travail"
                  subtitle="Modèle communiqué par la tentative, sinon modèle demandé enregistré au lancement. Les appels internes ne sont pas comptés séparément."
                >
                  <select
                    aria-label="Mesure par modèle"
                    value={modelMetric}
                    onChange={(event) =>
                      setModelMetric(event.target.value as 'attempts' | 'credits')
                    }
                  >
                    <option value="attempts">Nombre de tentatives</option>
                    <option value="credits">Crédits observés</option>
                  </select>
                  {modelValues.length ? (
                    <ol className="stats-ranking stats-models">
                      {modelValues.map((model, index) => (
                        <li
                          key={model.id}
                          style={
                            {
                              '--stats-color': `var(--${['coral', 'lavender', 'green', 'apricot'][index % 4]})`,
                            } as CSSProperties
                          }
                        >
                          <span>{model.label}</span>
                          <strong>
                            {modelMetric === 'credits' ? credit(model.value) : number(model.value)}
                          </strong>
                          <meter
                            min={0}
                            max={modelMaximum}
                            value={model.value ?? 0}
                            aria-label={`${model.label} : ${modelMetric === 'credits' ? `${credit(model.value)} crédits observés` : `${model.value} tentatives`}`}
                          />
                          <small>
                            {model.attempts} tentative(s) · {model.sessionIds.size} session(s)
                            {modelMetric === 'credits' ? ` · ${measurement(model.credits)}` : ''}
                          </small>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">Les modèles apparaîtront après un premier lancement.</p>
                  )}
                </Panel>
              </div>
              <div className="stats-columns">
                <Panel
                  title="Quand l’atelier s’anime"
                  subtitle={`Tentatives par jour de semaine et heure locale (${timezone}).`}
                >
                  <div
                    className="stats-heatmap"
                    role="table"
                    aria-label="Tentatives par jour et heure"
                  >
                    <div className="stats-heat-row" role="row">
                      <span role="columnheader">Heure</span>
                      {Array.from({ length: 24 }, (_, hour) => (
                        <span role="columnheader" key={hour}>
                          {hour % 6 === 0 ? (
                            `${hour}h`
                          ) : (
                            <span className="stats-sr-only">{hour}h</span>
                          )}
                        </span>
                      ))}
                    </div>
                    {data.heatmap.map((hours, day) => (
                      <div className="stats-heat-row" key={day} role="row">
                        <span role="rowheader">
                          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][day]}
                        </span>
                        {hours.map((count, hour) => (
                          <span
                            key={hour}
                            role="cell"
                            className={`stats-heat-cell heat-${count ? Math.max(1, Math.ceil((count / heatMaximum) * 4)) : 0}`}
                            title={`${['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'][day]}, ${hour}h : ${count} tentative(s)`}
                            aria-label={`${hour}h : ${count} tentative(s)`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="stats-insights">
                    <div>
                      <strong>{data.activeDays}</strong>
                      <span>jours avec un lancement</span>
                    </div>
                    <div>
                      <strong>{data.longestStreak}</strong>
                      <span>jours consécutifs au maximum</span>
                    </div>
                    <div>
                      <strong>{data.busiest ? shortDate(data.busiest[0]) : '—'}</strong>
                      <span>
                        {data.busiest
                          ? `${data.busiest[1]} lancement(s), jour le plus actif`
                          : 'Aucun lancement daté'}
                      </span>
                    </div>
                  </div>
                </Panel>
                <Panel
                  title="L’effort derrière les résultats"
                  subtitle="Les relances incluent corrections et reprises ; elles ne sont pas toutes des erreurs."
                >
                  <div className="stats-facts">
                    <div>
                      <strong>{data.retries}</strong>
                      <span>relances après une première tentative</span>
                    </div>
                    <div>
                      <strong>{data.failures}</strong>
                      <span>tentatives en échec</span>
                    </div>
                    <div>
                      <strong>{data.cancelled}</strong>
                      <span>annulations</span>
                    </div>
                    <div>
                      <strong>{data.interrupted}</strong>
                      <span>interruptions</span>
                    </div>
                    <div>
                      <strong>{number(average(data.prompts))}</strong>
                      <span>caractères / contexte connu ({data.prompts.known} mesures)</span>
                    </div>
                    <div>
                      <strong>{number(average(data.reports))}</strong>
                      <span>caractères / livrable conservé ({data.reports.known} mesures)</span>
                    </div>
                  </div>
                  <p className="stats-footnote">
                    Les crédits mesurent la consommation. La durée, la fréquence et le volume ne
                    mesurent pas la qualité d’un agent.
                  </p>
                </Panel>
              </div>
              <div className="stats-columns stats-three-columns">
                <Panel
                  title="Où en sont les sessions ?"
                  subtitle="État actuel des sessions du périmètre."
                >
                  <ul className="stats-breakdown">
                    {Object.entries(stateLabels).map(([id, label]) => (
                      <li key={id}>
                        <span>{label}</span>
                        <strong>{data.states.get(id) ?? 0}</strong>
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Panel
                  title="Les projets"
                  subtitle="Une session multi-projets apparaît dans chaque projet. Les lignes ne s’additionnent donc pas."
                >
                  <ul className="stats-breakdown">
                    {data.projects.map((project) => (
                      <li key={project.id}>
                        <span>{project.label}</span>
                        <strong>
                          {project.sessions}
                          <small>{project.attempts} tentative(s)</small>
                        </strong>
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Panel
                  title="Les parcours les plus utilisés"
                  subtitle="Nombre de sessions dans le périmètre."
                >
                  <ul className="stats-breakdown">
                    {data.workflows.map((workflow) => (
                      <li key={workflow.id}>
                        <span>{workflow.label}</span>
                        <strong>
                          {workflow.sessions}
                          <small>{workflow.attempts} tentative(s)</small>
                        </strong>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
              <Panel
                title="Les sessions les plus actives"
                subtitle="Les 10 sessions avec le plus de tentatives dans la période."
              >
                <div
                  className="stats-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Sessions les plus actives"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Projet</th>
                        <th>État actuel</th>
                        <th>Tentatives</th>
                        <th>Crédits observés</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topSessions.slice(0, 10).map(({ feature, attempts, credits }) => (
                        <tr key={feature.id}>
                          <th>
                            <button
                              className="text-button"
                              onClick={() => onOpen(feature.id)}
                              aria-label={`Ouvrir ${feature.title}`}
                            >
                              {feature.title}
                              <ArrowUpRight size={14} />
                            </button>
                          </th>
                          <td>
                            {sessionProjects(feature, catalog)
                              .map((project) => project.name)
                              .join(' + ') || 'Sans projet associé'}
                          </td>
                          <td>{stateLabels[feature.status]}</td>
                          <td>{attempts}</td>
                          <td>
                            {credit(credits.value)}
                            {credits.partial || credits.missing ? ' *' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Storage ids={ids} featuresKey={storageKey} dispatch={dispatch} />
            </>
          )}
          <details className="stats-panel stats-method">
            <summary>Comprendre les chiffres et leur couverture</summary>
            <ul>
              <li>
                Seules les sessions encore présentes dans les projets chargés sont analysées. Les
                sessions supprimées, discussions et analyses d’observateur sont exclues.
              </li>
              <li>
                Les tentatives sont rattachées à leur date de lancement, même si elles se terminent
                après la période. Les statuts sont ceux d’aujourd’hui. Une période personnalisée
                inclut les deux dates, dans le fuseau de cet écran.
              </li>
              <li>
                Les crédits utilisent une seule fois le dernier total mesuré de chaque tentative.
                Les journaux, révisions et ventilations par modèle ne sont pas ajoutés à nouveau. Le
                graphique attribue le total au modèle de la tentative, même si elle utilise
                plusieurs modèles.
              </li>
              <li>
                {measurement(data.credits)} pour les crédits. « — » signifie inconnu ; 0 signifie un
                zéro mesuré. Les sommes partielles sont signalées par * dans les tableaux.
              </li>
              <li>
                {data.fallbackModels} tentative(s) sans modèle communiqué : modèle demandé ou « Non
                communiqué ». {data.legacyAgents} tentative(s) ancienne(s) sans identité d’agent
                figée : attribution au profil de l’étape.
              </li>
              <li>
                {data.undatedCompleted} session(s) terminée(s) sans date de validation finale dans
                les projets/parcours sélectionnés ; elles ne contribuent pas aux finalisations
                datées. {data.invalidDates} tentative(s) sans date valide exclue(s) de l’activité.
              </li>
              <li>
                Les volumes de contexte sont les caractères enregistrés au lancement ; les livrables
                sont leur version conservée aujourd’hui. Le stockage est un instantané actuel, pas
                la taille historique sur la période.
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
