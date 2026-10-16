import { toCredits, formatCredits } from '../src/shared/credits';
import { useMemo, useState } from 'react';
import { BarChart3, ArrowRight } from 'lucide-react';
import {
  analyzeUsage,
  usageEntries,
  type UsageMetric,
  type UsageGroup,
  type UsageSummary,
} from '../src/core/analytics';
import type { Feature } from '../src/shared/types';
import type { Discussion } from '../src/shared/discussions';
import { discussionUsage } from '../src/core/discussionUsage';
import './UsageDashboard.css';

const number = formatCredits;
const creditMetric = (metric: UsageMetric): UsageMetric => ({
  ...metric,
  value: metric.value === null ? null : toCredits(metric.value),
});
const value = (metric: UsageMetric) => (metric.value === null ? 'Inconnu' : number(metric.value));
const coverage = (metric: UsageMetric) =>
  `${metric.completeRuns} complète(s) · ${metric.partialRuns} partielle(s) · ${metric.unknownRuns} inconnue(s)`;
function MetricCard({
  label,
  unit,
  metric,
  runs,
}: {
  label: string;
  unit: string;
  metric: UsageMetric;
  runs: number;
}) {
  return (
    <article className="usage-metric-card" aria-label={label}>
      <span>{label}</span>
      <strong>
        {value(metric)} <small>{metric.value !== null && unit}</small>
      </strong>
      <p>
        {metric.value === null
          ? 'Aucune mesure reçue.'
          : metric.partialRuns || metric.unknownRuns
            ? 'Somme observée partielle.'
            : 'Somme mesurée complète.'}
      </p>
      <small>
        {coverage(metric)} / {runs} tentative(s)
      </small>
      {metric.zeroRuns > 0 && <small>{metric.zeroRuns} zéro(s) réellement mesuré(s)</small>}
    </article>
  );
}
function GroupTable({
  title,
  groups,
  openSession,
}: {
  title: string;
  groups: UsageGroup[];
  openSession?: (id: string) => void;
}) {
  const maximum = Math.max(
    1,
    ...groups.map((group) => toCredits(group.summary.nanoAiu.value ?? 0)),
  );
  return (
    <section className="usage-group-panel" aria-label={title}>
      <h2>{title}</h2>
      <p className="table-scroll-hint">
        Sur petit écran, faites défiler le tableau horizontalement. Au clavier : placez le focus sur
        le tableau, puis utilisez les flèches.
      </p>
      <div
        className="usage-table-scroll"
        role="region"
        tabIndex={0}
        aria-label={`Tableau ${title}`}
      >
        <table className="usage-table">
          <caption>
            Sommes observées, sans classement de performance. H = humain, A = pilote automatique, ?
            = acteur non communiqué.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {title === 'Par modèle effectif'
                  ? 'Modèle effectif'
                  : title === 'Par parcours'
                    ? 'Parcours'
                    : 'Session'}
              </th>
              <th scope="col">Tentatives</th>
              <th scope="col">Entrée</th>
              <th scope="col">Sortie</th>
              <th scope="col">crédits</th>
              <th scope="col">Validations actuelles</th>
              <th scope="col">Échecs / annulations</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ id, label, summary }) => (
              <tr key={id}>
                <th scope="row">
                  {openSession ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => openSession(id)}
                      aria-label={`Ouvrir la session ${label}`}
                    >
                      {label}
                      <ArrowRight size={13} />
                    </button>
                  ) : (
                    label
                  )}
                </th>
                <td>{summary.runs}</td>
                <td>
                  <MetricCell metric={summary.inputTokens} />
                </td>
                <td>
                  <MetricCell metric={summary.outputTokens} />
                </td>
                <td>
                  <MetricCell metric={creditMetric(summary.nanoAiu)} />
                  {summary.nanoAiu.value !== null && (
                    <meter
                      min={0}
                      max={maximum}
                      value={toCredits(summary.nanoAiu.value)}
                      aria-label={`crédits mesurés · ${label}`}
                      aria-valuetext={`${value(creditMetric(summary.nanoAiu))} crédits observés`}
                    >
                      {value(creditMetric(summary.nanoAiu))}
                    </meter>
                  )}
                </td>
                <td>
                  H {summary.humanApprovals} · A {summary.autopilotApprovals} · ?{' '}
                  {summary.unattributedApprovals}
                </td>
                <td>
                  {summary.failedRuns} / {summary.cancelledRuns}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function MetricCell({ metric }: { metric: UsageMetric }) {
  return (
    <>
      <strong>{value(metric)}</strong>
      {metric.partialRuns + metric.unknownRuns > 0 && metric.value !== null && (
        <small>Somme partielle</small>
      )}
      <small>{coverage(metric)}</small>
    </>
  );
}
function Outcomes({ summary }: { summary: UsageSummary }) {
  return (
    <dl className="usage-outcomes">
      <div>
        <dt>Tentatives</dt>
        <dd>{summary.runs}</dd>
      </div>
      <div>
        <dt>Validées par un humain</dt>
        <dd>{summary.humanApprovals}</dd>
      </div>
      <div>
        <dt>Validées par le pilote automatique</dt>
        <dd>{summary.autopilotApprovals}</dd>
      </div>
      <div>
        <dt>Acteur de validation non communiqué</dt>
        <dd>{summary.unattributedApprovals}</dd>
      </div>
      <div>
        <dt>Échecs</dt>
        <dd>{summary.failedRuns}</dd>
      </div>
      <div>
        <dt>Annulations</dt>
        <dd>{summary.cancelledRuns}</dd>
      </div>
      <div>
        <dt>Interruptions</dt>
        <dd>{summary.interruptedRuns}</dd>
      </div>
      <div>
        <dt>En cours ou en attente de réponse</dt>
        <dd>{summary.ongoingRuns}</dd>
      </div>
      <div>
        <dt>Anciennes validations invalidées</dt>
        <dd>{summary.invalidatedApprovalRuns}</dd>
      </div>
    </dl>
  );
}
export function UsageDashboard({
  features: workflowFeatures,
  discussions = [],
  onOpenFeature: openFeature,
  onOpenDiscussion,
}: {
  features: Feature[];
  discussions?: Discussion[];
  onOpenFeature: (id: string) => void;
  onOpenDiscussion?: (id: string) => void;
}) {
  const features = useMemo(
    () => [...workflowFeatures, ...discussionUsage(discussions)],
    [workflowFeatures, discussions],
  );
  const onOpenFeature = (id: string) =>
    id.startsWith('discussion:')
      ? onOpenDiscussion?.(id.slice('discussion:'.length))
      : openFeature(id);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [model, setModel] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const analytics = useMemo(
    () => analyzeUsage(features, { from, to, workflowId, model, includeArchived }),
    [features, from, to, workflowId, model, includeArchived],
  );
  const models = [...new Set(usageEntries(features).map((entry) => entry.model))].sort((a, b) =>
    a.localeCompare(b, 'fr'),
  );
  const workflows = [
    ...new Map(features.map((feature) => [feature.workflowId, feature.workflowName])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const { summary, validationEffort } = analytics;
  return (
    <div className="usage-dashboard">
      <header className="usage-heading">
        <div>
          <span className="eyebrow">MESURES LOCALES DU SDK</span>
          <h1>
            <BarChart3 size={24} />
            Consommation
          </h1>
          <p>La consommation de vos sessions et discussions, à partir des mesures reçues.</p>
        </div>
      </header>
      <form
        className="usage-filters"
        onSubmit={(event) => event.preventDefault()}
        aria-label="Filtres de consommation"
      >
        <label>
          Du
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Au
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          Parcours
          <select
            aria-label="Filtrer par parcours"
            value={workflowId}
            onChange={(event) => setWorkflowId(event.target.value)}
          >
            <option value="">Tous les parcours</option>
            {workflows.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modèle effectif
          <select
            aria-label="Filtrer par modèle effectif"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            <option value="">Tous les modèles</option>
            {models.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="usage-archive-toggle">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Inclure les sessions archivées
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setFrom('');
            setTo('');
            setWorkflowId('');
            setModel('');
            setIncludeArchived(false);
          }}
        >
          Réinitialiser les filtres
        </button>
      </form>
      <p className="usage-definition">
        Dates inclusives en UTC, selon le début de la tentative. Modèle : mesure SDK, puis modèle
        enregistré de la tentative, puis « Non communiqué ».
      </p>
      {from && to && from > to && (
        <p role="alert">La date de début doit précéder la date de fin.</p>
      )}
      {!summary.runs ? (
        <section className="usage-empty" role="status">
          <h2>Aucune donnée pour cette sélection</h2>
          <p>Aucune tentative ne correspond aux filtres. Aucune consommation n’est présumée.</p>
        </section>
      ) : (
        <>
          <div className="usage-metrics">
            <MetricCard
              label="Tokens d’entrée"
              unit="tokens"
              metric={summary.inputTokens}
              runs={summary.runs}
            />
            <MetricCard
              label="Tokens de sortie"
              unit="tokens"
              metric={summary.outputTokens}
              runs={summary.runs}
            />
            <MetricCard
              label="Consommation en crédits"
              unit="crédits"
              metric={creditMetric(summary.nanoAiu)}
              runs={summary.runs}
            />
          </div>
          <div className="usage-coverage" role="status">
            <strong>
              Couverture : {summary.completeTokenRuns}/{summary.runs} tentative(s) avec tokens
              complets ; {summary.nanoAiu.completeRuns}/{summary.runs} avec crédits complets.
            </strong>
            <p>
              Une donnée inconnue est distincte d’un zéro mesuré. Les valeurs partielles sont
              incluses dans les sommes observées ; elles ne constituent pas un total complet.
            </p>
            {summary.ignoredCostUnitRuns > 0 && (
              <p>
                {summary.ignoredCostUnitRuns} mesure(s) de coût dans une autre unité exclue(s), sans
                conversion.
              </p>
            )}
            {summary.invalidDateRuns > 0 && (
              <p>
                {summary.invalidDateRuns} tentative(s) sans date exploitable ; elles sont exclues
                lorsqu’un filtre de date est actif.
              </p>
            )}
          </div>
          <section className="usage-efficiency" aria-label="Validations et tentatives">
            <h2>Validations et tentatives</h2>
            <Outcomes summary={summary} />
            <p>
              {validationEffort.average === null
                ? 'Aucune étape actuellement validée dans cette sélection.'
                : `${number(validationEffort.average)} tentative(s) en moyenne jusqu’à validation · ${validationEffort.attempts} tentative(s) pour ${validationEffort.validatedSteps} étape(s) actuellement validée(s).`}
            </p>
            <small>
              Le dénominateur comprend les étapes dont la dernière tentative validée est dans la
              sélection. Toutes les tentatives antérieures de ces étapes sont comptées, y compris{' '}
              {validationEffort.outsideSelection} hors filtres. Une révision du même livrable ne
              crée pas de tentative supplémentaire. Ce constat descriptif ne mesure pas la qualité
              d’un modèle.
            </small>
          </section>
          <GroupTable title="Par modèle effectif" groups={analytics.models} />
          <GroupTable title="Par parcours" groups={analytics.workflows} />
          <GroupTable title="Par session" groups={analytics.sessions} openSession={onOpenFeature} />
          <details className="usage-attempt-details">
            <summary>Détail des {summary.runs} tentative(s)</summary>
            <ul>
              {analytics.entries.map(({ feature, step, attempt, model }) => (
                <li key={`${feature.id}:${step.id}:${attempt.id}`}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOpenFeature(feature.id)}
                  >
                    {feature.title}
                  </button>
                  <span>
                    {step.name} · {attempt.startedAt} · {model} ·{' '}
                    {feature.workflowId === '__discussion__' && attempt.status === 'awaiting_review'
                      ? 'terminée'
                      : attempt.status}{' '}
                    · révision {attempt.revision ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <p className="usage-definition">
        Un seul instantané cumulatif par tentative est additionné. Source : usage « measured » reçu
        du SDK. Aucune estimation tarifaire, conversion en euros ou requête Copilot supplémentaire.
      </p>
    </div>
  );
}
