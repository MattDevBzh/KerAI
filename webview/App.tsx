import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronRight,
  Command,
  FileText,
  FolderGit2,
  GitBranch,
  LoaderCircle,
  Menu,
  MessageSquare,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import brandIcon from '../resources/icon.png';
import type { AccountCredits } from '../src/shared/credits';
import type { DevOpsState } from '../src/shared/devops';
import { emptyQuestState, type QuestState } from '../src/shared/quests';
import { normalizeRoastLevel, roastLabel } from '../src/shared/roast';
import { allFeatures, featurePath } from '../src/shared/subplans';
import { orderedAgents } from '../src/shared/team';
import type { AgentProfile, ClientMessage, SkillInfo, StudioState } from '../src/shared/types';
import { AccountCreditsBadge } from './AccountCreditsBadge';
import { AgentFavorite } from './AgentFavorite';
import { Avatar } from './Avatar';
import { initialView, isDemo, isHosted, persistView, send, subscribe } from './bridge';
import { demoState } from './demo';
import { CatalogSearch, searchText } from './Ergonomics';
import './evolution.css';
import { attentionCount, hasActiveRun } from '../src/shared/sessionAttention';
import { deferred } from './DeferredScreen';
import { HumanRequestProvider } from './HumanRequests';
import { StudioNavigation, navigationGroup, navigationScreens, type View } from './Navigation';
import { ProjectSwitcher } from './ProjectUI';
import { RewardTitle, RewardUnlockNotice } from './RewardsUI';
import './session-compact.css';
import { Sessions } from './Sessions';
import { CreateReview } from './CreateReview';
import { ThemeScenery } from './ThemeScenery';
import { ZoomControls } from './ZoomControls';

import type { DiscussionFeatureDraft, DiscussionState } from '../src/shared/discussions';

import { Empty, Modal } from './SessionPrimitives';

const ApplicationsUI = deferred(() =>
  import('./ApplicationsUI').then((module) => module.ApplicationsUI),
);

const DashboardUI = deferred(() => import('./DashboardUI').then((module) => module.DashboardUI));

const DevOpsDashboard = deferred(() =>
  import('./DevOpsDashboard').then((module) => module.DevOpsDashboard),
);

const DevOpsUI = deferred(() => import('./DevOpsUI').then((module) => module.DevOpsUI));

const HqCinema = deferred(() => import('./HqCinema').then((module) => module.HqCinema));

const KitsUI = deferred(() => import('./KitsUI').then((module) => module.KitsUI));

const QuestCelebration = deferred(() =>
  import('./QuestsUI').then((module) => module.QuestCelebration),
);
const QuestsUI = deferred(() => import('./QuestsUI').then((module) => module.QuestsUI));

const Statistics = deferred(() => import('./Statistics').then((module) => module.Statistics));

const ProjectMemoryView = deferred(() =>
  import('./StudioUI').then((module) => module.ProjectMemoryView),
);
const ValidationCenter = deferred(() =>
  import('./StudioUI').then((module) => module.ValidationCenter),
);
const WorkflowLibrary = deferred(() =>
  import('./StudioUI').then((module) => module.WorkflowLibrary),
);

const UsageDashboard = deferred(() =>
  import('./UsageDashboard').then((module) => module.UsageDashboard),
);

const DiscussionUI = deferred(() => import('./DiscussionUI').then((module) => module.DiscussionUI));

const CreateModal = deferred(() => import('./CreateSession').then((module) => module.CreateModal));

const FeatureDetail = deferred(() =>
  import('./FeatureDetail').then((module) => module.FeatureDetail),
);

const AgentEditor = deferred(() => import('./ProfileEditors').then((module) => module.AgentEditor));
const SkillEditor = deferred(() => import('./ProfileEditors').then((module) => module.SkillEditor));

const SettingsView = deferred(() => import('./SettingsView').then((module) => module.SettingsView));

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
export default function App() {
  const [accountCredits, setAccountCredits] = useState<AccountCredits | undefined>(
    isDemo
      ? { state: 'unavailable', message: 'Le quota du compte est disponible dans VS Code.' }
      : undefined,
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const [catalogQuery, setCatalogQuery] = useState({ agents: '', skills: '' });
  const [agentScope, setAgentScope] = useState('all');
  const [skillScope, setSkillScope] = useState('all');
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
  const [visitedViews, setVisitedViews] = useState(() => new Set<View>([view]));
  useEffect(() => {
    setVisitedViews((previous) => (previous.has(view) ? previous : new Set([...previous, view])));
  }, [view]);
  const [discussionMounted, setDiscussionMounted] = useState(view === 'discussion');
  useEffect(() => {
    if (view === 'discussion') setDiscussionMounted(true);
  }, [view]);
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
  const [hqFeatureId, setHqFeatureId] = useState(initialView.hqFeatureId);
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
      else if (message.type === 'navigationState')
        setState((previous) => (previous ? { ...previous, navigation: message.state } : previous));
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
      } else if ((message.type === 'error' && !message.requestId) || message.type === 'notice')
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
        setHqFeatureId(undefined);
        setView(
          message.view === 'devops-prs' ||
            message.view === 'devops-tickets' ||
            message.view === 'devops' ||
            message.view === 'reviews'
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
    () => persistView({ view, featureId, stepId, pairOpen, hqFeatureId }),
    [view, featureId, stepId, pairOpen, hqFeatureId],
  );
  const pairLocation = useRef(`${featureId}:${stepId}`);
  useEffect(() => {
    const location = `${featureId}:${stepId}`;
    if (pairLocation.current !== location) setPairOpen(false);
    pairLocation.current = location;
  }, [featureId, stepId]);
  const loaded = Boolean(state);
  useEffect(() => {
    if (loaded && featureId && (view === 'sessions' || view === 'reviews') && !create && !isDemo)
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
      if (message.type === 'saveAutopilot' || message.type === 'previewAutopilot') {
        window.postMessage(
          {
            type: message.type === 'saveAutopilot' ? 'autopilotSaved' : 'autopilotPreview',
            requestId: message.requestId,
            error:
              'Mode démonstration : ouvre KerAI dans VS Code pour configurer et lancer le pilote.',
          },
          '*',
        );
        return;
      }
      if (message.type === 'navigation') {
        window.postMessage(
          {
            type: 'navigationState',
            requestId: message.requestId,
            state: state?.navigation ?? {
              navigationVersion: 1,
              applications: [],
              journeys: [],
              contributions: [],
              runs: [],
            },
            error:
              message.command.action === 'load'
                ? undefined
                : 'Ouvrez KerAI dans VS Code pour utiliser le navigateur dédié et enregistrer les parcours.',
          },
          '*',
        );
        return;
      }
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
  useEffect(() => {
    if (selected?.reviewTarget && view === 'sessions') setView('reviews');
  }, [selected?.id, Boolean(selected?.reviewTarget), view]);
  const hqRoot = state?.features.find((f) => f.id === hqFeatureId);
  useEffect(() => {
    if (state && hqFeatureId && !hqRoot) setHqFeatureId(undefined);
  }, [Boolean(state), hqFeatureId, Boolean(hqRoot)]);
  const activeFeatures = state?.features.filter((f) => !f.archived && !f.reviewTarget) ?? [];
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
      (agentScope === 'all' || agent.source === agentScope) &&
      (!onlyFavorites || state?.favoriteAgentIds?.includes(agent.id)),
  );
  const skills = (state?.skills ?? []).filter(
    (skill) =>
      searchText(`${skill.name} ${skill.description}`).includes(searchText(catalogQuery.skills)) &&
      (skillScope === 'all' || skill.source === skillScope),
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
      presentationOnly={Boolean(hqRoot)}
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
          {earnedQuests.length > 0 && (
            <QuestCelebration
              ids={earnedQuests}
              onClose={() => setEarnedQuests([])}
              onOpen={() => {
                chooseView('quests');
                setEarnedQuests([]);
              }}
            />
          )}
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
          {(view === 'sessions' || view === 'reviews') &&
            (selected ? (
              <FeatureDetail
                onExpandHq={() => {
                  if (!draftDirtyRef.current)
                    setHqFeatureId(featurePath(state.features, selected.id)[0]?.id ?? selected.id);
                }}
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
                key={view}
                reviewMode={view === 'reviews'}
                state={{
                  ...state,
                  features: state.features.filter(
                    (feature) => Boolean(feature.reviewTarget) === (view === 'reviews'),
                  ),
                }}
                onCreate={openCreate}
                onOpen={(id) => {
                  setFeatureId(id);
                  setStepId('');
                }}
              />
            ))}
          {(visitedViews.has('devops') ||
            visitedViews.has('delivery') ||
            view === 'devops' ||
            view === 'delivery') && (
            <div hidden={view !== 'devops' && view !== 'delivery'}>
              <DevOpsUI
                draftScope={state.workspace.path}
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
          )}
          {(['devops-prs', 'devops-tickets'] as View[])
            .filter((target) => visitedViews.has(target) || view === target)
            .map((dashboardView) => (
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
          {(discussionMounted || view === 'discussion') && (
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
          )}
          {view === 'applications' && (
            <ApplicationsUI
              state={state}
              dispatch={dispatch}
              onOpenSkill={(id) => {
                const skill = state.skills.find((s) => s.id === id);
                if (skill) setSkillEditor(skill);
              }}
              onOpenAgent={(id) => {
                const agent = state.agents.find((a) => a.id === id);
                if (agent) setAgentEditor(agent);
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
                    value={agentScope}
                    onChange={(event) => setAgentScope(event.target.value)}
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
                      setAgentScope('all');
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
                    value={skillScope}
                    onChange={(event) => setSkillScope(event.target.value)}
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
                      setSkillScope('all');
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
      {create && view === 'reviews' && (
        <CreateReview state={state} dispatch={dispatch} onClose={() => setCreate(false)} />
      )}
      {create && view !== 'reviews' && (
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
      {hqRoot && (
        <HqCinema
          root={hqRoot}
          state={state}
          reduce={(id, step) => {
            setHqFeatureId(undefined);
            setFeatureId(id);
            setStepId(step ?? '');
            setView('sessions');
          }}
        />
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
