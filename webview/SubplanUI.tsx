import { ImageGallery } from './Images';
import { executionCallCount } from '../src/core/budgets';
import { useState, useRef, type ReactNode } from 'react';
import { searchText, useDialogAccessibility } from './Ergonomics';
import { createPortal } from 'react-dom';
import {
  Layers3,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  History,
  Home,
  MessageSquare,
  Search,
  X,
} from 'lucide-react';
import type {
  ClientMessage,
  Feature,
  FeatureStep,
  StudioState,
  WorkflowStep,
} from '../src/shared/types';
import {
  currentIteration,
  featurePath,
  subplanIssues,
  type SubplanIteration,
} from '../src/shared/subplans';
import { inheritTeamProfiles } from '../src/shared/agentInheritance';
import { instantiateTeam, orderTeam } from '../src/shared/team';
import { TeamComposer } from './TeamComposer';
import './subplans.css';

export function SubplanMark({ step }: { step: WorkflowStep }) {
  const issues = subplanIssues([step]);
  return (
    <span className={`subplan-mark ${issues.length ? 'incomplete' : ''}`} title={issues.join(' ')}>
      <Layers3 size={22} />
      {issues.length > 0 && <AlertTriangle size={12} />}
    </span>
  );
}
/** A team container, deliberately distinct from the portraits used by agent cards. */
export function SubplanCardVisual({ step }: { step: WorkflowStep }) {
  const incomplete = subplanIssues([step]).length > 0;
  return (
    <span className={`subplan-card-visual ${incomplete ? 'incomplete' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 112 76" fill="none">
        <rect
          className="subplan-sheet back"
          x="27"
          y="4"
          width="68"
          height="48"
          rx="10"
          transform="rotate(8 27 4)"
        />
        <rect
          className="subplan-sheet middle"
          x="18"
          y="12"
          width="72"
          height="48"
          rx="10"
          transform="rotate(-5 18 12)"
        />
        <rect className="subplan-sheet front" x="14" y="20" width="80" height="50" rx="12" />
        <path className="subplan-links" d="M54 35v10M34 52v-7h40v7" />
        <rect className="subplan-node" x="47" y="28" width="14" height="11" rx="4" />
        <rect className="subplan-node" x="27" y="50" width="14" height="11" rx="4" />
        <rect className="subplan-node" x="67" y="50" width="14" height="11" rx="4" />
        <path className="subplan-spark" d="m99 13 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" />
      </svg>
      {incomplete && <AlertTriangle size={15} />}
    </span>
  );
}
type SubplanSettingsProps = {
  step: WorkflowStep;
  state: StudioState;
  dispatch: (m: ClientMessage) => void;
  onChange: (patch: Partial<WorkflowStep>) => void;
};

/** The card and its settings open the same editor, including at nested levels. */
export function SubplanTeamButton({
  step,
  state,
  dispatch,
  onChange,
  disabled,
  onCard = false,
}: SubplanSettingsProps & { disabled?: boolean; onCard?: boolean }) {
  const config = step.subplan!;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Feature>();
  const edit = () => {
    setDraft({
      id: step.id,
      title: step.name,
      description: step.description,
      workflowId: 'custom',
      workflowName: config.teamName,
      branch: '',
      createdAt: '',
      updatedAt: '',
      status: 'draft',
      activeStepId: config.steps[0]?.id ?? '',
      steps: config.steps.map((s) => ({ ...structuredClone(s), status: 'pending', attempts: [] })),
    });
    setOpen(true);
  };
  return (
    <>
      <button
        type="button"
        className={`button secondary ${onCard ? 'small subplan-team-button' : ''}`}
        disabled={disabled}
        aria-label={onCard ? `Configurer la sous-équipe de ${step.name}` : undefined}
        aria-haspopup="dialog"
        onClick={edit}
      >
        <Layers3 size={16} />
        <span>{config.steps.length ? 'Configurer la sous-équipe' : 'Choisir une équipe'}</span>
      </button>
      {open &&
        draft &&
        createPortal(
          <SubplanPanel title={`Sous-équipe de ${step.name}`} onClose={() => setOpen(false)}>
            <header>
              <SubplanMark step={step} />
              <div>
                <span className="eyebrow">COMPOSITION DE LA SOUS-ÉQUIPE</span>
                <h2>{step.name}</h2>
                <p>Cette équipe intervient pour chaque tâche du sous-plan.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Fermer la sous-équipe"
                onClick={() => setOpen(false)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="subplan-config-body">
              <TeamComposer
                feature={draft}
                state={state}
                dispatch={dispatch}
                onPendingChange={() => {}}
                onClose={() => setOpen(false)}
                onApply={(steps) => {
                  onChange({
                    subplan: {
                      ...config,
                      teamName: config.teamName || 'Sous-équipe personnalisée',
                      steps,
                    },
                  });
                  setOpen(false);
                }}
              />
            </div>
          </SubplanPanel>,
          document.body,
        )}
    </>
  );
}

export function SubplanSettings({ step, state, dispatch, onChange }: SubplanSettingsProps) {
  const config = step.subplan!;
  const issues = subplanIssues([step]);
  return (
    <div className="subplan-settings">
      <label className="field subplan-wide-field">
        <span>Nom du sous-plan</span>
        <input value={step.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <label className="field subplan-wide-field">
        <span>Mission du sous-plan</span>
        <textarea
          value={step.description}
          rows={3}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Orchestrateur dédié</span>
        <select
          value={step.agentId}
          onChange={(e) => onChange({ agentId: e.target.value, inheritAgent: true })}
        >
          {state.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.nickname || agent.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Organisation par défaut</span>
        <select
          value={config.mode}
          onChange={(e) =>
            onChange({ subplan: { ...config, mode: e.target.value as 'pair' | 'automatic' } })
          }
        >
          <option value="pair">Découpage accompagné</option>
          <option value="automatic">Découpage automatique</option>
        </select>
      </label>
      <p className="field-help subplan-wide-field">
        {config.mode === 'pair'
          ? 'Discutez le découpage dans le chat, puis validez les tâches avant de démarrer.'
          : 'L’orchestrateur prépare le découpage et lance la première sous-équipe.'}{' '}
        Chaque étape de la sous-équipe garde sa validation humaine, y compris le code avant les
        tests.
      </p>
      <div className="subplan-team-choice subplan-wide-field">
        <div className="subplan-team-choice-heading">
          <SubplanCardVisual step={step} />
          <div>
            <span className="subplan-card-kicker">UNE ÉQUIPE POUR CHAQUE TÂCHE</span>
            <strong>{config.teamName || 'Votre sous-équipe reste à choisir'}</strong>
            <small>
              {config.steps.length
                ? `${config.steps.length} intervention${config.steps.length > 1 ? 's' : ''} · composition personnalisable`
                : 'Partez d’une équipe enregistrée ou composez la vôtre.'}
            </small>
          </div>
        </div>
        <label className="field">
          <span>Équipe à utiliser</span>
          <select
            value=""
            onChange={(e) => {
              const team = state.workflows.find((t) => t.id === e.target.value);
              if (team)
                onChange({
                  subplan: {
                    ...config,
                    teamName: team.name,
                    steps: instantiateTeam(
                      orderTeam(inheritTeamProfiles(team.steps, state.agents)),
                    ),
                  },
                });
            }}
          >
            <option value="">{config.teamName || 'Choisir une équipe…'}</option>
            {state.workflows.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <SubplanTeamButton step={step} state={state} dispatch={dispatch} onChange={onChange} />
        <small>Les prochaines itérations utiliseront cette composition.</small>
      </div>
      {issues.length > 0 && (
        <p className="subplan-warning subplan-wide-field" role="status">
          <AlertTriangle size={16} />
          {issues.join(' ')} Vous pouvez enregistrer cette carte ; son lancement reste bloqué.
        </p>
      )}
    </div>
  );
}

export function SubplanNavigation({
  feature,
  state,
  navigate,
  disabled,
}: {
  feature: Feature;
  state: StudioState;
  navigate: (id: string, stepId?: string) => void;
  disabled: boolean;
}) {
  const path = featurePath(state.features, feature.id),
    parent = path.at(-2);
  if (!parent || !feature.parent) return null;
  const card = parent.steps.find((s) => s.id === feature.parent!.stepId)!;
  const iterations = card.subplanState?.iterations ?? [],
    selected = iterations.find((i) => i.feature.id === feature.id),
    current = currentIteration(card);
  return (
    <nav className="subplan-navigation" aria-label="Navigation des sous-équipes">
      <div className="subplan-breadcrumb">
        {path.map((f, index) => (
          <span key={f.id}>
            {index > 0 && <ChevronRight size={13} aria-hidden="true" />}
            {f.id === feature.id ? (
              <span aria-current="page">{f.title}</span>
            ) : (
              <button disabled={disabled} onClick={() => navigate(f.id)}>
                {f.title}
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="subplan-location">
        <SubplanMark step={card} />
        <div className="subplan-location-title">
          <span className="subplan-card-kicker">SOUS-ÉQUIPE · NIVEAU {path.length - 1}</span>
          <strong>{card.subplan?.teamName || 'Sous-équipe'}</strong>
          <span className="subplan-location-status">
            {selected && (
              <span>
                Itération {selected.number} sur {iterations.length}
              </span>
            )}
            {selected && <IterationStatus iteration={selected} />}
          </span>
        </div>
        <label className="field subplan-iteration-picker">
          <span>Changer d’itération</span>
          <select
            aria-label="Itération de la sous-équipe"
            disabled={disabled}
            value={feature.id}
            onChange={(e) => navigate(e.target.value)}
          >
            {iterations.map((i) => (
              <option key={i.id} value={i.feature.id}>
                {i.number} · {i.title} · {iterationLabel(i)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="subplan-navigation-actions">
        <button
          className="button secondary small"
          disabled={disabled}
          onClick={() => navigate(parent.id, card.id)}
        >
          <ArrowLeft size={14} />
          Niveau précédent
        </button>
        <button
          className="button secondary small"
          disabled={disabled}
          onClick={() => navigate(path[0].id)}
        >
          <Home size={14} />
          Équipe de base
        </button>
        <button
          className="button secondary small"
          disabled={disabled}
          onClick={() => navigate(parent.id, card.id)}
        >
          <MessageSquare size={14} />
          Chat de l’orchestrateur
        </button>
        {current && current.feature.id !== feature.id && (
          <button
            className="button primary small subplan-return-current"
            disabled={disabled}
            onClick={() => navigate(current.feature.id)}
          >
            <ArrowRight size={14} />
            Revenir à l’itération active
          </button>
        )}
      </div>
      <p className="subplan-shared-budget">
        Budget commun à l’équipe de base : {executionCallCount(path[0])}
        {path[0].budget?.maxRuns
          ? ` / ${path[0].budget.maxRuns} appels.`
          : ' appels · sans limite.'}
      </p>
      {selected?.requiresRecheck && (
        <p className="subplan-warning" role="status">
          <AlertTriangle size={16} />
          Une correction ultérieure peut affecter ce résultat. Ajoutez une tâche de revalidation
          depuis l’orchestrateur.
        </p>
      )}
      {feature.status === 'completed' && (
        <p className="subplan-history-notice">
          <History size={16} aria-hidden="true" />
          Itération validée. Son historique est conservé ; pour la faire évoluer, ouvrez une
          nouvelle révision depuis le chat de l’orchestrateur.
        </p>
      )}
    </nav>
  );
}
function iterationLabel(i: SubplanIteration) {
  return i.cancelled
    ? 'Retirée du plan'
    : i.requiresRecheck
      ? 'À revérifier'
      : i.feature.status === 'completed'
        ? 'Validée'
        : i.feature.status === 'draft'
          ? 'À venir'
          : i.feature.status === 'running'
            ? 'En cours'
            : i.feature.status === 'awaiting_final_validation'
              ? 'Validation finale'
              : 'À valider';
}

function IterationStatus({ iteration: i }: { iteration: SubplanIteration }) {
  const tone = i.cancelled
    ? 'muted'
    : i.requiresRecheck
      ? 'warning'
      : i.feature.status === 'completed'
        ? 'complete'
        : i.feature.status === 'draft'
          ? 'muted'
          : 'active';
  return (
    <span className={`subplan-status ${tone}`}>
      {i.cancelled ? (
        <History size={12} />
      ) : i.requiresRecheck ? (
        <AlertTriangle size={12} />
      ) : i.feature.status === 'completed' ? (
        <Check size={12} />
      ) : (
        <span className="subplan-status-dot" />
      )}
      {iterationLabel(i)}
    </span>
  );
}

/** Show the task's mission first; preserve the complete agent context on demand. */
export function FeatureBrief({ feature, state }: { feature: Feature; state: StudioState }) {
  const parent = feature.parent && featurePath(state.features, feature.id).at(-2);
  const iteration = parent?.steps
    .find((s) => s.id === feature.parent?.stepId)
    ?.subplanState?.iterations.find((i) => i.feature.id === feature.id);
  if (!iteration)
    return (
      <>
        <p>{feature.description}</p>
        <ImageGallery images={feature.images} />
      </>
    );
  return (
    <div className="subplan-brief">
      <p className="subplan-mission">{iteration.description}</p>
      <details key={feature.id} className="subplan-context">
        <summary>Contexte transmis à la sous-équipe</summary>
        <p>{feature.description}</p>
      </details>
    </div>
  );
}

export function SubplanOverview({
  step,
  navigate,
  disabled = false,
}: {
  step: FeatureStep;
  navigate: (id: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  if (!step.subplan) return null;
  const iterations = step.subplanState?.iterations ?? [],
    issues = subplanIssues([step]),
    current = currentIteration(step),
    total = iterations.filter((i) => !i.cancelled).length,
    completed = iterations.filter(
      (i) => !i.cancelled && !i.requiresRecheck && i.feature.status === 'completed',
    ).length,
    rechecks = iterations.filter((i) => !i.cancelled && i.requiresRecheck).length;
  const visible = iterations.filter((i) => {
    const matches = searchText(`${i.number} ${i.title} ${i.description}`).includes(
      searchText(query),
    );
    return (
      matches &&
      (filter === 'all' ||
        (filter === 'pending' && !i.cancelled && i.feature.status !== 'completed') ||
        (filter === 'review' && !i.cancelled && i.requiresRecheck) ||
        (filter === 'history' && (i.cancelled || i.feature.status === 'completed')))
    );
  });
  return (
    <section className="subplan-overview" aria-label="Sous-tâches du plan">
      <header>
        <SubplanMark step={step} />
        <div className="subplan-overview-title">
          <span className="subplan-card-kicker">SOUS-TÂCHES ET ITÉRATIONS</span>
          <h3>{step.subplan.teamName || 'Sous-équipe à configurer'}</h3>
          <p>{step.subplan.mode === 'pair' ? 'Découpage accompagné' : 'Découpage automatique'}</p>
        </div>
        {!!total && (
          <div className="subplan-completion">
            <strong>
              {completed}
              <span> / {total}</span>
            </strong>
            <span>
              tâche{total > 1 ? 's' : ''} validée{total > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </header>
      {!!total && (
        <div
          className="subplan-progress"
          role="progressbar"
          aria-label="Tâches du sous-plan validées"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          aria-valuetext={`${completed} tâches validées sur ${total}`}
        >
          <span style={{ width: `${(100 * completed) / total}%` }} />
        </div>
      )}
      {issues.length > 0 && <p className="subplan-warning">{issues.join(' ')}</p>}
      {rechecks > 0 && (
        <p className="subplan-warning" role="status">
          <AlertTriangle size={16} />
          {rechecks} résultat{rechecks > 1 ? 's' : ''} à revérifier après une correction. Les
          anciennes validations restent dans l’historique.
        </p>
      )}
      {!iterations.length && (
        <p className="muted">
          Lancez l’orchestrateur pour préparer les tâches. Chaque tâche ouvrira ici sa propre
          sous-équipe.
        </p>
      )}
      {(iterations.length > 6 || query || filter !== 'all') && (
        <div className="subplan-history-tools">
          <label className="subplan-history-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label="Rechercher une itération"
              placeholder="Rechercher une tâche…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Filtrer les itérations"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Toutes les itérations ({iterations.length})</option>
            <option value="pending">En cours et à venir</option>
            <option value="review">À revérifier ({rechecks})</option>
            <option value="history">Historique</option>
          </select>
        </div>
      )}
      <div className="subplan-iterations" aria-label="Liste des itérations">
        {visible.map((i) => (
          <button
            key={i.id}
            type="button"
            disabled={disabled}
            className={`subplan-iteration ${i.id === current?.id ? 'is-current' : ''} ${i.cancelled ? 'is-cancelled' : ''} ${i.requiresRecheck ? 'needs-review' : ''}`}
            onClick={() => navigate(i.feature.id)}
          >
            <span className="subplan-iteration-number">{String(i.number).padStart(2, '0')}</span>
            <span className="subplan-iteration-content">
              {i.id === current?.id && (
                <span className="subplan-current-label">
                  {step.subplanState?.paused ? 'SOUS-PLAN EN PAUSE' : 'ITÉRATION ACTIVE'}
                </span>
              )}
              <strong>{i.title}</strong>
              <span className="subplan-iteration-meta">
                <IterationStatus iteration={i} />
                {i.corrects && (
                  <small>
                    Révision de l’itération{' '}
                    {iterations.find((previous) => previous.id === i.corrects)?.number ??
                      'précédente'}
                  </small>
                )}
              </span>
            </span>
            <span className="subplan-iteration-action">
              {i.feature.status === 'completed' || i.cancelled ? 'Consulter' : 'Ouvrir'}
              <ArrowRight size={16} aria-hidden="true" />
            </span>
          </button>
        ))}
        {!!iterations.length && !visible.length && (
          <div className="subplan-no-results" role="status">
            <p>Aucune itération ne correspond à ces critères.</p>
            <button
              className="text-button"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              Afficher toutes les itérations
            </button>
          </div>
        )}
      </div>
      {!!iterations.length && (
        <details className="subplan-history-help">
          <summary>Ajouter une tâche ou corriger un résultat</summary>
          <p>
            Demandez-le dans le chat de l’orchestrateur ci-dessous. Il reste ouvert jusqu’à la
            validation de l’ensemble. Une correction crée une nouvelle révision ; les résultats
            concernés sont signalés à revérifier.
          </p>
        </details>
      )}
    </section>
  );
}

function SubplanPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialogAccessibility(ref, onClose);
  return (
    <div className="subplan-modal-backdrop">
      <section
        className="subplan-config-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        {children}
      </section>
    </div>
  );
}
