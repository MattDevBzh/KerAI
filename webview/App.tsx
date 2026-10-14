import { ObservationPanel, TraceStorageSetting, TraceJournal } from './ObservationUI';
import { usageCredits } from '../src/shared/credits';
import { CorrectionPanel, ReportEditor, FinalSummary } from './CollaborationUI';
import { featureStateKey, finalValidationReady } from '../src/shared/collaboration';
import { ThemePicker } from './ThemePicker';
import { KitsUI } from './KitsUI';
import { UsageDashboard } from './UsageDashboard';
import { ProfileScopeSelector, profileOptions, useProfileSave } from './ProfileScope';
import type { ProfileSaveOptions, ProfileScope } from '../src/shared/profiles';
import {
  ROAST_LEVELS,
  normalizeRoastLevel,
  roastInstructions,
  roastLabel,
  type RoastLevel,
} from '../src/shared/roast';
import { DevOpsUI, DevOpsFeatureLinks } from './DevOpsUI';
import { DevOpsDashboard } from './DevOpsDashboard';
import type { DevOpsState } from '../src/shared/devops';
import { approvalBlockers, featureCompletionBlockers } from '../src/core/validation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BarChart3,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Archive,
  Bot,
  BookOpen,
  BrainCircuit,
  FileCheck2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  Command,
  ExternalLink,
  Eye,
  Trash2,
  FileCode2,
  FileText,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Tickets,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  MessageSquare,
  Play,
  Plus,
  Package,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
  WandSparkles,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AgentProfile,
  ClientMessage,
  Feature,
  FeatureStep,
  SkillInfo,
  StepStatus,
  StudioSettings,
  StudioState,
  Workflow as WorkflowType,
} from '../src/shared/types';
import { initialView, isDemo, isHosted, persistView, send, subscribe } from './bridge';
import { demoState } from './demo';
import { QualityCommandFields, QualitySetup } from './QualityUI';
import { LaunchDialog, HumanRequests, McpSettings, McpPicker } from './ExecutionUI';
import './evolution.css';
import {
  GitWorkspacePanel,
  WorkspaceChoice,
  hasActiveRun,
  AttemptCheckpointLinks,
} from './GitWorkspaceUI';
import {
  AutopilotBar,
  BudgetMeter,
  ModelBudgetSettings,
  EvidencePanel,
  ValidationCenter,
  ReviewWorkspace,
  ProjectMemoryView,
  WorkflowLibrary,
  attentionCount,
} from './StudioUI';

type View =
  | 'kits'
  | 'usage'
  | 'devops'
  | 'devops-prs'
  | 'devops-tickets'
  | 'delivery'
  | 'dashboard'
  | 'validation'
  | 'workflows'
  | 'memory'
  | 'agents'
  | 'skills'
  | 'automations'
  | 'settings';
const statuses: Record<StepStatus, { label: string; tone: string }> = {
  pending: { label: 'À venir', tone: 'neutral' },
  running: { label: 'En cours', tone: 'lavender' },
  waiting_input: { label: 'Votre réponse', tone: 'apricot' },
  awaiting_review: { label: 'À valider', tone: 'apricot' },
  approved: { label: 'Validée', tone: 'green' },
  failed: { label: 'Échec', tone: 'coral' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
  stale: { label: 'À actualiser', tone: 'apricot' },
  interrupted: { label: 'Interrompue', tone: 'coral' },
};
const featureStatus: Record<Feature['status'], { label: string; tone: string }> = {
  draft: { label: 'À démarrer', tone: 'neutral' },
  running: { label: 'En cours', tone: 'lavender' },
  attention: { label: 'À votre tour', tone: 'apricot' },
  awaiting_final_validation: { label: 'Dernière validation', tone: 'apricot' },
  completed: { label: 'Terminée', tone: 'green' },
};
const policyLabels = {
  'read-only': 'Lecture seule',
  'workspace-write': 'Écriture dans le projet',
  tests: 'Exécution des tests autorisés',
};
const date = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const nav = [
  { id: 'devops', label: 'Azure DevOps', icon: FolderGit2 },
  { id: 'devops-prs', label: 'PR', icon: GitPullRequest },
  { id: 'devops-tickets', label: 'Tickets', icon: Tickets },
  { id: 'delivery', label: 'Livraison', icon: GitBranch },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'usage', label: 'Consommation', icon: BarChart3 },
  { id: 'validation', label: 'Validation', icon: FileCheck2 },
  { id: 'workflows', label: 'Parcours', icon: Workflow },
  { id: 'kits', label: 'Kits', icon: Package },
  { id: 'memory', label: 'Mémoire', icon: BrainCircuit },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'automations', label: 'Automatisations', icon: Zap },
  { id: 'settings', label: 'Réglages', icon: Settings2 },
] as const;
const workflowRank = (w: WorkflowType) => ({ feature: 0, 'code-review': 1, single: 2 })[w.id] ?? 3;
const orderedWorkflows = (items: WorkflowType[]) =>
  [...items].sort((a, b) => workflowRank(a) - workflowRank(b));
function WorkflowIcon({ workflow }: { workflow: WorkflowType }) {
  return workflow.id === 'feature' ? (
    <Sparkles size={19} />
  ) : workflow.id === 'code-review' ? (
    <Code2 size={19} />
  ) : workflow.id === 'single' ? (
    <MessageSquare size={19} />
  ) : (
    <Workflow size={19} />
  );
}
function Badge({ label, tone = 'neutral' }: { label: string; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <span />
      {label}
    </span>
  );
}
function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <Sparkles />}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, [tabindex="0"]',
        ) ?? [],
      ).filter((e) => !e.hasAttribute('disabled'));
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const nodes = focusables();
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Fermer" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [devops, setDevops] = useState<DevOpsState>({
    authenticated: false,
    busy: false,
    notices: [],
    tickets: [],
    pullRequests: [],
    links: [],
    history: [],
  });
  const [state, setState] = useState<StudioState | null>(
    isDemo ? structuredClone(demoState) : null,
  );
  const [view, setView] = useState<View>(
    (nav.some((n) => n.id === initialView.view) ? initialView.view : 'dashboard') as View,
  );
  const [featureId, setFeatureId] = useState(initialView.featureId ?? '');
  const [stepId, setStepId] = useState(initialView.stepId ?? '');
  const [observerRequested, setObserverRequested] = useState(false);
  const [create, setCreate] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const draftDirtyRef = useRef(false);
  const updateDraftDirty = (value: boolean) => {
    draftDirtyRef.current = value;
    setDraftDirty(value);
  };
  const [workflowId, setWorkflowId] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: () => void;
  } | null>(null);
  const [agentEditor, setAgentEditor] = useState<AgentProfile | 'new' | null>(null);
  const [skillEditor, setSkillEditor] = useState<SkillInfo | 'new' | null>(null);
  useEffect(() => {
    const cleanup = subscribe((message) => {
      if (message.type === 'state') setState(message.state);
      else if (message.type === 'devopsState') setDevops(message.state);
      else if (message.type === 'error' || message.type === 'notice')
        setNotice({ text: message.message, error: message.type === 'error' });
      else if (message.type === 'deleteFeatureResult') {
        if (message.error) setNotice({ text: message.error, error: true });
        else if (message.freedBytes !== undefined) {
          setFeatureId('');
          setNotice({
            text: `Session supprimée · ${(message.freedBytes / 1024 ** 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mio libérés.`,
          });
        }
      } else if (message.type === 'navigate') {
        if (draftDirtyRef.current) {
          setNotice({
            text: 'Enregistrez le brouillon du compte rendu avant de changer de page.',
            error: true,
          });
          return;
        }
        setView('dashboard');
        setFeatureId(message.featureId ?? '');
        setCreate(message.view === 'create');
        setObserverRequested(message.view === 'observation');
      }
    });
    send({ type: 'ready' });
    return cleanup;
  }, []);
  useEffect(() => persistView({ view, featureId, stepId }), [view, featureId, stepId]);
  const dispatch = (message: ClientMessage) => {
    if (
      state?.workspaceOperation &&
      [
        'createFeature',
        'runStep',
        'restoreCheckpoint',
        'createCheckpoint',
        'startAutopilot',
        'configureStep',
        'saveArtifact',
        'requestCorrection',
        'finalizeFeature',
        'approveStep',
        'archiveFeature',
        'deleteFeature',
        'previewObservation',
        'runObservation',
        'deliveryExecute',
        'deliveryCommit',
        'devopsCreateFeature',
      ].includes(message.type)
    ) {
      setNotice({
        text: `${state.workspaceOperation.label} · attendez la fin de cette opération.`,
        error: true,
      });
      return;
    }
    if (isDemo) {
      if (
        ['saveArtifact', 'requestCorrection', 'finalizeFeature'].includes(message.type) &&
        'featureId' in message
      ) {
        window.postMessage(
          {
            type:
              message.type === 'saveArtifact'
                ? 'artifactSaveResult'
                : message.type === 'requestCorrection'
                  ? 'correctionResult'
                  : 'featureFinalizationResult',
            featureId: message.featureId,
            ...('stepId' in message ? { stepId: message.stepId } : {}),
            error:
              'Mode démonstration : ouvrez le cockpit dans VS Code pour enregistrer cette décision.',
          },
          '*',
        );
      }
      if (message.type.startsWith('kit') && 'requestId' in message) {
        window.postMessage(
          {
            type: 'kitResult',
            requestId: message.requestId,
            ...(message.type === 'kitCatalog'
              ? {
                  catalog: [],
                  message:
                    'Les kits installables sont disponibles dans l’extension VS Code. Ici, vous pouvez explorer la composition avec les profils de démonstration.',
                }
              : {
                  error:
                    'L’import, l’export et l’installation des kits nécessitent l’extension VS Code.',
                }),
          },
          '*',
        );
        return;
      }
      setNotice({
        text: 'Démonstration : aucune commande, écriture ou exécution Copilot n’a été effectuée.',
      });
      return;
    }
    send(message);
  };
  const selected = state?.features.find((f) => f.id === featureId);
  const activeFeatures = state?.features.filter((f) => !f.archived) ?? [];
  const openCreate = (id?: string) => {
    setWorkflowId(
      id ?? state?.workflows.find((w) => w.id === 'feature')?.id ?? state?.workflows[0]?.id ?? '',
    );
    setCreate(true);
  };
  const chooseView = (id: View) => {
    if (draftDirty) {
      setNotice({
        text: 'Enregistrez le brouillon du compte rendu avant de changer de page.',
        error: true,
      });
      return;
    }
    setView(id);
    setFeatureId('');
  };
  if (!state)
    return (
      <div className="launch-screen">
        <div className="brand-mark">
          <Command size={28} />
        </div>
        <span className="eyebrow">VOTRE ATELIER DE DÉVELOPPEMENT</span>
        <h1>Feature Studio</h1>
        <p>
          {isHosted
            ? 'Connexion à votre espace de travail…'
            : 'Ouvrez Feature Studio dans VS Code pour travailler avec vos agents GitHub Copilot.'}
        </p>
        {isHosted ? (
          <LoaderCircle className="spin" size={22} />
        ) : (
          <>
            <div className="launch-command">
              <Command size={16} />
              <code>Feature Studio : ouvrir le cockpit</code>
            </div>
            <a className="button secondary" href="?demo=1">
              Explorer la démonstration <ArrowRight size={16} />
            </a>
          </>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => chooseView('dashboard')}
          aria-label="Feature Studio, accueil"
        >
          <span className="brand-mark">
            <Command size={23} />
          </span>
          <span>
            Feature<span>Studio</span>
          </span>
        </button>
        <div className="workspace-card">
          <span className="workspace-icon">
            <FolderGit2 size={17} />
          </span>
          <div>
            <strong title={state.workspace.path}>{state.workspace.name}</strong>
            <span>
              <GitBranch size={11} />
              {state.workspace.branch || 'Sans branche'}
            </span>
          </div>
        </div>
        <span className="nav-heading">ESPACE DE TRAVAIL</span>
        <nav aria-label="Navigation principale">
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${n.id === 'devops-prs' || n.id === 'devops-tickets' ? 'nav-child' : ''} ${view === n.id ? 'active' : ''}`}
              title={n.label}
              onClick={() => chooseView(n.id)}
              aria-label={n.label}
              aria-current={view === n.id ? 'page' : undefined}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === 'dashboard' && activeFeatures.length > 0 && (
                <small>{activeFeatures.length}</small>
              )}
              {n.id === 'validation' && attentionCount(state) > 0 && (
                <small>{attentionCount(state)}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <span className={`connection-dot ${state.runtime.state}`} />
            <div>
              <strong>
                {state.runtime.state === 'ready'
                  ? 'Copilot connecté'
                  : state.runtime.state === 'checking'
                    ? 'Vérification…'
                    : state.runtime.state === 'unavailable'
                      ? 'Copilot indisponible'
                      : 'Copilot à vérifier'}
              </strong>
              <span>{state.runtime.account ?? 'GitHub Copilot CLI'}</span>
            </div>
            <button
              className="icon-button"
              onClick={() => dispatch({ type: 'checkRuntime' })}
              aria-label="Vérifier Copilot"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <button className="sidebar-link" onClick={() => chooseView('kits')}>
            <Package size={14} /> Gérer les kits <ArrowUpRight size={13} />
          </button>
          <button className="sidebar-link" onClick={() => dispatch({ type: 'migrateUserKit' })}>
            <ArrowUpRight size={14} /> Migrer les profils du projet
          </button>
          <div className="sidebar-footnote">
            Votre intention. Vos agents.
            <br />
            Vous gardez la main.
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-context">
            <span className="context-dot" /> ATELIER <ChevronRight size={12} />
            <span>{selected ? selected.title : nav.find((n) => n.id === view)?.label}</span>
          </div>
          <div className="topbar-actions">
            <span className="trust-label">
              <ShieldCheck size={14} />
              {state.workspace.trusted ? 'Projet approuvé' : 'Consultation seule'}
            </span>
            <button
              className="icon-button"
              aria-label="Actualiser l’espace de travail"
              onClick={() => dispatch({ type: 'refresh' })}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        {isDemo && (
          <div className="demo-banner">
            <Sparkles size={15} />
            <strong>Démonstration — aucune exécution Copilot</strong>
            <span>Un aperçu du cockpit, avec des données d’exemple.</span>
          </div>
        )}
        {!state.workspace.trusted && (
          <div className="warning-banner">
            <ShieldCheck size={16} /> Approuvez ce projet dans VS Code pour exécuter des agents ou
            des scripts.
          </div>
        )}
        {notice && (
          <div
            className={`toast ${notice.error ? 'error' : ''}`}
            role={notice.error ? 'alert' : 'status'}
          >
            {notice.error ? <TriangleAlert size={17} /> : <MessageSquare size={17} />}
            <span>{notice.text}</span>
            <button
              className="icon-button"
              aria-label="Fermer la notification"
              onClick={() => setNotice(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {state.notices.length > 0 && (
          <div className="workspace-notices">
            {state.notices.map((n, i) => (
              <p key={i}>
                <TriangleAlert size={14} />
                {n}
              </p>
            ))}
          </div>
        )}
        <main>
          {state.workspaceOperation && (
            <div className="workspace-operation global-workspace-operation" role="status">
              <LoaderCircle className="spin" size={14} />
              {state.workspaceOperation.label}
            </div>
          )}
          {Boolean(state.humanRequests?.length) && (
            <div className="human-global-banner">
              <MessageSquare size={15} />
              <span>
                {state.humanRequests!.length} demande{state.humanRequests!.length > 1 ? 's' : ''}{' '}
                humaine{state.humanRequests!.length > 1 ? 's' : ''} en attente
              </span>
              <button
                className="text-button"
                onClick={() => {
                  const r = state.humanRequests![0];
                  setView('dashboard');
                  setFeatureId(r.featureId);
                  setStepId(r.stepId);
                }}
              >
                Ouvrir la demande <ArrowRight size={13} />
              </button>
            </div>
          )}
          {view === 'dashboard' &&
            (selected ? (
              <FeatureDetail
                key={selected.id}
                observerRequested={observerRequested}
                feature={selected}
                state={state}
                devops={devops}
                openDevOps={() => chooseView('devops')}
                stepId={stepId}
                selectStep={(id) => {
                  if (!draftDirty) setStepId(id);
                }}
                onDirtyChange={updateDraftDirty}
                dispatch={dispatch}
                back={() => {
                  if (!draftDirty) setFeatureId('');
                }}
                confirm={(title, description, action) => setConfirm({ title, description, action })}
              />
            ) : (
              <Dashboard
                state={state}
                onCreate={openCreate}
                onOpen={(id) => {
                  setFeatureId(id);
                  setStepId('');
                }}
              />
            ))}
          <div hidden={view !== 'devops' && view !== 'delivery'}>
            <DevOpsUI
              state={devops}
              visible={view === 'devops' || view === 'delivery'}
              features={state.features}
              dispatch={dispatch}
              mode={view === 'delivery' ? 'delivery' : 'dashboard'}
              onOpenFeature={(id) => {
                setView('dashboard');
                setFeatureId(id);
                setStepId('');
              }}
            />
          </div>
          {(['devops-prs', 'devops-tickets'] as View[]).map((dashboardView) => (
            <div hidden={view !== dashboardView} key={dashboardView}>
              <DevOpsDashboard
                active={view === dashboardView}
                kind={dashboardView === 'devops-prs' ? 'prs' : 'tickets'}
                state={devops}
                features={state.features}
                dispatch={dispatch}
                onConfigure={() => chooseView('devops')}
                onOpenFeature={(id) => {
                  setView('dashboard');
                  setFeatureId(id);
                  setStepId('');
                }}
              />
            </div>
          ))}
          {view === 'usage' && (
            <UsageDashboard
              features={state.features}
              onOpenFeature={(id) => {
                setView('dashboard');
                setFeatureId(id);
                setStepId('');
              }}
            />
          )}
          {view === 'validation' && (
            <ValidationCenter
              state={state}
              dispatch={dispatch}
              onOpen={(id, step) => {
                setView('dashboard');
                setFeatureId(id);
                setStepId(step);
              }}
            />
          )}
          {view === 'memory' && <ProjectMemoryView state={state} dispatch={dispatch} />}
          {view === 'workflows' && <WorkflowLibrary state={state} dispatch={dispatch} />}
          {view === 'kits' && <KitsUI state={state} dispatch={dispatch} />}
          {view === 'agents' && (
            <Library
              title="Des agents, chacun son regard."
              eyebrow="VOTRE ÉQUIPE"
              subtitle="Des profils spécialisés, des instructions lisibles. Composez une équipe qui connaît votre manière de travailler."
              count={`${state.agents.length} profils`}
              action="Nouvel agent"
              onCreate={() => setAgentEditor('new')}
            >
              <div className="library-grid">
                {state.agents.map((a, i) => (
                  <button className="library-card" key={a.id} onClick={() => setAgentEditor(a)}>
                    <Avatar agent={a} />
                    <span className="library-meta">
                      {a.source === 'workspace'
                        ? 'PROJET'
                        : a.source === 'user'
                          ? 'UTILISATEUR'
                          : 'KIT FOURNI'}
                      <ArrowUpRight size={16} />
                    </span>
                    <h3>{a.nickname || a.name}</h3>
                    {normalizeRoastLevel(a.roastLevel) !== 'off' && (
                      <span className="profile-role">Roast · {roastLabel(a.roastLevel)}</span>
                    )}
                    <p>
                      {a.nickname && <span className="profile-role">{a.name}</span>}
                      {a.description}
                    </p>
                    <div className="card-footer">
                      <span>
                        {a.skills.length} skill{a.skills.length > 1 ? 's' : ''}
                      </span>
                      <span>{a.model || 'Modèle automatique'}</span>
                    </div>
                  </button>
                ))}
              </div>
              {!state.agents.length && (
                <Empty title="Une équipe à construire" icon={<Bot />}>
                  Créez un agent avec un rôle clair et des instructions adaptées au projet.
                </Empty>
              )}
              <div className="quiet-note">
                <ShieldCheck size={17} />
                <span>
                  Les permissions de chaque étape encadrent les outils de l’agent. Les profils sont
                  enregistrés dans le projet.
                </span>
              </div>
            </Library>
          )}
          {view === 'skills' && (
            <Library
              title="Le savoir-faire, à portée d’agent."
              eyebrow="VOTRE BOÎTE À OUTILS"
              subtitle="Des méthodes réutilisables pour retrouver vos conventions et vos exigences dans chaque session."
              count={`${state.skills.length} skills`}
              action="Nouvelle skill"
              onCreate={() => setSkillEditor('new')}
            >
              <div className="library-grid">
                {state.skills.map((s, i) => (
                  <button
                    className="library-card skill-card"
                    key={s.id}
                    onClick={() => setSkillEditor(s)}
                  >
                    <span className={`agent-avatar color-${(i + 1) % 4}`}>
                      <BookOpen size={24} />
                    </span>
                    <span className="library-meta">
                      {s.source === 'workspace'
                        ? 'PROJET'
                        : s.source === 'user'
                          ? 'UTILISATEUR'
                          : 'KIT FOURNI'}
                      <ArrowUpRight size={16} />
                    </span>
                    <h3>{s.name}</h3>
                    <p>{s.description}</p>
                    <div className="card-footer">
                      <span>
                        <FileText size={13} /> SKILL.md
                      </span>
                      <span>Consulter & éditer</span>
                    </div>
                  </button>
                ))}
              </div>
              {!state.skills.length && (
                <Empty title="Vos méthodes méritent une skill" icon={<BookOpen />}>
                  Décrivez une méthode dans un fichier SKILL.md pour la rendre disponible à vos
                  agents.
                </Empty>
              )}
            </Library>
          )}
          {(view === 'settings' || view === 'automations') && (
            <SettingsView
              key={`${view}-${JSON.stringify(state.settings)}`}
              settings={state.settings}
              state={state}
              automation={view === 'automations'}
              dispatch={dispatch}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>
            <Command size={12} /> FEATURE STUDIO
          </span>
          <span>Un espace pour avancer avec intention.</span>
          <span>
            {state.runtime.version ? `CLI ${state.runtime.version}` : 'Copilot CLI'}{' '}
            <span className="footer-dot" />
          </span>
        </footer>
      </div>
      {create && (
        <CreateModal
          state={state}
          initialWorkflow={workflowId}
          onClose={() => setCreate(false)}
          onCreate={(message) => {
            dispatch(message);
            setCreate(false);
          }}
        />
      )}
      {agentEditor && (
        <AgentEditor
          agent={agentEditor}
          state={state}
          onClose={() => setAgentEditor(null)}
          onMigrate={() => {
            setAgentEditor(null);
            dispatch({ type: 'migrateUserKit' });
          }}
          save={(a, options, requestId) => {
            dispatch({ type: 'saveAgent', agent: a, options, requestId });
          }}
        />
      )}
      {skillEditor && (
        <SkillEditor
          skill={skillEditor}
          state={state}
          onClose={() => setSkillEditor(null)}
          onMigrate={() => {
            setSkillEditor(null);
            dispatch({ type: 'migrateUserKit' });
          }}
          save={(id, content, options, requestId) => {
            dispatch({ type: 'saveSkill', id, content, options, requestId });
          }}
        />
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="confirm-copy">{confirm.description}</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setConfirm(null)}>
              Revenir
            </button>
            <button
              className="button primary"
              onClick={() => {
                confirm.action();
                setConfirm(null);
              }}
            >
              Confirmer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Dashboard({
  state,
  onCreate,
  onOpen,
}: {
  state: StudioState;
  onCreate: (id?: string) => void;
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showArchive, setShowArchive] = useState(false);
  const live = state.features.filter((f) => !f.archived);
  const features = state.features.filter(
    (f) =>
      Boolean(f.archived) === showArchive &&
      (!search ||
        `${f.title} ${f.description} ${f.branch}`.toLowerCase().includes(search.toLowerCase())) &&
      (filter === 'all' || f.status === filter),
  );
  const waiting = live.filter((f) =>
    ['attention', 'awaiting_final_validation'].includes(f.status),
  ).length;
  const approved = live.filter((f) => f.status === 'completed').length;
  return (
    <div className="page dashboard-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            <span /> L’INTENTION DEVIENT CONCRÈTE
          </span>
          <h1>
            Chaque idée mérite
            <br />
            un <span className="serif accent-text">beau parcours.</span>
          </h1>
          <p>Pilotez vos features, une étape et une décision à la fois.</p>
        </div>
        <button
          className="button primary new-session"
          disabled={Boolean(state.workspaceOperation)}
          onClick={() => onCreate()}
        >
          <Plus size={17} /> Nouvelle session
        </button>
      </div>
      <div className="overview-strip">
        <div>
          <span className="stat-number">{String(live.length).padStart(2, '0')}</span>
          <span>sessions dans l’atelier</span>
          <span className="stat-icon">
            <Workflow size={20} />
          </span>
        </div>
        <div>
          <span className="stat-number apricot-text">{String(waiting).padStart(2, '0')}</span>
          <span>à votre tour de jouer</span>
          <span className="stat-icon">
            <MessageSquare size={20} />
          </span>
        </div>
        <div>
          <span className="stat-number green-text">{String(approved).padStart(2, '0')}</span>
          <span>parcours terminés</span>
          <span className="stat-icon">
            <CheckCircle2 size={20} />
          </span>
        </div>
      </div>
      <div className="dashboard-columns">
        <section className="sessions-section">
          <div className="section-heading">
            <h2>
              {showArchive ? 'Archives' : 'Vos sessions'}
              <span className="count-pill">{features.length}</span>
            </h2>
            <button
              className={`text-button ${showArchive ? 'selected' : ''}`}
              onClick={() => setShowArchive(!showArchive)}
            >
              <Archive size={14} />
              {showArchive ? 'Voir les sessions' : 'Archives'}
            </button>
          </div>
          <div className="filter-bar">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Rechercher une session"
                placeholder="Retrouver une idée, une branche…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Effacer la recherche"
                  onClick={() => setSearch('')}
                >
                  <X size={13} />
                </button>
              )}
            </label>
            <label className="filter-select">
              <ListFilter size={15} />
              <select
                aria-label="Filtrer les sessions"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Tous les états</option>
                <option value="attention">À votre tour</option>
                <option value="awaiting_final_validation">Dernière validation</option>
                <option value="running">En cours</option>
                <option value="draft">À démarrer</option>
                <option value="completed">Terminées</option>
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
          <div className="session-list">
            {features.map((f, i) => {
              const status = featureStatus[f.status];
              const approved = f.steps.filter((s) => s.status === 'approved').length;
              const active = f.steps.find((s) => s.id === f.activeStepId);
              return (
                <button
                  className={`session-card ${['attention', 'awaiting_final_validation'].includes(f.status) ? 'needs-attention' : ''}`}
                  onClick={() => onOpen(f.id)}
                  key={f.id}
                >
                  <div className="session-top">
                    <span className="session-kind">
                      <span className={`mini-symbol color-${i % 3}`}>
                        <Workflow size={15} />
                      </span>
                      {f.workflowName}
                    </span>
                    <Badge {...status} />
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                  <div
                    className="segmented-progress"
                    aria-label={`${approved} étapes validées sur ${f.steps.length}`}
                  >
                    {f.steps.map((s) => (
                      <span
                        key={s.id}
                        className={s.status}
                        title={`${s.name} : ${statuses[s.status].label}`}
                      />
                    ))}
                  </div>
                  <div className="session-bottom">
                    <span>
                      <GitBranch size={12} />
                      {f.branch || 'Branche courante'}
                    </span>
                    <span>
                      {f.status === 'completed'
                        ? `${approved} / ${f.steps.length} étapes`
                        : f.status === 'awaiting_final_validation'
                          ? 'Valider le bilan final'
                          : (active?.name ?? 'Préparation')}
                      <ArrowRight size={16} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {!features.length && (
            <Empty
              title={
                search || filter !== 'all'
                  ? 'Aucune session ne correspond'
                  : showArchive
                    ? 'Vos archives sont tranquilles'
                    : 'La prochaine belle idée commence ici'
              }
              icon={search ? <Search /> : <WandSparkles />}
              action={
                !showArchive && !search && filter === 'all' ? (
                  <button className="button primary" onClick={() => onCreate()}>
                    <Plus size={16} /> Créer ma première session
                  </button>
                ) : undefined
              }
            >
              {search || filter !== 'all'
                ? 'Essayez un autre mot ou élargissez le filtre.'
                : showArchive
                  ? 'Une session archivée reste disponible et peut être restaurée à tout moment.'
                  : 'Un besoin, une envie, un petit détail à améliorer. Confiez le premier pas à votre équipe d’agents.'}
            </Empty>
          )}
        </section>
        <aside className="dashboard-aside">
          <div className="start-card">
            <span className="eyebrow">UN BON POINT DE DÉPART</span>
            <h2>
              Quel est votre
              <br />
              <span className="serif">prochain mouvement ?</span>
            </h2>
            <div className="template-list">
              {orderedWorkflows(state.workflows).map((w) => (
                <button key={w.id} onClick={() => onCreate(w.id)}>
                  <span className={`template-icon color-${workflowRank(w) % 3}`}>
                    <WorkflowIcon workflow={w} />
                  </span>
                  <span>
                    <strong>{w.name}</strong>
                    <small>
                      {w.steps.length} étape{w.steps.length > 1 ? 's' : ''} ·{' '}
                      {w.id === 'feature'
                        ? 'De l’idée aux tests'
                        : w.id === 'code-review'
                          ? 'Un regard indépendant'
                          : w.id === 'single'
                            ? 'À votre rythme'
                            : 'Personnalisé'}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          </div>
          <div className="principle-card">
            <span className="orbit-art" aria-hidden="true">
              <span />
              <span />
              <Sparkles size={23} />
            </span>
            <span className="eyebrow">LE PRINCIPE DE L’ATELIER</span>
            <h3>
              Les agents proposent.
              <br />
              <span className="serif">Vous donnez le cap.</span>
            </h3>
            <p>
              Relisez chaque livrable, ajustez-le, puis validez pour ouvrir la suite du parcours.
            </p>
            <div>
              <ShieldCheck size={14} /> Votre validation compte.
            </div>
          </div>
          <div className="aside-note">
            <span className="tiny-line" />
            <p>
              Un livrable éditable, un historique lisible,
              <br />
              et toujours la possibilité de reprendre.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
function Library({
  title,
  eyebrow,
  subtitle,
  count,
  action,
  onCreate,
  children,
}: {
  title: string;
  eyebrow: string;
  subtitle: string;
  count: string;
  action: string;
  onCreate: () => void;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={16} />
          {action}
        </button>
      </div>
      <div className="section-heading">
        <h2>Dans votre projet</h2>
        <span className="muted">{count}</span>
      </div>
      {children}
    </div>
  );
}
function ModelSelect({
  state,
  value,
  onChange,
  label = 'Modèle',
}: {
  state: StudioState;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="select-wrap">
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Automatique · choix du CLI</option>
          {value && !state.runtime.models.some((m) => m.id === value) && (
            <option value={value}>{value} · configuré</option>
          )}
          {state.runtime.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.multiplier !== undefined ? ` · ×${m.multiplier}` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </div>
      {!state.runtime.models.length && (
        <small>Vérifiez Copilot pour consulter les modèles disponibles.</small>
      )}
    </label>
  );
}
function CreateModal({
  state,
  initialWorkflow,
  onClose,
  onCreate,
}: {
  state: StudioState;
  initialWorkflow: string;
  onClose: () => void;
  onCreate: (m: Extract<ClientMessage, { type: 'createFeature' }>) => void;
}) {
  const [workflow, setWorkflow] = useState(initialWorkflow || state.workflows[0]?.id || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agent, setAgent] = useState('');
  const [model, setModel] = useState('');
  const [isolated, setIsolated] = useState(
    Boolean(
      state.workspace.canIsolate &&
        ['feature', 'single'].includes(initialWorkflow || state.workflows[0]?.id || ''),
    ),
  );
  const creationBusy = Boolean(state.workspaceOperation) || hasActiveRun(state);
  return (
    <Modal
      title="Une idée, un nouveau parcours."
      subtitle="Choisissez un point de départ. Vous gardez la main à chaque étape."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && workflow)
            onCreate({
              type: 'createFeature',
              title: title.trim(),
              description: description.trim(),
              workflowId: workflow,
              isolated: isolated && Boolean(state.workspace.canIsolate),
              ...(agent ? { agentId: agent } : {}),
              ...(model ? { model } : {}),
            });
        }}
      >
        <div className="workflow-picker" role="radiogroup" aria-label="Type de session">
          {orderedWorkflows(state.workflows).map((w) => (
            <button
              type="button"
              role="radio"
              aria-checked={workflow === w.id}
              key={w.id}
              className={workflow === w.id ? 'chosen' : ''}
              onClick={() => {
                setWorkflow(w.id);
                setIsolated(
                  Boolean(state.workspace.canIsolate && ['feature', 'single'].includes(w.id)),
                );
              }}
            >
              <span className={`template-icon color-${workflowRank(w) % 3}`}>
                <WorkflowIcon workflow={w} />
              </span>
              <strong>{w.name}</strong>
              <small>{w.description}</small>
              <span className="picker-check">
                {workflow === w.id ? <Check size={13} /> : <Circle size={13} />}
              </span>
            </button>
          ))}
        </div>
        <WorkspaceChoice
          state={state}
          isolated={isolated && Boolean(state.workspace.canIsolate)}
          onChange={setIsolated}
        />
        <label className="field">
          <span>
            Qu’allons-nous faire ? <em>*</em>
          </span>
          <input
            required
            maxLength={200}
            placeholder="Ex. Une recherche plus agréable au clavier"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Le contexte et le résultat souhaité</span>
          <textarea
            rows={4}
            placeholder="Le besoin, les contraintes, ce qui vous ferait dire « c’est réussi »…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Agent de la première étape</span>
            <div className="select-wrap">
              <select value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="">Profil prévu par le parcours</option>
                {state.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
          </label>
          <ModelSelect state={state} value={model} onChange={setModel} />
        </div>
        <div className="modal-actions">
          <span className="muted">
            <ShieldCheck size={14} /> Créer ne lance aucune exécution.
          </span>
          <button type="button" className="button secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!title.trim() || !workflow || creationBusy}
          >
            Créer la session <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function FeatureDetail({
  observerRequested,
  feature,
  state,
  devops,
  openDevOps,
  stepId,
  selectStep,
  dispatch,
  back,
  confirm,
  onDirtyChange,
}: {
  observerRequested?: boolean;
  onDirtyChange: (dirty: boolean) => void;
  feature: Feature;
  state: StudioState;
  devops: DevOpsState;
  openDevOps: () => void;
  stepId: string;
  selectStep: (id: string) => void;
  dispatch: (m: ClientMessage) => void;
  back: () => void;
  confirm: (title: string, description: string, action: () => void) => void;
}) {
  const step =
    feature.steps.find((s) => s.id === stepId) ??
    feature.steps.find((s) => s.id === feature.activeStepId) ??
    feature.steps[0];
  const done = feature.steps.filter((s) => s.status === 'approved').length;
  const [correction, setCorrection] = useState<{
    sourceStepId: string;
    feedback: string;
    findingIds?: string[];
    commentIds?: string[];
    rootStepIds?: string[];
  } | null>(null);
  const [finalPending, setFinalPending] = useState(false),
    [finalError, setFinalError] = useState(''),
    [finalAck, setFinalAck] = useState('');
  const finalRequested = useRef(false);
  const [celebrationToken, setCelebrationToken] = useState('');
  const [detailDirty, setDetailDirty] = useState(false);
  const [observerOpen, setObserverOpen] = useState(Boolean(observerRequested));
  useEffect(() => {
    if (observerRequested) setObserverOpen(true);
  }, [observerRequested]);
  const finalKey = useRef('');
  const busy =
    hasActiveRun(state) ||
    Boolean(state.workspaceOperation) ||
    state.features.some((item) => item.autopilot?.status === 'running');
  useEffect(
    () =>
      subscribe((message) => {
        if (
          message.type !== 'featureFinalizationResult' ||
          message.featureId !== feature.id ||
          !finalRequested.current
        )
          return;
        finalRequested.current = false;
        if (message.error) {
          setFinalPending(false);
          setFinalError(message.error);
        } else if (message.finalizationId) setFinalAck(message.finalizationId);
      }),
    [feature.id],
  );
  useEffect(() => {
    if (finalAck && feature.finalValidation?.id === finalAck) {
      setFinalPending(false);
      setCelebrationToken(finalAck);
      setFinalAck('');
    }
  }, [finalAck, feature.finalValidation?.id]);
  const openCorrection = (
    sourceStepId: string,
    feedback = '',
    findingIds?: string[],
    commentIds?: string[],
    rootStepIds?: string[],
  ) => setCorrection({ sourceStepId, feedback, findingIds, commentIds, rootStepIds });

  return (
    <div className="page feature-page">
      {correction && (
        <Modal
          title="Demander une correction"
          subtitle="Choisissez les étapes et le contexte pour guider l’équipe."
          wide
          onClose={() => setCorrection(null)}
        >
          <CorrectionPanel
            feature={feature}
            state={state}
            {...correction}
            initialFeedback={correction.feedback}
            dispatch={dispatch}
            onClose={() => setCorrection(null)}
          />
        </Modal>
      )}
      <div className="breadcrumb">
        <button onClick={back} disabled={detailDirty}>
          <ArrowLeft size={14} /> Vos sessions
        </button>
        <ChevronRight size={12} />
        <span>{feature.workflowName}</span>
      </div>
      <div className="feature-heading">
        <div>
          <Badge {...featureStatus[feature.status]} />
          <h1>{feature.title}</h1>
          <p>{feature.description}</p>
          <div className="feature-meta">
            <span>
              <GitBranch size={14} />
              {feature.branch || 'Branche courante'}
            </span>
            <span>
              <Clock3 size={13} />
              {date(feature.updatedAt)}
            </span>
          </div>
        </div>
        <div className="feature-tools">
          <button
            className="button secondary small"
            disabled={detailDirty}
            onClick={() => setObserverOpen(!observerOpen)}
          >
            <Eye size={15} /> Analyser cette session
          </button>
          <button
            className="icon-button"
            disabled={busy || detailDirty}
            aria-label="Supprimer la session"
            onClick={() => dispatch({ type: 'deleteFeature', featureId: feature.id })}
          >
            <Trash2 size={16} />
          </button>
          <button
            className="button secondary small"
            onClick={() => dispatch({ type: 'exportFeature', featureId: feature.id })}
          >
            <ArrowDownToLine size={15} /> Exporter
          </button>
          <button
            className="icon-button"
            aria-label={feature.archived ? 'Restaurer la session' : 'Archiver la session'}
            onClick={() =>
              confirm(
                feature.archived ? 'Restaurer cette session ?' : 'Archiver cette session ?',
                feature.archived
                  ? 'La session retrouvera sa place dans votre atelier.'
                  : 'La session restera consultable dans les archives. Son historique et ses livrables seront conservés.',
                () =>
                  dispatch({
                    type: 'archiveFeature',
                    featureId: feature.id,
                    archived: !feature.archived,
                  }),
              )
            }
          >
            <Archive size={17} />
          </button>
        </div>
      </div>
      {observerOpen && (
        <ObservationPanel
          feature={feature}
          state={state}
          dispatch={dispatch}
          close={() => setObserverOpen(false)}
        />
      )}
      <DevOpsFeatureLinks state={devops} featureId={feature.id} onOpenDashboard={openDevOps} />
      <GitWorkspacePanel feature={feature} state={state} dispatch={dispatch} />
      <div className="feature-control-band">
        <AutopilotBar feature={feature} state={state} dispatch={dispatch} />
        <BudgetMeter feature={feature} state={state} dispatch={dispatch} />
      </div>
      <div className="journey-heading">
        <span className="eyebrow">LE PARCOURS</span>
        <span>
          {done} / {feature.steps.length} étapes validées
        </span>
      </div>
      <div className="journey" role="navigation" aria-label="Étapes du parcours">
        {feature.steps.map((s, i) => (
          <button
            key={s.id}
            disabled={detailDirty}
            onClick={() => selectStep(s.id)}
            className={`journey-step ${s.status} ${s.id === step?.id ? 'current' : ''}`}
            aria-current={s.id === step?.id ? 'step' : undefined}
          >
            <span className="journey-node">
              <Avatar
                agent={state.agents.find((a) => a.id === s.agentId)}
                status={s.status}
                small
              />
              {s.status === 'approved' && (
                <span className="journey-check">
                  <Check size={9} />
                </span>
              )}
            </span>
            <span>
              <strong>
                <span className="step-index">{String(i + 1).padStart(2, '0')} </span>
                {s.name}
              </strong>
              <small>{statuses[s.status].label}</small>
            </span>
          </button>
        ))}
      </div>
      {done === feature.steps.length && feature.steps.length > 0 && (
        <FinalSummary
          feature={feature}
          state={state}
          busy={busy || finalPending || detailDirty}
          error={finalError}
          finalized={feature.status === 'completed' && Boolean(feature.finalValidation)}
          token={feature.finalValidation?.id === celebrationToken ? celebrationToken : ''}
          onFinalize={() => {
            if (!finalValidationReady(feature)) return;
            finalKey.current = featureStateKey(feature);
            finalRequested.current = true;
            setFinalPending(true);
            setFinalError('');
            dispatch({
              type: 'finalizeFeature',
              featureId: feature.id,
              expectedStateKey: finalKey.current,
            });
          }}
          onCorrection={() => {
            const source = [...feature.steps]
              .reverse()
              .find((item) => item.attempts.at(-1)?.artifact);
            if (source) openCorrection(source.id);
            else
              setFinalError(
                'Aucun compte rendu conservé dans cette ancienne session. Ouvrez une nouvelle session pour poursuivre.',
              );
          }}
        />
      )}
      {step ? (
        <StepPanel
          key={`${feature.id}-${step.id}`}
          feature={feature}
          step={step}
          state={state}
          dispatch={dispatch}
          selectStep={selectStep}
          onDirtyChange={(value) => {
            setDetailDirty(value);
            onDirtyChange(value);
          }}
          onCorrection={openCorrection}
          confirm={confirm}
        />
      ) : (
        <Empty title="Ce parcours n’a aucune étape">Choisissez un autre modèle de session.</Empty>
      )}
    </div>
  );
}
function StepPanel({
  feature,
  step,
  state,
  dispatch,
  selectStep,
  confirm,
  onDirtyChange,
  onCorrection,
}: {
  onDirtyChange: (dirty: boolean) => void;
  onCorrection: (
    sourceStepId: string,
    feedback?: string,
    findingIds?: string[],
    commentIds?: string[],
    rootStepIds?: string[],
  ) => void;
  feature: Feature;
  step: FeatureStep;
  state: StudioState;
  dispatch: (m: ClientMessage) => void;
  selectStep: (id: string) => void;
  confirm: (title: string, description: string, action: () => void) => void;
}) {
  const latest = step.attempts.at(-1);
  const [attemptId, setAttemptId] = useState('');
  const attempt = step.attempts.find((a) => a.id === attemptId) ?? latest;
  const historic = Boolean(attempt && latest && attempt.id !== latest.id);
  const [tab, setTab] = useState<'artifact' | 'activity' | 'diffs' | 'evidence' | 'review'>(
    'artifact',
  );
  const [edit, setEdit] = useState(false);
  const [content, setContent] = useState(latest?.artifact?.content ?? '');
  const [savedContent, setSavedContent] = useState(latest?.artifact?.content ?? '');
  const [reason, setReason] = useState(''),
    [description, setDescription] = useState(feature.description),
    [descriptionChanged, setDescriptionChanged] = useState(false);
  const editStateKey = useRef(featureStateKey(feature));
  const editAttemptId = useRef(latest?.id);
  const editRevision = useRef(latest?.revision ?? 0);
  const dirty =
    content !== savedContent || (descriptionChanged && description !== feature.description);
  const [savePending, setSavePending] = useState(false),
    [saveError, setSaveError] = useState('');
  const [saveAck, setSaveAck] = useState<{ revision: number; action: 'approve' | 'review' } | null>(
    null,
  );
  const saveAction = useRef<'approve' | 'review' | null>(null);
  const savedBriefChanged = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    onDirtyChange(dirty || savePending);
    return () => onDirtyChange(false);
  }, [dirty, savePending]);
  useEffect(
    () =>
      subscribe((message) => {
        if (
          message.type !== 'artifactSaveResult' ||
          message.featureId !== feature.id ||
          message.stepId !== step.id ||
          !saveAction.current
        )
          return;
        const action = saveAction.current;
        saveAction.current = null;
        if (message.error) {
          setSavePending(false);
          setSaveError(message.error);
        } else if (message.attemptId === latest?.id && message.revision !== undefined)
          setSaveAck({ revision: message.revision, action });
      }),
    [feature.id, step.id, latest?.id],
  );
  useEffect(() => {
    if (!saveAck || latest?.revision !== saveAck.revision) return;
    setSavePending(false);
    setSaveAck(null);
    setSavedContent(latest.artifact?.content ?? '');
    setDescriptionChanged(false);
    setEdit(false);
    if (saveAck.action === 'review')
      onCorrection(
        step.id,
        reason.trim() || 'Relire et prendre en compte le compte rendu corrigé par Matt.',
        [],
        [],
        savedBriefChanged.current
          ? feature.steps.filter((item) => item.dependsOn.length === 0).map((item) => item.id)
          : [step.id],
      );
    else {
      setApprovalPending(true);
      dispatch({
        type: 'approveStep',
        featureId: feature.id,
        stepId: step.id,
        expectedAttemptId: latest.id,
        expectedRevision: latest.revision,
      });
    }
  }, [saveAck, latest?.revision]);
  const saveReport = (action: 'approve' | 'review') => {
    if (!latest) return;
    setSavePending(true);
    setSaveError('');
    saveAction.current = action;
    savedBriefChanged.current = descriptionChanged && description !== feature.description;
    dispatch({
      type: 'saveArtifact',
      featureId: feature.id,
      stepId: step.id,
      content,
      expectedAttemptId: editAttemptId.current,
      expectedRevision: editRevision.current,
      expectedStateKey: editStateKey.current,
      ...(descriptionChanged ? { description } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  };
  const [feedback, setFeedback] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [config, setConfig] = useState(false);
  const [launchResume, setLaunchResume] = useState<boolean | null>(null);
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const approvalReasons =
    step.status === 'awaiting_review' ? approvalBlockers(feature, step, 'human') : [];
  useEffect(
    () =>
      subscribe((message) => {
        if (
          message.type === 'stepApprovalResult' &&
          message.featureId === feature.id &&
          message.stepId === step.id &&
          message.attemptId === latest?.id
        ) {
          setApprovalPending(false);
          setApprovalError(message.error ?? '');
        }
      }),
    [feature.id, step.id, latest?.id],
  );
  useEffect(() => {
    setApprovalError('');
    setApprovalPending(false);
  }, [latest?.id, latest?.revision]);
  useEffect(() => {
    const received = latest?.artifact?.content ?? '';
    if (received === content) setSavedContent(received);
    else if (!dirty) {
      setContent(received);
      setSavedContent(received);
    }
  }, [latest?.artifact?.content, dirty, content]);
  const running =
    hasActiveRun(state) ||
    Boolean(state.workspaceOperation) ||
    state.features.some((item) => item.autopilot?.status === 'running');
  const unlocked = step.dependsOn.every(
    (id) => feature.steps.find((s) => s.id === id)?.status === 'approved',
  );
  const canRun =
    state.workspace.trusted &&
    state.runtime.state === 'ready' &&
    !running &&
    unlocked &&
    !feature.archived &&
    step.attempts.length < step.maxAttempts;
  const next = feature.steps.find((s) => s.dependsOn.includes(step.id) && s.status !== 'approved');
  const agent = state.agents.find((a) => a.id === step.agentId);
  const unanswered = latest?.questions.filter((q) => !latest.answers[q.id]) ?? [];
  const blocked = !state.workspace.trusted
    ? 'Le projet doit être approuvé dans VS Code.'
    : state.runtime.state !== 'ready'
      ? 'Vérifiez la connexion Copilot avant de lancer une étape.'
      : !unlocked
        ? 'Validez les étapes précédentes pour débloquer celle-ci.'
        : step.attempts.length >= step.maxAttempts
          ? `La limite de ${step.maxAttempts} tentative${step.maxAttempts > 1 ? 's' : ''} est atteinte.`
          : feature.archived
            ? 'Restaurez la session pour poursuivre.'
            : '';
  const run = (resume = false) => {
    const action = () => setLaunchResume(resume);
    if ((latest || step.status === 'approved') && !resume)
      confirm(
        step.status === 'approved' ? 'Rejouer une étape validée ?' : 'Relancer cette étape ?',
        step.status === 'approved'
          ? 'Une nouvelle tentative sera créée. Les étapes suivantes deviennent à actualiser et devront être validées à nouveau. Les fichiers déjà modifiés restent présents.'
          : 'Une nouvelle tentative sera ajoutée à l’historique. Les modifications éventuelles du projet restent présentes.',
        action,
      );
    else action();
  };
  return (
    <div className="step-layout">
      {launchResume !== null && (
        <LaunchDialog
          feature={feature}
          step={step}
          state={state}
          resume={launchResume}
          feedback={feedback}
          dispatch={dispatch}
          onClose={() => setLaunchResume(null)}
        />
      )}
      <section className="workbench">
        <div className="workbench-heading">
          <div>
            <span className="eyebrow">
              ÉTAPE {String(feature.steps.indexOf(step) + 1).padStart(2, '0')}
            </span>
            <h2>{step.name}</h2>
            <p>{step.description}</p>
          </div>
          <Badge {...statuses[step.status]} />
        </div>
        <div className="agent-strip">
          <Avatar agent={agent} status={step.status} small />
          <div>
            <strong>{agent?.nickname || agent?.name || step.agentId}</strong>
            <span>
              {step.model || agent?.model || state.settings.defaultModel || 'Modèle automatique'}
              <span className="inline-dot" />
              {policyLabels[step.policy]}
            </span>
          </div>
          <button
            className="text-button"
            disabled={running || dirty || Boolean(feature.archived)}
            onClick={() => setConfig(!config)}
            aria-expanded={config}
          >
            <Settings2 size={14} />
            {config ? 'Fermer' : 'Configurer'}
          </button>
        </div>
        {config && (
          <StepConfig
            key={`${step.agentId}-${step.model}-${step.skills.join(',')}`}
            step={step}
            state={state}
            save={(values) => {
              const action = () => {
                dispatch({
                  type: 'configureStep',
                  featureId: feature.id,
                  stepId: step.id,
                  ...values,
                });
                setConfig(false);
              };
              const contextChanged =
                values.agentId !== step.agentId ||
                (values.model ?? '') !== (step.model ?? '') ||
                (values.reasoning ?? '') !== (step.reasoning ?? '') ||
                JSON.stringify(values.skills) !== JSON.stringify(step.skills) ||
                (values.initialContext ?? '') !== (step.initialContext ?? '') ||
                JSON.stringify(values.mcpServerIds ?? []) !==
                  JSON.stringify(step.mcpServerIds ?? []) ||
                Boolean(values.askBeforeRun) !== Boolean(step.askBeforeRun);
              if (step.status === 'approved' && contextChanged)
                confirm(
                  'Modifier une étape validée ?',
                  'La configuration change le contexte du livrable. Les étapes suivantes deviennent à actualiser et devront être validées à nouveau.',
                  action,
                );
              else action();
            }}
          />
        )}
        <div className="workbench-tabs" role="tablist" aria-label="Contenu de l’étape">
          <button
            role="tab"
            id="tab-artifact"
            aria-controls="step-content"
            aria-selected={tab === 'artifact'}
            onClick={() => setTab('artifact')}
          >
            <FileText size={15} /> Livrable
          </button>
          <button
            role="tab"
            id="tab-activity"
            aria-controls="step-content"
            aria-selected={tab === 'activity'}
            onClick={() => setTab('activity')}
          >
            <Workflow size={15} /> Activité{' '}
            {attempt?.logs.length ? <span>{attempt.logs.length}</span> : null}
          </button>
          <button
            role="tab"
            id="tab-diffs"
            aria-controls="step-content"
            aria-selected={tab === 'diffs'}
            onClick={() => setTab('diffs')}
          >
            <FileCode2 size={15} /> Fichiers <span>{attempt?.changedFiles.length ?? 0}</span>
          </button>
          <button
            role="tab"
            id="tab-evidence"
            aria-controls="step-content"
            aria-selected={tab === 'evidence'}
            onClick={() => setTab('evidence')}
          >
            <ShieldCheck size={15} /> Preuves <span>{attempt?.evidence?.length ?? 0}</span>
          </button>
          <button
            role="tab"
            id="tab-review"
            aria-controls="step-content"
            aria-selected={tab === 'review'}
            onClick={() => setTab('review')}
          >
            <MessageSquare size={15} /> Relecture
          </button>
        </div>
        <div
          id="step-content"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          className="workbench-content"
        >
          {tab === 'evidence' && (
            <EvidencePanel attempt={attempt} featureId={feature.id} dispatch={dispatch} />
          )}
          {tab === 'review' && (
            <ReviewWorkspace
              key={`${attempt?.id}-${JSON.stringify(feature.criteria)}`}
              feature={feature}
              step={step}
              attempt={attempt}
              state={state}
              dispatch={dispatch}
              onCorrection={(text, commentId, findingId) =>
                onCorrection(
                  step.id,
                  text,
                  findingId ? [findingId] : [],
                  commentId ? [commentId] : [],
                )
              }
              correctionDisabled={running || dirty || historic || Boolean(feature.archived)}
            />
          )}
          {tab === 'artifact' &&
            (attempt?.artifact ? (
              <>
                <div className="artifact-toolbar">
                  <span>
                    <FileText size={13} />
                    {attempt.artifact.name}
                    {historic && <em>Tentative précédente</em>}
                  </span>
                  {!historic && (
                    <button
                      className="text-button"
                      disabled={running || savePending || Boolean(feature.archived)}
                      onClick={() => {
                        if (!edit && !dirty) {
                          editStateKey.current = featureStateKey(feature);
                          editAttemptId.current = latest?.id;
                          editRevision.current = latest?.revision ?? 0;
                          setDescription(feature.description);
                          setSaveError('');
                        }
                        setEdit(!edit);
                      }}
                    >
                      {edit ? 'Fermer l’éditeur' : 'Modifier le compte rendu'} <Code2 size={13} />
                    </button>
                  )}
                </div>
                {!historic && (
                  <button
                    className="text-button report-correction-button"
                    disabled={
                      running ||
                      dirty ||
                      Boolean(feature.archived) ||
                      !['approved', 'awaiting_review', 'stale'].includes(step.status)
                    }
                    onClick={() => onCorrection(step.id, feedback || latest?.review?.summary || '')}
                  >
                    <RefreshCw size={14} />
                    Demander une correction
                  </button>
                )}
                {edit && !historic ? (
                  <ReportEditor
                    content={content}
                    onChange={setContent}
                    reason={reason}
                    onReason={setReason}
                    original={
                      latest?.artifactVersions?.find((v) => v.author === 'agent')?.content ??
                      latest?.artifact?.content ??
                      ''
                    }
                    descriptionVersions={feature.descriptionVersions}
                    description={description}
                    onDescription={setDescription}
                    descriptionChanged={descriptionChanged}
                    onDescriptionChanged={setDescriptionChanged}
                    versions={(latest?.artifactVersions ?? [])
                      .filter((v) => v.author === 'human')
                      .map((version) => {
                        const previous = latest?.artifactVersions
                          ?.filter((v) => v.revision < version.revision)
                          .at(-1);
                        return {
                          id: String(version.revision),
                          label: `Version ${version.revision + 1} · ${date(version.at)}`,
                          before: previous?.content ?? '',
                          after: version.content,
                          reason: version.reason,
                        };
                      })}
                    busy={running || savePending}
                    error={saveError}
                    dirty={dirty}
                    currentContent={latest?.artifact?.content ?? ''}
                    refreshBaseline={() => {
                      editStateKey.current = featureStateKey(feature);
                      editAttemptId.current = latest?.id;
                      editRevision.current = latest?.revision ?? 0;
                      setSavedContent(latest?.artifact?.content ?? '');
                      setSaveError('');
                    }}
                    discard={() =>
                      confirm(
                        'Abandonner ce brouillon ?',
                        'Les modifications non enregistrées de ce compte rendu et du besoin seront abandonnées.',
                        () => {
                          setContent(latest?.artifact?.content ?? '');
                          setSavedContent(latest?.artifact?.content ?? '');
                          setDescription(feature.description);
                          setDescriptionChanged(false);
                          setSaveError('');
                          setEdit(false);
                        },
                      )
                    }
                    blockers={[
                      ...approvalBlockers(feature, { ...step, status: 'awaiting_review' }, 'human'),
                      ...(running
                        ? [
                            state.workspaceOperation?.label ??
                              (state.features.some((item) => item.autopilot?.status === 'running')
                                ? 'Arrêtez le pilote avant de modifier le compte rendu.'
                                : 'Attendez la fin de l’exécution en cours.'),
                          ]
                        : []),
                      ...(!content.trim() ? ['Un compte rendu non vide est nécessaire.'] : []),
                      ...(descriptionChanged && description !== feature.description
                        ? [
                            'Le besoin modifié rend les étapes précédentes à revoir. Faites réviser par l’agent pour reprendre le parcours depuis le début.',
                          ]
                        : []),
                    ]}
                    save={() => saveReport('approve')}
                    review={() => saveReport('review')}
                  />
                ) : (
                  <article className="markdown">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noreferrer">
                            {children}
                            <ExternalLink size={11} />
                          </a>
                        ),
                      }}
                    >
                      {historic ? attempt.artifact.content : content}
                    </Markdown>
                  </article>
                )}
              </>
            ) : (
              <Empty
                title={
                  step.status === 'running'
                    ? 'Votre agent est à l’œuvre'
                    : 'Un espace pour le prochain livrable'
                }
                icon={step.status === 'running' ? <LoaderCircle className="spin" /> : <FileText />}
              >
                {step.status === 'running'
                  ? 'Suivez sa progression dans l’activité. Le résultat apparaîtra ici à la fin de la tentative.'
                  : 'Lancez cette étape pour obtenir un premier livrable. Vous pourrez ensuite le lire, l’ajuster et le valider.'}
              </Empty>
            ))}
          {tab === 'activity' && (
            <div className="activity-list" aria-live={step.status === 'running' ? 'polite' : 'off'}>
              {attempt?.traceArchive && (
                <TraceJournal featureId={feature.id} attemptId={attempt.id} dispatch={dispatch} />
              )}
              {attempt?.logs.map((log) => (
                <div key={log.id} className={`activity-event ${log.kind}`}>
                  <span className="event-marker">
                    {log.kind === 'error' ? (
                      <X size={12} />
                    ) : log.kind === 'tool' ? (
                      <Code2 size={12} />
                    ) : log.kind === 'warning' ? (
                      <TriangleAlert size={12} />
                    ) : (
                      <Circle size={9} />
                    )}
                  </span>
                  <div>
                    <time>
                      {new Intl.DateTimeFormat('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      }).format(new Date(log.at))}
                    </time>
                    <p>{log.message}</p>
                  </div>
                </div>
              ))}
              {!attempt?.logs.length && (
                <Empty title="L’histoire commence à la première exécution" icon={<Workflow />}>
                  Les messages et les appels d’outils de l’agent apparaîtront ici.
                </Empty>
              )}
              {step.status === 'running' && (
                <div className="stream-indicator">
                  <LoaderCircle className="spin" size={14} /> Exécution en cours…
                </div>
              )}
            </div>
          )}
          {tab === 'diffs' &&
            (attempt?.changedFiles.length ? (
              <div className="changed-files">
                <p>
                  Fichiers signalés par cette tentative. Ouvrez leur diff dans VS Code pour relire
                  les changements.
                </p>
                {attempt.changedFiles.map((path) => (
                  <div key={path}>
                    <FileCode2 size={16} />
                    <span title={path}>{path}</span>
                    <button
                      className="text-button"
                      onClick={() => dispatch({ type: 'openFile', path, featureId: feature.id })}
                    >
                      Ouvrir
                    </button>
                    <button
                      className="button secondary small"
                      onClick={() => dispatch({ type: 'openDiff', path, featureId: feature.id })}
                    >
                      Voir le diff <ArrowUpRight size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Aucun fichier signalé" icon={<FileCode2 />}>
                Cette tentative ne déclare aucun fichier modifié. L’historique Git du projet reste
                la référence.
              </Empty>
            ))}
        </div>
      </section>
      <aside className="step-aside">
        <HumanRequests
          requests={(state.humanRequests ?? []).filter(
            (r) => r.featureId === feature.id && r.stepId === step.id,
          )}
          dispatch={dispatch}
        />
        <div className="decision-card">
          <span className="eyebrow">À VOUS DE DONNER LE CAP</span>
          <h3>
            {step.status === 'approved'
              ? 'Une étape de plus.'
              : step.status === 'running'
                ? 'Ça prend forme.'
                : step.status === 'waiting_input'
                  ? 'Votre regard est nécessaire.'
                  : step.status === 'awaiting_review'
                    ? 'Prêt pour votre regard.'
                    : 'Faisons le prochain pas.'}
          </h3>
          <p>
            {step.status === 'approved'
              ? 'Le livrable a été validé. Vous pouvez ouvrir la suite du parcours.'
              : step.status === 'running'
                ? 'L’agent travaille dans le cadre des permissions de cette étape.'
                : step.status === 'awaiting_review'
                  ? 'Lisez le livrable, affinez-le si nécessaire, puis validez pour avancer.'
                  : 'Votre retour accompagne l’agent dans sa prochaine tentative.'}
          </p>
          {latest?.error && (
            <div className="inline-error">
              <TriangleAlert size={15} />
              <span>{latest.error}</span>
            </div>
          )}
          {unanswered.length > 0 && (
            <form
              className="questions-form"
              onSubmit={(e) => {
                e.preventDefault();
                dispatch({
                  type: 'answerQuestions',
                  featureId: feature.id,
                  stepId: step.id,
                  answers,
                });
              }}
            >
              {unanswered.map((q) => (
                <label className="field" key={q.id}>
                  <span>{q.text}</span>
                  {q.choices?.length ? (
                    <select
                      required
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    >
                      <option value="">Choisir une réponse…</option>
                      {q.choices.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      required
                      rows={2}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              <button
                className="button primary"
                disabled={
                  !state.workspace.trusted ||
                  Boolean(feature.archived) ||
                  !unanswered.every((q) => answers[q.id]?.trim())
                }
              >
                <Send size={15} /> Transmettre les réponses
              </button>
            </form>
          )}
          {!['running', 'waiting_input'].includes(step.status) && (
            <label className="field feedback-field">
              <span>
                Votre retour <small>facultatif</small>
              </span>
              <textarea
                rows={4}
                placeholder="Un détail à préciser, une autre direction à explorer…"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </label>
          )}
          <div className="decision-actions">
            {step.status === 'running' ? (
              <button
                className="button secondary"
                onClick={() =>
                  confirm(
                    'Arrêter cette exécution ?',
                    'La tentative sera annulée. Les modifications déjà effectuées dans le projet seront conservées.',
                    () => dispatch({ type: 'cancelRun', featureId: feature.id }),
                  )
                }
              >
                <Square size={14} /> Arrêter l’exécution
              </button>
            ) : step.status === 'approved' ? (
              <>
                {next ? (
                  <button className="button primary" onClick={() => selectStep(next.id)}>
                    Continuer vers {next.name}
                    <ArrowRight size={15} />
                  </button>
                ) : (
                  <div className="completion-note">
                    <CheckCircle2 size={18} />{' '}
                    {feature.status === 'completed'
                      ? 'Décision finale enregistrée — session terminée'
                      : `Étape validée. ${featureCompletionBlockers(feature).join(' ') || (feature.steps.every((item) => item.status === 'approved') ? 'Le bilan final attend votre décision.' : 'D’autres étapes restent à valider.')}`}
                  </div>
                )}
                <button
                  className="button secondary"
                  disabled={!canRun || dirty}
                  onClick={() => run()}
                >
                  <RefreshCw size={14} /> Rejouer cette étape
                </button>
              </>
            ) : (
              <>
                {step.status === 'awaiting_review' && (
                  <>
                    {approvalReasons.length > 0 && (
                      <div className="approval-blockers" role="status">
                        <strong>Validation bloquée</strong>
                        <ul>
                          {approvalReasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        <button className="button secondary" onClick={() => setTab('review')}>
                          Voir les critères et commentaires
                        </button>
                      </div>
                    )}
                    {approvalError && (
                      <div className="approval-blockers" role="alert">
                        <strong>La validation n’a pas été enregistrée</strong>
                        <p>{approvalError}</p>
                      </div>
                    )}
                    <button
                      className="button primary"
                      disabled={
                        approvalPending ||
                        approvalReasons.length > 0 ||
                        running ||
                        dirty ||
                        Boolean(feature.archived) ||
                        !state.workspace.trusted ||
                        Boolean(state.workspaceOperation)
                      }
                      onClick={() =>
                        confirm(
                          'Valider cette étape ?',
                          'Cette décision approuve le livrable actuel et débloque les étapes qui en dépendent.',
                          () => {
                            setApprovalError('');
                            setApprovalPending(true);
                            dispatch({
                              type: 'approveStep',
                              featureId: feature.id,
                              stepId: step.id,
                              expectedAttemptId: latest?.id,
                              expectedRevision: latest?.revision ?? 0,
                            });
                          },
                        )
                      }
                    >
                      {approvalPending ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Check size={16} />
                      )}{' '}
                      {approvalPending ? 'Validation en cours…' : 'Valider cette étape'}
                    </button>
                  </>
                )}
                {latest?.sessionId &&
                  ['failed', 'cancelled', 'interrupted', 'waiting_input'].includes(step.status) && (
                    <button
                      className="button secondary"
                      disabled={!canRun || dirty || unanswered.length > 0}
                      onClick={() => run(true)}
                    >
                      <RefreshCw size={15} /> Reprendre la session
                    </button>
                  )}
                {step.status !== 'waiting_input' && (
                  <button
                    className={`button ${step.status === 'awaiting_review' ? 'secondary' : 'primary'}`}
                    disabled={!canRun || dirty}
                    onClick={() => run()}
                  >
                    <Play size={14} />
                    {latest ? 'Nouvelle tentative' : 'Exécuter cette étape'}
                  </button>
                )}
              </>
            )}
          </div>
          {dirty && (
            <p className="action-help">
              Enregistrez vos modifications avant de valider ou relancer.
            </p>
          )}
          {blocked && step.status !== 'running' && (
            <p className="action-help">
              {blocked}
              {step.attempts.length >= step.maxAttempts && (
                <button
                  className="text-button"
                  disabled={running || Boolean(feature.archived)}
                  onClick={() => setConfig(true)}
                >
                  Modifier la limite <Settings2 size={12} />
                </button>
              )}
              {state.runtime.state !== 'ready' && (
                <button className="text-button" onClick={() => dispatch({ type: 'checkRuntime' })}>
                  Vérifier Copilot <RefreshCw size={12} />
                </button>
              )}
            </p>
          )}
        </div>
        <div className="history-card">
          <div className="section-heading">
            <h3>Les tentatives</h3>
            <span className="count-pill">{step.attempts.length}</span>
          </div>
          {step.attempts.length ? (
            <div className="attempt-list">
              {[...step.attempts].reverse().map((a, i) => (
                <button
                  key={a.id}
                  className={a.id === attempt?.id ? 'active' : ''}
                  disabled={dirty || savePending}
                  onClick={() => {
                    setAttemptId(a.id);
                    setEdit(false);
                  }}
                >
                  <span className="attempt-dot">
                    <Circle size={10} />
                  </span>
                  <span>
                    <strong>Tentative {step.attempts.length - i}</strong>
                    <small>{date(a.startedAt)}</small>
                  </span>
                  <span className={`attempt-state ${statuses[a.status].tone}`}>
                    {statuses[a.status].label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted history-empty">
              Une trace de chaque essai,
              <br />
              dès le premier lancement.
            </p>
          )}
          <AttemptCheckpointLinks
            feature={feature}
            attempt={attempt}
            state={state}
            dispatch={dispatch}
          />
          {attempt?.usage && (
            <div className="usage-note">
              <span>Consommation mesurée</span>
              {attempt.usage.inputTokens !== undefined && (
                <span>Entrée : {attempt.usage.inputTokens.toLocaleString('fr-FR')} tokens</span>
              )}
              {attempt.usage.outputTokens !== undefined && (
                <span>Sortie : {attempt.usage.outputTokens.toLocaleString('fr-FR')} tokens</span>
              )}
              {<span>{usageCredits(attempt.usage)}</span>}
            </div>
          )}
        </div>
        <div className="step-policy">
          <ShieldCheck size={16} />
          <div>
            <strong>{policyLabels[step.policy]}</strong>
            <p>
              {step.policy === 'read-only'
                ? 'Cette étape est destinée à analyser et proposer.'
                : step.policy === 'tests'
                  ? 'Seules les commandes de test configurées sont autorisées.'
                  : 'L’agent peut modifier les fichiers du projet pendant cette étape.'}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
function StepConfig({
  step,
  state,
  save,
}: {
  step: FeatureStep;
  state: StudioState;
  save: (v: {
    agentId: string;
    model?: string;
    reasoning?: string;
    skills: string[];
    maxAttempts: number;
    initialContext?: string;
    mcpServerIds?: string[];
    askBeforeRun?: boolean;
  }) => void;
}) {
  const [agent, setAgent] = useState(step.agentId);
  const [model, setModel] = useState(step.model ?? '');
  const [reasoning, setReasoning] = useState(step.reasoning ?? '');
  const [skills, setSkills] = useState(step.skills);
  const [maxAttempts, setMaxAttempts] = useState(step.maxAttempts);
  const [initialContext, setInitialContext] = useState(step.initialContext ?? '');
  const [mcpServerIds, setMcpServerIds] = useState(step.mcpServerIds ?? []);
  const [askBeforeRun, setAskBeforeRun] = useState(step.askBeforeRun ?? false);
  const efforts = state.runtime.models.find((m) => m.id === model)?.reasoningEfforts ?? [];
  return (
    <form
      className="step-config"
      onSubmit={(e) => {
        e.preventDefault();
        save({
          agentId: agent,
          model: model || undefined,
          reasoning: reasoning || undefined,
          skills,
          maxAttempts,
        });
      }}
    >
      <div className="field-row">
        <label className="field">
          <span>Profil de l’agent</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {state.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <ModelSelect
          state={state}
          value={model}
          onChange={(v) => {
            setModel(v);
            setReasoning('');
          }}
        />
      </div>
      {(efforts.length > 0 || reasoning) && (
        <label className="field">
          <span>Effort de raisonnement</span>
          <select value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
            <option value="">Automatique</option>
            {reasoning && !efforts.includes(reasoning) && (
              <option value={reasoning}>{reasoning} · configuré</option>
            )}
            {efforts.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Limite de tentatives</span>
        <input
          type="number"
          required
          min={Math.max(step.attempts.length, 1)}
          max={100}
          value={maxAttempts}
          onChange={(e) => setMaxAttempts(Number(e.target.value))}
        />
        <small>
          {step.attempts.length} tentative{step.attempts.length > 1 ? 's' : ''} déjà effectuée
          {step.attempts.length > 1 ? 's' : ''}. Chaque nouvelle tentative peut consommer votre
          quota Copilot. Augmenter la limite autorise ces exécutions supplémentaires.
        </small>
      </label>
      <label className="field">
        <span>Contexte initial de l’étape</span>
        <textarea
          rows={3}
          value={initialContext}
          onChange={(e) => setInitialContext(e.target.value)}
          placeholder="Le contexte proposé à chaque lancement de cette étape."
        />
      </label>
      <McpPicker state={state} selected={mcpServerIds} onChange={setMcpServerIds} />
      <label className="inline-check">
        <input
          type="checkbox"
          checked={askBeforeRun}
          onChange={(e) => setAskBeforeRun(e.target.checked)}
        />
        <span>Demander un contexte humain avant exécution automatique</span>
      </label>
      <fieldset className="skill-options">
        <legend>Skills pour cette étape</legend>
        {state.skills.length ? (
          state.skills.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={skills.includes(s.id)}
                onChange={(e) =>
                  setSkills(
                    e.target.checked ? [...skills, s.id] : skills.filter((id) => id !== s.id),
                  )
                }
              />
              {s.name}
            </label>
          ))
        ) : (
          <span className="muted">Aucune skill disponible dans ce projet.</span>
        )}
      </fieldset>
      <button className="button secondary small" disabled={!agent}>
        Enregistrer la configuration <Check size={14} />
      </button>
    </form>
  );
}
const avatarOptions = [
  { id: 'wizard', name: 'Le mage' },
  { id: 'hacker', name: 'Le hacker' },
  { id: 'detective', name: 'Le détective' },
  { id: 'lumberjack', name: 'Le bûcheron' },
  { id: 'scientist', name: 'La scientifique' },
  { id: 'robot', name: 'Le robot' },
  { id: 'ninja', name: 'Le ninja' },
  { id: 'captain', name: 'La capitaine' },
  { id: 'devops-scout', name: 'Éclaireur' },
  { id: 'devops-architect', name: 'Architecte DevOps' },
  { id: 'devops-builder', name: 'Bâtisseur' },
  { id: 'devops-sentinel', name: 'Vigie' },
  { id: 'devops-lab', name: 'Laborantin' },
  { id: 'devops-controller', name: 'Contrôleur' },
];
const avatarDefaults: Record<string, string> = {
  'fs-specs': 'detective',
  'fs-plan': 'wizard',
  'fs-dev': 'hacker',
  'fs-tests': 'scientist',
  'fs-review': 'ninja',
  analyst: 'detective',
  architect: 'wizard',
  builder: 'hacker',
  tester: 'scientist',
  reviewer: 'ninja',
};
function Avatar({
  agent,
  status = 'pending',
  small = false,
}: {
  agent?: AgentProfile;
  status?: StepStatus;
  small?: boolean;
}) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [failed, setFailed] = useState(false);
  const id = agent?.avatar || avatarDefaults[agent?.id ?? ''] || 'robot';
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const pose =
    status === 'approved'
      ? 'approved.png'
      : status === 'running' && !reduced
        ? 'working.gif'
        : 'idle.png';
  useEffect(() => setFailed(false), [id, pose]);
  return (
    <span className={`pixel-avatar ${small ? 'small' : ''} ${status}`} aria-hidden="true">
      {failed ? (
        <Bot size={small ? 21 : 30} />
      ) : (
        <img
          src={`${import.meta.env.BASE_URL}avatars/${id}/${pose}`}
          alt=""
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
function AgentEditor({
  agent,
  state,
  onClose,
  onMigrate,
  save,
}: {
  agent: AgentProfile | 'new';
  state: StudioState;
  onClose: () => void;
  onMigrate: () => void;
  save: (
    a: Extract<ClientMessage, { type: 'saveAgent' }>['agent'],
    options: ProfileSaveOptions,
    requestId: string,
  ) => void;
}) {
  const blank = agent === 'new';
  const source = blank ? null : agent;
  const [id, setId] = useState(source?.id ?? '');
  const [name, setName] = useState(source?.name ?? '');
  const [nickname, setNickname] = useState(source?.nickname ?? '');
  const [avatar, setAvatar] = useState(
    source?.avatar ?? avatarDefaults[source?.id ?? ''] ?? 'robot',
  );
  const [description, setDescription] = useState(source?.description ?? '');
  const [instructions, setInstructions] = useState(source?.instructions ?? '');
  const [tools, setTools] = useState(source?.tools.join(', ') ?? '');
  const [model, setModel] = useState(source?.model ?? '');
  const [skills, setSkills] = useState(source?.skills ?? []);
  const [emptyContextByDefault, setEmptyContextByDefault] = useState(
    source?.emptyContextByDefault ?? false,
  );
  const [roastLevel, setRoastLevel] = useState<RoastLevel>(normalizeRoastLevel(source?.roastLevel));
  const [scope, setScope] = useState<ProfileScope>(
    source?.source === 'workspace' ? 'workspace' : 'user',
  );
  const [origin, setOrigin] = useState(source);
  const drafts = useRef<
    Partial<
      Record<
        ProfileScope,
        {
          fields: {
            id: string;
            name: string;
            nickname: string;
            avatar: string;
            description: string;
            instructions: string;
            tools: string;
            model: string;
            skills: string[];
            emptyContextByDefault: boolean;
            roastLevel: RoastLevel;
          };
          origin: typeof source;
        }
      >
    >
  >({});
  const saving = useProfileSave(onClose);
  const version = source?.versions?.find((version) => version.source === scope);
  const target =
    source?.targets?.[scope] ??
    (state.profileDirectories && {
      path: `${state.profileDirectories[scope]}/${scope === 'workspace' ? '.github/' : ''}agents/${id}.agent.md`,
      revision: null,
    });
  const collision = blank && state.agents.some((entry) => entry.id === id);
  const changeScope = (next: ProfileScope) => {
    drafts.current[scope] = {
      fields: {
        id,
        name,
        nickname,
        avatar,
        description,
        instructions,
        tools,
        model,
        skills,
        emptyContextByDefault,
        roastLevel,
      },
      origin,
    };
    const cached = drafts.current[next];
    const existing = source?.versions?.find((version) => version.source === next);
    const chosen =
      cached?.fields ??
      (existing && {
        ...existing,
        nickname: existing.nickname ?? '',
        avatar: existing.avatar ?? 'robot',
        tools: existing.tools.join(', '),
        model: existing.model ?? '',
        emptyContextByDefault: existing.emptyContextByDefault ?? false,
        roastLevel: normalizeRoastLevel(existing.roastLevel),
      });
    if (chosen) {
      setId(chosen.id);
      setName(chosen.name);
      setNickname(chosen.nickname);
      setAvatar(chosen.avatar);
      setDescription(chosen.description);
      setInstructions(chosen.instructions);
      setTools(chosen.tools);
      setModel(chosen.model);
      setSkills(chosen.skills);
      setEmptyContextByDefault(chosen.emptyContextByDefault);
      setRoastLevel(chosen.roastLevel);
    }
    setOrigin(cached ? cached.origin : (existing ?? origin));
    setScope(next);
  };
  const slug = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return (
    <Modal
      title={blank ? 'Un nouveau membre de l’atelier.' : nickname || name}
      subtitle={
        blank
          ? 'Un rôle clair, un caractère à lui, et des instructions qui donnent le cap.'
          : source?.path
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saving.start((requestId) =>
            save(
              {
                id,
                name,
                description,
                instructions,
                tools: tools
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                model: model || undefined,
                skills,
                nickname: nickname.trim() || undefined,
                avatar,
                emptyContextByDefault,
                roastLevel,
              },
              profileOptions(scope, target, origin ?? undefined),
              requestId,
            ),
          );
        }}
      >
        <fieldset disabled={saving.pending} style={{ display: 'contents' }}>
          <ProfileScopeSelector
            scope={scope}
            onChange={changeScope}
            target={target || undefined}
            active={source?.source}
            origin={origin?.source}
            versions={source?.versions ?? (source ? [source] : [])}
            pending={saving.pending}
            error={saving.error}
          />
          {collision && (
            <p role="alert">
              Cet identifiant existe déjà. Ouvrez le profil existant ou choisissez un nouvel
              identifiant pour créer une copie.
            </p>
          )}
          <div className="agent-identity">
            <Avatar agent={{ ...source, id, name, avatar } as AgentProfile} />
            <label className="field">
              <span>
                Son petit nom <small>facultatif</small>
              </span>
              <input
                maxLength={60}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Ex. Merlin, Ada, Capitaine Patch…"
              />
            </label>
          </div>
          <fieldset className="avatar-picker">
            <legend>Choisissez son personnage</legend>
            {avatarOptions.map((a) => (
              <button
                key={a.id}
                type="button"
                className={avatar === a.id ? 'chosen' : ''}
                aria-label={a.name}
                aria-pressed={avatar === a.id}
                onClick={() => setAvatar(a.id)}
              >
                <img src={`${import.meta.env.BASE_URL}avatars/${a.id}/idle.png`} alt="" />
                <span>{a.name}</span>
                {avatar === a.id && <Check size={12} />}
              </button>
            ))}
          </fieldset>
          <div className="field-row">
            <label className="field">
              <span>
                Nom du profil <em>*</em>
              </span>
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (blank) setId(slug(e.target.value));
                }}
              />
            </label>
            <label className="field">
              <span>Identifiant</span>
              <input
                required
                pattern="[a-z0-9][a-z0-9-]*"
                value={id}
                disabled={!blank}
                onChange={(e) => setId(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>Rôle et description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            <span>
              Instructions <em>*</em>
            </span>
            <textarea
              required
              className="code-input"
              rows={7}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Décrivez sa mission, ses méthodes et les critères d’un travail réussi."
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Outils demandés</span>
              <input
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="read, search, edit, execute"
              />
              <small>
                Noms pris en charge : read, search, edit, execute. execute permet uniquement les
                commandes de test préautorisées, sans accès shell. studio_devops_inspect lit les
                pipelines et résultats du dépôt Azure DevOps configuré ; studio_devops_verify_test
                vérifie le test manuel dans une étape exigeant sa preuve. Les permissions de l’étape
                restent applicables.
              </small>
            </label>
            <ModelSelect state={state} value={model} onChange={setModel} />
          </div>
          <label className="field">
            <span>Mode roast</span>
            <select
              aria-label="Mode roast"
              value={roastLevel}
              onChange={(e) => setRoastLevel(e.target.value as RoastLevel)}
            >
              {ROAST_LEVELS.map((level) => (
                <option value={level} key={level}>
                  {roastLabel(level)}
                </option>
              ))}
            </select>
            <small>
              Un ton complice pour ses comptes rendus : les piques visent les choix et le code. Les
              documents du projet restent professionnels. Le niveau est fixé au lancement ; les
              anciens rapports restent tels quels.
            </small>
          </label>
          {roastLevel !== 'off' && (
            <details>
              <summary>Aperçu des consignes roast · {roastLabel(roastLevel)}</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{roastInstructions(roastLevel)}</pre>
            </details>
          )}
          <label className="context-default-option">
            <input
              type="checkbox"
              checked={emptyContextByDefault}
              onChange={(e) => setEmptyContextByDefault(e.target.checked)}
            />
            <span>
              <strong>Contexte vide par défaut</strong>
              <small>
                Tous les blocs optionnels commencent décochés à chaque nouvelle tentative.
                Sélectionnez ensuite la spec, le plan ou les autres informations utiles. Le cadre
                d’exécution reste actif.
              </small>
            </span>
          </label>
          <fieldset className="skill-options">
            <legend>Skills associées</legend>
            {state.skills.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={skills.includes(s.id)}
                  onChange={(e) =>
                    setSkills(
                      e.target.checked ? [...skills, s.id] : skills.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
            {!state.skills.length && (
              <span className="muted">Créez votre première skill depuis la bibliothèque.</span>
            )}
          </fieldset>
          <div className="modal-actions">
            <span className="muted">
              {saving.pending
                ? 'Sauvegarde en cours…'
                : version
                  ? 'Modification de la version choisie.'
                  : 'Création d’une version dans la portée choisie.'}
            </span>
            <button type="button" className="button secondary" onClick={onClose}>
              Annuler
            </button>
            {source?.source === 'workspace' && (
              <button type="button" className="button secondary" onClick={onMigrate}>
                Migrer vers le compte utilisateur
              </button>
            )}
            <button
              className="button primary"
              disabled={saving.pending || collision || !id || !name.trim() || !instructions.trim()}
            >
              Enregistrer le profil <Check size={15} />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function SkillEditor({
  skill,
  state,
  onClose,
  onMigrate,
  save,
}: {
  skill: SkillInfo | 'new';
  state: StudioState;
  onClose: () => void;
  onMigrate: () => void;
  save: (id: string, content: string, options: ProfileSaveOptions, requestId: string) => void;
}) {
  const blank = skill === 'new';
  const source = blank ? null : skill;
  const [id, setId] = useState(source?.id ?? '');
  const [content, setContent] = useState(
    source?.content ??
      '---\nname: Ma nouvelle skill\ndescription: Décrivez la méthode et quand l’utiliser.\n---\n\n# Ma nouvelle skill\n\n## Méthode\n\n1. Comprendre le contexte.\n2. Appliquer les conventions du projet.\n3. Vérifier le résultat.\n',
  );
  const [preview, setPreview] = useState(false);
  const [scope, setScope] = useState<ProfileScope>(
    source?.source === 'workspace' ? 'workspace' : 'user',
  );
  const [origin, setOrigin] = useState(source);
  const drafts = useRef<Partial<Record<ProfileScope, { content: string; origin: typeof source }>>>(
    {},
  );
  const saving = useProfileSave(onClose);
  const target =
    source?.targets?.[scope] ??
    (state.profileDirectories && {
      path: `${state.profileDirectories[scope]}/${scope === 'workspace' ? '.github/' : ''}skills/${id}/SKILL.md`,
      revision: null,
    });
  const collision = blank && state.skills.some((entry) => entry.id === id);
  const changeScope = (next: ProfileScope) => {
    drafts.current[scope] = { content, origin };
    const cached = drafts.current[next];
    const existing = source?.versions?.find((version) => version.source === next);
    setContent(cached?.content ?? existing?.content ?? content);
    setOrigin(cached ? cached.origin : (existing ?? origin));
    setScope(next);
  };
  return (
    <Modal
      title={blank ? 'Une méthode qui se transmet.' : (source?.name ?? 'Skill')}
      subtitle={
        source?.path ??
        'Une skill est un fichier Markdown avec une méthode précise et réutilisable.'
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saving.start((requestId) =>
            save(
              id,
              content,
              profileOptions(scope, target || undefined, origin ?? undefined),
              requestId,
            ),
          );
        }}
      >
        <fieldset disabled={saving.pending} style={{ display: 'contents' }}>
          <ProfileScopeSelector
            scope={scope}
            onChange={changeScope}
            target={target || undefined}
            active={source?.source}
            origin={origin?.source}
            versions={source?.versions ?? (source ? [source] : [])}
            pending={saving.pending}
            error={saving.error}
          />
          {collision && (
            <p role="alert">
              Cet identifiant existe déjà. Ouvrez la skill existante ou choisissez un nouvel
              identifiant pour créer une copie.
            </p>
          )}
          <label className="field">
            <span>
              Identifiant de la skill <em>*</em>
            </span>
            <input
              required
              pattern="[a-z0-9][a-z0-9-]*"
              disabled={!blank}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="ex. revue-accessibilite"
            />
            <small>Lettres minuscules, chiffres et tirets.</small>
          </label>
          <div className="section-heading">
            <h3>SKILL.md</h3>
            <button type="button" className="text-button" onClick={() => setPreview(!preview)}>
              <FileText size={14} />
              {preview ? 'Éditer' : 'Aperçu'}
            </button>
          </div>
          {preview ? (
            <div className="skill-preview markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            </div>
          ) : (
            <label className="field">
              <span className="sr-only">Contenu de la skill</span>
              <textarea
                required
                className="code-input"
                rows={16}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}
          <div className="modal-actions">
            <span className="muted">
              {saving.pending
                ? 'Sauvegarde en cours…'
                : 'Le fichier SKILL.md complet est conservé.'}
            </span>
            <button type="button" className="button secondary" onClick={onClose}>
              Annuler
            </button>
            {source?.source === 'workspace' && (
              <button type="button" className="button secondary" onClick={onMigrate}>
                Migrer vers le compte utilisateur
              </button>
            )}
            <button
              className="button primary"
              disabled={saving.pending || collision || !id || !content.trim()}
            >
              Enregistrer la skill <Check size={15} />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function SettingsView({
  settings,
  state,
  automation,
  dispatch,
}: {
  settings: StudioSettings;
  state: StudioState;
  automation: boolean;
  dispatch: (m: ClientMessage) => void;
}) {
  const [draft, setDraft] = useState(structuredClone(settings));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = (patch: Partial<StudioSettings>) => setDraft({ ...draft, ...patch });
  const lines = (text: string) =>
    text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    dispatch({
      type: 'saveSettings',
      settings: {
        ...draft,
        mcpServers: draft.mcpServers?.map((s) => ({
          ...s,
          args: s.args.filter(Boolean),
          tools: s.tools.map((t) => t.trim()).filter(Boolean),
          envKeys: s.envKeys.map((t) => t.trim()).filter(Boolean),
        })),
        testPaths: lines(draft.testPaths.join('\n')),
        testCommands: draft.testCommands.map((c) => ({
          ...c,
          args: c.args.filter((a) => a.length > 0),
        })),
        hooks: draft.hooks.map((h) => ({ ...h, args: h.args.filter((a) => a.length > 0) })),
      },
    });
  };
  return (
    <div className="page settings-page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">
            {automation ? 'LES RITUELS DE VOTRE ATELIER' : 'VOTRE ENVIRONNEMENT'}
          </span>
          <h1>
            {automation
              ? 'Un bon rythme, des règles claires.'
              : 'Les détails qui vous ressemblent.'}
          </h1>
          <p>
            {automation
              ? 'Configurez les scripts avant et après chaque exécution. Vous choisissez lesquels activer.'
              : 'Reliez votre runtime Copilot et définissez le cadre de travail de vos agents.'}
          </p>
        </div>
      </div>
      {!automation && <ThemePicker />}
      <form onSubmit={submit}>
        {!automation && (
          <>
            <McpSettings
              servers={draft.mcpServers ?? []}
              state={state}
              onChange={(mcpServers) => set({ mcpServers })}
              dispatch={dispatch}
            />
            <ModelBudgetSettings settings={draft} state={state} onChange={set} />
            <TraceStorageSetting
              value={draft.traceLimitBytes}
              onChange={(traceLimitBytes) => set({ traceLimitBytes })}
            />
            <section className="settings-card">
              <div className="settings-card-title">
                <span className="settings-icon color-2">
                  <Command size={21} />
                </span>
                <div>
                  <h2>GitHub Copilot CLI</h2>
                  <p>Le moteur de vos sessions, installé dans votre environnement.</p>
                </div>
                <Badge
                  label={
                    state.runtime.state === 'ready'
                      ? 'Connecté'
                      : state.runtime.state === 'checking'
                        ? 'Vérification'
                        : state.runtime.state === 'unavailable'
                          ? 'Indisponible'
                          : 'Non vérifié'
                  }
                  tone={
                    state.runtime.state === 'ready'
                      ? 'green'
                      : state.runtime.state === 'unavailable'
                        ? 'coral'
                        : 'neutral'
                  }
                />
              </div>
              {state.runtime.error && (
                <div className="inline-error">
                  <TriangleAlert size={16} />
                  {state.runtime.error}
                </div>
              )}
              <div className="runtime-facts">
                <div>
                  <span>Compte</span>
                  <strong>{state.runtime.account ?? 'À vérifier'}</strong>
                </div>
                <div>
                  <span>Version</span>
                  <strong>{state.runtime.version ?? 'À vérifier'}</strong>
                </div>
                <div>
                  <span>Modèles disponibles</span>
                  <strong>{state.runtime.models.length || 'À vérifier'}</strong>
                </div>
              </div>
              <div className="runtime-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={state.runtime.state === 'checking'}
                  onClick={() => dispatch({ type: 'checkRuntime' })}
                >
                  <RefreshCw size={15} /> Vérifier la connexion
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => dispatch({ type: 'openSettings' })}
                >
                  Chemin du CLI dans VS Code <ArrowUpRight size={14} />
                </button>
              </div>
            </section>
            <section className="settings-card">
              <div className="settings-card-title">
                <span className="settings-icon color-0">
                  <Settings2 size={21} />
                </span>
                <div>
                  <h2>Préférences des sessions</h2>
                  <p>Des valeurs par défaut, ajustables à chaque étape.</p>
                </div>
              </div>
              <div className="field-row">
                <ModelSelect
                  state={state}
                  value={draft.defaultModel}
                  onChange={(defaultModel) => set({ defaultModel })}
                  label="Modèle par défaut"
                />
                <label className="field">
                  <span>Durée maximale d’une tentative</span>
                  <div className="input-unit">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      required
                      value={draft.timeoutMinutes}
                      onChange={(e) => set({ timeoutMinutes: Number(e.target.value) })}
                    />
                    <span>minutes</span>
                  </div>
                </label>
              </div>
            </section>
            <section className="settings-card">
              <div className="settings-card-title">
                <span className="settings-icon color-1">
                  <CheckCircle2 size={21} />
                </span>
                <div>
                  <h2>Les commandes de test autorisées</h2>
                  <p>Un exécutable et des arguments explicites pour les étapes de test.</p>
                </div>
              </div>
              <div className="command-list">
                <QualitySetup
                  disabled={
                    !state.workspace.trusted ||
                    Boolean(state.workspaceOperation) ||
                    hasActiveRun(state)
                  }
                  onInstall={() => dispatch({ type: 'installQualityKit' })}
                />
                {draft.testCommands.map((command, i) => (
                  <div className="command-editor" key={command.id}>
                    <div className="command-heading">
                      <span className="eyebrow">COMMANDE {String(i + 1).padStart(2, '0')}</span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Supprimer ${command.name || 'la commande ' + (i + 1)}`}
                        onClick={() =>
                          set({
                            testCommands: draft.testCommands.filter((c) => c.id !== command.id),
                          })
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="field-row">
                      <label className="field">
                        <span>Nom</span>
                        <input
                          required
                          value={command.name}
                          onChange={(e) =>
                            set({
                              testCommands: draft.testCommands.map((c) =>
                                c.id === command.id ? { ...c, name: e.target.value } : c,
                              ),
                            })
                          }
                          placeholder="Tests unitaires"
                        />
                      </label>
                      <label className="field">
                        <span>Exécutable</span>
                        <input
                          required
                          value={command.command}
                          onChange={(e) =>
                            set({
                              testCommands: draft.testCommands.map((c) =>
                                c.id === command.id ? { ...c, command: e.target.value } : c,
                              ),
                            })
                          }
                          placeholder="npm"
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span>
                        Arguments <small>un par ligne</small>
                      </span>
                      <textarea
                        rows={2}
                        className="code-input"
                        value={command.args.join('\n')}
                        onChange={(e) =>
                          set({
                            testCommands: draft.testCommands.map((c) =>
                              c.id === command.id ? { ...c, args: e.target.value.split('\n') } : c,
                            ),
                          })
                        }
                        placeholder={'run\ntest'}
                      />
                    </label>
                    <QualityCommandFields
                      config={command.quality}
                      onChange={(quality) =>
                        set({
                          testCommands: draft.testCommands.map((c) =>
                            c.id === command.id ? { ...c, quality } : c,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              {!draft.testCommands.length && (
                <p className="settings-empty">Aucune commande n’est autorisée pour le moment.</p>
              )}
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  set({
                    testCommands: [
                      ...draft.testCommands,
                      { id: crypto.randomUUID(), name: '', command: '', args: [] },
                    ],
                  })
                }
              >
                <Plus size={14} /> Ajouter une commande
              </button>
              <label className="field test-paths">
                <span>
                  Dossiers de test <small>un par ligne</small>
                </span>
                <textarea
                  className="code-input"
                  rows={2}
                  value={draft.testPaths.join('\n')}
                  onChange={(e) => set({ testPaths: e.target.value.split('\n') })}
                  placeholder={'tests\ntest\n__tests__'}
                />
                <small>
                  Préfixes de dossiers uniquement, sans motif glob. Les fichiers de ces dossiers
                  sont accessibles dans le profil de test.
                </small>
              </label>
            </section>
          </>
        )}
        {automation && (
          <section className="settings-card">
            <div className="settings-card-title">
              <span className="settings-icon color-0">
                <Zap size={21} />
              </span>
              <div>
                <h2>Hooks du projet</h2>
                <p>Une action avant ou après l’exécution, uniquement si vous l’activez.</p>
              </div>
              <span className="count-pill">
                {draft.hooks.filter((h) => h.enabled).length} actifs
              </span>
            </div>
            <div className="hook-note">
              <ShieldCheck size={17} />
              <p>
                Un hook exécute une commande locale dans ce projet. Vérifiez l’exécutable et les
                arguments avant de l’activer. Chaque nouveau hook est désactivé par défaut.
              </p>
            </div>
            {draft.hooks.map((hook, i) => (
              <div className="hook-editor" key={hook.id}>
                <div className="command-heading">
                  <span className="hook-number">{String(i + 1).padStart(2, '0')}</span>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={hook.enabled}
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id ? { ...h, enabled: e.target.checked } : h,
                          ),
                        })
                      }
                    />
                    <span className="toggle-switch" />
                    <strong>{hook.enabled ? 'Activé' : 'Désactivé'}</strong>
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Supprimer ${hook.name || 'le hook ' + (i + 1)}`}
                    onClick={() => set({ hooks: draft.hooks.filter((h) => h.id !== hook.id) })}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Nom du hook</span>
                    <input
                      required
                      value={hook.name}
                      placeholder="Préparer le contexte"
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id ? { ...h, name: e.target.value } : h,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Quand l’exécuter ?</span>
                    <select
                      value={hook.event}
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id
                              ? { ...h, event: e.target.value as 'beforeRun' | 'afterRun' }
                              : h,
                          ),
                        })
                      }
                    >
                      <option value="beforeRun">Avant l’exécution · beforeRun</option>
                      <option value="afterRun">Après l’exécution · afterRun</option>
                    </select>
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Exécutable</span>
                    <input
                      required
                      className="code-input"
                      value={hook.command}
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id ? { ...h, command: e.target.value } : h,
                          ),
                        })
                      }
                      placeholder="node"
                    />
                  </label>
                  <label className="field">
                    <span>
                      Arguments <small>un par ligne</small>
                    </span>
                    <textarea
                      rows={2}
                      className="code-input"
                      value={hook.args.join('\n')}
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id ? { ...h, args: e.target.value.split('\n') } : h,
                          ),
                        })
                      }
                      placeholder="scripts/prepare.mjs"
                    />
                  </label>
                </div>
              </div>
            ))}
            {!draft.hooks.length && (
              <Empty icon={<Zap />} title="Un rituel à inventer">
                Préparer des fichiers avant une étape, produire un rapport après : les hooks
                s’adaptent à votre manière de travailler.
              </Empty>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                set({
                  hooks: [
                    ...draft.hooks,
                    {
                      id: crypto.randomUUID(),
                      name: '',
                      event: 'beforeRun',
                      command: '',
                      args: [],
                      enabled: false,
                    },
                  ],
                })
              }
            >
              <Plus size={15} /> Ajouter un hook
            </button>
          </section>
        )}
        <div className="settings-save">
          <span>
            {dirty ? 'Modifications à enregistrer' : 'Configuration du projet'}
            <small>Les scripts restent soumis à l’approbation de l’espace de travail.</small>
          </span>
          <button className="button primary" disabled={!dirty}>
            Enregistrer les réglages <Check size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
