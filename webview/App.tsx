import { HumanRequestProvider } from './HumanRequests';
import { allFeatures, subplanIssues, subplanProgressLabel } from '../src/shared/subplans';
import { FeatureBrief, SubplanCardVisual, SubplanNavigation, SubplanOverview } from './SubplanUI';
import { PairWorkspace } from './PairWorkspace';
import { SessionConversation } from './SessionConversation';
import { PermissionPicker } from './NativeExecutionUI';
import { permissionLabels, type NativePermissionMode } from '../src/shared/native';
import { agentPolicy } from '../src/shared/agentInheritance';
import { AgentProfileSummary, AgentModelOverrides } from './AgentModelOverrides';
import { AgentReportDownload } from './AgentReportDownload';
import { Sessions } from './Sessions';
import { stepResolved, progressLabel } from '../src/shared/optionalSteps';
import { OptionalStepChoice, SkippedInterventions } from './OptionalStepsUI';
import { CatalogSearch, searchText, useDialogAccessibility } from './Ergonomics';
import {
  ObservationPanel,
  ObservationScan,
  TraceStorageSetting,
  TraceJournal,
} from './ObservationUI';
import { ProjectPicker, ProjectSettings, ProjectSwitcher } from './ProjectUI';
import { TeamComposer } from './TeamComposer';
import { SessionHq } from './SessionHq';
import { useHqContextTransfer } from './HqContextTransfer';
import { SessionViewToggle, useSessionView } from './SessionViewPreference';
import { AgentFavorite } from './AgentFavorite';
import { orderedAgents } from '../src/shared/team';
import { Avatar, AgentImage, avatarOptions } from './Avatar';
import { resolveAvatar } from '../src/shared/avatars';
import { usageCredits } from '../src/shared/credits';
import type { AccountCredits } from '../src/shared/credits';
import { AccountCreditsBadge } from './AccountCreditsBadge';
import { StudioNavigation, navigationGroup, navigationScreens, type View } from './Navigation';
import { CorrectionPanel, ReportEditor, FinalSummary } from './CollaborationUI';
import { featureStateKey, finalValidationReady } from '../src/shared/collaboration';
import { ThemePicker } from './ThemePicker';
import { ZoomControls, ZoomSettings } from './ZoomControls';
import { ThemeScenery } from './ThemeScenery';
import { QuestCelebration, QuestsUI } from './QuestsUI';
import { RewardTitle, RewardUnlockNotice } from './RewardsUI';
import { emptyQuestState, type QuestState } from '../src/shared/quests';
import { KitsUI } from './KitsUI';
import { DashboardUI } from './DashboardUI';
import { UsageDashboard } from './UsageDashboard';
import { Statistics } from './Statistics';
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
import { TicketSourceCard } from './TicketsUI';
import type { DevOpsState } from '../src/shared/devops';
import { approvalBlockers, featureCompletionBlockers } from '../src/core/validation';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Archive,
  Bot,
  BookOpen,
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
  ListFilter,
  LoaderCircle,
  MessageSquare,
  Menu,
  Play,
  Plus,
  Package,
  RefreshCw,
  Search,
  Send,
  Settings,
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
import Markdown, { defaultUrlTransform } from 'react-markdown';
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
} from '../src/shared/types';
import {
  initialView,
  isDemo,
  isHosted,
  persistView,
  savedFeatureProposal,
  send,
  subscribe,
} from './bridge';
import { demoState } from './demo';
import { QualityCommandFields, QualitySetup } from './QualityUI';
import brandIcon from '../resources/icon.png';
import { LaunchDialog, HumanRequests, McpSettings, McpPicker } from './ExecutionUI';
import './evolution.css';
import './session-compact.css';
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

import { DiscussionUI } from './DiscussionUI';
import type { DiscussionState, DiscussionFeatureDraft } from '../src/shared/discussions';

const statuses: Record<StepStatus, { label: string; tone: string }> = {
  pending: { label: 'À venir', tone: 'neutral' },
  running: { label: 'En cours', tone: 'lavender' },
  waiting_input: { label: 'Votre réponse', tone: 'apricot' },
  awaiting_review: { label: 'À valider', tone: 'apricot' },
  approved: { label: 'Validée', tone: 'green' },
  skipped: { label: 'Passée · non exécutée', tone: 'apricot' },
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
// These screens consume project-specific profiles, memory or Azure DevOps configuration.
const projectScopedViews = new Set<View>([
  'agents',
  'skills',
  'kits',
  'workflows',
  'memory',
  'delivery',
  'devops',
  'devops-prs',
  'devops-tickets',
]);
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
  const titleId = useId();
  useDialogAccessibility(ref, onClose);
  return (
    <div className="modal-backdrop">
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? `${titleId}-description` : undefined}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={`${titleId}-description`}>{subtitle}</p>}
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
  const [accountCredits, setAccountCredits] = useState<AccountCredits | undefined>(
    isDemo
      ? { state: 'unavailable', message: 'Le quota du compte est disponible dans VS Code.' }
      : undefined,
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const [catalogQuery, setCatalogQuery] = useState({ agents: '', skills: '' });
  const [catalogScope, setCatalogScope] = useState('all');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const navigationWasOpen = useRef(false);
  const navigationFocus = useRef<'menu' | 'content'>('menu');
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 890) setNavigationOpen(false);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const wasOpen = navigationWasOpen.current;
    navigationWasOpen.current = navigationOpen;
    if (!navigationOpen) {
      if (wasOpen)
        (navigationFocus.current === 'content'
          ? document.getElementById('main-content')
          : menuButton.current
        )?.focus({ preventScroll: true });
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    navigation.current?.querySelector<HTMLButtonElement>('.navigation-close')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavigationOpen(false);
        menuButton.current?.focus();
      }
      if (event.key === 'Tab') {
        const nodes = Array.from(
          navigation.current?.querySelectorAll<HTMLElement>(
            'a[href],button,input,select,textarea,summary,[tabindex]',
          ) ?? [],
        ).filter(
          (node) =>
            node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length,
        );
        if (event.shiftKey && document.activeElement === nodes[0]) {
          event.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
          event.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = previousOverflow;
    };
  }, [navigationOpen]);
  const [questState, setQuestState] = useState<QuestState | undefined>(
    isDemo ? emptyQuestState() : undefined,
  );
  const [earnedQuests, setEarnedQuests] = useState<string[]>([]);
  const ticketPreparationId = useRef<string | undefined>(undefined);
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
    (navigationScreens.some((n) => n.id === initialView.view)
      ? initialView.view
      : 'sessions') as View,
  );
  const [discussionState, setDiscussionState] = useState<DiscussionState>({
    discussions: [],
    agents: [],
  });
  const [pairOpen, setPairOpen] = useState(initialView.pairOpen ?? false);
  const [discussionId, setDiscussionId] = useState(initialView.discussionId ?? '');
  const reportRequest = useRef<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    featureId: string;
    stepId: string;
    attemptId: string;
    edit: boolean;
  }>();
  const [featureId, setFeatureId] = useState(initialView.featureId ?? '');
  const [stepId, setStepId] = useState(initialView.stepId ?? '');
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [view, featureId]);
  const [observerRequested, setObserverRequested] = useState(false);
  const [create, setCreate] = useState(false);
  const [createFrom, setCreateFrom] = useState<{
    discussionId: string;
    draft: DiscussionFeatureDraft;
  }>();
  const [draftDirty, setDraftDirty] = useState(false);
  const draftDirtyRef = useRef(false);
  const updateDraftDirty = (value: boolean) => {
    draftDirtyRef.current = value;
    setDraftDirty(value);
  };
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
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
      else if (message.type === 'accountCredits') setAccountCredits(message.state);
      else if (message.type === 'questState') {
        setQuestState(message.state);
        if (message.earned?.length)
          setEarnedQuests((ids) => [...new Set([...ids, ...message.earned!])]);
      } else if (message.type === 'discussionState') setDiscussionState(message.state);
      else if (message.type === 'reportDiscussionOpened') {
        if (message.requestId !== reportRequest.current) return;
        reportRequest.current = null;
        if (message.error) setNotice({ text: message.error, error: true });
        else if (message.discussionId && !draftDirtyRef.current) {
          setDiscussionId(message.discussionId);
          setView('discussion');
        }
      } else if (message.type === 'discussionReportOpened') {
        if (draftDirtyRef.current) return;
        setReportTarget(message);
        setFeatureId(message.featureId);
        setStepId(message.stepId);
        setView('sessions');
        if (message.notice) setNotice({ text: message.notice });
      } else if (message.type === 'devopsState') {
        setDevops(message.state);
        if (
          message.state.ticketPreparation &&
          message.state.ticketPreparation.snapshotId !== ticketPreparationId.current &&
          !draftDirtyRef.current
        ) {
          ticketPreparationId.current = message.state.ticketPreparation.snapshotId;
          setView('devops-tickets');
        }
      } else if (message.type === 'error' || message.type === 'notice')
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
            text: 'Terminez ou annulez les modifications en cours avant de changer de page.',
            error: true,
          });
          return;
        }
        setView(
          message.view === 'devops-prs' ||
            message.view === 'devops-tickets' ||
            message.view === 'devops'
            ? message.view
            : 'sessions',
        );
        setStepId(message.stepId ?? '');
        setFeatureId(message.featureId ?? '');
        setCreate(message.view === 'create');
        setObserverRequested(message.view === 'observation');
      }
    });
    send({ type: 'ready' });
    return cleanup;
  }, []);
  useEffect(
    () => persistView({ view, featureId, stepId, pairOpen }),
    [view, featureId, stepId, pairOpen],
  );
  const pairLocation = useRef(`${featureId}:${stepId}`);
  useEffect(() => {
    const location = `${featureId}:${stepId}`;
    if (pairLocation.current !== location) setPairOpen(false);
    pairLocation.current = location;
  }, [featureId, stepId]);
  const loaded = Boolean(state);
  useEffect(() => {
    if (loaded && featureId && view === 'sessions' && !create && !isDemo)
      send({ type: 'activateFeature', featureId });
  }, [loaded, featureId, view, create]);
  useEffect(() => {
    // Connect only when the cockpit has a trusted, not-yet-checked host state.
    // Failed checks remain explicit retries; navigation must not start a retry loop.
    if (isHosted && state?.workspace.trusted && state.runtime.state === 'unchecked')
      send({ type: 'checkRuntime' });
  }, [state?.workspace.path, state?.workspace.trusted, state?.runtime.state]);
  const dispatch = (message: ClientMessage) => {
    if (message.type === 'openReportDiscussion') {
      if (draftDirtyRef.current) return;
      reportRequest.current = message.requestId;
    }
    if (
      state?.workspaceOperation &&
      [
        'createFeature',
        'runStep',
        'restoreCheckpoint',
        'createCheckpoint',
        'startAutopilot',
        'configureStep',
        'saveFeatureTeam',
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
      if (message.type === 'devopsCreateFeature')
        setDevops((previous) => ({
          ...previous,
          ticketCreateResult: {
            requestId: message.plan.requestId,
            error: `${state.workspaceOperation!.label} · attendez la fin de cette opération.`,
          },
        }));
      return;
    }
    if (isDemo) {
      if (message.type === 'dashboardOpen') {
        setView(message.page ?? 'sessions');
        setFeatureId(message.featureId ?? '');
        setStepId(message.stepId ?? '');
        return;
      }
      if (
        message.type === 'sendDiscussion' ||
        message.type === 'deleteDiscussion' ||
        message.type === 'deleteWorkflow'
      ) {
        window.postMessage(
          {
            type: message.type === 'deleteWorkflow' ? 'workflowDeleteResult' : 'discussionResult',
            requestId: message.requestId,
            ...('discussionId' in message ? { discussionId: message.discussionId } : {}),
            error:
              'Mode démonstration : ouvrez Feature Studio dans VS Code pour enregistrer cette action.',
          },
          '*',
        );
        return;
      }
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
  const selected = state && allFeatures(state.features).find((f) => f.id === featureId);
  const activeFeatures = state?.features.filter((f) => !f.archived) ?? [];
  const openCreate = (_id?: string) => {
    setCreateFrom(undefined);
    setCreate(true);
  };
  const chooseView = (id: View) => {
    if (draftDirty) {
      setNotice({
        text: 'Terminez ou annulez les modifications en cours avant de changer de page.',
        error: true,
      });
      return;
    }
    if (navigationOpen) navigationFocus.current = 'content';
    setView(id);
    setFeatureId('');
    setNavigationOpen(false);
    setNavQuery('');
  };
  const agents = orderedAgents(state?.agents ?? [], state?.favoriteAgentIds).filter(
    (agent) =>
      searchText(
        `${agent.name} ${agent.nickname ?? ''} ${agent.description} ${agent.skills.join(' ')}`,
      ).includes(searchText(catalogQuery.agents)) &&
      (catalogScope === 'all' || agent.source === catalogScope) &&
      (!onlyFavorites || state?.favoriteAgentIds?.includes(agent.id)),
  );
  const skills = (state?.skills ?? []).filter(
    (skill) =>
      searchText(`${skill.name} ${skill.description}`).includes(searchText(catalogQuery.skills)) &&
      (catalogScope === 'all' || skill.source === catalogScope),
  );
  if (!state)
    return (
      <div className="launch-screen">
        <div className="brand-mark">
          <img src={brandIcon} alt="" />
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
    <HumanRequestProvider
      className="app-shell"
      requests={state.humanRequests ?? []}
      features={state.features}
      dispatch={dispatch}
    >
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      {navigationOpen && (
        <button
          className="navigation-backdrop"
          aria-label="Fermer la navigation"
          onClick={() => {
            setNavigationOpen(false);
            menuButton.current?.focus();
          }}
        />
      )}
      <aside
        id="app-navigation"
        ref={navigation}
        role={navigationOpen ? 'dialog' : undefined}
        aria-modal={navigationOpen || undefined}
        aria-label={navigationOpen ? 'Navigation du cockpit' : undefined}
        className={`sidebar ${navigationOpen ? 'is-open' : ''}`}
      >
        <button
          className="icon-button navigation-close"
          aria-label="Fermer le menu"
          onClick={() => {
            setNavigationOpen(false);
            menuButton.current?.focus();
          }}
        >
          <X size={20} />
        </button>
        <button
          className="brand"
          onClick={() => chooseView('sessions')}
          aria-label="Feature Studio, accueil"
        >
          <span className="brand-mark">
            <img src={brandIcon} alt="" />
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
        <label className="navigation-search search-field">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="Rechercher un écran"
            placeholder="Aller à…"
            value={navQuery}
            onChange={(event) => setNavQuery(event.target.value)}
          />
          {navQuery && (
            <button
              className="icon-button"
              aria-label="Effacer la recherche de navigation"
              onClick={() => setNavQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <StudioNavigation
          view={view}
          query={navQuery}
          onNavigate={chooseView}
          sessionCount={activeFeatures.length}
          validationCount={attentionCount(state)}
          trophies={questState && !questState.error ? questState.trophies : undefined}
        />
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
          <details className="sidebar-tools">
            <summary>Outils du projet</summary>
            <button className="sidebar-link" onClick={() => chooseView('kits')}>
              <Package size={14} /> Gérer les kits <ArrowUpRight size={13} />
            </button>
            <button className="sidebar-link" onClick={() => dispatch({ type: 'migrateUserKit' })}>
              <ArrowUpRight size={14} /> Migrer les profils du projet
            </button>
          </details>
        </div>
      </aside>
      <div className="main-shell" inert={navigationOpen}>
        <ThemeScenery />
        <header className="topbar">
          <button
            ref={menuButton}
            className="button secondary menu-toggle"
            aria-label="Ouvrir le menu"
            aria-expanded={navigationOpen}
            aria-controls="app-navigation"
            onClick={() => {
              navigationFocus.current = 'menu';
              setNavigationOpen(true);
            }}
          >
            <Menu size={18} /> Menu
          </button>
          <div className="topbar-context">
            <span className="context-dot" />
            {navigationGroup(view)?.label.toLocaleUpperCase('fr-FR') ?? 'COCKPIT'}
            <ChevronRight size={12} />
            <span>
              {selected ? selected.title : navigationScreens.find((n) => n.id === view)?.label}
            </span>
          </div>
          <div className="topbar-actions">
            <RewardTitle />
            <AccountCreditsBadge credits={accountCredits} />
            <button
              className={`icon-button settings-toggle ${view === 'settings' ? 'active' : ''}`}
              title="Réglages"
              aria-label="Réglages"
              aria-current={view === 'settings' ? 'page' : undefined}
              onClick={() => chooseView('settings')}
            >
              <Settings size={18} aria-hidden="true" />
            </button>
            <ZoomControls />
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
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              Projet en consultation seule. Approuvez cet espace de travail dans VS Code pour
              enregistrer les réglages du projet et exécuter des agents ou des scripts.
            </span>
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatch({ type: 'manageWorkspaceTrust' })}
            >
              Gérer l’approbation dans VS Code <ArrowUpRight size={14} aria-hidden="true" />
            </button>
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
        <main id="main-content" tabIndex={-1}>
          <RewardUnlockNotice />
          <QuestCelebration
            ids={earnedQuests}
            onClose={() => setEarnedQuests([])}
            onOpen={() => {
              chooseView('quests');
              setEarnedQuests([]);
            }}
          />
          {view === 'quests' && (
            <QuestsUI
              state={questState}
              navigate={(target) => chooseView(target === 'dashboard' ? 'sessions' : target)}
            />
          )}
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
                {state.humanRequests!.length} demande
                {state.humanRequests!.length > 1 ? 's' : ''} humaine
                {state.humanRequests!.length > 1 ? 's' : ''} en attente
              </span>
              <button
                className="text-button"
                onClick={() => {
                  const r = state.humanRequests![0];
                  setView('sessions');
                  setFeatureId(r.featureId);
                  setStepId(r.stepId);
                }}
              >
                Ouvrir la demande <ArrowRight size={13} />
              </button>
            </div>
          )}
          {projectScopedViews.has(view) && !create && (
            <ProjectSwitcher
              state={state}
              dispatch={dispatch}
              disabled={draftDirty || hasActiveRun(state)}
            />
          )}
          {view === 'dashboard' && (
            <DashboardUI studio={state} credits={accountCredits} dispatch={dispatch} />
          )}
          {view === 'sessions' &&
            (selected ? (
              <FeatureDetail
                pairOpen={pairOpen}
                onPairOpenChange={setPairOpen}
                key={selected.id}
                observerRequested={observerRequested}
                openDiscussion={(id) => {
                  if (!draftDirty) {
                    if (!discussionState.discussions.some((discussion) => discussion.id === id)) {
                      setNotice({
                        text: 'La discussion d’origine a été supprimée ou n’est plus disponible.',
                        error: true,
                      });
                      return;
                    }
                    setDiscussionId(id);
                    setView('discussion');
                  }
                }}
                reportTarget={reportTarget?.featureId === selected.id ? reportTarget : undefined}
                navigate={(id, step) => {
                  if (!draftDirty) {
                    setFeatureId(id);
                    setStepId(step ?? '');
                  }
                }}
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
              <Sessions
                dispatch={dispatch}
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
              key={state.projectCatalog?.activeProjectId ?? 'default'}
              state={devops}
              visible={view === 'devops' || view === 'delivery'}
              features={state.features}
              dispatch={dispatch}
              mode={view === 'delivery' ? 'delivery' : 'dashboard'}
              onOpenFeature={(id) => {
                setView('sessions');
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
                  setView('sessions');
                  setFeatureId(id);
                  setStepId('');
                }}
              />
            </div>
          ))}
          {view === 'stats' && (
            <Statistics
              state={state}
              dispatch={dispatch}
              onOpen={(id) => {
                setView('sessions');
                setFeatureId(id);
                setStepId('');
              }}
            />
          )}
          {view === 'usage' && (
            <UsageDashboard
              features={state.features}
              discussions={discussionState.discussions}
              onOpenDiscussion={(id) => {
                setDiscussionId(id);
                chooseView('discussion');
              }}
              onOpenFeature={(id) => {
                setView('sessions');
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
                setView('sessions');
                setFeatureId(id);
                setStepId(step);
              }}
            />
          )}
          <div hidden={view !== 'discussion'}>
            <DiscussionUI
              state={
                isDemo
                  ? {
                      ...discussionState,
                      agents: state.agents.map((profile) => ({
                        key: `global:${profile.id}`,
                        profile,
                      })),
                    }
                  : discussionState
              }
              studio={state}
              dispatch={dispatch}
              visible={view === 'discussion'}
              selectedId={discussionId}
              onSelect={setDiscussionId}
              onCreateFeature={(discussionId, draft) => {
                setCreateFrom({ discussionId, draft });
                setCreate(true);
              }}
            />
          </div>
          {view === 'memory' && <ProjectMemoryView state={state} dispatch={dispatch} />}
          {view === 'workflows' && <WorkflowLibrary state={state} dispatch={dispatch} />}
          {view === 'kits' && <KitsUI state={state} dispatch={dispatch} />}
          {view === 'agents' && (
            <Library
              title="Des agents, chacun son regard."
              eyebrow="VOTRE ÉQUIPE"
              subtitle="Des profils spécialisés, des instructions lisibles. Composez une équipe qui connaît votre manière de travailler."
              count={`${agents.length} / ${state.agents.length} profils`}
              action="Nouvel agent"
              onCreate={() => setAgentEditor('new')}
            >
              <div className="catalog-toolbar">
                <CatalogSearch
                  label="Rechercher un agent"
                  value={catalogQuery.agents}
                  onChange={(value) => setCatalogQuery({ ...catalogQuery, agents: value })}
                  count={agents.length}
                />
                <label className="catalog-scope">
                  Origine
                  <select
                    aria-label="Origine des agents"
                    value={catalogScope}
                    onChange={(event) => setCatalogScope(event.target.value)}
                  >
                    <option value="all">Toutes les origines</option>
                    <option value="workspace">Ce projet</option>
                    <option value="user">Personnel</option>
                    <option value="bundled">Kits fournis</option>
                  </select>
                </label>
                <label className="catalog-favorites">
                  <input
                    type="checkbox"
                    checked={onlyFavorites}
                    onChange={(event) => setOnlyFavorites(event.target.checked)}
                  />{' '}
                  Mes favoris
                </label>
              </div>
              {!agents.length && state.agents.length > 0 && (
                <div className="empty-state" role="status">
                  <h3>Aucun résultat pour ces filtres.</h3>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setCatalogQuery({ ...catalogQuery, agents: '' });
                      setCatalogScope('all');
                      setOnlyFavorites(false);
                    }}
                  >
                    Réinitialiser les filtres
                  </button>
                </div>
              )}
              <div className="library-grid">
                {agents.map((a) => (
                  <div className="agent-library-item" key={a.id}>
                    <AgentFavorite agent={a} state={state} dispatch={dispatch} />
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
                      {a.discussionAgent && (
                        <span className="profile-role">
                          <MessageSquare size={12} /> Agent de discussion
                        </span>
                      )}
                      {normalizeRoastLevel(a.roastLevel) !== 'off' && (
                        <span className="profile-role">Roast · {roastLabel(a.roastLevel)}</span>
                      )}
                      <p>
                        {a.nickname && <span className="profile-role">{a.name}</span>}
                        {a.description}
                      </p>
                      <div className="card-footer">
                        <span>
                          {a.skills.length} skill
                          {a.skills.length > 1 ? 's' : ''}
                        </span>
                        <span>{a.model || 'Modèle automatique'}</span>
                      </div>
                    </button>
                  </div>
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
                  Les permissions de chaque étape encadrent les outils de l’agent. Les favoris sont
                  personnels et communs à vos projets.
                </span>
              </div>
            </Library>
          )}
          {view === 'skills' && (
            <Library
              title="Le savoir-faire, à portée d’agent."
              eyebrow="VOTRE BOÎTE À OUTILS"
              subtitle="Des méthodes réutilisables pour retrouver vos conventions et vos exigences dans chaque session."
              count={`${skills.length} / ${state.skills.length} skills`}
              action="Nouvelle skill"
              onCreate={() => setSkillEditor('new')}
            >
              <div className="catalog-toolbar">
                <CatalogSearch
                  label="Rechercher une skill"
                  value={catalogQuery.skills}
                  onChange={(value) => setCatalogQuery({ ...catalogQuery, skills: value })}
                  count={skills.length}
                />
                <label className="catalog-scope">
                  Origine
                  <select
                    aria-label="Origine des skills"
                    value={catalogScope}
                    onChange={(event) => setCatalogScope(event.target.value)}
                  >
                    <option value="all">Toutes les origines</option>
                    <option value="workspace">Ce projet</option>
                    <option value="user">Personnel</option>
                    <option value="bundled">Kits fournis</option>
                  </select>
                </label>
              </div>
              {!skills.length && state.skills.length > 0 && (
                <div className="empty-state" role="status">
                  <h3>Aucun résultat pour ces filtres.</h3>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setCatalogQuery({ ...catalogQuery, skills: '' });
                      setCatalogScope('all');
                      setOnlyFavorites(false);
                    }}
                  >
                    Réinitialiser les filtres
                  </button>
                </div>
              )}
              <div className="library-grid">
                {skills.map((s, i) => (
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
              key={`${view}-${state.projectCatalog?.activeProjectId ?? 'default'}`}
              onDirtyChange={updateDraftDirty}
              settings={state.settings}
              state={state}
              automation={view === 'automations'}
              dispatch={dispatch}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>
            <img className="brand-inline" src={brandIcon} alt="" /> FEATURE STUDIO
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
          origin={createFrom}
          state={state}
          onClose={() => setCreate(false)}
          dispatch={dispatch}
          onCreate={(message) => {
            dispatch(message);
            if (!isHosted) setCreate(false);
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
    </HumanRequestProvider>
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
        <h2>Votre catalogue</h2>
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
  emptyLabel = 'Automatique · choix du CLI',
}: {
  state: StudioState;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  emptyLabel?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="select-wrap">
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{emptyLabel}</option>
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
  origin,
  state,
  onClose,
  onCreate,
  dispatch,
}: {
  origin?: { discussionId: string; draft: DiscussionFeatureDraft };
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  onClose: () => void;
  onCreate: (message: Extract<ClientMessage, { type: 'createFeature' }>) => void;
}) {
  const [restored] = useState(() => {
    const saved = savedFeatureProposal();
    return origin &&
      saved?.discussionId === origin.discussionId &&
      saved.draft.requestId === origin.draft.requestId
      ? saved.draft
      : origin?.draft;
  });
  const [title, setTitle] = useState(restored?.title ?? ''),
    [description, setDescription] = useState(restored?.description ?? '');
  const [criteria, setCriteria] = useState(restored?.criteria.join('\n') ?? '');
  const [team, setTeam] = useState(restored?.team ?? []);
  useEffect(() => {
    if (origin)
      persistView({
        featureProposal: {
          discussionId: origin.discussionId,
          draft: { ...origin.draft, title, description, criteria: criteria.split('\n'), team },
        },
      });
  }, [title, description, criteria, team]);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'featureCreateResult' || message.requestId !== pending) return;
        setPending(undefined);
        if (message.error) setError(message.error);
        else {
          persistView({ featureProposal: undefined });
          onClose();
        }
      }),
    [pending, onClose],
  );
  const invalidProposal = Boolean(
    origin &&
      (!description.trim() ||
        !criteria.trim() ||
        criteria.split('\n').filter((item) => item.trim()).length > 30 ||
        criteria.split('\n').some((item) => item.length > 2000) ||
        !team.length ||
        team.some(
          (member) =>
            !member.name.trim() ||
            !member.description.trim() ||
            !state.agents.some((agent) => agent.id === member.agentId),
        )),
  );
  const [isolated, setIsolated] = useState(Boolean(state.workspace.canIsolate));
  const [permissionMode, setPermissionMode] = useState<NativePermissionMode>('manual');
  const [projectPending, setProjectPending] = useState(false);
  const ids = state.projectCatalog?.selectedProjectIds;
  const multiple = (ids?.length ?? 0) > 1;
  const missing = Boolean(state.projectCatalog && !ids?.length);
  const busy =
    Boolean(state.workspaceOperation) || hasActiveRun(state) || projectPending || Boolean(pending);
  return (
    <Modal
      title="Une nouvelle feature"
      subtitle={
        origin
          ? 'Relisez le besoin, les critères et l’équipe avant de créer la session.'
          : 'Posez le besoin. Vous composerez votre équipe sur la fiche.'
      }
      wide={Boolean(origin)}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && !busy && !missing && !invalidProposal) {
            const requestId = crypto.randomUUID();
            if (isHosted) setPending(requestId);
            setError('');
            onCreate({
              type: 'createFeature',
              requestId,
              ...(origin
                ? {
                    discussionId: origin.discussionId,
                    criteria: criteria
                      .split('\n')
                      .map((item) => item.trim())
                      .filter(Boolean),
                    team,
                  }
                : {}),
              title: title.trim(),
              permissionMode,
              description: description.trim(),
              isolated: !multiple && isolated && Boolean(state.workspace.canIsolate),
              ...(ids ? { projectIds: ids } : {}),
            });
          }
        }}
      >
        <ProjectPicker state={state} dispatch={dispatch} onPendingChange={setProjectPending} />
        <p>
          <strong>Copilot natif</strong> · Les outils de Copilot réalisent le travail.
        </p>
        <PermissionPicker
          state={state}
          value={permissionMode}
          onChange={setPermissionMode}
          disabled={busy}
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
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Le contexte et le résultat souhaité</span>
          <textarea
            rows={4}
            maxLength={origin ? 30000 : 500000}
            placeholder="Le besoin, les contraintes, le résultat attendu…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {origin && (
          <section className="feature-proposal" aria-label="Proposition de feature">
            <label className="field">
              <span>Critères de réussite — un par ligne</span>
              <textarea
                rows={4}
                value={criteria}
                onChange={(event) => setCriteria(event.target.value)}
              />
            </label>
            <h3>Équipe proposée · ordre des interventions</h3>
            {team.map((member, index) => (
              <div className="proposal-member" key={index}>
                <label className="field">
                  <span>Agent {index + 1}</span>
                  <select
                    value={member.agentId}
                    onChange={(event) =>
                      setTeam(
                        team.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                agentId: event.target.value,
                                model: undefined,
                                reasoning: undefined,
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {!state.agents.some((agent) => agent.id === member.agentId) && (
                      <option value={member.agentId}>Agent indisponible dans ce projet</option>
                    )}
                    {state.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.nickname || agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <AgentModelOverrides
                  native
                  step={member}
                  state={state}
                  onChange={(patch) =>
                    setTeam(team.map((item, i) => (i === index ? { ...item, ...patch } : item)))
                  }
                />
                <label className="field">
                  <span>Participation de {member.name}</span>
                  <select
                    aria-label={`Participation de l’intervention ${index + 1}`}
                    value={member.optional ? 'optional' : 'required'}
                    onChange={(event) =>
                      setTeam(
                        team.map((item, i) =>
                          i === index
                            ? { ...item, optional: event.target.value === 'optional' }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="required">Obligatoire</option>
                    <option value="optional">Facultative</option>
                  </select>
                </label>
                <div className="discussion-source-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={!index}
                    onClick={() =>
                      setTeam((items) => {
                        const next = [...items];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        return next;
                      })
                    }
                  >
                    Monter l’intervention {index + 1}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setTeam(team.filter((_, i) => i !== index))}
                  >
                    Retirer l’intervention {index + 1}
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="button secondary small"
              disabled={team.length >= 12 || !state.agents.length}
              onClick={() =>
                setTeam([
                  ...team,
                  {
                    agentId: state.agents[0].id,
                    name: state.agents[0].name,
                    description: state.agents[0].description,
                    policy: 'read-only',
                  },
                ])
              }
            >
              Ajouter une intervention
            </button>
            {invalidProposal && (
              <p role="status">
                Complétez le besoin, les critères et les missions avec les agents disponibles dans
                le projet choisi.
              </p>
            )}
          </section>
        )}
        {error && <p role="alert">{error}</p>}
        {multiple ? (
          <p className="muted">
            Cette session travaille dans les dossiers sélectionnés. L’isolation en worktree est
            disponible avec un seul projet.
          </p>
        ) : (
          <WorkspaceChoice
            state={state}
            isolated={isolated && Boolean(state.workspace.canIsolate)}
            onChange={setIsolated}
          />
        )}
        <div className="modal-actions">
          <span className="muted">Créer ne lance aucune exécution.</span>
          <button
            type="button"
            className="button secondary"
            disabled={Boolean(pending)}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!title.trim() || busy || missing || invalidProposal}
          >
            Créer la feature <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function FeatureDetail({
  navigate,
  pairOpen,
  onPairOpenChange,
  openDiscussion,
  observerRequested,
  reportTarget,
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
  navigate: (id: string, stepId?: string) => void;
  pairOpen: boolean;
  onPairOpenChange: (open: boolean) => void;
  openDiscussion: (id: string) => void;
  observerRequested?: boolean;
  reportTarget?: { stepId: string; attemptId: string; edit: boolean };
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
  const workbench = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const selectCard = (id: string) => {
    selectStep(id);
    setFocusRequest((request) => request + 1);
  };
  useEffect(() => {
    if (!focusRequest) return;
    workbench.current?.scrollIntoView({ block: 'start' });
    workbench.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  const [composing, setComposing] = useState(false),
    [teamPending, setTeamPending] = useState(false);
  const { enabled: livingHq } = useSessionView();
  const hqTransfer = useHqContextTransfer(feature, livingHq);
  const closeTeam = () => {
    if (!teamPending) {
      setComposing(false);
      onDirtyChange(false);
    }
  };
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
    allFeatures(state.features).some((item) => item.autopilot?.status === 'running');
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
  ) =>
    setCorrection({
      sourceStepId,
      feedback,
      findingIds,
      commentIds,
      rootStepIds,
    });

  if (pairOpen && step && !step.attempts.at(-1)?.pair?.nativeConversation)
    return (
      <div className="feature-pair-page">
        {livingHq && (
          <SessionHq
            feature={feature}
            state={state}
            transfer={hqTransfer}
            selectedStepId={step.id}
            disabled={false}
            selectStep={(id) => {
              selectStep(id);
              onPairOpenChange(false);
            }}
          />
        )}
        <PairWorkspace
          key={`${feature.id}:${step.id}:${step.attempts.at(-1)?.id ?? 'pending'}`}
          feature={feature}
          step={step}
          state={state}
          dispatch={dispatch}
          back={() => onPairOpenChange(false)}
        />
      </div>
    );
  return (
    <div className="page feature-page">
      {feature.pendingTeam && (
        <p className="subplan-warning" role="status">
          Nouvelle composition enregistrée. Elle sera appliquée à la fin de l’appel en cours.
        </p>
      )}
      {composing && (
        <Modal
          title="Composer mon équipe"
          subtitle="Ajoutez des équipes et des agents, puis ajustez chaque intervention."
          wide
          onClose={closeTeam}
        >
          <TeamComposer
            feature={feature}
            state={state}
            dispatch={dispatch}
            onPendingChange={setTeamPending}
            onClose={() => {
              setComposing(false);
              setTeamPending(false);
              onDirtyChange(false);
            }}
          />
        </Modal>
      )}
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
        {feature.discussionId && (
          <button disabled={detailDirty} onClick={() => openDiscussion(feature.discussionId!)}>
            <MessageSquare size={14} /> Discussion d’origine
          </button>
        )}
      </div>
      <div className="feature-heading">
        <div>
          <Badge {...featureStatus[feature.status]} />
          <h1>{feature.title}</h1>
          <FeatureBrief feature={feature} state={state} />
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
        {step && (
          <button
            className="button secondary small feature-jump-to-work"
            disabled={detailDirty}
            onClick={() => selectCard(feature.activeStepId || step.id)}
          >
            <ArrowDown size={15} />
            {feature.status === 'completed' ? 'Voir le résultat' : 'Aller à l’étape en cours'}
          </button>
        )}
      </div>
      <SubplanNavigation
        feature={feature}
        state={state}
        navigate={navigate}
        disabled={detailDirty}
      />
      <div className="feature-toolbar">
        <GitWorkspacePanel feature={feature} state={state} dispatch={dispatch} />
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
            disabled={busy || detailDirty || Boolean(feature.parent)}
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
      <ObservationScan
        feature={feature}
        state={state}
        dispatch={dispatch}
        open={() => setObserverOpen(true)}
      />
      {observerOpen && (
        <ObservationPanel
          feature={feature}
          state={state}
          dispatch={dispatch}
          close={() => setObserverOpen(false)}
        />
      )}
      {!!feature.projects?.length && (
        <div className="feature-projects" aria-label="Projets de cette session">
          {feature.projects.map((project) => (
            <span key={project.id} title={project.path}>
              {project.name} ·{' '}
              {project.id === feature.projects![0].id ? feature.branch : project.branch}
            </span>
          ))}
        </div>
      )}
      <DevOpsFeatureLinks state={devops} featureId={feature.id} onOpenDashboard={openDevOps} />
      <TicketSourceCard feature={feature} />
      <SkippedInterventions feature={feature} />
      {feature.optionalRequest &&
        (() => {
          const optionalStep = feature.steps.find(
            (item) => item.id === feature.optionalRequest!.stepId,
          );
          return optionalStep ? (
            <OptionalStepChoice
              key={feature.optionalRequest!.id}
              feature={feature}
              step={optionalStep}
              state={state}
              dispatch={dispatch}
              automatic
              busy={busy || detailDirty}
            />
          ) : null;
        })()}
      <div className="feature-control-band">
        {!!feature.steps.length && (
          <AutopilotBar feature={feature} state={state} dispatch={dispatch} />
        )}
        <BudgetMeter feature={feature} state={state} dispatch={dispatch} />
      </div>
      {!!feature.steps.length && (
        <div className="feature-team-heading">
          <h2>Votre équipe</h2>
          <button
            className="button secondary small"
            disabled={
              detailDirty ||
              Boolean(feature.archived) ||
              Boolean(feature.pendingTeam) ||
              Boolean(feature.parent && feature.status === 'completed')
            }
            onClick={() => {
              setComposing(true);
              onDirtyChange(true);
            }}
          >
            <Settings2 size={14} />
            Modifier l’équipe
          </button>
        </div>
      )}
      <div className="journey-heading">
        <span className="eyebrow">LE PARCOURS</span>
        <SessionViewToggle />
        <span>{progressLabel(feature)}</span>
      </div>
      {livingHq && feature.steps.length > 0 ? (
        <SessionHq
          feature={feature}
          state={state}
          transfer={hqTransfer}
          selectedStepId={step?.id}
          disabled={detailDirty}
          selectStep={selectCard}
        />
      ) : (
        <div className="journey" role="navigation" aria-label="Étapes du parcours">
          {feature.steps.map((s, i) => (
            <button
              key={s.id}
              disabled={detailDirty}
              onClick={() => selectCard(s.id)}
              className={`journey-step ${s.subplan ? 'subplan-card' : ''} ${s.status} ${s.id === step?.id ? 'current' : ''}`}
              aria-current={s.id === step?.id ? 'step' : undefined}
            >
              <span className="journey-node">
                {s.subplan ? (
                  <SubplanCardVisual step={s} />
                ) : (
                  <Avatar
                    agent={state.agents.find((a) => a.id === s.agentId)}
                    status={s.status}
                    small
                  />
                )}
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
                <small>
                  {s.awaitsCorrection
                    ? 'Reprise par correctif'
                    : s.subplan && subplanIssues([s]).length
                      ? 'À configurer'
                      : subplanProgressLabel(s) || statuses[s.status].label}
                  {s.subplanState
                    ? ` · ${s.subplanState.iterations.filter((i) => i.feature.status === 'completed' && !i.cancelled && !i.requiresRecheck).length}/${s.subplanState.iterations.filter((i) => !i.cancelled).length} tâches validées`
                    : s.subplan
                      ? ' · Sous-équipe'
                      : ''}
                  {s.optional && s.status !== 'skipped' ? ' · Facultative' : ''}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {feature.steps.length > 0 && feature.steps.every(stepResolved) && (
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
        <section
          ref={workbench}
          tabIndex={-1}
          className="feature-step-detail"
          aria-label={`Détail de l’étape : ${step.name}`}
        >
          {step.subplan && (
            <SubplanOverview key={step.id} step={step} navigate={navigate} disabled={detailDirty} />
          )}
          <StepPanel
            configureTeam={() => {
              setComposing(true);
              onDirtyChange(true);
            }}
            openPair={() => onPairOpenChange(true)}
            reportTarget={reportTarget?.stepId === step.id ? reportTarget : undefined}
            key={`${feature.id}-${step.id}`}
            feature={feature}
            step={step}
            state={state}
            dispatch={dispatch}
            selectStep={selectCard}
            onDirtyChange={(value) => {
              setDetailDirty(value);
              onDirtyChange(value);
            }}
            onCorrection={openCorrection}
            confirm={confirm}
          />
        </section>
      ) : (
        <section className="feature-empty-team">
          <Bot size={32} />
          <h2>Aucune équipe constituée</h2>
          <p className="muted">
            Votre feature est enregistrée. Ajoutez les agents qui vont intervenir.
          </p>
          <button
            className="button primary"
            disabled={busy || Boolean(feature.archived)}
            onClick={() => {
              setComposing(true);
              onDirtyChange(true);
            }}
          >
            <Plus size={16} />
            Composer mon équipe
          </button>
        </section>
      )}
    </div>
  );
}
function StepPanel({
  configureTeam,
  openPair,
  reportTarget,
  feature,
  step,
  state,
  dispatch,
  selectStep,
  confirm,
  onDirtyChange,
  onCorrection,
}: {
  openPair: () => void;
  configureTeam: () => void;
  reportTarget?: { attemptId: string; edit: boolean };
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
  const [attemptId, setAttemptId] = useState(reportTarget?.attemptId ?? '');
  const attempt = step.attempts.find((a) => a.id === attemptId) ?? latest;
  const historic = Boolean(attempt && latest && attempt.id !== latest.id);
  const [tab, setTab] = useState<
    'conversation' | 'artifact' | 'activity' | 'diffs' | 'evidence' | 'review'
  >(reportTarget ? 'artifact' : latest?.pair?.nativeConversation ? 'conversation' : 'artifact');
  const conversationAttempt = useRef(latest?.id);
  useEffect(() => {
    if (conversationAttempt.current !== latest?.id && latest?.pair?.nativeConversation)
      setTab('conversation');
    conversationAttempt.current = latest?.id;
  }, [latest?.id, latest?.pair?.nativeConversation]);
  useEffect(() => {
    if (tab === 'conversation' && !attempt?.pair?.nativeConversation) setTab('artifact');
  }, [attempt?.id, attempt?.pair?.nativeConversation, tab]);
  const [edit, setEdit] = useState(Boolean(reportTarget?.edit && !historic));
  const [discussionPending, setDiscussionPending] = useState<string>();
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'reportDiscussionOpened' && message.requestId === discussionPending)
          setDiscussionPending(undefined);
      }),
    [discussionPending],
  );
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
  const [saveAck, setSaveAck] = useState<{
    revision: number;
    action: 'approve' | 'review';
  } | null>(null);
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
  const [launchPair, setLaunchPair] = useState(false);
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
    allFeatures(state.features).some((item) => item.autopilot?.status === 'running');
  const unlocked = step.dependsOn.every((id) =>
    stepResolved(feature.steps.find((s) => s.id === id)),
  );
  const canRun =
    state.workspace.trusted &&
    state.runtime.state === 'ready' &&
    !running &&
    unlocked &&
    !step.awaitsCorrection &&
    !subplanIssues(feature.steps).length &&
    !(feature.parent && feature.status === 'completed') &&
    !feature.archived &&
    (step.maxAttempts === 0 || step.attempts.length < step.maxAttempts);
  const next = feature.steps.find((s) => s.dependsOn.includes(step.id) && !stepResolved(s));
  const agent = state.agents.find((a) => a.id === step.agentId);
  const displayPolicy = step.inheritAgent && agent ? agentPolicy(agent) : step.policy;
  const unanswered = latest?.questions.filter((q) => !latest.answers[q.id]) ?? [];
  const blocked = step.awaitsCorrection
    ? 'Intervention ajoutée avant du travail réalisé : utilisez une route de correction.'
    : subplanIssues(feature.steps).length
      ? subplanIssues(feature.steps).join(' ')
      : !state.workspace.trusted
        ? 'Le projet doit être approuvé dans VS Code.'
        : state.runtime.state !== 'ready'
          ? 'Vérifiez la connexion Copilot avant de lancer une étape.'
          : !unlocked
            ? 'Validez les étapes précédentes pour débloquer celle-ci.'
            : step.maxAttempts > 0 && step.attempts.length >= step.maxAttempts
              ? `La limite de ${step.maxAttempts} tentative${step.maxAttempts > 1 ? 's' : ''} est atteinte.`
              : feature.archived
                ? 'Restaurez la session pour poursuivre.'
                : '';
  const run = (resume = false, pairMode = false) => {
    const action = () => {
      setLaunchPair(pairMode);
      setLaunchResume(resume);
    };
    if ((latest || stepResolved(step)) && !resume)
      confirm(
        step.status === 'skipped'
          ? 'Exécuter cette intervention passée ?'
          : step.status === 'approved'
            ? 'Rejouer une étape validée ?'
            : 'Relancer cette étape ?',
        stepResolved(step)
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
          pairMode={launchPair}
          onPairStarted={feature.execution ? () => setTab('conversation') : openPair}
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
        {step.status === 'skipped' && (
          <div className="optional-notice skipped-notice" role="status">
            <strong>Passée par décision humaine — non exécutée</strong>
            <p>
              Aucun livrable ni preuve de test.{' '}
              {step.optionalDecision?.at ? date(step.optionalDecision.at) : ''}
            </p>
          </div>
        )}
        {!feature.optionalRequest && (
          <OptionalStepChoice
            feature={feature}
            step={step}
            state={state}
            dispatch={dispatch}
            busy={running || dirty}
          />
        )}
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
              {(step.model ?? agent?.model) || state.settings.defaultModel || 'Modèle automatique'}
              <span className="inline-dot" />
              {feature.execution
                ? `Copilot natif · ${permissionLabels[feature.execution.permissionMode]}`
                : policyLabels[displayPolicy]}
            </span>
          </div>
          <button
            className="text-button"
            disabled={running || dirty || Boolean(feature.archived)}
            onClick={() => (step.subplan ? configureTeam() : setConfig(!config))}
            aria-expanded={config}
          >
            <Settings2 size={14} />
            {config ? 'Fermer' : 'Configurer'}
          </button>
        </div>
        {config && (
          <StepConfig
            native={Boolean(feature.execution)}
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
          {attempt?.pair?.nativeConversation && (
            <button
              role="tab"
              id="tab-conversation"
              aria-controls="step-content"
              aria-selected={tab === 'conversation'}
              onClick={() => setTab('conversation')}
            >
              <MessageSquare size={15} /> Conversation
            </button>
          )}
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
            <ShieldCheck size={15} /> Preuves{' '}
            <span>{(attempt?.evidence?.length ?? 0) + (attempt?.nativeActivity?.length ?? 0)}</span>
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
          {tab === 'conversation' && attempt?.pair?.nativeConversation && (
            <SessionConversation
              key={attempt.id}
              feature={feature}
              step={step}
              attempt={attempt}
              state={state}
              dispatch={dispatch}
              showArtifact={() => setTab('artifact')}
            />
          )}
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
                  <AgentReportDownload
                    key={attempt.id}
                    featureId={feature.id}
                    stepId={step.id}
                    attempt={attempt}
                    unsaved={dirty || savePending}
                    dispatch={dispatch}
                  />
                  <button
                    className="text-button"
                    disabled={
                      dirty ||
                      savePending ||
                      Boolean(discussionPending) ||
                      attempt.status === 'running' ||
                      !state.workspace.trusted
                    }
                    onClick={() => {
                      if (attempt.pair?.nativeConversation) {
                        setTab('conversation');
                        return;
                      }
                      const requestId = crypto.randomUUID();
                      if (isHosted) setDiscussionPending(requestId);
                      dispatch({
                        type: 'openReportDiscussion',
                        requestId,
                        featureId: feature.id,
                        stepId: step.id,
                        attemptId: attempt.id,
                        revision: attempt.revision ?? 0,
                      });
                    }}
                  >
                    <MessageSquare size={14} />{' '}
                    {attempt.pair?.nativeConversation
                      ? 'Revenir à la conversation'
                      : discussionPending
                        ? 'Ouverture…'
                        : 'Discuter avec l’agent'}
                  </button>
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
                              (allFeatures(state.features).some(
                                (item) => item.autopilot?.status === 'running',
                              )
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
                      urlTransform={(url) =>
                        /^feature-studio-review:[a-f0-9-]{36}$/.test(url)
                          ? url
                          : defaultUrlTransform(url)
                      }
                      components={{
                        a: ({ href, children }) =>
                          /^feature-studio-review:[a-f0-9-]{36}$/.test(href ?? '') ? (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                dispatch({
                                  type: 'openPersonalReviewReport',
                                  sessionId: href!.slice('feature-studio-review:'.length),
                                })
                              }
                            >
                              {children}
                            </button>
                          ) : (
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
                      onClick={() =>
                        dispatch({
                          type: 'openFile',
                          path,
                          featureId: feature.id,
                        })
                      }
                    >
                      Ouvrir
                    </button>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        dispatch({
                          type: 'openDiff',
                          path,
                          featureId: feature.id,
                        })
                      }
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
        {tab !== 'conversation' && (
          <HumanRequests
            requests={(state.humanRequests ?? []).filter(
              (r) => r.featureId === feature.id && r.stepId === step.id,
            )}
            dispatch={dispatch}
          />
        )}
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
          {unanswered.length > 0 && tab !== 'conversation' && (
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
          {!latest?.pair?.nativeConversation &&
            !['running', 'waiting_input'].includes(step.status) && (
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
            {step.attempts.some((a) => a.pair) && (
              <button
                className="button secondary"
                disabled={dirty}
                onClick={latest?.pair?.nativeConversation ? () => setTab('conversation') : openPair}
              >
                <MessageSquare size={14} />{' '}
                {latest?.pair?.nativeConversation
                  ? 'Ouvrir la conversation'
                  : !latest?.pair
                    ? 'Consulter les échanges en pair'
                    : latest.pair.busy
                      ? 'Rejoindre le travail en pair'
                      : 'Ouvrir le travail en pair'}
              </button>
            )}
            {!latest?.pair && step.status !== 'running' && (
              <button
                className="button secondary"
                disabled={!canRun || dirty}
                onClick={() => run(false, true)}
              >
                <MessageSquare size={14} /> Démarrer en mode pair
              </button>
            )}
            {latest?.pair && step.status !== 'running' && (
              <button
                className="button secondary"
                disabled={!canRun || dirty}
                onClick={() => run(false, true)}
              >
                <MessageSquare size={14} /> Nouvelle tentative en pair
              </button>
            )}
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
                      : `Étape validée. ${featureCompletionBlockers(feature).join(' ') || (feature.steps.every(stepResolved) ? 'Le bilan final attend votre décision.' : 'D’autres étapes restent à valider.')}`}
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
                      {approvalPending
                        ? 'Validation en cours…'
                        : step.subplan
                          ? 'Valider l’ensemble des sous-tâches'
                          : 'Valider cette étape'}
                    </button>
                  </>
                )}
                {latest?.sessionId &&
                  !latest.pair &&
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
                    {step.status === 'skipped'
                      ? 'Exécuter finalement cette étape'
                      : latest
                        ? 'Nouvelle tentative'
                        : 'Exécuter cette étape'}
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
              {step.maxAttempts > 0 && step.attempts.length >= step.maxAttempts && (
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
            {feature.execution ? (
              <PermissionPicker
                state={state}
                value={feature.execution.permissionMode}
                disabled={
                  Boolean(feature.archived) ||
                  Boolean(
                    state.humanRequests?.some((request) => request.featureId === feature.id),
                  ) ||
                  Boolean(
                    attempt?.pair?.busy &&
                      !['work', 'solo'].includes(attempt.pair.turn?.kind ?? ''),
                  )
                }
                onChange={(mode) =>
                  dispatch({ type: 'setPermissionMode', featureId: feature.id, mode })
                }
              />
            ) : (
              <>
                <strong>{policyLabels[displayPolicy]}</strong>
                <p>
                  {displayPolicy === 'read-only'
                    ? 'Cette étape est destinée à analyser et proposer.'
                    : displayPolicy === 'tests'
                      ? 'Seules les commandes de test configurées sont autorisées.'
                      : 'L’agent peut modifier les fichiers du projet pendant cette étape.'}
                </p>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
function StepConfig({
  native = false,
  step,
  state,
  save,
}: {
  native?: boolean;
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
  const profile = state.agents.find((a) => a.id === agent);
  const efforts =
    state.runtime.models.find(
      (m) => m.id === (model || profile?.model || state.settings.defaultModel),
    )?.reasoningEfforts ?? [];
  return (
    <form
      className="step-config"
      onSubmit={(e) => {
        e.preventDefault();
        save({
          agentId: agent,
          model: model || undefined,
          reasoning: reasoning || undefined,
          skills: step.inheritAgent ? [] : skills,
          maxAttempts,
          initialContext,
          mcpServerIds,
          askBeforeRun,
        });
      }}
    >
      <div className="field-row">
        <label className="field">
          <span>Profil de l’agent</span>
          <select
            disabled={step.inheritAgent}
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            {orderedAgents(state.agents, state.favoriteAgentIds).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <ModelSelect
          state={state}
          value={model}
          emptyLabel={`Hériter de l’agent (${profile?.model || state.settings.defaultModel || 'Automatique'})`}
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
            <option value="">Hériter de l’agent ({profile?.reasoning || 'Automatique'})</option>
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
          min={Math.max(step.attempts.length, 1)}
          max={100}
          value={maxAttempts || ''}
          placeholder="Sans limite"
          onChange={(e) => setMaxAttempts(Number(e.target.value))}
        />
        <small>
          {step.attempts.length} tentative{step.attempts.length > 1 ? 's' : ''} déjà effectuée
          {step.attempts.length > 1 ? 's' : ''}. Chaque nouvelle tentative peut consommer votre
          quota Copilot. Laisser vide autorise les relances manuelles sans limite.
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
      {step.inheritAgent && profile ? (
        <AgentProfileSummary agent={profile} state={state} native={native} />
      ) : (
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
      )}
      <button className="button secondary small" disabled={!agent}>
        Enregistrer la configuration <Check size={14} />
      </button>
    </form>
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
  const [avatar, setAvatar] = useState(resolveAvatar(source?.avatar, source?.id));
  const [description, setDescription] = useState(source?.description ?? '');
  const [instructions, setInstructions] = useState(source?.instructions ?? '');
  const [tools, setTools] = useState(source?.tools.join(', ') ?? '');
  const [model, setModel] = useState(source?.model ?? '');
  const [reasoning, setReasoning] = useState(source?.reasoning ?? '');
  const [policy, setPolicy] = useState<NonNullable<AgentProfile['policy']>>(
    source ? agentPolicy(source) : 'read-only',
  );
  const [skills, setSkills] = useState(source?.skills ?? []);
  const [emptyContextByDefault, setEmptyContextByDefault] = useState(
    source?.emptyContextByDefault ?? false,
  );
  const [discussionAgent, setDiscussionAgent] = useState(source?.discussionAgent ?? false);
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
            reasoning: string;
            policy: NonNullable<AgentProfile['policy']>;
            skills: string[];
            emptyContextByDefault: boolean;
            discussionAgent: boolean;
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
        reasoning,
        policy,
        skills,
        emptyContextByDefault,
        discussionAgent,
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
        avatar: resolveAvatar(existing.avatar, existing.id),
        tools: existing.tools.join(', '),
        model: existing.model ?? '',
        reasoning: existing.reasoning ?? '',
        policy: agentPolicy(existing),
        emptyContextByDefault: existing.emptyContextByDefault ?? false,
        discussionAgent: existing.discussionAgent ?? false,
        roastLevel: normalizeRoastLevel(existing.roastLevel),
      });
    if (chosen) {
      setId(chosen.id);
      setName(chosen.name);
      setNickname(chosen.nickname);
      setAvatar(resolveAvatar(chosen.avatar, chosen.id));
      setDescription(chosen.description);
      setInstructions(chosen.instructions);
      setTools(chosen.tools);
      setModel(chosen.model);
      setReasoning(chosen.reasoning);
      setPolicy(chosen.policy);
      setSkills(chosen.skills);
      setEmptyContextByDefault(chosen.emptyContextByDefault);
      setDiscussionAgent(chosen.discussionAgent);
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
                reasoning,
                policy,
                skills,
                nickname: nickname.trim() || undefined,
                avatar,
                emptyContextByDefault,
                discussionAgent,
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
                <AgentImage avatar={a.id} />
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
              <span>Outils Studio et outils métier</span>
              <input
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="read, search, edit, execute"
              />
              <small>
                Dans les nouvelles sessions, fichiers et terminal utilisent les outils natifs et les
                permissions Copilot choisies pour la session. Les noms read, search, edit et execute
                configurent les outils Studio historiques. studio_devops_inspect lit les pipelines
                et résultats du dépôt Azure DevOps configuré ; studio_devops_verify_test vérifie le
                test manuel dans une étape exigeant sa preuve. Les permissions de l’étape restent
                applicables à ces outils métier.
              </small>
            </label>
            <ModelSelect
              state={state}
              value={model}
              onChange={(value) => {
                setModel(value);
                setReasoning('');
              }}
            />
          </div>
          <div className="field-row">
            <label className="field">
              <span>Réflexion par défaut de l’agent</span>
              <select value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
                <option value="">Automatique</option>
                {[
                  ...new Set([
                    ...(reasoning ? [reasoning] : []),
                    ...(state.runtime.models.find(
                      (m) => m.id === (model || state.settings.defaultModel),
                    )?.reasoningEfforts ?? []),
                  ]),
                ].map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Permissions par défaut de l’agent</span>
              <select
                value={policy}
                onChange={(e) => setPolicy(e.target.value as NonNullable<AgentProfile['policy']>)}
              >
                <option value="read-only">Lecture seule</option>
                <option value="workspace-write">Écriture dans le projet</option>
                <option value="tests">Tests préautorisés</option>
              </select>
              <small>
                Les outils demandés et les commandes de test autorisées restent nécessaires.
              </small>
            </label>
          </div>
          <label className="discussion-agent-toggle">
            <input
              type="checkbox"
              checked={discussionAgent}
              onChange={(event) => setDiscussionAgent(event.target.checked)}
            />
            <span>
              <strong>Agent de discussion</strong>
              <small>Le proposer en priorité dans le menu Discussion.</small>
            </span>
          </label>
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
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
  settings: StudioSettings;
  state: StudioState;
  automation: boolean;
  dispatch: (m: ClientMessage) => void;
}) {
  const [draft, setDraft] = useState(structuredClone(settings));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const baseline = useRef(settings);
  useEffect(() => {
    if (JSON.stringify(baseline.current) !== JSON.stringify(settings)) {
      if (
        JSON.stringify(draft) === JSON.stringify(baseline.current) ||
        JSON.stringify(draft) === JSON.stringify(settings)
      )
        setDraft(structuredClone(settings));
      baseline.current = settings;
    }
  }, [settings]);
  useEffect(() => {
    dirtyCallback.current(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyCallback.current(false), []);
  const set = (patch: Partial<StudioSettings>) => setDraft({ ...draft, ...patch });
  const lines = (text: string) =>
    text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!state.workspace.trusted) return;
    dispatch({
      type: 'saveSettings',
      projectId: state.projectCatalog?.activeProjectId,
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
        hooks: draft.hooks.map((h) => ({
          ...h,
          args: h.args.filter((a) => a.length > 0),
        })),
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
      {!automation && (
        <nav className="settings-jump-links" aria-label="Sections des réglages">
          {[
            ['appearance', 'Apparence'],
            ['connection', 'Connexion'],
            ['projects', 'Projets'],
            ['mcp', 'MCP'],
            ['models', 'Modèles et budgets'],
            ['storage', 'Archives'],
            ['sessions', 'Sessions'],
            ['tests', 'Tests'],
          ].map(([id, label]) => (
            <a key={id} href={`#settings-${id}`}>
              {label}
            </a>
          ))}
        </nav>
      )}
      {!automation && (
        <section className="common-settings" aria-label="Réglages communs">
          <div className="settings-section-heading">
            <span className="eyebrow">COMMUN À TOUS LES PROJETS</span>
            <h2>Votre atelier</h2>
          </div>
          <div id="settings-appearance" className="settings-anchor">
            <ZoomSettings />
            <ThemePicker />
          </div>
          <section className="settings-card settings-anchor" id="settings-connection">
            <div className="settings-card-title">
              <span className="settings-icon color-2">
                <Command size={21} />
              </span>
              <div>
                <h2>GitHub Copilot CLI</h2>
                <p>Détection automatique du CLI installé. Un chemin personnalisé reste possible.</p>
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
            <div className="runtime-location">
              <span>Chemin utilisé au dernier diagnostic</span>
              <code>{state.runtime.cliPath ?? 'Cliquez sur Vérifier la connexion.'}</code>
              {state.runtime.cliSource && (
                <small>
                  {state.runtime.cliSource === 'configured'
                    ? 'Chemin personnalisé'
                    : state.runtime.cliSource === 'path'
                      ? 'Détection automatique · PATH de VS Code'
                      : 'Détection automatique · installation utilisateur'}
                </small>
              )}
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
                className="button secondary"
                disabled={state.runtime.state === 'checking'}
                onClick={() => dispatch({ type: 'autoDetectCli' })}
              >
                Détection automatique
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
          <div id="settings-projects" className="settings-anchor">
            <ProjectSettings state={state} dispatch={dispatch} dirty={dirty} />
          </div>
        </section>
      )}
      <section className="project-settings-heading" aria-label="Réglages du projet">
        <div>
          <span className="eyebrow">PARAMÈTRES PAR PROJET</span>
          <h2>{automation ? 'Automatisations du projet' : 'Configurer un projet'}</h2>
          <p className="project-current-settings">
            Les paramètres ci-dessous concernent{' '}
            <strong>
              {state.projectCatalog?.projects.find(
                (project) => project.id === state.projectCatalog?.activeProjectId,
              )?.name ?? state.workspace.name}
            </strong>
            .
          </p>
        </div>
        <ProjectSwitcher
          state={state}
          dispatch={dispatch}
          disabled={dirty || hasActiveRun(state)}
        />
      </section>
      <form onSubmit={submit}>
        {!automation && (
          <>
            <div id="settings-mcp" className="settings-anchor">
              <McpSettings
                servers={draft.mcpServers ?? []}
                state={state}
                onChange={(mcpServers) => set({ mcpServers })}
                dispatch={dispatch}
              />
            </div>
            <div id="settings-models" className="settings-anchor">
              <ModelBudgetSettings settings={draft} state={state} onChange={set} />
            </div>
            <div id="settings-storage" className="settings-anchor">
              <TraceStorageSetting
                value={draft.traceLimitBytes}
                onChange={(traceLimitBytes) => set({ traceLimitBytes })}
              />
            </div>
            <section className="settings-card settings-anchor" id="settings-sessions">
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
            <section className="settings-card settings-anchor" id="settings-tests">
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
                      {
                        id: crypto.randomUUID(),
                        name: '',
                        command: '',
                        args: [],
                      },
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
                    onClick={() =>
                      set({
                        hooks: draft.hooks.filter((h) => h.id !== hook.id),
                      })
                    }
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
                              ? {
                                  ...h,
                                  event: e.target.value as 'beforeRun' | 'afterRun',
                                }
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
        <div className="settings-save" data-dirty={dirty}>
          <span role="status" aria-live="polite">
            {dirty ? 'Réglages du projet modifiés' : 'Aucune modification des réglages du projet'}
            {!automation && (
              <small>Les thèmes s’enregistrent automatiquement dès leur sélection.</small>
            )}
            <small id="settings-trust-status">
              {state.workspace.trusted
                ? 'Projet approuvé dans VS Code. Les nouvelles commandes vous seront présentées à l’enregistrement.'
                : 'Approbation requise dans VS Code pour enregistrer. Vos modifications sont conservées ici.'}
            </small>
          </span>
          {!state.workspace.trusted && (
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatch({ type: 'manageWorkspaceTrust' })}
            >
              Gérer l’approbation dans VS Code <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
          {dirty && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setDraft(structuredClone(settings))}
            >
              Annuler les modifications
            </button>
          )}
          <button
            className="button primary"
            disabled={!dirty || !state.workspace.trusted}
            aria-describedby="settings-trust-status"
          >
            Enregistrer les réglages du projet <Check size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
