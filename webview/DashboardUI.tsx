import { progressLabel } from '../src/shared/optionalSteps';
import { useEffect, useId, useRef, useState } from 'react';
import { DashboardSecret, DragonBalls } from './SecretThemes';
import { useThemeAppearance } from './ThemePicker';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  ExternalLink,
  GitPullRequest,
  GripVertical,
  Maximize,
  Pause,
  Plus,
  RefreshCw,
  Route,
  Settings2,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  currentDashboardStep,
  dashboardAgentId,
  dashboardAttention,
  dashboardFeatures,
  dashboardKinds,
  dashboardLabels,
  defaultDashboardConfig,
  newDashboardModule,
  type DashboardConfig,
  type DashboardModule,
  type DashboardState,
} from '../src/shared/dashboard';
import type { AccountCredits } from '../src/shared/credits';
import { formatCredits, toCredits } from '../src/shared/credits';
import type { ClientMessage, Feature, StepStatus, StudioState } from '../src/shared/types';
import { AccountCreditsBadge } from './AccountCreditsBadge';
import { Avatar } from './Avatar';
import { useDialogAccessibility } from './Ergonomics';
import { isDemo, send, subscribe } from './bridge';
import { demoState } from './demo';
import './dashboard.css';

const labels: Record<StepStatus, string> = {
  pending: 'À venir',
  running: 'En cours',
  waiting_input: 'Attend ta réponse',
  awaiting_review: 'À valider',
  approved: 'Validée',
  skipped: 'Passée',
  failed: 'Échec',
  cancelled: 'Annulée',
  stale: 'À actualiser',
  interrupted: 'Interrompue',
};
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Pas encore actualisé';
function elapsed(start: string | undefined, now: number) {
  if (!start || !Number.isFinite(Date.parse(start))) return '';
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function useDashboard() {
  const [state, setState] = useState<DashboardState>({
    revision: 0,
    config: defaultDashboardConfig(),
    data: {},
  });
  const [pending, setPending] = useState<string>();
  const pendingRequest = useRef<string | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'dashboardState') setState(message.state);
        if (message.type === 'dashboardSaved' && message.requestId === pendingRequest.current) {
          pendingRequest.current = undefined;
          setPending(undefined);
          setError(message.error ?? '');
        }
      }),
    [],
  );
  const save = (config: DashboardConfig) => {
    if (pending) return;
    if (isDemo) {
      setState((s) => ({ ...s, config, revision: s.revision + 1 }));
      return;
    }
    const requestId = crypto.randomUUID();
    pendingRequest.current = requestId;
    setPending(requestId);
    setError('');
    send({ type: 'dashboardSave', config, revision: state.revision, requestId });
  };
  return { state, save, pending: Boolean(pending), error };
}

export function DashboardWindow() {
  const [state, setState] = useState<StudioState | null>(isDemo ? demoState : null);
  const [credits, setCredits] = useState<AccountCredits>();
  const [error, setError] = useState('');
  useEffect(() => {
    const cleanup = subscribe((message) => {
      if (message.type === 'state') setState(message.state);
      else if (message.type === 'accountCredits') setCredits(message.state);
      else if (message.type === 'error') setError(message.message);
    });
    send({ type: 'ready' });
    return cleanup;
  }, []);
  return (
    <div className="control-window">
      {error && (
        <p role="alert" className="dashboard-error">
          {error}
        </p>
      )}
      {state ? (
        <DashboardUI studio={state} credits={credits} detached dispatch={send} />
      ) : (
        <p role="status">Connexion au cockpit…</p>
      )}
    </div>
  );
}

export function DashboardUI({
  studio,
  credits,
  detached = false,
  dispatch,
}: {
  studio: StudioState;
  credits?: AccountCredits;
  detached?: boolean;
  dispatch: (message: ClientMessage) => void;
}) {
  const { state, save, pending, error } = useDashboard();
  const { family } = useThemeAppearance();
  const config = state.config;
  const [customize, setCustomize] = useState(false),
    [editing, setEditing] = useState<DashboardModule>();
  const [kind, setKind] = useState<(typeof dashboardKinds)[number]>('sessions');
  const [dragged, setDragged] = useState<string>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    send({ type: 'dashboardVisible', visible: true });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      send({ type: 'dashboardVisible', visible: false });
    };
  }, []);
  const replace = (module: DashboardModule) =>
    save({ ...config, modules: config.modules.map((m) => (m.id === module.id ? module : m)) });
  const move = (id: string, index: number) => {
    const modules = [...config.modules],
      from = modules.findIndex((m) => m.id === id);
    if (from < 0 || index < 0 || index >= modules.length || from === index) return;
    const [item] = modules.splice(from, 1);
    modules.splice(index, 0, item);
    save({ ...config, modules });
  };
  const open = (feature: Feature, stepId?: string) =>
    dispatch({ type: 'dashboardOpen', featureId: feature.id, stepId });
  const projects = studio.projectCatalog?.projects.filter((p) => !p.hidden) ?? [];
  return (
    <div className={`page overview-page ${detached ? 'control-mode' : ''}`}>
      <DashboardSecret />
      {family === 'dragonball' && (
        <section className="dragon-hero" aria-label="Le dojo des légendes">
          <div className="dragon-hero-copy">
            <span className="eyebrow">CAPSULE CORP · FEATURE STUDIO</span>
            <h2>
              Le dojo
              <br />
              <em>des légendes.</em>
            </h2>
            <p>
              Entraîne ton équipe. Concentre ton ki.
              <br />
              La prochaine transformation commence ici.
            </p>
            <DragonBalls />
          </div>
          <span className="dragon-hero-stamp" aria-hidden="true">
            悟
          </span>
        </section>
      )}
      <header className="overview-heading">
        <div>
          <span className="eyebrow">{detached ? 'TOUR DE CONTRÔLE' : 'SUIVI DES PROJETS'}</span>
          <h1>{detached ? 'Feature Studio · Dashboard' : 'Chaque session, à sa station.'}</h1>
          <p>Les agents avancent. Les décisions restent à portée de main.</p>
        </div>
        <div className="overview-actions">
          <button
            className="button secondary"
            onClick={() => dispatch({ type: detached ? 'dashboardFullscreen' : 'dashboardDetach' })}
          >
            {detached ? <Maximize size={16} /> : <ExternalLink size={16} />}{' '}
            {detached ? 'Plein écran' : 'Ouvrir dans une nouvelle fenêtre'}
          </button>
          {detached && (
            <button
              className="button secondary"
              onClick={() => dispatch({ type: 'dashboardOpen' })}
            >
              Revenir au cockpit <ArrowUpRight size={16} />
            </button>
          )}
          <button
            className="button secondary"
            aria-pressed={customize}
            onClick={() => setCustomize((v) => !v)}
          >
            <Settings2 size={16} /> Personnaliser
          </button>
        </div>
      </header>
      <div className="overview-toolbar">
        <label>
          Projet
          <select
            aria-label="Projet du dashboard"
            value={config.projectIds[0] ?? ''}
            disabled={pending}
            onChange={(e) =>
              save({ ...config, projectIds: e.target.value ? [e.target.value] : [] })
            }
          >
            <option value="">Tous les projets</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Actualisation Azure
          <select
            aria-label="Fréquence d’actualisation"
            value={config.refreshSeconds}
            disabled={pending}
            onChange={(e) => save({ ...config, refreshSeconds: Number(e.target.value) })}
          >
            {[0, 15, 30, 60, 120, 300].map((s) => (
              <option key={s} value={s}>
                {s === 0
                  ? 'Manuelle'
                  : s < 60
                    ? `${s} secondes`
                    : `${s / 60} minute${s > 60 ? 's' : ''}`}
              </option>
            ))}
          </select>
        </label>
        <span className="overview-live">
          <span /> Sessions en direct
        </span>
        <button
          className="button secondary"
          disabled={Object.values(state.data).some((d) => d.loading)}
          onClick={() => dispatch({ type: 'dashboardRefresh' })}
        >
          <RefreshCw size={15} /> Actualiser
        </button>
      </div>
      {(error || state.error) && (
        <p className="dashboard-error" role="alert">
          {error || state.error}
        </p>
      )}
      {customize && (
        <section className="dashboard-customize" aria-label="Personnalisation du dashboard">
          <label>
            Nouveau module
            <select
              aria-label="Type de module"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {dashboardKinds.map((k) => (
                <option key={k} value={k}>
                  {dashboardLabels[k]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={pending || config.modules.length >= 24}
            onClick={() =>
              save({
                ...config,
                modules: [...config.modules, newDashboardModule(kind, crypto.randomUUID())],
              })
            }
          >
            <Plus size={16} /> Ajouter un module
          </button>
          <p>
            Déplace les modules par leur poignée ou avec les flèches. Les réglages permettent de
            changer leur taille, leur titre et leurs filtres. Jusqu’à 24 modules.
          </p>
          {pending && <span role="status">Enregistrement…</span>}
        </section>
      )}
      {!config.modules.length && (
        <div className="dashboard-empty">
          Ton dashboard est vide. Personnalise-le pour ajouter tes premiers modules.
        </div>
      )}
      <div className="overview-grid">
        {config.modules.map((module, index) => {
          const features = dashboardFeatures(studio.features, config, module),
            data = state.data[module.id];
          return (
            <section
              className={`overview-module module-${module.kind} span-${detached ? module.controlSpan : module.span}`}
              key={module.id}
              aria-label={module.title}
              style={module.height ? { height: module.height } : undefined}
              onDragOver={(e) => {
                if (customize && dragged) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged) move(dragged, index);
                setDragged(undefined);
              }}
              onPointerUp={(e) => {
                if (!customize || pending) return;
                const element = e.currentTarget,
                  explicit = parseInt(element.style.height, 10);
                if (explicit && Math.abs(explicit - module.height) > 3)
                  replace({ ...module, height: Math.max(180, Math.min(1600, explicit)) });
              }}
              data-resizable={customize || undefined}
            >
              <header className="overview-module-heading">
                {customize && (
                  <span
                    className="dashboard-grip"
                    draggable={!pending}
                    onDragStart={() => setDragged(module.id)}
                    onDragEnd={() => setDragged(undefined)}
                    title="Déplacer le module"
                  >
                    <GripVertical size={17} />
                  </span>
                )}
                {module.kind === 'sessions' ? (
                  <Route size={17} />
                ) : module.kind === 'attention' ? (
                  <TriangleAlert size={17} />
                ) : module.kind === 'prs' ? (
                  <GitPullRequest size={17} />
                ) : null}
                <h2>{module.title}</h2>
                <button
                  className="icon-button"
                  aria-label={`Réglages de ${module.title}`}
                  disabled={pending}
                  onClick={() => setEditing(structuredClone(module))}
                >
                  <Settings2 size={16} />
                </button>
              </header>
              {customize && (
                <div className="dashboard-module-tools">
                  <button
                    className="icon-button"
                    aria-label={`Monter ${module.title}`}
                    disabled={pending || index === 0}
                    onClick={() => move(module.id, index - 1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Descendre ${module.title}`}
                    disabled={pending || index === config.modules.length - 1}
                    onClick={() => move(module.id, index + 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Dupliquer ${module.title}`}
                    disabled={pending || config.modules.length >= 24}
                    onClick={() =>
                      save({
                        ...config,
                        modules: [
                          ...config.modules.slice(0, index + 1),
                          {
                            ...structuredClone(module),
                            id: crypto.randomUUID(),
                            title: `${module.title.slice(0, 90)} · copie`,
                          },
                          ...config.modules.slice(index + 1),
                        ],
                      })
                    }
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Retirer ${module.title}`}
                    disabled={pending}
                    onClick={() =>
                      save({ ...config, modules: config.modules.filter((m) => m.id !== module.id) })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
              <div className="overview-module-body">
                {module.filters.projectIds.length > 0 && (
                  <p className="dashboard-scope">
                    {module.filters.projectIds
                      .map((id) => projects.find((p) => p.id === id)?.name ?? 'Projet indisponible')
                      .join(', ')}
                  </p>
                )}
                {module.kind === 'sessions' && (
                  <>
                    {features.length === 0 && <Empty>Pas de session pour ces filtres.</Empty>}
                    {features.map((feature) => (
                      <SessionMetro
                        key={feature.id}
                        feature={feature}
                        studio={studio}
                        now={now}
                        onOpen={(step) => open(feature, step)}
                      />
                    ))}
                  </>
                )}
                {module.kind === 'attention' && (
                  <>
                    {features
                      .filter(
                        (f) =>
                          dashboardAttention(f) ||
                          studio.humanRequests?.some((r) => r.featureId === f.id),
                      )
                      .map((feature) => {
                        const request = studio.humanRequests?.find(
                            (r) => r.featureId === feature.id,
                          ),
                          step =
                            feature.steps.find((s) => s.id === request?.stepId) ??
                            feature.steps.find((s) =>
                              [
                                'waiting_input',
                                'awaiting_review',
                                'failed',
                                'stale',
                                'interrupted',
                              ].includes(s.status),
                            );
                        return (
                          <div className="dashboard-attention-row" key={feature.id}>
                            <span className="eyebrow">
                              {request
                                ? 'RÉPONSE ATTENDUE'
                                : feature.status === 'awaiting_final_validation'
                                  ? 'VALIDATION FINALE'
                                  : step
                                    ? labels[step.status]
                                    : 'À TRAITER'}
                            </span>
                            <strong>{feature.title}</strong>
                            <p>{step?.name ?? 'Le parcours attend ta validation.'}</p>
                            <button
                              className="button secondary"
                              onClick={() => open(feature, step?.id)}
                            >
                              Voir la session <ArrowUpRight size={14} />
                            </button>
                          </div>
                        );
                      })}
                    {!features.some(
                      (f) =>
                        dashboardAttention(f) ||
                        studio.humanRequests?.some((r) => r.featureId === f.id),
                    ) && <Empty>Aucune intervention à prévoir pour ces sessions.</Empty>}
                  </>
                )}
                {(module.kind === 'tickets' || module.kind === 'prs') && (
                  <>
                    {!data && (
                      <Empty>
                        {isDemo
                          ? 'Connecte un projet Azure DevOps dans le cockpit pour afficher ses données.'
                          : 'En attente de la première actualisation…'}
                      </Empty>
                    )}
                    {data && (
                      <>
                        <p className="dashboard-freshness" role="status">
                          {data.loading ? 'Actualisation…' : date(data.updatedAt)}
                          {data.errors.length > 0 && data.updatedAt ? ' · données à vérifier' : ''}
                        </p>
                        {data.errors.map((error, i) => (
                          <p key={i} className="dashboard-error">
                            <TriangleAlert size={14} /> {error}
                          </p>
                        ))}
                        {data.partial && (
                          <p className="dashboard-limit">
                            Résultats partiels. Affine les filtres ou consulte la page complète.
                          </p>
                        )}
                        {module.kind === 'tickets'
                          ? data.tickets.map(({ item, projectId, projectName }) => (
                              <div className="dashboard-list-row" key={`${projectId}:${item.id}`}>
                                <div>
                                  <small>
                                    {projectName} · #{item.id} · {item.workItemType ?? 'Ticket'}
                                  </small>
                                  <strong>{item.title}</strong>
                                  <span>
                                    {item.state} · {item.assignedTo || 'Non assigné'}
                                  </span>
                                </div>
                                <button
                                  className="icon-button"
                                  aria-label={`Ouvrir le ticket ${item.id}`}
                                  onClick={() =>
                                    dispatch({
                                      type: 'dashboardOpen',
                                      projectId,
                                      page: 'devops-tickets',
                                      ticketId: item.id,
                                    })
                                  }
                                >
                                  <ArrowUpRight size={17} />
                                </button>
                              </div>
                            ))
                          : data.prs.map(({ item, projectId, projectName }) => (
                              <div className="dashboard-list-row" key={`${projectId}:${item.id}`}>
                                <div>
                                  <small>
                                    {projectName} · PR #{item.id} ·{' '}
                                    {item.isDraft ? 'Brouillon' : item.status}
                                  </small>
                                  <a href={item.url} target="_blank" rel="noreferrer">
                                    {item.title} <ArrowUpRight size={13} />
                                  </a>
                                  <span>
                                    {item.createdBy || 'Auteur inconnu'} · {item.sourceBranch} →{' '}
                                    {item.targetBranch}
                                  </span>
                                </div>
                              </div>
                            ))}
                        {!data.loading &&
                          !data.errors.length &&
                          !data.tickets.length &&
                          !data.prs.length && <Empty>Aucun résultat pour ces filtres.</Empty>}
                      </>
                    )}
                    <button
                      className="text-button"
                      onClick={() =>
                        dispatch({
                          type: 'dashboardOpen',
                          projectId: module.filters.projectIds[0] ?? config.projectIds[0],
                          page: module.kind === 'tickets' ? 'devops-tickets' : 'devops-prs',
                        })
                      }
                    >
                      Ouvrir {module.kind === 'tickets' ? 'Tickets' : 'les PR'}{' '}
                      <ArrowUpRight size={14} />
                    </button>
                  </>
                )}
                {module.kind === 'usage' && <UsageModule features={features} credits={credits} />}
                {module.kind === 'activity' && (
                  <>
                    {features.slice(0, 20).map((feature) => {
                      const step = currentDashboardStep(feature),
                        attempt = step?.attempts.at(-1);
                      return (
                        <button
                          className="dashboard-activity"
                          key={feature.id}
                          onClick={() => open(feature, step?.id)}
                        >
                          <time>{date(feature.updatedAt)}</time>
                          <span>
                            <strong>{feature.title}</strong>
                            <span>
                              {attempt?.agentName ?? step?.name ?? 'Session'} ·{' '}
                              {step ? labels[step.status] : 'Équipe à choisir'}
                            </span>
                          </span>
                          <ArrowUpRight size={14} />
                        </button>
                      );
                    })}
                    {!features.length && <Empty>Aucune activité pour ces filtres.</Empty>}
                    {features.length > 20 && (
                      <p className="dashboard-limit">
                        Les 20 sessions les plus récemment mises à jour.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="dashboard-legend">
        <Check size={13} /> Étape validée <span className="legend-active">●</span> Agent actif{' '}
        <Pause size={13} /> Attend ton avis <Circle size={13} /> À venir <X size={13} /> Échec
      </p>
      {editing && (
        <ModuleEditor
          module={editing}
          studio={studio}
          onClose={() => setEditing(undefined)}
          onSave={(module) => {
            replace(module);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="dashboard-empty">{children}</p>;
}
function SessionMetro({
  feature,
  studio,
  now,
  onOpen,
}: {
  feature: Feature;
  studio: StudioState;
  now: number;
  onOpen: (step?: string) => void;
}) {
  const current = currentDashboardStep(feature),
    attempt = current?.attempts.at(-1),
    agent = studio.agents.find((a) => a.id === dashboardAgentId(feature));
  return (
    <article className="session-metro" aria-label={feature.title}>
      <div className="metro-title">
        <div>
          <small>
            {feature.projects?.map((p) => p.name).join(' · ') || studio.workspace.name}
            {feature.ticketSource ? ` · #${feature.ticketSource.ticketId}` : ''}
          </small>
          <button className="text-button" onClick={() => onOpen(current?.id)}>
            {feature.title} <ArrowUpRight size={14} />
          </button>
        </div>
        <span className={`metro-status status-${current?.status ?? 'pending'}`}>
          {feature.status === 'completed'
            ? 'Terminée'
            : feature.optionalRequest
              ? 'Choix facultatif attendu'
              : current
                ? labels[current.status]
                : 'Équipe à choisir'}
        </span>
      </div>
      <ol className="metro-track" aria-label="Étapes de la session">
        {feature.steps.map((step) => (
          <li
            key={step.id}
            className={`station-${step.status} ${step.id === current?.id ? 'station-current' : ''}`}
          >
            <button
              aria-label={`${step.name} : ${labels[step.status]}`}
              onClick={() => onOpen(step.id)}
            >
              <span className="metro-dot">
                {step.status === 'approved' ? (
                  <Check size={12} />
                ) : ['failed', 'interrupted'].includes(step.status) ? (
                  <X size={12} />
                ) : ['waiting_input', 'awaiting_review'].includes(step.status) ? (
                  <Pause size={11} />
                ) : null}
              </span>
              <span>{step.name}</span>
            </button>
          </li>
        ))}
      </ol>
      <footer className="metro-agent">
        <Avatar
          agent={agent ?? (current ? { id: current.agentId } : undefined)}
          status={current?.status}
          small
        />
        <div>
          <strong>
            {attempt?.agentName ??
              agent?.nickname ??
              agent?.name ??
              current?.agentId ??
              'Équipe à composer'}
          </strong>
          <span>{current?.name ?? 'Choisis les agents dans la session.'}</span>
        </div>
        <div className="metro-progress">
          <span>{progressLabel(feature)}</span>
          <small>
            {current?.status === 'running'
              ? `en cours · ${elapsed(attempt?.startedAt, now) || 'durée indisponible'}`
              : ['waiting_input', 'awaiting_review'].includes(current?.status ?? '')
                ? `en attente · ${elapsed(attempt?.finishedAt ?? feature.updatedAt, now)}`
                : ''}
          </small>
        </div>
      </footer>
    </article>
  );
}
function UsageModule({ features, credits }: { features: Feature[]; credits?: AccountCredits }) {
  const usages = features.flatMap((f) => f.steps.flatMap((s) => s.attempts.map((a) => a.usage)));
  const measured = usages.filter(
    (u) => u?.source === 'measured' && u.unit === 'nano-AIU' && typeof u.cost === 'number',
  );
  const total = measured.reduce((sum, u) => sum + (u?.cost ?? 0), 0);
  return (
    <div className="dashboard-usage">
      <span className="eyebrow">ABONNEMENT GLOBAL GITHUB COPILOT</span>
      <AccountCreditsBadge credits={credits} />
      <p>Le quota concerne tout le compte, quel que soit le projet filtré.</p>
      <hr />
      <span>Sessions sélectionnées</span>
      <strong>
        {measured.length
          ? `${formatCredits(toCredits(total))} crédits mesurés`
          : 'Crédits non communiqués'}
      </strong>
      <small>
        {features.length} sessions · {measured.length} tentatives mesurées sur {usages.length}
        {measured.length < usages.length || measured.some((u) => u?.incompleteCost)
          ? ' · mesure partielle'
          : ''}
      </small>
    </div>
  );
}

function ModuleEditor({
  module,
  studio,
  onSave,
  onClose,
}: {
  module: DashboardModule;
  studio: StudioState;
  onSave: (module: DashboardModule) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(module),
    ref = useRef<HTMLDivElement>(null),
    id = useId();
  useDialogAccessibility(ref, onClose);
  const f = draft.filters;
  const filter = (patch: Partial<typeof f>) =>
    setDraft((d) => ({ ...d, filters: { ...d.filters, ...patch } }));
  const ticket = (patch: Partial<typeof f.tickets>) =>
    filter({ tickets: { ...f.tickets, ...patch } });
  const projects = studio.projectCatalog?.projects.filter((p) => !p.hidden) ?? [];
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal dashboard-module-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2 id={id}>Réglages du module</h2>
          <button className="icon-button" aria-label="Fermer" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
          }}
        >
          <label>
            Titre
            <input
              required
              maxLength={100}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="dashboard-editor-grid">
            <label>
              Largeur Métro
              <select
                value={draft.span}
                onChange={(e) => setDraft({ ...draft, span: Number(e.target.value) as 4 | 6 | 12 })}
              >
                <option value={4}>Un tiers</option>
                <option value={6}>La moitié</option>
                <option value={12}>Toute la largeur</option>
              </select>
            </label>
            <label>
              Largeur Tour de contrôle
              <select
                value={draft.controlSpan}
                onChange={(e) =>
                  setDraft({ ...draft, controlSpan: Number(e.target.value) as 4 | 6 | 12 })
                }
              >
                <option value={4}>Un tiers</option>
                <option value={6}>La moitié</option>
                <option value={12}>Toute la largeur</option>
              </select>
            </label>
            <label>
              Hauteur
              <select
                value={draft.height}
                onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })}
              >
                <option value={0}>Automatique</option>
                <option value={280}>Compacte</option>
                <option value={440}>Standard</option>
                <option value={640}>Grande</option>
                {![0, 280, 440, 640].includes(draft.height) && (
                  <option value={draft.height}>{draft.height} px</option>
                )}
              </select>
            </label>
          </div>
          <label>
            Projet du module
            <select
              value={f.projectIds[0] ?? ''}
              onChange={(e) => filter({ projectIds: e.target.value ? [e.target.value] : [] })}
            >
              <option value="">Suivre le filtre global</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {draft.kind === 'tickets' ? (
            <>
              <label>
                Titre ou numéro de ticket
                <input
                  maxLength={500}
                  value={f.tickets.query}
                  onChange={(e) => ticket({ query: e.target.value })}
                />
              </label>
              <TicketListInput
                label="Types (séparés par ;)"
                values={f.tickets.types}
                onChange={(values) => ticket({ types: values })}
              />
              <TicketListInput
                label="États (séparés par ;)"
                values={f.tickets.states}
                onChange={(values) => ticket({ states: values })}
              />
              <label>
                Assignation
                <select
                  value={f.tickets.assignment}
                  onChange={(e) =>
                    ticket({ assignment: e.target.value as typeof f.tickets.assignment })
                  }
                >
                  <option value="all">Tout le monde</option>
                  <option value="me">Moi</option>
                  <option value="unassigned">Non assignés</option>
                  <option value="identity">Une personne</option>
                </select>
              </label>
              {f.tickets.assignment === 'identity' && (
                <label>
                  Identité Azure DevOps
                  <input
                    required
                    maxLength={500}
                    value={f.tickets.identity}
                    onChange={(e) => ticket({ identity: e.target.value })}
                  />
                </label>
              )}
              <TicketListInput
                label="Tags (séparés par ;)"
                values={f.tickets.tags}
                onChange={(values) => ticket({ tags: values })}
              />
              <label>
                Zone
                <input
                  maxLength={500}
                  value={f.tickets.areaPath}
                  onChange={(e) => ticket({ areaPath: e.target.value })}
                />
              </label>
              <label>
                Sprint / itération
                <input
                  maxLength={500}
                  value={f.tickets.iterationPath}
                  onChange={(e) => ticket({ iterationPath: e.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Recherche
                <input
                  maxLength={500}
                  value={f.query}
                  onChange={(e) => filter({ query: e.target.value })}
                />
              </label>
              <label>
                État
                <select value={f.status} onChange={(e) => filter({ status: e.target.value })}>
                  {(draft.kind === 'prs'
                    ? [
                        ['all', 'Tous'],
                        ['active', 'Actives'],
                        ['completed', 'Terminées'],
                        ['abandoned', 'Abandonnées'],
                      ]
                    : [
                        ['all', 'Toutes les sessions'],
                        ['active', 'Non terminées'],
                        ['running', 'En cours'],
                        ['attention', 'À votre tour'],
                        ['awaiting_final_validation', 'Validation finale'],
                        ['draft', 'À démarrer'],
                        ['completed', 'Terminées'],
                      ]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {draft.kind === 'prs' ? (
                <>
                  <label>
                    Auteur
                    <input
                      maxLength={500}
                      value={f.author}
                      onChange={(e) => filter({ author: e.target.value })}
                    />
                  </label>
                  <label>
                    Relecteur
                    <input
                      maxLength={500}
                      value={f.reviewer}
                      onChange={(e) => filter({ reviewer: e.target.value })}
                    />
                  </label>
                  <label>
                    Brouillons
                    <select
                      value={f.draft}
                      onChange={(e) => filter({ draft: e.target.value as typeof f.draft })}
                    >
                      <option value="all">Tous</option>
                      <option value="yes">Brouillons uniquement</option>
                      <option value="no">Exclure les brouillons</option>
                    </select>
                  </label>
                </>
              ) : (
                <label>
                  Agent courant
                  <select value={f.agentId} onChange={(e) => filter({ agentId: e.target.value })}>
                    <option value="">Tous les agents</option>
                    {[
                      ...new Set([
                        ...studio.agents.map((a) => a.id),
                        ...studio.features.flatMap((f) => f.steps.map((s) => s.agentId)),
                      ]),
                    ].map((agentId) => (
                      <option key={agentId} value={agentId}>
                        {studio.agents.find((a) => a.id === agentId)?.name ?? agentId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="button primary" disabled={!draft.title.trim()}>
              Appliquer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function TicketListInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [raw, setRaw] = useState(values.join('; '));
  return (
    <label>
      {label}
      <input
        maxLength={2000}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(
            e.target.value
              .split(';')
              .map((v) => v.trim())
              .filter(Boolean),
          );
        }}
      />
    </label>
  );
}
