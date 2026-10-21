import { executionCallCount } from '../src/core/budgets';
import { useState, useRef, type ReactNode } from 'react';
import { useDialogAccessibility } from './Ergonomics';
import { createPortal } from 'react-dom';
import { Layers3, AlertTriangle, ArrowLeft, Home, MessageSquare, X } from 'lucide-react';
import type {
  ClientMessage,
  Feature,
  FeatureStep,
  StudioState,
  WorkflowStep,
} from '../src/shared/types';
import { currentIteration, featurePath, subplanIssues } from '../src/shared/subplans';
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
export function SubplanSettings({
  step,
  state,
  dispatch,
  onChange,
}: {
  step: WorkflowStep;
  state: StudioState;
  dispatch: (m: ClientMessage) => void;
  onChange: (patch: Partial<WorkflowStep>) => void;
}) {
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
  const issues = subplanIssues([step]);
  return (
    <div className="subplan-settings">
      <label className="field">
        <span>Nom du sous-plan</span>
        <input value={step.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <label className="field">
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
      <p className="field-help">
        {config.mode === 'pair'
          ? 'Discutez le découpage dans le chat, puis validez les tâches avant de démarrer.'
          : 'L’orchestrateur prépare le découpage et lance la première sous-équipe.'}{' '}
        Chaque étape de la sous-équipe garde sa validation humaine, y compris le code avant les
        tests.
      </p>
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
                  steps: instantiateTeam(orderTeam(inheritTeamProfiles(team.steps, state.agents))),
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
      <button type="button" className="button secondary" onClick={edit}>
        <Layers3 size={16} />
        {config.steps.length ? 'Configurer la sous-équipe' : 'Choisir une équipe'}
      </button>
      <small>
        {config.steps.length} intervention{config.steps.length > 1 ? 's' : ''} · les prochaines
        itérations utiliseront cette composition.
      </small>
      {issues.length > 0 && (
        <p className="subplan-warning" role="status">
          <AlertTriangle size={16} />
          {issues.join(' ')} Vous pouvez enregistrer cette carte ; son lancement reste bloqué.
        </p>
      )}
      {open &&
        draft &&
        createPortal(
          <SubplanPanel title={`Sous-équipe de ${step.name}`} onClose={() => setOpen(false)}>
            <header>
              <div>
                <span className="eyebrow">SOUS-ÉQUIPE</span>
                <h2>{step.name}</h2>
                <p>
                  Ajoutez des agents et des sous-plans. Chaque carte conserve ses propres réglages.
                </p>
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
          </SubplanPanel>,
          document.body,
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
            {index > 0 && ' › '}
            <button disabled={disabled || f.id === feature.id} onClick={() => navigate(f.id)}>
              {f.title}
            </button>
          </span>
        ))}
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
        <label className="field">
          <span>Itération</span>
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
        {current && current.feature.id !== feature.id && (
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => navigate(current.feature.id)}
          >
            Revenir à l’itération active
          </button>
        )}
      </div>
      <p className="muted">
        Budget commun à l’équipe de base : {executionCallCount(path[0])} /{' '}
        {path[0].budget?.maxRuns ?? 10} appels.
      </p>
      {selected?.requiresRecheck && (
        <p className="subplan-warning">
          <AlertTriangle size={16} />
          Une correction ultérieure peut affecter ce résultat. Ajoutez une tâche de revalidation
          depuis l’orchestrateur.
        </p>
      )}
      {feature.status === 'completed' && (
        <p className="muted">
          Itération validée. Son historique est conservé ; pour la faire évoluer, ouvrez une
          nouvelle révision depuis le chat de l’orchestrateur.
        </p>
      )}
    </nav>
  );
}
function iterationLabel(i: NonNullable<FeatureStep['subplanState']>['iterations'][number]) {
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
            : 'À valider';
}
export function SubplanOverview({
  step,
  navigate,
}: {
  step: FeatureStep;
  navigate: (id: string) => void;
}) {
  if (!step.subplan) return null;
  const iterations = step.subplanState?.iterations ?? [],
    issues = subplanIssues([step]);
  return (
    <section className="subplan-overview" aria-label="Sous-tâches du plan">
      <header>
        <SubplanMark step={step} />
        <div>
          <h3>{step.subplan.teamName || 'Sous-équipe à configurer'}</h3>
          <p>
            {step.subplan.mode === 'pair' ? 'Découpage accompagné' : 'Découpage automatique'} ·{' '}
            {iterations.length} itération{iterations.length > 1 ? 's' : ''}
          </p>
        </div>
      </header>
      {issues.length > 0 && <p className="subplan-warning">{issues.join(' ')}</p>}
      {!iterations.length && (
        <p className="muted">
          Lancez l’orchestrateur pour préparer les tâches. Chaque tâche ouvrira ici sa propre
          sous-équipe.
        </p>
      )}
      <div className="subplan-iterations">
        {iterations.map((i) => (
          <button
            key={i.id}
            className={`subplan-iteration ${i.requiresRecheck ? 'needs-review' : ''}`}
            onClick={() => navigate(i.feature.id)}
          >
            <span className="subplan-iteration-number">{i.number}</span>
            <span>
              <strong>{i.title}</strong>
              <small>
                {iterationLabel(i)}
                {i.corrects ? ' · Révision liée' : ''}
              </small>
            </span>
            <span>Ouvrir →</span>
          </button>
        ))}
      </div>
      {!!iterations.length && (
        <p className="field-help">
          Le chat reste ouvert jusqu’à la validation de l’ensemble. Pour ajouter une tâche ou
          réviser une itération validée, expliquez-le à l’orchestrateur. Les résultats suivants
          concernés seront signalés à revérifier.
        </p>
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
