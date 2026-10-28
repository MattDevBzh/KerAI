import { attentionCount } from '../src/shared/sessionAttention';
import { validationDecisions } from '../src/shared/validationDecisions';
import './validation-delivery.css';
import { TeamComposer } from './TeamComposer';
import { executionCallCount } from '../src/core/budgets';
import { NativeActivityPanel } from './NativeExecutionUI';
import { NativeContextPanel } from './NativeContextPanel';
import { inheritTeamProfiles } from '../src/shared/agentInheritance';
import { progressLabel } from '../src/shared/optionalSteps';
import { searchText } from './Ergonomics';
import { orderedAgents } from '../src/shared/team';
import { toCredits, toNanoAiu, formatCredits } from '../src/shared/credits';
import { useState, useEffect, useRef, type FormEvent } from 'react';
import { subscribe } from './bridge';
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileCheck2,
  FileCode2,
  Flag,
  Gauge,
  GitBranch,
  Layers,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { QualityPanel } from './QualityUI';
import { DevOpsEvidencePanel } from './DevOpsKitUI';
import type {
  AcceptanceCriterion,
  Attempt,
  ClientMessage,
  Feature,
  FeatureBudget,
  FeatureStep,
  MemoryEntry,
  ModelProfile,
  StudioSettings,
  StudioState,
  Workflow as WorkflowType,
} from '../src/shared/types';
import { HumanRequests, McpPicker, MemoryPicker, StudioDialog, type Dispatch } from './ExecutionUI';
import { usageTotals, defaultBudget } from '../src/core/budgets';
const number = (v: number) => v.toLocaleString('fr-FR');
const stamp = (v: string) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v));
const slug = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
export { attentionCount } from '../src/shared/sessionAttention';
export { AutopilotBar } from './AutopilotUI';
const profileLabels: Record<ModelProfile, string> = {
  current: 'Conserver les modèles des étapes',
  economy: 'Économie',
  balanced: 'Équilibré',
  quality: 'Qualité',
};
function proposedBudget(state: StudioState, feature?: Feature): FeatureBudget {
  return feature?.budget ?? state.settings.budgetDefaults ?? { ...defaultBudget };
}
function BudgetFields({
  value,
  onChange,
}: {
  value: FeatureBudget;
  onChange: (b: FeatureBudget) => void;
}) {
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Nombre maximal d’exécutions</span>
          <input
            type="number"
            min={1}
            max={1000}
            placeholder="Sans limite"
            value={value.maxRuns || ''}
            onChange={(e) => onChange({ ...value, maxRuns: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Caractères maximum du prompt</span>
          <input
            required
            type="number"
            min={1000}
            max={500000}
            step={1000}
            value={value.maxPromptChars}
            onChange={(e) => onChange({ ...value, maxPromptChars: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>
            Seuil de tokens mesurés <small>facultatif</small>
          </span>
          <input
            type="number"
            min={0}
            value={value.maxTokens ?? ''}
            onChange={(e) =>
              onChange({ ...value, maxTokens: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="Aucune limite de tokens définie"
          />
        </label>
        <label className="field">
          <span>
            Seuil de crédits IA <small>facultatif</small>
          </span>
          <input
            type="number"
            min={0}
            step="any"
            value={value.maxNanoAiu === undefined ? '' : toCredits(value.maxNanoAiu)}
            onChange={(e) =>
              onChange({
                ...value,
                maxNanoAiu: e.target.value ? toNanoAiu(Number(e.target.value)) : undefined,
              })
            }
            placeholder="Aucune limite de crédits définie"
          />
        </label>
      </div>
      <label className="field">
        <span>Profil de modèles</span>
        <select
          value={value.modelProfile}
          onChange={(e) => onChange({ ...value, modelProfile: e.target.value as ModelProfile })}
        >
          {Object.entries(profileLabels).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
        <small>
          Les profils utilisent uniquement les modèles que vous avez associés dans les réglages. Les
          seuils de tokens et crédits arrêtent AVANT la tentative suivante ; ils ne plafonnent pas
          une facture ni la consommation de la tentative en cours.
        </small>
      </label>
    </>
  );
}
export function BudgetMeter({
  feature,
  state,
  dispatch,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: Dispatch;
}) {
  const totals = usageTotals(feature);
  const calls = executionCallCount(feature);
  const tokens = totals.inputTokens + totals.outputTokens;
  const unknown = totals.unknownTokenRuns;
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState(proposedBudget(state, feature));
  const live = feature.budget ?? state.settings.budgetDefaults ?? defaultBudget;
  return (
    <>
      <section className="budget-meter">
        <div className="budget-heading">
          <span className="eyebrow">
            <Gauge size={13} /> CONSOMMATION & CADRE
          </span>
          <button
            className="text-button"
            onClick={() => {
              setBudget(proposedBudget(state, feature));
              setEditing(true);
            }}
          >
            <Settings2 size={13} /> Budget
          </button>
        </div>
        <div className="budget-stats">
          <div>
            <strong>
              {number(calls)}
              {live.maxRuns > 0 ? <small> / {live.maxRuns}</small> : <small> · sans limite</small>}
            </strong>
            <span>appels agents</span>
          </div>
          <div>
            <strong>
              {tokens || unknown < totals.runs ? number(tokens) : '—'}
              {live?.maxTokens && <small> / {number(live.maxTokens)}</small>}
            </strong>
            <span>tokens {unknown > 0 ? '· mesure partielle' : 'mesurés'}</span>
          </div>
          <div>
            <strong>
              {totals.nanoAiu > 0 || totals.runs > totals.unknownCostRuns
                ? formatCredits(toCredits(totals.nanoAiu))
                : '—'}
              {live?.maxNanoAiu !== undefined && (
                <small> / {formatCredits(toCredits(live.maxNanoAiu))}</small>
              )}
            </strong>
            <span>crédits {totals.unknownCostRuns ? '· mesure incomplète' : 'mesurés'}</span>
          </div>
        </div>
        {live.maxRuns > 0 && (
          <div className="budget-track" aria-label={`${calls} appels sur ${live.maxRuns}`}>
            <span style={{ width: `${Math.min(100, (calls / live.maxRuns) * 100)}%` }} />
          </div>
        )}
        <details className="budget-details">
          <summary>Détail du cadre</summary>
          <p className="field-help">
            {totals.runs} tentative{totals.runs > 1 ? 's' : ''} réalisée{totals.runs > 1 ? 's' : ''}
            .
            {unknown > 0 &&
              ` ${unknown} tentative${unknown > 1 ? 's' : ''} avec mesure absente ou partielle.`}{' '}
            {live
              ? `${profileLabels[live.modelProfile]} · ${number(live.maxPromptChars)} caractères maximum par prompt`
              : 'Définissez un budget pour encadrer les prochaines exécutions.'}{' '}
            Les valeurs inconnues ne comptent jamais comme des consommations nulles.
          </p>
        </details>
      </section>
      {editing && (
        <StudioDialog
          title="Un budget pour avancer sereinement."
          subtitle="Les limites encadrent les prochaines exécutions. Aucun coût en euros n’est extrapolé."
          onClose={() => setEditing(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              dispatch({ type: 'saveBudget', featureId: feature.id, budget });
              setEditing(false);
            }}
          >
            <BudgetFields value={budget} onChange={setBudget} />
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setEditing(false)}>
                Annuler
              </button>
              <button className="button primary">
                Enregistrer le budget <Check size={15} />
              </button>
            </div>
          </form>
        </StudioDialog>
      )}
    </>
  );
}
export function ModelBudgetSettings({
  settings,
  state,
  onChange,
}: {
  settings: StudioSettings;
  state: StudioState;
  onChange: (patch: Partial<StudioSettings>) => void;
}) {
  const update = (profile: Exclude<ModelProfile, 'current'>, model: string, reasoning?: string) =>
    onChange({ modelProfiles: { ...settings.modelProfiles, [profile]: { model, reasoning } } });
  return (
    <section className="settings-card">
      <div className="settings-card-title">
        <span className="settings-icon color-1">
          <Gauge size={21} />
        </span>
        <div>
          <h2>Budgets et profils de modèles</h2>
          <p>Associez vos profils aux identifiants réellement proposés par le runtime.</p>
        </div>
      </div>
      <div className="model-profile-grid">
        {(['economy', 'balanced', 'quality'] as const).map((profile) => {
          const value = settings.modelProfiles?.[profile];
          const model = value?.model ?? '';
          const known = state.runtime.models.find((m) => m.id === model);
          return (
            <div key={profile}>
              <span className="eyebrow">{profileLabels[profile].toUpperCase()}</span>
              <label className="field">
                <span>Modèle du profil {profileLabels[profile]}</span>
                <select value={model} onChange={(e) => update(profile, e.target.value)}>
                  <option value="">Non associé · automatique</option>
                  {model && !known && <option value={model}>{model} · configuré</option>}
                  {state.runtime.models.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              {Boolean(known?.reasoningEfforts?.length) && (
                <label className="field">
                  <span>Raisonnement du profil {profileLabels[profile]}</span>
                  <select
                    value={value?.reasoning ?? ''}
                    onChange={(e) => update(profile, model, e.target.value || undefined)}
                  >
                    <option value="">Automatique</option>
                    {known?.reasoningEfforts?.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </div>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={Boolean(settings.budgetDefaults)}
          onChange={(e) =>
            onChange({ budgetDefaults: e.target.checked ? proposedBudget(state) : undefined })
          }
        />
        <span>Définir un budget par défaut pour les nouvelles sessions</span>
      </label>
      {settings.budgetDefaults && (
        <BudgetFields
          value={settings.budgetDefaults}
          onChange={(budgetDefaults) => onChange({ budgetDefaults })}
        />
      )}
      <p className="field-help">
        Ce paramétrage n’appelle aucun modèle. Les profils ne déduisent aucune tarification ni
        qualité à partir du nom du modèle.
      </p>
    </section>
  );
}
export function EvidencePanel({
  attempt,
  featureId,
  dispatch,
}: {
  attempt?: Attempt;
  featureId?: string;
  dispatch?: (message: ClientMessage) => void;
}) {
  const evidence = attempt?.evidence ?? [];
  return (
    <div className="evidence-panel">
      <NativeActivityPanel activities={attempt?.nativeActivity ?? []} />
      {attempt && <NativeContextPanel loads={attempt.nativeContextLoads ?? []} />}
      <DevOpsEvidencePanel evidence={evidence} />
      <QualityPanel
        evidence={evidence}
        onOpenAttachment={(evidenceId, attachmentId) => {
          if (featureId)
            dispatch?.({ type: 'openQualityAttachment', featureId, evidenceId, attachmentId });
        }}
      />
      {featureId && dispatch && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => dispatch({ type: 'installQualityKit', featureId })}
        >
          Installer le reporter dans cette session
        </button>
      )}
      <div className="evidence-intro">
        <ShieldCheck size={21} />
        <div>
          <h3>Des preuves, au bon niveau.</h3>
          <p>
            Les sorties de commandes exécutées par le host sont distinctes du compte rendu produit
            par l’agent.
          </p>
        </div>
      </div>
      {evidence.length ? (
        evidence.map((e) => (
          <details
            className={`evidence-entry ${e.exitCode === 0 && !e.error && (!e.quality || e.quality.status === 'passed') ? 'passed' : 'failed'}`}
            key={e.id}
            open
          >
            <summary>
              <span className="evidence-status">
                {e.exitCode === 0 && !e.error && (!e.quality || e.quality.status === 'passed') ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <TriangleAlert size={16} />
                )}
              </span>
              <span>
                <strong>{e.name}</strong>
                <small>
                  {stamp(e.startedAt)} ·{' '}
                  {e.devops
                    ? 'Collecté par le host · test exécuté manuellement'
                    : e.source === 'host'
                      ? 'Exécuté par le host'
                      : 'Source non confirmée'}
                </small>
              </span>
              <span className="evidence-result">
                {e.exitCode === 0 && !e.error && (!e.quality || e.quality.status === 'passed')
                  ? 'Code 0'
                  : e.quality && e.quality.status !== 'passed'
                    ? 'Preuve qualité bloquante'
                    : e.exitCode === null
                      ? 'Pas de code de sortie'
                      : `Code ${e.exitCode}`}
              </span>
            </summary>
            <div className="evidence-body">
              <code>{[e.command, ...e.args].join(' ')}</code>
              {e.error && <div className="inline-error">{e.error}</div>}
              {e.stdout && (
                <details open>
                  <summary>Sortie standard</summary>
                  <pre>{e.stdout}</pre>
                </details>
              )}
              {e.stderr && (
                <details>
                  <summary>Sortie d’erreur</summary>
                  <pre>{e.stderr}</pre>
                </details>
              )}
              {e.truncated && (
                <p className="field-help">La sortie affichée a été tronquée par le host.</p>
              )}
              <details>
                <summary>Empreintes des fichiers · {Object.keys(e.fileHashes).length}</summary>
                <pre>
                  {Object.entries(e.fileHashes)
                    .map(([file, hash]) => `${file}  ${hash}`)
                    .join('\n') || 'Aucune empreinte associée.'}
                </pre>
              </details>
            </div>
          </details>
        ))
      ) : !attempt?.nativeActivity?.length ? (
        <div className="evidence-empty">
          <FileCheck2 size={28} />
          <h3>Aucune commande attestée pour cette tentative.</h3>
          <p>
            Un livrable ou un message d’agent peut décrire un test. Les preuves d’exécution
            apparaîtront ici uniquement lorsqu’elles seront transmises par le host.
          </p>
        </div>
      ) : null}
      {attempt?.review && (
        <section className="review-report">
          <span className="eyebrow">RELECTURE PRODUITE PAR L’AGENT</span>
          <h3>
            {attempt.review.verdict === 'pass'
              ? 'Aucun changement demandé'
              : 'Des corrections sont demandées'}
          </h3>
          <p>{attempt.review.summary}</p>
          {attempt.review.findings.map((f) => (
            <div className={`review-finding ${f.severity}`} key={f.id}>
              <Flag size={13} />
              <span>
                {f.message}
                {f.file && (
                  <small>
                    {f.file}
                    {f.line ? `:${f.line}` : ''}
                  </small>
                )}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
export function ValidationCenter({
  state,
  dispatch,
  onOpen,
}: {
  state: StudioState;
  dispatch: Dispatch;
  onOpen: (featureId: string, stepId: string) => void;
}) {
  const [filter, setFilter] = useState('all');
  const requests = (state.humanRequests ?? []).filter((request) =>
    state.features.some((feature) => feature.id === request.featureId && !feature.archived),
  );
  const decisions = validationDecisions(state);
  const items = decisions.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'blocked'
        ? item.priority === 0
        : filter === 'review'
          ? ['review', 'final'].includes(item.kind)
          : item.kind === filter),
  );
  return (
    <div className="page validation-page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">LES DÉCISIONS QUI FONT AVANCER</span>
          <h1>Votre regard, au bon moment.</h1>
          <p>
            Résultat, critères, tests et changements réunis pour décider. Les blocages apparaissent
            en premier, puis les réponses attendues.
          </p>
        </div>
        <span className="validation-counter">
          <strong>{attentionCount(state)}</strong> points d’attention
        </span>
      </div>
      {requests.length > 0 && (
        <section className="validation-requests">
          <div className="section-heading">
            <h2>Les agents vous attendent</h2>
            <span className="count-pill">{requests.length}</span>
          </div>
          <HumanRequests requests={requests} dispatch={dispatch} />
        </section>
      )}
      <div className="section-heading">
        <h2>Dans vos parcours</h2>
        <label className="filter-select">
          <select
            aria-label="Filtrer le centre de validation"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">Tous les points d’attention</option>
            <option value="blocked">Blocages prioritaires</option>
            <option value="review">Livrables à valider</option>
            <option value="question">Questions</option>
            <option value="optional">Interventions facultatives</option>
            <option value="repair">À reprendre ou actualiser</option>
          </select>
        </label>
      </div>
      <div className="validation-grid">
        {items.map((item) => (
          <article
            className="validation-card validation-decision"
            key={item.id}
            aria-label={`${item.feature.title} · ${item.step?.name ?? 'Bilan final'}`}
          >
            <span className="validation-kind">
              <FileCheck2 size={17} />
              {item.label}
              {item.priority === 0 && <strong>Prioritaire</strong>}
            </span>
            <h3>{item.step?.name ?? 'Bilan final du parcours'}</h3>
            <p>{item.feature.title}</p>
            <small>
              {stamp(item.feature.updatedAt)} · {progressLabel(item.feature)}
            </small>
            {item.blockers.length > 0 && (
              <div className="validation-decision-blockers">
                <strong>À résoudre avant validation</strong>
                <ul>
                  {item.blockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <section className="validation-result">
              <h4>Résultat à relire</h4>
              <p>
                {item.result
                  ? item.result.replace(/[#*_`]/g, '').slice(0, 420) +
                    (item.result.length > 420 ? '…' : '')
                  : 'Aucun compte rendu disponible pour cette tentative.'}
              </p>
            </section>
            <details>
              <summary>
                Critères d’acceptation ·{' '}
                {item.feature.criteria?.filter(
                  (criterion) => criterion.status === 'passed' && criterion.evidence.trim(),
                ).length ?? 0}
                /{item.feature.criteria?.length ?? 0} renseignés comme validés
              </summary>
              {item.feature.criteria?.length ? (
                <ul>
                  {item.feature.criteria.map((criterion) => (
                    <li key={criterion.id}>
                      <strong>
                        {criterion.status === 'passed'
                          ? 'Déclaré validé'
                          : criterion.status === 'failed'
                            ? 'En échec'
                            : 'À vérifier'}{' '}
                        · {criterion.text}
                      </strong>
                      <p>{criterion.evidence || 'Aucune justification renseignée.'}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Aucun critère renseigné.</p>
              )}
              <small>
                Une déclaration de validation ne constitue pas une preuve de test exécuté.
              </small>
            </details>
            <details>
              <summary>
                Tests exécutés par le host · {item.tests.length} preuve
                {item.tests.length > 1 ? 's' : ''}
              </summary>
              {item.tests.length ? (
                <ul>
                  {item.tests.map((proof) => (
                    <li key={proof.id}>
                      <strong>
                        {proof.title} ·{' '}
                        {proof.state === 'observed'
                          ? 'Réussite enregistrée'
                          : proof.state === 'failed'
                            ? 'Échec ou résultat incomplet'
                            : proof.state === 'pending'
                              ? 'En attente'
                              : 'À revérifier'}
                      </strong>
                      <p>
                        {stamp(proof.at)} · {proof.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  Aucun test exécuté attesté. Les tests décrits dans un compte rendu restent des
                  déclarations.
                </p>
              )}
            </details>
            <details>
              <summary>
                Changements de la tentative · {item.files.length} fichier
                {item.files.length > 1 ? 's' : ''}
              </summary>
              {item.files.length ? (
                <ul>
                  {item.files.map((file) => (
                    <li key={file}>
                      <button
                        className="text-button"
                        onClick={() =>
                          dispatch({ type: 'openFile', featureId: item.feature.id, path: file })
                        }
                      >
                        <FileCode2 size={13} />
                        {file}
                      </button>
                      <button
                        className="text-button"
                        aria-label={`Voir le diff de ${file}`}
                        onClick={() =>
                          dispatch({ type: 'openDiff', featureId: item.feature.id, path: file })
                        }
                      >
                        Voir le diff
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Aucun fichier signalé pour cette tentative.</p>
              )}
              <small>Les changements signalés sont à confronter au diff Git avant livraison.</small>
            </details>
            <div className="validation-card-footer">
              <GitBranch size={12} />
              {item.feature.branch}
            </div>
            <button
              className="button secondary"
              onClick={() => onOpen(item.feature.id, item.stepId)}
            >
              {item.action}
              <ArrowRight size={15} />
            </button>
          </article>
        ))}
      </div>
      {!items.length && (
        <div className="evidence-empty">
          <CheckCircle2 size={29} />
          <h3>Le prochain mouvement est ailleurs.</h3>
          <p>
            Aucun point d’attention ne correspond à ce filtre. Les questions en direct restent
            accessibles au-dessus.
          </p>
        </div>
      )}
    </div>
  );
}
export function ReviewWorkspace({
  feature,
  step,
  attempt,
  state,
  dispatch,
  onCorrection,
  correctionDisabled = false,
}: {
  onCorrection?: (text: string, commentId?: string, findingId?: string) => void;
  correctionDisabled?: boolean;
  feature: Feature;
  step: FeatureStep;
  attempt?: Attempt;
  state: StudioState;
  dispatch: Dispatch;
}) {
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(
    structuredClone(feature.criteria ?? []),
  );
  const [text, setText] = useState(''),
    [file, setFile] = useState(''),
    [line, setLine] = useState(''),
    [blocking, setBlocking] = useState(false),
    [memory, setMemory] = useState<MemoryEntry | null>(null);
  const comments = (feature.reviewComments ?? []).filter(
    (c) => c.stepId === step.id && c.attemptId === attempt?.id,
  );
  const criteriaDirty = JSON.stringify(criteria) !== JSON.stringify(feature.criteria ?? []);
  return (
    <div className="review-workspace">
      {attempt?.review && (
        <section className="review-report">
          <h3>Relecture de l’agent</h3>
          <p>{attempt.review.summary}</p>
          {attempt.review.findings.map((finding) => (
            <div className={`review-finding ${finding.severity}`} key={finding.id}>
              <span>
                {finding.message}
                {finding.file && (
                  <small>
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ''}
                  </small>
                )}
              </span>
              {onCorrection && (
                <button
                  className="text-button"
                  disabled={correctionDisabled}
                  onClick={() => onCorrection(finding.message, undefined, finding.id)}
                >
                  Demander une correction
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <section>
        <div className="section-heading">
          <h3>Critères d’acceptation</h3>
          <button
            className="text-button"
            onClick={() =>
              setCriteria([
                ...criteria,
                { id: crypto.randomUUID(), text: '', status: 'pending', evidence: '' },
              ])
            }
          >
            <Plus size={13} /> Ajouter
          </button>
        </div>
        {criteria.map((criterion, i) => (
          <div className="criterion-row" key={criterion.id}>
            <span className="criterion-number">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <label className="field">
                <span className="sr-only">Critère {i + 1}</span>
                <input
                  value={criterion.text}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((c) =>
                        c.id === criterion.id ? { ...c, text: e.target.value } : c,
                      ),
                    )
                  }
                  placeholder="Un comportement observable et vérifiable"
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span className="sr-only">État du critère {i + 1}</span>
                  <select
                    value={criterion.status}
                    onChange={(e) =>
                      setCriteria(
                        criteria.map((c) =>
                          c.id === criterion.id
                            ? { ...c, status: e.target.value as AcceptanceCriterion['status'] }
                            : c,
                        ),
                      )
                    }
                  >
                    <option value="pending">À vérifier</option>
                    <option value="passed">Vérifié</option>
                    <option value="failed">Non satisfait</option>
                  </select>
                </label>
                <label className="field">
                  <span className="sr-only">Preuve du critère {i + 1}</span>
                  <input
                    value={criterion.evidence}
                    onChange={(e) =>
                      setCriteria(
                        criteria.map((c) =>
                          c.id === criterion.id ? { ...c, evidence: e.target.value } : c,
                        ),
                      )
                    }
                    placeholder="Preuve ou référence"
                  />
                </label>
              </div>
            </div>
            <button
              className="icon-button"
              aria-label={`Supprimer le critère ${i + 1}`}
              onClick={() => setCriteria(criteria.filter((c) => c.id !== criterion.id))}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {!criteria.length && (
          <p className="muted">
            Ajoutez les comportements qui vous feront considérer la feature comme réussie.
          </p>
        )}
        <button
          className="button secondary small"
          disabled={!criteriaDirty || criteria.some((c) => !c.text.trim())}
          onClick={() => dispatch({ type: 'saveCriteria', featureId: feature.id, criteria })}
        >
          Enregistrer les critères <Check size={13} />
        </button>
      </section>
      <section>
        <div className="section-heading">
          <h3>Notes de relecture</h3>
          <span className="count-pill">{comments.length}</span>
        </div>
        {comments.map((c) => (
          <div className={`review-comment ${c.resolved ? 'resolved' : ''}`} key={c.id}>
            <div>
              <span className="eyebrow">
                {c.blocking ? 'BLOQUANT' : 'NOTE'}
                {c.resolved ? ' · RÉSOLU' : ''}
              </span>
              <p>{c.text}</p>
              {c.file && (
                <button
                  className="text-button"
                  onClick={() =>
                    dispatch({ type: 'openFile', path: c.file!, featureId: feature.id })
                  }
                >
                  <FileCode2 size={12} />
                  {c.file}
                  {c.line ? `:${c.line}` : ''}
                </button>
              )}
            </div>
            {onCorrection && !c.resolved && (
              <button
                className="text-button"
                disabled={correctionDisabled}
                onClick={() => onCorrection(c.text, c.id)}
              >
                Demander une correction
              </button>
            )}
            <button
              className="text-button"
              onClick={() =>
                dispatch({
                  type: 'resolveReviewComment',
                  featureId: feature.id,
                  commentId: c.id,
                  resolved: !c.resolved,
                })
              }
            >
              {c.resolved ? 'Rouvrir' : 'Marquer résolu'}
              <Check size={12} />
            </button>
          </div>
        ))}
        <label className="field">
          <span>Un retour sur cette tentative</span>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Le problème observé, son impact et la correction attendue."
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>
              Fichier <small>facultatif</small>
            </span>
            <input
              value={file}
              onChange={(e) => setFile(e.target.value)}
              placeholder="src/composant.ts"
            />
          </label>
          <label className="field">
            <span>
              Ligne <small>facultatif</small>
            </span>
            <input type="number" min={1} value={line} onChange={(e) => setLine(e.target.value)} />
          </label>
        </div>
        <div className="comment-actions">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={blocking}
              onChange={(e) => setBlocking(e.target.checked)}
            />
            <span>Bloque la validation</span>
          </label>
          <button
            className="button secondary small"
            disabled={!text.trim() || !attempt}
            onClick={() => {
              if (!attempt) return;
              dispatch({
                type: 'addReviewComment',
                featureId: feature.id,
                comment: {
                  stepId: step.id,
                  attemptId: attempt.id,
                  text: text.trim(),
                  blocking,
                  ...(file.trim() ? { file: file.trim() } : {}),
                  ...(line ? { line: Number(line) } : {}),
                },
              });
              setText('');
            }}
          >
            Ajouter le commentaire
          </button>
        </div>
      </section>
      {step.status === 'approved' && attempt?.artifact && (
        <section className="memory-from-artifact">
          <BrainCircuit size={19} />
          <div>
            <h3>Une décision à retenir ?</h3>
            <p>
              Préparez une entrée locale à partir de ce livrable. Aucun résumé IA n’est demandé.
            </p>
          </div>
          <button
            className="button secondary small"
            onClick={() =>
              setMemory({
                id: crypto.randomUUID(),
                title: `${feature.title} · ${step.name}`,
                content: attempt.artifact!.content,
                category: 'decision',
                enabled: false,
                agentIds: [],
                updatedAt: new Date().toISOString(),
                source: { featureId: feature.id, stepId: step.id, attemptId: attempt.id },
              })
            }
          >
            Préparer une note <ArrowRight size={13} />
          </button>
        </section>
      )}
      {memory && (
        <MemoryEditor
          entry={memory}
          state={state}
          dispatch={dispatch}
          onClose={() => setMemory(null)}
        />
      )}
    </div>
  );
}
export function ProjectMemoryView({ state, dispatch }: { state: StudioState; dispatch: Dispatch }) {
  const [editor, setEditor] = useState<MemoryEntry | null>(null);
  const [deleting, setDeleting] = useState<MemoryEntry | null>(null);
  const [query, setQuery] = useState('');
  const memory = (state.memory ?? []).filter((m) =>
    searchText(`${m.title} ${m.content}`).includes(searchText(query)),
  );
  return (
    <div className="page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">CE QUE L’ATELIER RETIENT</span>
          <h1>La mémoire de votre projet.</h1>
          <p>
            Des conventions et décisions locales, relues par vous. L’injection dans les prompts
            reste une option explicite, sans appel IA supplémentaire.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            setEditor({
              id: crypto.randomUUID(),
              title: '',
              content: '',
              category: 'context',
              enabled: false,
              agentIds: [],
              updatedAt: new Date().toISOString(),
            })
          }
        >
          <Plus size={15} /> Nouvelle note
        </button>
      </div>
      <div className="memory-toolbar">
        <label className="search-field">
          <BrainCircuit size={15} />
          <input
            aria-label="Rechercher dans la mémoire"
            placeholder="Une convention, une décision…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="muted">
          {memory.length} note{memory.length > 1 ? 's' : ''} ·{' '}
          {memory.filter((m) => m.enabled).length} activée
          {memory.filter((m) => m.enabled).length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="memory-grid">
        {memory.map((m) => (
          <article className="memory-card" key={m.id}>
            <div className="section-heading">
              <span className="eyebrow">
                {
                  {
                    convention: 'Convention',
                    architecture: 'Architecture',
                    decision: 'Décision',
                    context: 'Contexte',
                  }[m.category]
                }
              </span>
              <span className={`memory-state ${m.enabled ? 'enabled' : ''}`}>
                {m.enabled ? 'Disponible à l’injection' : 'Conservée localement'}
              </span>
            </div>
            <h3>{m.title}</h3>
            <p>
              {m.content.slice(0, 260)}
              {m.content.length > 260 ? '…' : ''}
            </p>
            <div className="memory-meta">
              <span>{stamp(m.updatedAt)}</span>
              <span>{number(m.content.length)} caractères</span>
            </div>
            <div className="memory-card-actions">
              <button className="text-button" onClick={() => setEditor(m)}>
                Lire et ajuster <ArrowUpRight size={13} />
              </button>
              <button
                className="icon-button"
                aria-label={`Supprimer la note ${m.title}`}
                onClick={() => setDeleting(m)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!memory.length && (
        <div className="evidence-empty">
          <BrainCircuit size={30} />
          <h3>
            {query ? 'Aucune note ne correspond.' : 'Une mémoire qui se construit avec vous.'}
          </h3>
          <p>
            {query
              ? 'Essayez un autre mot ou effacez la recherche.'
              : 'Ajoutez une convention ou conservez une décision validée depuis une session. Les nouvelles notes sont désactivées pour l’injection par défaut.'}
          </p>
          {query && (
            <button className="button secondary" onClick={() => setQuery('')}>
              Effacer la recherche
            </button>
          )}
        </div>
      )}
      {editor && (
        <MemoryEditor
          entry={editor}
          state={state}
          dispatch={dispatch}
          onClose={() => setEditor(null)}
        />
      )}{' '}
      {deleting && (
        <StudioDialog
          title="Supprimer cette note ?"
          subtitle={`« ${deleting.title} » sera retirée de la mémoire locale du projet.`}
          onClose={() => setDeleting(null)}
        >
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleting(null)}>
              Revenir
            </button>
            <button
              className="button primary"
              onClick={() => {
                dispatch({ type: 'deleteMemory', id: deleting.id });
                setDeleting(null);
              }}
            >
              Supprimer la note
            </button>
          </div>
        </StudioDialog>
      )}
    </div>
  );
}
function MemoryEditor({
  entry,
  state,
  dispatch,
  onClose,
}: {
  entry: MemoryEntry;
  state: StudioState;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(entry));
  const [preview, setPreview] = useState(false);
  return (
    <StudioDialog
      title="Un repère pour les prochains pas."
      subtitle="Cette note reste locale. Vous choisissez si elle devient disponible pour l’injection dans les prompts."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          dispatch({
            type: 'saveMemory',
            entry: { ...draft, title: draft.title.trim(), updatedAt: new Date().toISOString() },
          });
          onClose();
        }}
      >
        <div className="field-row">
          <label className="field">
            <span>Titre de la note</span>
            <input
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Catégorie</span>
            <select
              value={draft.category}
              onChange={(e) =>
                setDraft({ ...draft, category: e.target.value as MemoryEntry['category'] })
              }
            >
              <option value="context">Contexte</option>
              <option value="convention">Convention</option>
              <option value="architecture">Architecture</option>
              <option value="decision">Décision</option>
            </select>
          </label>
        </div>
        <div className="section-heading">
          <h3>Le contenu à retenir</h3>
          <button type="button" className="text-button" onClick={() => setPreview(!preview)}>
            {preview ? 'Éditer' : 'Aperçu Markdown'}
          </button>
        </div>
        {preview ? (
          <div className="skill-preview markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{draft.content}</Markdown>
          </div>
        ) : (
          <label className="field">
            <span className="sr-only">Contenu de la note</span>
            <textarea
              required
              maxLength={40000}
              rows={10}
              className="code-input"
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </label>
        )}
        <label className="inline-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <span>
            Rendre cette note disponible pour les prompts
            <small>
              Le lancement doit encore activer l’inclusion de mémoire. Maximum 4 000 caractères
              injectés au total.
            </small>
          </span>
        </label>
        <fieldset className="skill-options">
          <legend>Agents concernés · aucun choisi = tous les agents</legend>
          {orderedAgents(state.agents, state.favoriteAgentIds).map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={draft.agentIds.includes(a.id)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    agentIds: e.target.checked
                      ? [...draft.agentIds, a.id]
                      : draft.agentIds.filter((id) => id !== a.id),
                  })
                }
              />
              {a.nickname || a.name}
            </label>
          ))}
        </fieldset>
        {draft.source && (
          <p className="field-help">
            Source : session {draft.source.featureId}, étape {draft.source.stepId}, tentative{' '}
            {draft.source.attemptId}.
          </p>
        )}
        <div className="modal-actions">
          <span className="muted">
            {number(draft.content.length)} caractères / 40 000 · aucun appel IA
          </span>
          <button type="button" className="button secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="button primary"
            disabled={!draft.title.trim() || !draft.content.trim() || draft.content.length > 40000}
          >
            Enregistrer la note <Check size={14} />
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}
function workflowErrors(workflow: WorkflowType, state: StudioState) {
  const errors: string[] = [];
  if (!workflow.name.trim()) errors.push('Donnez un nom à l’équipe.');
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(workflow.id))
    errors.push('L’identifiant doit commencer par une lettre.');
  if (!workflow.steps.length) errors.push('Ajoutez au moins une étape.');
  const ids = new Set(workflow.steps.map((s) => s.id));
  if (ids.size !== workflow.steps.length)
    errors.push('Les identifiants des étapes doivent être uniques.');
  const seen = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (seen.has(id)) return false;
    visiting.add(id);
    const step = workflow.steps.find((s) => s.id === id);
    for (const dep of step?.dependsOn ?? []) if (visit(dep)) return true;
    visiting.delete(id);
    seen.add(id);
    return false;
  };
  if (workflow.steps.some((s) => visit(s.id)))
    errors.push('Les dépendances forment un cycle. Retirez une liaison.');
  for (const s of workflow.steps) {
    if (!/^[^/\\]+\.md$/i.test(s.artifact))
      errors.push(`${s.name || 'Étape'} : le livrable doit être un fichier .md.`);
    if (!s.name.trim() || !s.artifact.trim())
      errors.push(`${s.name || 'Étape'} : nom et fichier livrable requis.`);
    if (!state.agents.some((a) => a.id === s.agentId))
      errors.push(`${s.name} : choisissez un agent disponible.`);
    if (s.dependsOn.some((d) => !ids.has(d)))
      errors.push(`${s.name} : une dépendance n’existe plus.`);
    if (s.maxAttempts < 0 || s.maxAttempts > 100)
      errors.push(
        `${s.name} : la limite doit être 0 (sans limite) ou comprise entre 1 et 100 tentatives.`,
      );
    if (s.artifact.includes('..') || s.artifact.includes('/') || s.artifact.includes('\\'))
      errors.push(`${s.name} : utilisez un nom de fichier simple pour le livrable.`);
  }
  return [...new Set(errors)];
}
export function WorkflowLibrary({ state, dispatch }: { state: StudioState; dispatch: Dispatch }) {
  const [deleting, setDeleting] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const deleteRequest = useRef('');
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'workflowDeleteResult' || message.requestId !== deleteRequest.current)
          return;
        setDeleting('');
        setDeleteError(message.error ?? '');
      }),
    [],
  );
  const [editor, setEditor] = useState<WorkflowType | null>(null);
  const [originalId, setOriginalId] = useState('');
  const open = (workflow: WorkflowType, isCopy = false) => {
    setOriginalId(isCopy ? '' : workflow.id);
    setEditor(
      isCopy
        ? {
            ...structuredClone(workflow),
            id: `${workflow.id}-copie-${Date.now().toString(36)}`,
            name: `${workflow.name} · copie`,
            source: undefined,
          }
        : structuredClone(workflow),
    );
  };
  return (
    <div className="page workflows-page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">VOS ÉQUIPES RÉUTILISABLES</span>
          <h1>Mes équipes</h1>
          <p>
            Composez vos équipes avec les agents de votre choix, puis retrouvez-les lors de la
            création de vos features.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setOriginalId('');
            setEditor({
              id: '',
              name: '',
              description: '',
              icon: 'layers',
              steps: [],
            });
          }}
        >
          <Plus size={15} /> Nouvelle équipe
        </button>
      </div>
      <div className="workflow-library">
        {deleteError && (
          <p className="inline-error" role="alert">
            {deleteError}
          </p>
        )}
        {state.workflows.map((w) => (
          <article className="workflow-library-card" key={w.id}>
            <div className="section-heading">
              <span className="settings-icon color-2">
                <Workflow size={21} />
              </span>
              <span className="muted">{w.steps.length} étapes</span>
            </div>
            <h3>{w.name}</h3>
            <p>{w.description}</p>
            <div className="workflow-mini-map">
              {w.steps.map((s, i) => (
                <span key={s.id}>
                  <small>{String(i + 1).padStart(2, '0')}</small>
                  {s.name}
                  {i < w.steps.length - 1 && <ChevronRight size={10} />}
                </span>
              ))}
            </div>
            <div className="workflow-card-actions">
              <button className="text-button" onClick={() => open(w)}>
                Ouvrir l’éditeur <ArrowUpRight size={13} />
              </button>
              <button className="text-button" onClick={() => open(w, true)}>
                <Copy size={13} /> Dupliquer
              </button>
              <button
                className="text-button"
                aria-label={`Supprimer l’équipe ${w.name}`}
                disabled={
                  Boolean(deleting) || !state.workspace.trusted || Boolean(state.workspaceOperation)
                }
                onClick={() => {
                  const requestId = crypto.randomUUID();
                  deleteRequest.current = requestId;
                  setDeleting(w.id);
                  setDeleteError('');
                  dispatch({ type: 'deleteWorkflow', workflowId: w.id, requestId });
                }}
              >
                <Trash2 size={13} /> {deleting === w.id ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!state.workflows.length && (
        <div className="evidence-empty">
          <Layers size={29} />
          <h3>Votre première équipe à composer.</h3>
          <p>
            Choisissez des agents, organisez leurs interventions et enregistrez votre équipe pour la
            retrouver dans vos features.
          </p>
        </div>
      )}
      {editor && (
        <WorkflowEditor
          initial={editor}
          existingId={originalId}
          state={state}
          dispatch={dispatch}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
function WorkflowEditor({
  initial,
  existingId,
  state,
  dispatch,
  onClose,
}: {
  initial: WorkflowType;
  existingId: string;
  state: StudioState;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const [workflow, setWorkflow] = useState(() => ({
    ...structuredClone(initial),
    steps: inheritTeamProfiles(initial.steps, state.agents),
  }));
  // The composer also edits nested team drafts; this preview has no execution history.
  const [draft] = useState<Feature>(() => ({
    id: initial.id || 'team-draft',
    title: initial.name,
    description: initial.description,
    workflowId: initial.id,
    workflowName: initial.name,
    branch: '',
    createdAt: '',
    updatedAt: '',
    status: 'draft',
    activeStepId: '',
    budget: { ...defaultBudget, modelProfile: 'current' },
    steps: workflow.steps.map((step) => ({ ...step, status: 'pending', attempts: [] })),
  }));
  return (
    <StudioDialog
      title={existingId ? workflow.name || 'Votre équipe' : 'Composer une nouvelle équipe'}
      subtitle="Choisissez vos agents comme dans une feature. L’équipe enregistrée sera disponible dans tous vos projets."
      onClose={onClose}
      className="workflow-editor-dialog"
    >
      <div className="workflow-info">
        <label className="field">
          <span>Nom de l’équipe</span>
          <input
            required
            value={workflow.name}
            onChange={(event) =>
              setWorkflow({
                ...workflow,
                name: event.target.value,
                ...(!existingId ? { id: slug(event.target.value) } : {}),
              })
            }
            placeholder="Ex. Mon équipe développement"
          />
        </label>
        <label className="field">
          <span>Identifiant de l’équipe</span>
          <input
            required
            disabled={Boolean(existingId)}
            value={workflow.id}
            onChange={(event) => setWorkflow({ ...workflow, id: event.target.value })}
            pattern="[a-zA-Z][a-zA-Z0-9_-]*"
          />
        </label>
        <label className="field">
          <span>Description de l’équipe</span>
          <input
            value={workflow.description}
            onChange={(event) => setWorkflow({ ...workflow, description: event.target.value })}
            placeholder="Pour quels besoins utiliserez-vous cette équipe ?"
          />
        </label>
      </div>
      <TeamComposer
        feature={draft}
        state={state}
        dispatch={dispatch}
        onClose={onClose}
        onPendingChange={() => {}}
        templateMode
        validationErrors={workflowErrors(workflow, state)}
        onStepsChange={(steps) => setWorkflow((current) => ({ ...current, steps }))}
        onApply={(steps) => {
          const saved = { ...workflow, steps, source: undefined };
          if (workflowErrors(saved, state).length) return;
          dispatch({ type: 'saveWorkflow', workflow: saved });
          onClose();
        }}
      />
    </StudioDialog>
  );
}
