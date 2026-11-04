import { NavigationBugDialog } from './NavigationBugDialog';
import {
  navigationPlan,
  publishedJourneys,
  navigationOutputs,
} from '../src/shared/navigationRecipes';
import { NavigationEvaluationUI } from './NavigationEvaluationUI';
import { applicationReadiness } from './launchReadiness';
import { useEffect, useRef, useState } from 'react';
import {
  AppWindow,
  BookOpen,
  Camera,
  CircleHelp,
  FileJson,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
} from 'lucide-react';
import type {
  ApplicationProfile,
  NavigationCommand,
  NavigationCondition,
  NavigationJourney,
  NavigationLocator,
  NavigationParameter,
  NavigationRun,
  NavigationSelection,
  NavigationSnapshot,
  NavigationStep,
} from '../src/shared/navigation';
import type { Attempt, ClientMessage, StudioState } from '../src/shared/types';
import { subscribe } from './bridge';
import { StudioDialog } from './ExecutionUI';
import { applicationProfileSchema } from '../src/core/navigationSchemas';
import './applications.css';

type Dispatch = (message: ClientMessage) => void;
type Command = (command: NavigationCommand, onSuccess?: () => void) => void;
const empty: NavigationSnapshot = {
  navigationVersion: 1,
  applications: [],
  journeys: [],
  contributions: [],
  runs: [],
};
const definitionLabels = { draft: 'Brouillon', available: 'Disponible', archived: 'Archivé' };
const runLabels = {
  running: 'En cours',
  succeeded: 'Rejoué avec succès',
  failed: 'Échec',
  interrupted: 'Interrompu',
};
const actionLabels: Record<NavigationStep['action'], string> = {
  navigate: 'Ouvrir une adresse',
  click: 'Cliquer',
  doubleClick: 'Double-cliquer',
  resolve: 'Choisir une donnée métier',
  fill: 'Remplir',
  select: 'Choisir',
  check: 'Cocher',
  press: 'Touche clavier',
  scroll: 'Défiler',
  viewport: 'Taille de fenêtre',
  wait: 'Attendre',
  manual: 'Intervention manuelle',
};
const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
const stamp = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const shortDate = (value: string) => new Date(value).toLocaleString('fr-FR');
function currentRun(journey: NavigationJourney, runs: NavigationRun[]) {
  return runs
    .filter(
      (run) =>
        run.journeyId === journey.id &&
        (run.revision === journey.revision ||
          (run.id === journey.provenance.verifiedRunId && run.definitionHash === journey.hash)),
    )
    .at(-1);
}
function proof(journey: NavigationJourney, runs: NavigationRun[]) {
  const run = currentRun(journey, runs);
  return run
    ? runLabels[run.status]
    : journey.provenance.mode === 'demonstration'
      ? 'Observé'
      : 'Décrit';
}
function freshness(journey: NavigationJourney, runs: NavigationRun[]) {
  const run = currentRun(journey, runs);
  return run?.status === 'failed'
    ? 'À réparer'
    : run?.status === 'succeeded' && run.binding.verification === 'verified'
      ? 'Vérifié pour cette exécution'
      : 'À contrôler';
}

export function ApplicationsUI({
  state,
  dispatch,
  onOpenSkill,
  onOpenAgent,
}: {
  state: StudioState;
  dispatch: Dispatch;
  onOpenSkill?: (id: string) => void;
  onOpenAgent?: (id: string) => void;
}) {
  const data = state.navigation ?? empty;
  const preferencesKey = `kerai-navigation:${state.workspace.path}`;
  const [preferences, setPreferences] = useState<{
    applicationId?: string;
    journeyId?: string;
    favorites?: string[];
  }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(preferencesKey) ?? '{}');
      return {
        applicationId: typeof stored?.applicationId === 'string' ? stored.applicationId : undefined,
        journeyId: typeof stored?.journeyId === 'string' ? stored.journeyId : undefined,
        favorites: Array.isArray(stored?.favorites)
          ? stored.favorites.filter((id: unknown) => typeof id === 'string').slice(-100)
          : [],
      };
    } catch {
      return {};
    }
  });
  const [applicationId, setApplicationId] = useState(
    preferences.applicationId ?? data.applications[0]?.id ?? '',
  );
  const [journeyId, setJourneyId] = useState(preferences.journeyId ?? '');
  const [bug, setBug] = useState<{
    journey?: NavigationJourney;
    parameters: Record<string, string>;
    currentScreen: boolean;
  } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({ ...preferences, applicationId, journeyId }),
      );
    } catch {
      /* Preferences are optional. */
    }
  }, [preferencesKey, preferences, applicationId, journeyId]);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [profile, setProfile] = useState<ApplicationProfile | null>(null);
  const [learn, setLearn] = useState<'description' | 'import' | 'demonstration' | null>(null);
  const [editor, setEditor] = useState<NavigationJourney | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const requests = useRef(new Map<string, NavigationCommand['action']>());
  const completed = useRef(new Map<string, () => void>());
  const command: Command = (command, onSuccess) => {
    const requestId = newId();
    requests.current.set(requestId, command.action);
    if (onSuccess) completed.current.set(requestId, onSuccess);
    setPending(true);
    setError('');
    setNotice('');
    dispatch({ type: 'navigation', requestId, command });
  };
  useEffect(() => {
    const cleanup = subscribe((message) => {
      if (message.type !== 'navigationState') return;
      if (message.requestId && requests.current.has(message.requestId)) {
        const action = requests.current.get(message.requestId)!;
        requests.current.delete(message.requestId);
        setPending(requests.current.size > 0);
        setError(message.error ?? message.state.error ?? '');
        setNotice(message.message ?? message.state.notice ?? '');
        if (
          !message.error &&
          !message.state.error &&
          message.state.focusedJourneyId &&
          ['saveDraft', 'import', 'recordFinish'].includes(action)
        )
          setJourneyId(message.state.focusedJourneyId);
        if (!message.error && !message.state.error) completed.current.get(message.requestId)?.();
        completed.current.delete(message.requestId);
      }
    });
    command({ action: 'load' });
    return cleanup;
  }, []);
  useEffect(() => {
    if (!data.applications.some((app) => app.id === applicationId))
      setApplicationId(data.applications[0]?.id ?? '');
  }, [data.applications, applicationId]);
  const application = data.applications.find((app) => app.id === applicationId);
  const available = data.journeys.filter(
    (journey) =>
      journey.applicationId === applicationId && (showArchived || journey.status !== 'archived'),
  );
  const candidates = available.filter((journey) =>
    `${journey.title} ${journey.intent} ${journey.tags.join(' ')} ${journey.prerequisites.join(' ')} ${application?.role ?? ''}`
      .toLocaleLowerCase('fr')
      .includes(query.toLocaleLowerCase('fr')),
  );
  const found = [...candidates]
    .sort(
      (a, b) =>
        Number(preferences.favorites?.includes(b.id)) -
        Number(preferences.favorites?.includes(a.id)),
    )
    .slice(0, 30);
  const journey = data.journeys.find(
    (item) => item.id === journeyId && item.applicationId === applicationId,
  );
  const browser = data.browser?.applicationId === applicationId ? data.browser : undefined;
  const createProfile = () =>
    setProfile({
      id: newId(),
      name: '',
      origin: 'http://localhost:3000',
      allowedOrigins: [],
      projectIds: state.projectCatalog?.selectedProjectIds ?? [],
      interactionPolicy: 'confirm',
      ownerNavigatorId: state.agents.find((agent) => agent.id === 'fs-navigator')?.id,
      createdAt: stamp(),
      updatedAt: stamp(),
    });
  return (
    <section className="applications-page" aria-label="Applications et parcours">
      <header className="applications-heading">
        <div>
          <span className="eyebrow">NAVIGATION DOCUMENTÉE</span>
          <h1>
            <AppWindow size={28} /> Applications
          </h1>
          <p>Retrouver un écran, apprendre son accès et garder les preuves de chaque rejeu.</p>
        </div>
        <button className="primary" onClick={createProfile}>
          <Plus size={16} /> Ajouter une application
        </button>
      </header>
      <div className="applications-feedback" aria-live="polite">
        {pending && <p role="status">Commande transmise à l’hôte…</p>}
        {error && !profile && !learn && !editor && (
          <p className="applications-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
      {!data.applications.length ? (
        <div className="applications-empty">
          <AppWindow size={36} />
          <h2>Un navigateur dédié à votre application</h2>
          <p>
            Ajoutez son adresse HTTP ou HTTPS et ses dépôts. KerAI ouvrira votre application, avec
            un profil privé.
          </p>
          <button onClick={createProfile}>Préparer ma première application</button>
          <p className="muted">
            Aucun serveur ni navigateur n’est installé ou démarré automatiquement.
          </p>
        </div>
      ) : (
        <>
          <div className="applications-toolbar">
            <label className="field">
              <span>Application active</span>
              <select
                value={applicationId}
                onChange={(event) => {
                  setApplicationId(event.target.value);
                  setJourneyId('');
                }}
              >
                {data.applications.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => command({ action: 'load' })} disabled={pending}>
              <RefreshCw size={15} /> Actualiser
            </button>
          </div>
          {application && (
            <>
              <section className="applications-profile" aria-label="Prochaine action">
                <h2>Que veux-tu faire ?</h2>
                <div className="applications-actions">
                  <button
                    className="primary"
                    disabled={pending}
                    onClick={() =>
                      browser?.state === 'human'
                        ? command({ action: 'resumeControl' })
                        : !browser || ['closed', 'interrupted'].includes(browser.state)
                          ? command({ action: 'prepare', applicationId })
                          : setLearn('description')
                    }
                  >
                    {browser?.state === 'human'
                      ? 'Connexion terminée · continuer'
                      : !browser || ['closed', 'interrupted'].includes(browser.state)
                        ? 'Préparer le navigateur'
                        : 'Retrouver ou apprendre un écran'}
                  </button>
                  <button onClick={() => setProfile(structuredClone(application))}>
                    Modifier le profil
                  </button>
                  <button
                    disabled={pending || browser?.state !== 'idle'}
                    onClick={() => setBug({ parameters: {}, currentScreen: true })}
                  >
                    Corriger ce que je vois
                  </button>
                </div>
                <p>
                  1. Ouvrir et se connecter · 2. Choisir ou apprendre un accès · 3. Vérifier et
                  utiliser
                </p>
                {data.preparation?.applicationId === applicationId && (
                  <p role="status">
                    {data.preparation.browser
                      ? `Navigateur : ${data.preparation.browser.split(/[\\/]/).pop()}. `
                      : ''}
                    {data.preparation.message}
                  </p>
                )}
                {application.environment && (
                  <div className="applications-actions">
                    <button
                      disabled={pending || !application.environment.startTask}
                      onClick={() =>
                        command({ action: 'environmentTask', applicationId, task: 'start' })
                      }
                    >
                      Démarrer l’environnement
                    </button>
                    <button
                      disabled={pending || !application.environment.buildTask}
                      onClick={() =>
                        command({ action: 'environmentTask', applicationId, task: 'build' })
                      }
                    >
                      Reconstruire l’application
                    </button>
                    <button
                      disabled={pending || browser?.state !== 'idle'}
                      onClick={() => command({ action: 'checkEnvironment', applicationId })}
                    >
                      Vérifier la version servie
                    </button>
                  </div>
                )}
                {data.bindings
                  ?.filter((b) => b.applicationId === applicationId)
                  .map((b) => (
                    <p key={b.applicationId}>
                      {b.reason}
                      {b.commit &&
                        ` · Code ${b.commit.slice(0, 8)}${b.dirty ? ' avec modifications locales' : ''}`}
                    </p>
                  ))}
              </section>
              <details className="applications-profile">
                <summary>Configuration de l’application et droits</summary>
                <section className="applications-profile" aria-label="Profil d’application">
                  <div>
                    <h2>{application.name}</h2>
                    <p>{application.startUrl ?? application.origin}</p>
                    <div aria-label="Navigateur et skills">
                      <strong>Navigateur : </strong>
                      {application.ownerNavigatorId ? (
                        <button
                          className="text-button"
                          onClick={() => onOpenAgent?.(application.ownerNavigatorId!)}
                        >
                          {state.agents.find((agent) => agent.id === application.ownerNavigatorId)
                            ?.name ?? application.ownerNavigatorId}
                        </button>
                      ) : (
                        'À choisir dans le profil'
                      )}
                      <p>
                        Skills :{' '}
                        {(
                          state.agents.find((agent) => agent.id === application.ownerNavigatorId)
                            ?.skills ?? []
                        ).map((id) => {
                          const skill = state.skills.find((item) => item.id === id);
                          return (
                            <button
                              key={id}
                              className="text-button"
                              disabled={!skill}
                              onClick={() => onOpenSkill?.(id)}
                            >
                              {skill?.name ?? `${id} (absente)`}
                            </button>
                          );
                        })}
                        {!state.agents.find((agent) => agent.id === application.ownerNavigatorId)
                          ?.skills.length && 'Aucune skill affectée à cet agent.'}
                      </p>
                    </div>
                    <p className="muted">
                      {application.projectIds.length} dépôt(s) · Rôle :{' '}
                      {application.role || 'à renseigner'} ·{' '}
                      {application.interactionPolicy === 'inspect'
                        ? 'Inspection seule'
                        : application.interactionPolicy === 'confirm'
                          ? 'Interactions à confirmer'
                          : 'Interactions autorisées'}
                    </p>
                    <p className="applications-uncertain">
                      Version de l’application non vérifiée — chaque rejeu conserve son attestation.
                    </p>
                  </div>
                </section>
                <section className="applications-profile" aria-label="Diagnostic de navigation">
                  <h3>Avant de naviguer</h3>
                  <p>Adresse : {application.startUrl ?? application.origin}</p>
                  <p>
                    Projet actif :{' '}
                    {state.projectCatalog?.projects.find(
                      (project) => project.id === state.projectCatalog?.activeProjectId,
                    )?.name ?? state.workspace.name}
                    .
                  </p>
                  {applicationReadiness(state, application).length > 0 ? (
                    <ul>
                      {applicationReadiness(state, application).map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      Le profil inclut le projet actif et un agent compatible avec la navigation.
                    </p>
                  )}
                  <p>
                    {browser && browser.state === 'idle'
                      ? 'Navigateur préparé ; sa version et le serveur restent à vérifier pour chaque exécution.'
                      : 'Utilisez « Préparer le navigateur » pour vérifier Chromium et l’accès à l’adresse. Démarrez le serveur si l’application est locale.'}
                  </p>
                  <p>
                    {application.interactionPolicy === 'inspect'
                      ? 'Inspection seule : les interactions sont bloquées par ce profil.'
                      : application.interactionPolicy === 'confirm'
                        ? 'Chaque interaction demandée par l’agent exige votre confirmation. L’autorisation de la tentative reste nécessaire.'
                        : 'Les interactions exigent aussi l’autorisation explicite de la tentative.'}
                  </p>
                  <p>
                    Connexion :{' '}
                    {application.authInstructions ||
                      'aucune consigne renseignée. Utilisez la connexion manuelle dans le navigateur.'}{' '}
                    Les identifiants ne sont pas transmis à l’agent.
                  </p>
                  <p className="field-help">
                    Un changement de profil, de parcours ou d’autorisation requiert une nouvelle
                    tentative avec un contexte actualisé.
                  </p>
                </section>
              </details>
              <BrowserControls
                data={data}
                applicationId={applicationId}
                command={command}
                busy={pending}
              />
              <div className="applications-layout">
                <section className="applications-library" aria-label="Bibliothèque de parcours">
                  <div className="applications-section-heading">
                    <h2>
                      <BookOpen size={20} /> Bibliothèque
                    </h2>
                    <span>{available.length} parcours</span>
                  </div>
                  <label className="field">
                    <span>
                      <Search size={14} /> Rechercher par intention, écran, rôle ou tag
                    </span>
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Facturation, Gestionnaire…"
                    />
                  </label>
                  <label className="applications-check">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(event) => setShowArchived(event.target.checked)}
                    />{' '}
                    Inclure les parcours archivés
                  </label>
                  <div className="applications-learn">
                    <strong>Apprendre un parcours</strong>
                    <div className="applications-actions">
                      <button onClick={() => setLearn('description')}>Décrire</button>
                      <button onClick={() => setLearn('import')}>
                        <FileJson size={14} /> Importer un JSON
                      </button>
                      <button onClick={() => setLearn('demonstration')}>
                        <Play size={14} /> Montrer
                      </button>
                    </div>
                  </div>
                  <div className="applications-journeys">
                    {found.map((item) => (
                      <button
                        key={item.id}
                        className={`applications-journey ${journeyId === item.id ? 'selected' : ''}`}
                        aria-pressed={journeyId === item.id}
                        onClick={() => setJourneyId(item.id)}
                      >
                        <strong>
                          {preferences.favorites?.includes(item.id) ? '★ ' : ''}
                          {item.title}
                        </strong>
                        <span>{item.intent}</span>
                        <small>
                          Révision {item.revision}
                          {item.variantOf ? ' · Variante' : ''}
                        </small>
                        <span className="applications-badges">
                          <span>{definitionLabels[item.status]}</span>
                          <span>{proof(item, data.runs)}</span>
                          <span>{freshness(item, data.runs)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {!found.length && (
                    <p className="muted">
                      {query
                        ? 'Aucun parcours ne correspond à cette recherche.'
                        : 'Aucun parcours enregistré. Décrivez, importez ou montrez un premier accès.'}
                    </p>
                  )}
                  {candidates.length > found.length && (
                    <p role="status">
                      {found.length} résultats sur {candidates.length}. Précisez votre recherche.
                    </p>
                  )}
                </section>
                <div className="applications-detail">
                  {journey ? (
                    <JourneyDetail
                      journey={journey}
                      data={data}
                      command={command}
                      onBug={(selected, parameters) =>
                        setBug({ journey: selected, parameters, currentScreen: false })
                      }
                      favorite={Boolean(preferences.favorites?.includes(journey.id))}
                      onFavorite={() =>
                        setPreferences({
                          ...preferences,
                          favorites: preferences.favorites?.includes(journey.id)
                            ? preferences.favorites.filter((id) => id !== journey.id)
                            : [...(preferences.favorites ?? []), journey.id].slice(-100),
                        })
                      }
                      edit={() => setEditor(structuredClone(journey))}
                      variant={() =>
                        setEditor({
                          ...structuredClone(journey),
                          id: newId(),
                          revision: 0,
                          hash: undefined,
                          parentHash: undefined,
                          variantOf: journey.id,
                          title: `${journey.title} — variante`,
                          status: 'draft',
                          provenance: { mode: 'human' },
                          createdAt: stamp(),
                          updatedAt: stamp(),
                        })
                      }
                    />
                  ) : (
                    <section className="applications-empty">
                      <BookOpen size={32} />
                      <h2>Choisissez un parcours</h2>
                      <p>
                        Les étapes, paramètres, révisions et preuves apparaîtront ici. Les
                        observations restent distinctes de vos critères d’acceptation.
                      </p>
                    </section>
                  )}
                </div>
              </div>
              {(data.maintenance ?? []).some((m) =>
                data.journeys.some(
                  (j) => j.id === m.journeyId && j.applicationId === applicationId,
                ),
              ) && (
                <section className="applications-profile" aria-label="Accès à revérifier">
                  <h3>Accès à revérifier</h3>
                  {(data.maintenance ?? [])
                    .filter((m) =>
                      data.journeys.some(
                        (j) => j.id === m.journeyId && j.applicationId === applicationId,
                      ),
                    )
                    .map((entry) => (
                      <p key={entry.journeyId}>
                        <button onClick={() => setJourneyId(entry.journeyId)}>
                          {data.journeys.find((j) => j.id === entry.journeyId)?.title}
                        </button>{' '}
                        — {entry.reasons.join(' · ')}
                      </p>
                    ))}
                  <button onClick={() => command({ action: 'load' })}>
                    Contrôler les changements
                  </button>
                </section>
              )}
              {browser && (
                <InspectionPanel
                  data={data}
                  application={application}
                  command={command}
                  journeyId={journeyId}
                />
              )}
              <CaptureComparison data={data} applicationId={applicationId} />
              <Metrics data={data} applicationId={applicationId} command={command} />
            </>
          )}
        </>
      )}
      <NavigationEvaluationUI
        snapshot={data.evaluation}
        state={state}
        send={command}
        error={error}
        busy={pending}
      />
      {bug && (
        <NavigationBugDialog
          applicationId={applicationId}
          {...bug}
          error={error}
          busy={pending}
          onClose={() => setBug(null)}
          onCreate={(value) => command(value, () => setBug(null))}
        />
      )}
      {profile && (
        <ProfileEditor
          application={profile}
          error={error}
          state={state}
          onClose={() => setProfile(null)}
          onSave={(application) => {
            command({ action: 'saveApplication', application }, () => {
              setApplicationId(application.id);
              setProfile(null);
            });
          }}
        />
      )}
      {learn && application && (
        <LearnDialog
          mode={learn}
          error={error}
          application={application}
          data={data}
          busy={pending}
          command={command}
          onClose={() => setLearn(null)}
        />
      )}
      {editor && (
        <JourneyEditor
          journey={editor}
          data={data}
          error={error}
          onClose={() => setEditor(null)}
          onSave={(updated) => {
            command(
              { action: 'saveDraft', journey: updated, expectedRevision: editor.revision },
              () => {
                setJourneyId(updated.id);
                setEditor(null);
              },
            );
          }}
        />
      )}
    </section>
  );
}

function ProfileEditor({
  error,
  application,
  state,
  onClose,
  onSave,
}: {
  application: ApplicationProfile;
  error?: string;
  state: StudioState;
  onClose: () => void;
  onSave: (profile: ApplicationProfile) => void;
}) {
  const [value, setValue] = useState(application);
  const [url, setUrl] = useState(application.startUrl ?? application.origin);
  const [validationError, setValidationError] = useState('');
  const [origins, setOrigins] = useState(
    application.allowedOrigins.filter((origin) => origin !== application.origin).join('\n'),
  );
  const [authenticationOrigins, setAuthenticationOrigins] = useState(
    (application.authenticationOrigins ?? []).join('\n'),
  );
  const patch = (patch: Partial<ApplicationProfile>) => setValue({ ...value, ...patch });
  return (
    <StudioDialog
      title="Profil d’application"
      subtitle="Application locale ou en ligne · navigateur Chromium dédié"
      onClose={onClose}
      className="applications-dialog"
    >
      {(validationError || error) && (
        <p className="applications-error" role="alert">
          {validationError || error}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = applicationProfileSchema.safeParse({
            ...value,
            origin: url,
            startUrl: undefined,
            allowedOrigins: [...new Set([url, ...lines(origins)])],
            authenticationOrigins: lines(authenticationOrigins),
            updatedAt: stamp(),
          });
          if (!parsed.success) {
            setValidationError(
              [...new Set(parsed.error.issues.map((issue) => issue.message))].join(' '),
            );
            return;
          }
          setValidationError('');
          onSave(parsed.data);
        }}
      >
        <div className="applications-form-grid">
          <label className="field">
            <span>Nom de l’application</span>
            <input
              required
              value={value.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="field">
            <span id="application-origin-label">Adresse de l’application</span>
            <input
              required
              type="url"
              aria-labelledby="application-origin-label"
              aria-describedby="application-origin-help"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://mon-application.fr/espace"
            />
            <small id="application-origin-help">
              Tous les domaines sont acceptés en HTTP ou HTTPS, avec un port si nécessaire. Le
              chemin saisi sera ouvert au démarrage.
            </small>
          </label>
          <label className="field">
            <span>Rôle de connexion</span>
            <input
              value={value.role ?? ''}
              onChange={(event) => patch({ role: event.target.value })}
              placeholder="Gestionnaire"
            />
          </label>
          <label className="field">
            <span>Exécutable Chromium (facultatif)</span>
            <input
              value={value.browserExecutable ?? ''}
              onChange={(event) => patch({ browserExecutable: event.target.value || undefined })}
              placeholder="Chemin du navigateur installé"
            />
          </label>
        </div>
        <fieldset>
          <legend>Dépôts autorisés</legend>
          {state.projectCatalog?.projects
            .filter((project) => !project.hidden)
            .map((project) => (
              <label className="applications-check" key={project.id}>
                <input
                  type="checkbox"
                  checked={value.projectIds.includes(project.id)}
                  onChange={(event) =>
                    patch({
                      projectIds: event.target.checked
                        ? [...value.projectIds, project.id]
                        : value.projectIds.filter((id) => id !== project.id),
                    })
                  }
                />{' '}
                {project.name}
                <small>{project.path}</small>
              </label>
            ))}
          {!state.projectCatalog?.projects.length && (
            <p>Ajoutez d’abord un espace de travail dans les réglages.</p>
          )}
        </fieldset>
        <label className="field">
          <span>Consignes de connexion et prérequis</span>
          <textarea
            rows={3}
            value={value.authInstructions ?? ''}
            onChange={(event) => patch({ authInstructions: event.target.value })}
            placeholder="Se connecter manuellement avec un compte de test. Ne pas saisir de mot de passe ici."
          />
        </label>
        <label className="field">
          <span>Origines supplémentaires autorisées (une par ligne)</span>
          <textarea rows={2} value={origins} onChange={(event) => setOrigins(event.target.value)} />
          <small>
            Ajoute les autres sites utilisés par l’application. Tu peux coller une URL complète ;
            seul son domaine et son port seront retenus.
          </small>
        </label>
        <label className="field">
          <span>Origines de connexion manuelle (une par ligne)</span>
          <textarea
            rows={2}
            value={authenticationOrigins}
            onChange={(event) => setAuthenticationOrigins(event.target.value)}
          />
          <small>
            Exceptions pour le fournisseur d’identité, uniquement pendant la connexion manuelle sans
            capture.
          </small>
        </label>
        <label className="field">
          <span>Politique d’interaction</span>
          <select
            value={value.interactionPolicy}
            onChange={(event) =>
              patch({
                interactionPolicy: event.target.value as ApplicationProfile['interactionPolicy'],
              })
            }
          >
            <option value="inspect">Inspection seule</option>
            <option value="confirm">Confirmer chaque interaction demandée par l’agent</option>
            <option value="authorized">Interactions autorisées dans ce profil</option>
          </select>
        </label>
        <label className="field">
          <span>Navigateur propriétaire</span>
          <select
            value={value.ownerNavigatorId ?? ''}
            onChange={(event) => patch({ ownerNavigatorId: event.target.value || undefined })}
          >
            <option value="">Choisir un Navigateur pour les parcours</option>
            {value.ownerNavigatorId &&
              !state.agents.some(
                (agent) =>
                  agent.id === value.ownerNavigatorId && agent.tools.includes('navigation'),
              ) && (
                <option value={value.ownerNavigatorId}>
                  Agent indisponible ou sans capacité navigation
                </option>
              )}
            {state.agents
              .filter((agent) => agent.tools.includes('navigation'))
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
          </select>
        </label>
        <p className="field-help">
          Le Navigateur est requis pour décrire et entretenir les parcours. Vous pouvez enregistrer
          le profil avant de le choisir ; la préparation manuelle du navigateur reste disponible.
        </p>
        <details>
          <summary>Environnement de développement et version servie</summary>
          <p>
            Les commandes utilisent des tâches VS Code existantes du dépôt sélectionné. La
            comparaison porte sur un fichier construit et sa ressource réellement servie.
          </p>
          <label className="field">
            <span>Dépôt de l’environnement</span>
            <select
              value={value.environment?.projectId ?? ''}
              onChange={(e) =>
                patch({
                  environment: e.target.value
                    ? { ...value.environment, projectId: e.target.value }
                    : undefined,
                })
              }
            >
              <option value="">Non configuré</option>
              {state.projectCatalog?.projects
                .filter((p) => value.projectIds.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          {value.environment && (
            <>
              {(['startTask', 'buildTask', 'artifactPath', 'resourceUrl'] as const).map((key) => (
                <label className="field" key={key}>
                  <span>
                    {
                      {
                        startTask: 'Nom de la tâche de démarrage',
                        buildTask: 'Nom de la tâche de reconstruction',
                        artifactPath: 'Fichier construit relatif au dépôt',
                        resourceUrl: 'Adresse de la ressource servie à comparer',
                      }[key]
                    }
                  </span>
                  <input
                    value={value.environment?.[key] ?? ''}
                    onChange={(e) =>
                      patch({
                        environment: { ...value.environment!, [key]: e.target.value || undefined },
                      })
                    }
                  />
                </label>
              ))}
            </>
          )}
        </details>
        <p className="field-help">
          L’application doit être accessible depuis ce poste. Pour une application locale, démarrez
          son serveur. KerAI n’installe aucune dépendance et ne modifie pas votre application.
        </p>
        <div className="applications-actions">
          <button type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="primary" type="submit" disabled={!value.projectIds.length}>
            Enregistrer le profil
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}

function BrowserControls({
  busy,
  data,
  applicationId,
  command,
}: {
  data: NavigationSnapshot;
  applicationId: string;
  command: Command;
  busy: boolean;
}) {
  const browser = data.browser?.applicationId === applicationId ? data.browser : undefined;
  if (!browser) return null;
  const stateLabels = {
    idle: 'Prêt',
    agent: 'Commande hôte en cours',
    recording: 'À toi · démonstration',
    human: 'À toi · contrôle manuel',
    stopping: 'Arrêt en cours',
    interrupted: 'Interrompu · reprise explicite nécessaire',
    closed: 'Navigateur fermé',
  };
  return (
    <section className="applications-browser" aria-label="Contrôle du navigateur">
      <div>
        <strong>{stateLabels[browser.state]}</strong>
        <p>
          Acteur :{' '}
          {browser.actor ||
            (browser.state === 'human' || browser.state === 'recording' ? 'Humain' : 'Hôte')}{' '}
          · {browser.recordedSteps.length} action(s) enregistrée(s)
          {browser.recordingPaused && (browser.recordingActive || browser.state === 'human')
            ? ' · Capture suspendue'
            : ''}
        </p>
        <small>{browser.url}</small>
      </div>
      <div className="applications-actions">
        <button
          onClick={() => command({ action: 'authenticate' })}
          disabled={browser.state === 'closed'}
        >
          Connexion manuelle · suspendre la capture
        </button>
        <button
          onClick={() => command({ action: 'resumeControl' })}
          disabled={browser.state !== 'human'}
        >
          Connexion terminée · reprendre
        </button>
        <button
          onClick={() => command({ action: 'takeControl' })}
          disabled={browser.state === 'stopping' || browser.state === 'closed'}
        >
          Reprendre la main
        </button>
        <button onClick={() => command({ action: 'stop' })} disabled={browser.state === 'closed'}>
          <Square size={14} /> Arrêter
        </button>
        <button
          onClick={() => command({ action: 'capture' })}
          disabled={
            busy ||
            (browser.state !== 'idle' &&
              !(browser.state === 'recording' && !browser.recordingPaused))
          }
        >
          <Camera size={14} /> Capturer cet état
        </button>
        <button
          onClick={() => command({ action: 'closeBrowser' })}
          disabled={browser.state === 'closed'}
        >
          Fermer le navigateur
        </button>
      </div>
      {browser.warnings.length > 0 && (
        <ul className="applications-warnings">
          {browser.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LearnDialog({
  busy,
  error,
  mode,
  application,
  data,
  command,
  onClose,
}: {
  busy: boolean;
  error?: string;
  mode: 'description' | 'import' | 'demonstration';
  application: ApplicationProfile;
  data: NavigationSnapshot;
  command: Command;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [arrival, setArrival] = useState<NavigationCondition[]>([]);
  const [parseError, setParseError] = useState('');
  const browser = data.browser?.applicationId === application.id ? data.browser : undefined;
  const recording = browser?.recordingActive ?? browser?.state === 'recording';
  return (
    <StudioDialog
      title={
        mode === 'description'
          ? 'Décrire un parcours'
          : mode === 'import'
            ? 'Importer un parcours JSON'
            : 'Montrer un parcours'
      }
      subtitle={`${application.name} · les commandes restent dans KerAI`}
      onClose={onClose}
      className="applications-dialog"
    >
      {error && (
        <p className="applications-error" role="alert">
          {error}
        </p>
      )}
      {mode === 'description' ? (
        <>
          <p>
            Décrivez l’écran souhaité et ce qui permet de le reconnaître. Le Navigateur cherchera
            d’abord un parcours existant. Son lancement passe par la préparation habituelle.
          </p>
          <label className="field">
            <span>Objectif et contexte</span>
            <textarea
              autoFocus
              rows={7}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Depuis la liste des clients, ouvrir la fiche puis l’onglet Facturation…"
            />
          </label>
          <p className="field-help">
            Sans modèle connecté, utilisez l’import ou la démonstration, puis corrigez le brouillon
            manuellement.
          </p>
          <button
            className="primary"
            disabled={!text.trim()}
            onClick={() => {
              command(
                { action: 'describe', applicationId: application.id, description: text },
                onClose,
              );
            }}
          >
            Préparer la mission du Navigateur
          </button>
        </>
      ) : mode === 'import' ? (
        <>
          <p>
            Formats : KerAI et sous-ensemble Chrome Recorder. L’import crée un brouillon ; il ne
            lance aucune étape. Les actions inconnues restent signalées.
          </p>
          <label className="field">
            <span>Fichier JSON</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                  setParseError('Le fichier dépasse la limite de 2 Mio.');
                  return;
                }
                setText(await file.text());
                setParseError('');
              }}
            />
          </label>
          <label className="field">
            <span>Contenu JSON</span>
            <textarea
              rows={12}
              spellCheck={false}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setParseError('');
              }}
            />
          </label>
          {parseError && <p role="alert">{parseError}</p>}
          <p className="field-help">
            JavaScript, expressions et opérations système ne sont pas exécutés. Vérifiez les
            paramètres et les effets métier avant tout rejeu.
          </p>
          <button
            className="primary"
            disabled={!text.trim()}
            onClick={() => {
              try {
                JSON.parse(text);
                command({ action: 'import', applicationId: application.id, json: text }, onClose);
              } catch {
                setParseError('JSON invalide. Corrigez sa structure avant de l’envoyer.');
              }
            }}
          >
            Importer comme brouillon
          </button>
        </>
      ) : (
        <>
          <p>
            Montrez le parcours dans le navigateur dédié, sans surcouche dans votre application.
            Pour vous connecter, suspendez d’abord l’enregistrement.
          </p>
          <div className="applications-record-status" role="status">
            {recording
              ? `${browser?.recordingPaused ? 'Enregistrement suspendu — connexion manuelle possible' : 'À toi — enregistrement actif'} · ${browser?.recordedSteps.length ?? 0} action(s)`
              : 'Le contrôle vous sera donné après l’arrêt confirmé des commandes.'}
          </div>
          <div className="applications-actions">
            {!recording && browser?.state === 'human' && (
              <button disabled={busy} onClick={() => command({ action: 'resumeControl' })}>
                Connexion terminée · reprendre
              </button>
            )}
            {!recording &&
              (!browser || browser.state === 'closed' || browser.state === 'interrupted') && (
                <button
                  disabled={busy}
                  onClick={() => command({ action: 'prepare', applicationId: application.id })}
                >
                  Préparer le navigateur de démonstration
                </button>
              )}
            <button
              className="primary"
              disabled={busy || !!recording || browser?.state !== 'idle'}
              onClick={() => command({ action: 'recordStart', applicationId: application.id })}
            >
              Démarrer la démonstration
            </button>
            <button
              disabled={!recording}
              onClick={() =>
                command({ action: browser?.recordingPaused ? 'recordResume' : 'authenticate' })
              }
            >
              {browser?.recordingPaused ? 'Reprendre l’enregistrement' : 'Pause pour connexion'}
            </button>
            <button
              disabled={!recording || browser?.recordingPaused}
              onClick={() => command({ action: 'capture' })}
            >
              Capturer cet état
            </button>
          </div>
          {browser?.recordedSteps.length ? (
            <ol className="applications-step-list">
              {browser.recordedSteps.map((step, index) => (
                <li key={step.id}>
                  <strong>
                    {index + 1}. {actionLabels[step.action]}
                  </strong>{' '}
                  {step.target?.name || step.target?.value || step.url || step.note}
                </li>
              ))}
            </ol>
          ) : null}
          <label className="field">
            <span>Nom de l’état final</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Fiche client · onglet Facturation"
            />
          </label>
          <label className="field">
            <span>Intention</span>
            <textarea rows={2} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <ConditionsEditor value={arrival} onChange={setArrival} />
          <div className="applications-actions">
            <button
              disabled={!recording}
              onClick={() => {
                command({ action: 'recordCancel' }, onClose);
              }}
            >
              Annuler la démonstration
            </button>
            <button
              className="primary"
              disabled={!recording || !title.trim()}
              onClick={() => {
                command({ action: 'recordFinish', title, intent: text || title, arrival }, onClose);
              }}
            >
              Terminer et créer le brouillon
            </button>
          </div>
          <p className="field-help">
            Les étapes et valeurs pourront être corrigées dans le brouillon. Terminer ne constitue
            pas un rejeu réussi.
          </p>
        </>
      )}
    </StudioDialog>
  );
}

function JourneyDetail({
  journey,
  data,
  command,
  edit,
  variant,
  onBug,
  favorite,
  onFavorite,
}: {
  onBug: (journey: NavigationJourney, parameters: Record<string, string>) => void;
  favorite: boolean;
  onFavorite: () => void;
  journey: NavigationJourney;
  data: NavigationSnapshot;
  command: Command;
  edit: () => void;
  variant: () => void;
}) {
  const [mode, setMode] = useState<'reach' | 'reproduce' | 'verify'>('verify');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [prerequisites, setPrerequisites] = useState(false);
  const [interactions, setInteractions] = useState(false);
  const [observation, setObservation] = useState('');
  useEffect(() => {
    setParameters(
      Object.fromEntries(
        (plan?.parameters ?? journey.parameters)
          .filter((parameter) => !parameter.sensitive && !outputs.has(parameter.name))
          .map((parameter) => [parameter.name, parameter.defaultValue ?? '']),
      ),
    );
    setPrerequisites(false);
    setInteractions(false);
    setMode(journey.status === 'draft' ? 'verify' : 'reproduce');
  }, [journey.id, journey.revision]);
  const runs = data.runs
    .filter((run) => run.journeyId === journey.id)
    .slice()
    .reverse();
  const verified = runs.find(
    (run) => run.revision === journey.revision && run.status === 'succeeded' && run.arrivalVerified,
  );
  const published = publishedJourneys(data).find((j) => j.id === journey.id);
  let plan: ReturnType<typeof navigationPlan> | undefined;
  let planError = '';
  try {
    plan = navigationPlan(journey, data);
  } catch (error) {
    planError = (error as Error).message;
  }
  const assisted = (plan?.steps ?? journey.steps).some((step) => step.action === 'manual');
  const outputs = navigationOutputs(plan?.steps ?? journey.steps);
  const missing = [
    !journey.arrival.length && 'Définir les indices d’arrivée',
    assisted && 'Remplacer les étapes manuelles',
    (plan?.parameters ?? journey.parameters).some((p) => p.sensitive) &&
      'Revoir les paramètres de formulaire',
    planError,
  ].filter(Boolean);
  return (
    <section aria-label="Fiche de parcours">
      <div className="applications-section-heading">
        <div>
          <h2>{journey.title}</h2>
          <p>{journey.intent}</p>
        </div>
        <span>r{journey.revision}</span>
      </div>
      <div className="applications-status-grid">
        <div>
          <small>Définition</small>
          <strong>{definitionLabels[journey.status]}</strong>
        </div>
        <div>
          <small>Preuve</small>
          <strong>{proof(journey, data.runs)}</strong>
        </div>
        <div>
          <small>Fraîcheur</small>
          <strong>{freshness(journey, data.runs)}</strong>
        </div>
      </div>
      <p className="field-help">
        Source : {journey.provenance.mode} ·{' '}
        {journey.provenance.author?.kind === 'navigator' ? 'Navigateur' : 'Humain'}
        {journey.variantOf
          ? ` · Variante de ${data.journeys.find((item) => item.id === journey.variantOf)?.title ?? journey.variantOf}`
          : ''}
      </p>
      {journey.hash && <p className="applications-hash">Révision immuable : {journey.hash}</p>}
      {journey.provenance.notes && <p>{journey.provenance.notes}</p>}
      {journey.status === 'draft' && (
        <div role="status">
          <strong>Finaliser ce parcours</strong>
          <p>
            {missing.length
              ? missing.join(' · ')
              : 'Prêt pour un rejeu de vérification, puis une publication.'}
          </p>
          {published && (
            <p>La version r{published.revision} reste disponible pendant cette correction.</p>
          )}
        </div>
      )}
      <div className="applications-actions">
        <button onClick={onFavorite}>
          {favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        </button>
        <button
          className="primary"
          disabled={!published}
          onClick={() => published && onBug(published, parameters)}
        >
          Utiliser pour corriger un bug
        </button>
        <button onClick={edit}>Corriger le brouillon</button>
        <button onClick={variant}>Créer une variante</button>
        <button
          disabled={!verified || assisted || journey.status !== 'draft'}
          title={!verified ? 'Un rejeu de cette révision doit vérifier l’arrivée.' : undefined}
          onClick={() =>
            command({
              action: 'commit',
              journeyId: journey.id,
              expectedRevision: journey.revision,
              runId: verified?.id,
            })
          }
        >
          Rendre disponible
        </button>
        <button
          disabled={journey.status === 'archived'}
          onClick={() =>
            command({
              action: 'archive',
              journeyId: journey.id,
              expectedRevision: journey.revision,
            })
          }
        >
          Archiver
        </button>
        <button onClick={() => command({ action: 'export', journeyId: journey.id })}>
          Aperçu d’export
        </button>
      </div>
      <h3>Prérequis</h3>
      {(plan?.prerequisites ?? journey.prerequisites).length ? (
        <ul>
          {(plan?.prerequisites ?? journey.prerequisites).map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          Aucun prérequis déclaré. Vérifiez le rôle et les données avant le rejeu.
        </p>
      )}
      <h3>Étapes</h3>
      <ol className="applications-step-list">
        {(plan?.steps ?? journey.steps).map((step, index) => (
          <li key={step.id}>
            <span>
              <strong>
                {index + 1}. {actionLabels[step.action]}
              </strong>
              <small>
                {step.target?.name ||
                  step.target?.value ||
                  step.url ||
                  step.note ||
                  'Cible à préciser'}
                {step.value &&
                  ('parameter' in step.value
                    ? ` · paramètre ${step.value.parameter}`
                    : ' · valeur définie')}
              </small>
            </span>
            <span>
              {step.action === 'manual'
                ? 'Assisté · non rejouable'
                : step.effect === 'write'
                  ? 'Effet métier'
                  : step.effect === 'unknown'
                    ? 'Effet à vérifier'
                    : ''}
            </span>
          </li>
        ))}
      </ol>
      <h3>Reconnaître l’arrivée</h3>
      {journey.arrival.length ? (
        <ul>
          {journey.arrival.map((condition, index) => (
            <li key={index}>
              {condition.kind} ·{' '}
              {condition.target?.name || condition.target?.value || condition.value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="applications-uncertain">
          Aucune condition d’arrivée : ajoutez plusieurs indices observables avant de vérifier le
          parcours.
        </p>
      )}
      <fieldset className="applications-replay">
        <legend>Rejouer cette révision</legend>
        <label className="field">
          <span>Intention de rejeu</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="verify">Vérifier explicitement ce brouillon</option>
            <option value="reach" disabled={journey.status !== 'available'}>
              Atteindre cet état
            </option>
            <option value="reproduce" disabled={journey.status !== 'available'}>
              Reproduire ce parcours exact
            </option>
          </select>
        </label>
        {(plan?.parameters ?? journey.parameters)
          .filter((parameter) => !outputs.has(parameter.name))
          .map((parameter) => (
            <label className="field" key={parameter.name}>
              <span>
                {parameter.label || parameter.name}
                {parameter.required ? ' *' : ''}
              </span>
              {parameter.sensitive ? (
                <small>
                  Valeur privée : renseignez-la manuellement dans le navigateur, hors documentation.
                </small>
              ) : (
                <input
                  type={parameter.type === 'number' ? 'number' : 'text'}
                  value={parameters[parameter.name] ?? ''}
                  onChange={(event) =>
                    setParameters({ ...parameters, [parameter.name]: event.target.value })
                  }
                />
              )}
            </label>
          ))}
        <label className="applications-check">
          <input
            type="checkbox"
            checked={prerequisites}
            onChange={(event) => setPrerequisites(event.target.checked)}
          />{' '}
          Le rôle, les données et les prérequis sont prêts
        </label>
        <label className="applications-check">
          <input
            type="checkbox"
            checked={interactions}
            onChange={(event) => setInteractions(event.target.checked)}
          />{' '}
          J’autorise les interactions de ce rejeu et leurs effets métier
        </label>
        <p className="field-help">
          Les données serveur ne sont jamais remises à zéro implicitement. Le rejeu connu n’appelle
          aucun modèle.
        </p>
        <button
          className="primary"
          disabled={
            !prerequisites ||
            !interactions ||
            data.applications.find((app) => app.id === journey.applicationId)?.interactionPolicy ===
              'inspect' ||
            data.browser?.applicationId !== journey.applicationId ||
            data.browser?.state !== 'idle' ||
            Boolean(planError) ||
            assisted ||
            !journey.arrival.length ||
            journey.status === 'archived' ||
            (plan?.parameters ?? journey.parameters).some(
              (parameter) =>
                parameter.required &&
                !parameter.sensitive &&
                !outputs.has(parameter.name) &&
                !parameters[parameter.name]?.trim(),
            )
          }
          onClick={() =>
            command({
              action: 'replay',
              journeyId: journey.id,
              parameters,
              mode,
              confirmInteractions: interactions,
              prerequisitesConfirmed: prerequisites,
            })
          }
        >
          <Play size={15} /> Lancer le rejeu
        </button>
        {!interactions && <p>Autorise les interactions de ce parcours avant le lancement.</p>}
        {data.browser?.state !== 'idle' && (
          <p>Ouvre le navigateur et termine la connexion avant de rejouer.</p>
        )}
        {assisted && (
          <p className="applications-uncertain">Une étape manuelle empêche le rejeu automatique.</p>
        )}
      </fieldset>
      <RevisionHistory journey={journey} data={data} command={command} />
      <details className="applications-history" open={runs.length > 0}>
        <summary>Révisions et derniers rejeux ({runs.length})</summary>
        <p className="field-help">
          Chaque exécution conserve la révision et le contexte consommés. Une correction produit une
          nouvelle révision, sans modifier les preuves précédentes.
        </p>
        {journey.parentHash && (
          <p className="applications-hash">Révision parente : {journey.parentHash}</p>
        )}
        {runs.map((run) => (
          <article className="applications-run" key={run.id}>
            <strong>
              r{run.revision} · {runLabels[run.status]}
            </strong>
            <small>
              {shortDate(run.startedAt)} · {run.id}
            </small>
            <p>
              Arrivée {run.arrivalVerified ? 'vérifiée' : 'non vérifiée'} ·{' '}
              {run.binding.verification === 'verified'
                ? 'Version attestée'
                : 'Version de l’application non vérifiée'}
            </p>
            <p className="field-help">{run.binding.reason}</p>
            {run.error && (
              <>
                <p className="applications-error">{run.error}</p>
                <div className="applications-actions">
                  <button onClick={edit}>Corriger l’étape en échec</button>
                  <button onClick={() => command({ action: 'inspect' })}>
                    Inspecter l’état actuel
                  </button>
                  <button
                    onClick={() =>
                      command({
                        action: 'describe',
                        applicationId: journey.applicationId,
                        title: `Réparer ${journey.title}`,
                        description: `Réparer le parcours ${journey.id} r${journey.revision}. Échec : ${run.error}. Préserver les critères d’arrivée et les données choisies.`,
                      })
                    }
                  >
                    Confier au Navigateur
                  </button>
                </div>
              </>
            )}
            {!!run.skippedSteps?.length && (
              <p>{run.skippedSteps.length} étape(s) déjà satisfaites, non rejouées.</p>
            )}
            {run.resolvedParameters && (
              <details>
                <summary>Données choisies pour ce cas</summary>
                <dl>
                  {Object.entries(run.resolvedParameters).map(([name, value]) => (
                    <div key={name}>
                      <dt>{plan?.parameters.find((p) => p.name === name)?.label ?? name}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            {run.status === 'succeeded' && run.resolvedParameters && (
              <button onClick={() => setParameters({ ...run.resolvedParameters })}>
                Réutiliser ce cas exact
              </button>
            )}
            {run.events
              .filter((event) => event.status !== 'succeeded')
              .map((event, index) => (
                <p key={index}>
                  Étape {event.stepId} : {event.message || event.status}
                </p>
              ))}
            {run.evidencePaths.length > 0 && (
              <p>
                {run.evidencePaths.length} capture(s) conservée(s) par l’hôte pour cette exécution.
              </p>
            )}
          </article>
        ))}
      </details>
      <details className="applications-contributions">
        <summary>Contributions au Navigateur</summary>
        <p>
          Une observation n’altère pas l’attendu ni le parcours figé. Consolidez-la par une
          correction explicite.
        </p>
        {data.contributions
          .filter((item) => item.journeyId === journey.id)
          .map((item) => (
            <article className="applications-run" key={item.id}>
              <strong>
                {item.author} · r{item.revision} ·{' '}
                {item.status === 'pending'
                  ? 'En attente'
                  : item.status === 'accepted'
                    ? 'Acceptée'
                    : 'Écartée'}
              </strong>
              <p>{item.observation}</p>
              {item.proposal && <p>{item.proposal}</p>}
              {item.status === 'pending' && (
                <div className="applications-actions">
                  <button
                    onClick={() =>
                      command({ action: 'resolveContribution', id: item.id, status: 'accepted' })
                    }
                  >
                    Accepter pour consolidation
                  </button>
                  <button
                    onClick={() =>
                      command({ action: 'resolveContribution', id: item.id, status: 'dismissed' })
                    }
                  >
                    Écarter la contribution
                  </button>
                </div>
              )}
            </article>
          ))}
        <label className="field">
          <span>Observation ou détour rencontré</span>
          <textarea
            rows={3}
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
          />
        </label>
        <button
          disabled={!observation.trim()}
          onClick={() => {
            command({
              action: 'contribute',
              contribution: {
                id: newId(),
                journeyId: journey.id,
                revision: journey.revision,
                observation,
                author: 'human',
                status: 'pending',
                createdAt: stamp(),
              },
            });
            setObservation('');
          }}
        >
          Conserver la contribution
        </button>
      </details>
    </section>
  );
}

function LocatorEditor({
  value,
  onChange,
}: {
  value?: NavigationLocator;
  onChange: (value: NavigationLocator) => void;
}) {
  const locator = value ?? { strategy: 'role', value: 'button', name: '' };
  return (
    <div className="applications-locator">
      <label className="field">
        <span>Repérage</span>
        <select
          value={locator.strategy}
          onChange={(event) =>
            onChange({ ...locator, strategy: event.target.value as NavigationLocator['strategy'] })
          }
        >
          <option value="role">Rôle accessible</option>
          <option value="label">Libellé</option>
          <option value="text">Texte</option>
          <option value="css">Sélecteur CSS</option>
          <option value="testId">Identifiant existant</option>
        </select>
      </label>
      <label className="field">
        <span>Cible</span>
        <input
          value={locator.value}
          onChange={(event) => onChange({ ...locator, value: event.target.value })}
        />
      </label>
      {locator.strategy === 'role' && (
        <label className="field">
          <span>Nom accessible</span>
          <input
            value={locator.name ?? ''}
            onChange={(event) => onChange({ ...locator, name: event.target.value })}
          />
        </label>
      )}
    </div>
  );
}
function ConditionsEditor({
  value,
  onChange,
  title = 'Conditions d’arrivée',
  addLabel = 'Ajouter une condition d’arrivée',
}: {
  value: NavigationCondition[];
  onChange: (value: NavigationCondition[]) => void;
  title?: string;
  addLabel?: string;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <p className="field-help">
        Combinez l’adresse avec des indices d’écran : onglet actif, texte, formulaire ou dialogue
        visible.
      </p>
      {value.map((condition, index) => (
        <div className="applications-condition" key={index}>
          <label className="field">
            <span>Condition {index + 1}</span>
            <select
              value={condition.kind}
              onChange={(event) =>
                onChange(
                  value.map((item, at) =>
                    at === index
                      ? { ...item, kind: event.target.value as NavigationCondition['kind'] }
                      : item,
                  ),
                )
              }
            >
              <option value="visible">Visible</option>
              <option value="hidden">Absent / masqué</option>
              <option value="text">Texte</option>
              <option value="url">Adresse</option>
            </select>
          </label>
          {condition.kind !== 'url' && (
            <LocatorEditor
              value={condition.target}
              onChange={(target) =>
                onChange(value.map((item, at) => (at === index ? { ...item, target } : item)))
              }
            />
          )}
          {(condition.kind === 'url' || condition.kind === 'text') && (
            <label className="field">
              <span>Valeur attendue</span>
              <input
                value={condition.value ?? ''}
                onChange={(event) =>
                  onChange(
                    value.map((item, at) =>
                      at === index ? { ...item, value: event.target.value } : item,
                    ),
                  )
                }
              />
            </label>
          )}
          <button type="button" onClick={() => onChange(value.filter((_, at) => at !== index))}>
            Retirer la condition {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...value,
            { kind: 'visible', target: { strategy: 'role', value: 'heading', name: '' } },
          ])
        }
      >
        {addLabel}
      </button>
    </fieldset>
  );
}
function JourneyEditor({
  error,
  journey,
  data,
  onClose,
  onSave,
}: {
  journey: NavigationJourney;
  data: NavigationSnapshot;
  error?: string;
  onClose: () => void;
  onSave: (journey: NavigationJourney) => void;
}) {
  const [value, setValue] = useState(journey);
  const patch = (patch: Partial<NavigationJourney>) => setValue({ ...value, ...patch });
  const stepPatch = (index: number, patch: Partial<NavigationStep>) =>
    patchJourneySteps(value.steps.map((step, at) => (at === index ? { ...step, ...patch } : step)));
  const patchJourneySteps = (steps: NavigationStep[]) => patch({ steps });
  const moveStep = (index: number, delta: number) => {
    const steps = [...value.steps];
    [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]];
    patch({ steps });
  };
  return (
    <StudioDialog
      title="Corriger le parcours"
      subtitle={`Révision ${journey.revision} · l’enregistrement créera une nouvelle révision à vérifier`}
      onClose={onClose}
      className="applications-dialog"
    >
      {error && (
        <p className="applications-error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...value, status: 'draft', updatedAt: stamp() });
        }}
      >
        <label className="field">
          <span>Titre du parcours</span>
          <input
            required
            value={value.title}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Intention du parcours</span>
          <textarea
            required
            value={value.intent}
            onChange={(event) => patch({ intent: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Tags (séparés par une virgule)</span>
          <input
            value={value.tags.join(', ')}
            onChange={(event) =>
              patch({ tags: event.target.value.split(',').map((tag) => tag.trim()) })
            }
          />
        </label>
        <label className="field">
          <span>Prérequis (un par ligne)</span>
          <textarea
            value={value.prerequisites.join('\n')}
            onChange={(event) => patch({ prerequisites: event.target.value.split('\n') })}
          />
        </label>
        <details>
          <summary>Blocs réutilisables avant ces étapes</summary>
          <p>
            Les révisions choisies restent figées. Les paramètres de même nom sont partagés et
            doivent avoir la même définition.
          </p>
          {publishedJourneys(data)
            .filter((j) => j.applicationId === journey.applicationId && j.id !== journey.id)
            .map((block) => (
              <label className="applications-check" key={block.id}>
                <input
                  type="checkbox"
                  checked={value.blocks?.some((b) => b.journeyId === block.id) ?? false}
                  onChange={(e) =>
                    patch({
                      blocks: e.target.checked
                        ? [
                            ...(value.blocks ?? []),
                            { journeyId: block.id, revision: block.revision },
                          ]
                        : value.blocks?.filter((b) => b.journeyId !== block.id),
                    })
                  }
                />
                {block.title} · r
                {value.blocks?.find((b) => b.journeyId === block.id)?.revision ?? block.revision}
              </label>
            ))}
        </details>
        <h3>Étapes éditables</h3>
        <p>
          Utilise {'{{paramètre}}'} dans une cible, une adresse ou une condition. Les valeurs
          insérées sont échappées selon leur usage.
        </p>
        {value.steps.map((step, index) => (
          <fieldset key={step.id}>
            <legend>Étape {index + 1}</legend>
            <details open={value.steps.length <= 5}>
              <summary>
                {step.note ||
                  `${actionLabels[step.action]} ${step.target?.name || step.target?.value || step.url || ''}`}
              </summary>
              <label className="field">
                <span>Action</span>
                <select
                  value={step.action}
                  onChange={(event) => {
                    const action = event.target.value as NavigationStep['action'];
                    stepPatch(index, {
                      action,
                      ...([
                        'click',
                        'doubleClick',
                        'resolve',
                        'fill',
                        'select',
                        'check',
                        'press',
                      ].includes(action) && !step.target
                        ? { target: { strategy: 'role', value: 'button', name: '' } }
                        : {}),
                      ...(['fill', 'select'].includes(action) && !step.value
                        ? { value: { literal: '' } }
                        : {}),
                      resolver:
                        action === 'resolve'
                          ? {
                              output: 'entityId',
                              attribute: 'data-id',
                              pick: 'unique',
                              filters: [],
                            }
                          : undefined,
                      ...(action === 'resolve' ? { target: { strategy: 'css', value: '' } } : {}),
                      ...(action === 'check' ? { checked: step.checked ?? true } : {}),
                      ...(action === 'scroll' ? { x: step.x ?? 0, y: step.y ?? 0 } : {}),
                    });
                  }}
                >
                  {Object.entries(actionLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {['click', 'doubleClick', 'resolve', 'fill', 'select', 'check', 'press'].includes(
                step.action,
              ) && (
                <LocatorEditor
                  value={step.target}
                  onChange={(target) => stepPatch(index, { target })}
                />
              )}
              {step.action === 'resolve' && step.resolver && (
                <fieldset>
                  <legend>Donnée métier à choisir</legend>
                  <label className="field">
                    <span>Nom réutilisable</span>
                    <input
                      value={step.resolver.output}
                      onChange={(e) =>
                        stepPatch(index, {
                          resolver: { ...step.resolver!, output: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Attribut portant l’identifiant (data-id, href…)</span>
                    <input
                      value={step.resolver.attribute}
                      onChange={(e) =>
                        stepPatch(index, {
                          resolver: { ...step.resolver!, attribute: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Choix en cas de plusieurs résultats</span>
                    <select
                      value={step.resolver.pick}
                      onChange={(e) =>
                        stepPatch(index, {
                          resolver: {
                            ...step.resolver!,
                            pick: e.target.value as 'first' | 'unique',
                          },
                        })
                      }
                    >
                      <option value="unique">Exiger un résultat unique</option>
                      <option value="first">Choisir explicitement le premier</option>
                    </select>
                  </label>
                  {step.resolver.filters.map((filter, at) => (
                    <div key={at}>
                      <label className="field">
                        <span>Élément relatif au candidat {at + 1}</span>
                        <input
                          value={filter.selector ?? ''}
                          onChange={(e) =>
                            stepPatch(index, {
                              resolver: {
                                ...step.resolver!,
                                filters: step.resolver!.filters.map((f, n) =>
                                  n === at ? { ...f, selector: e.target.value || undefined } : f,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Texte à retrouver {at + 1} (vide : présence)</span>
                        <input
                          value={filter.text ?? ''}
                          onChange={(e) =>
                            stepPatch(index, {
                              resolver: {
                                ...step.resolver!,
                                filters: step.resolver!.filters.map((f, n) =>
                                  n === at ? { ...f, text: e.target.value || undefined } : f,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          stepPatch(index, {
                            resolver: {
                              ...step.resolver!,
                              filters: step.resolver!.filters.filter((_, n) => n !== at),
                            },
                          })
                        }
                      >
                        Retirer le filtre {at + 1}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      stepPatch(index, {
                        resolver: { ...step.resolver!, filters: [...step.resolver!.filters, {}] },
                      })
                    }
                  >
                    Ajouter un filtre métier
                  </button>
                  <p>
                    L’identifiant choisi est conservé dans le reçu. Réutilise-le dans la suite avec{' '}
                    {'{{nom}}'}, notamment pour chercher une voiture dans le garage retenu.
                  </p>
                </fieldset>
              )}
              {step.action === 'wait' && (
                <ConditionsEditor
                  title="Conditions d’attente"
                  addLabel="Ajouter une condition d’attente"
                  value={step.postconditions ?? []}
                  onChange={(postconditions) => stepPatch(index, { postconditions })}
                />
              )}
              {step.action === 'navigate' && (
                <label className="field">
                  <span>Adresse</span>
                  <input
                    type="url"
                    value={step.url ?? ''}
                    onChange={(event) => stepPatch(index, { url: event.target.value })}
                  />
                </label>
              )}
              {['fill', 'select'].includes(step.action) && (
                <div className="applications-form-grid">
                  <label className="field">
                    <span>Type de valeur</span>
                    <select
                      value={step.value && 'parameter' in step.value ? 'parameter' : 'literal'}
                      onChange={(event) =>
                        stepPatch(index, {
                          value:
                            event.target.value === 'parameter'
                              ? { parameter: '' }
                              : { literal: '' },
                        })
                      }
                    >
                      <option value="literal">Valeur fixe non sensible</option>
                      <option value="parameter">Paramètre</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Valeur ou nom du paramètre</span>
                    <input
                      value={
                        step.value
                          ? 'parameter' in step.value
                            ? step.value.parameter
                            : step.value.literal
                          : ''
                      }
                      onChange={(event) =>
                        stepPatch(index, {
                          value:
                            step.value && 'parameter' in step.value
                              ? { parameter: event.target.value }
                              : { literal: event.target.value },
                        })
                      }
                    />
                  </label>
                </div>
              )}
              {step.action === 'press' && (
                <label className="field">
                  <span>Touche</span>
                  <input
                    value={step.key ?? ''}
                    onChange={(event) => stepPatch(index, { key: event.target.value })}
                  />
                </label>
              )}
              {step.action === 'check' && (
                <label className="applications-check">
                  <input
                    type="checkbox"
                    checked={step.checked ?? true}
                    onChange={(event) => stepPatch(index, { checked: event.target.checked })}
                  />{' '}
                  Cocher (décocher si désactivé)
                </label>
              )}
              {(step.action === 'viewport' || step.action === 'scroll') && (
                <div className="applications-form-grid">
                  {(step.action === 'viewport'
                    ? (['width', 'height'] as const)
                    : (['x', 'y'] as const)
                  ).map((key) => (
                    <label className="field" key={key}>
                      <span>{key}</span>
                      <input
                        type="number"
                        value={step[key] ?? 0}
                        onChange={(event) =>
                          stepPatch(index, { [key]: Number(event.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              <label className="field">
                <span>Effet métier</span>
                <select
                  value={step.effect ?? 'unknown'}
                  onChange={(event) =>
                    stepPatch(index, { effect: event.target.value as NavigationStep['effect'] })
                  }
                >
                  <option value="unknown">À vérifier</option>
                  <option value="read">Lecture</option>
                  <option value="write">Écriture métier</option>
                </select>
              </label>
              <label className="field">
                <span>Note ou limite détectée</span>
                <input
                  value={step.note ?? ''}
                  onChange={(event) => stepPatch(index, { note: event.target.value })}
                />
              </label>
              <div className="applications-actions">
                <button type="button" disabled={!index} onClick={() => moveStep(index, -1)}>
                  Monter l’étape {index + 1}
                </button>
                <button
                  type="button"
                  disabled={index === value.steps.length - 1}
                  onClick={() => moveStep(index, 1)}
                >
                  Descendre l’étape {index + 1}
                </button>
                <button
                  type="button"
                  onClick={() => patchJourneySteps(value.steps.filter((_, at) => at !== index))}
                >
                  Retirer l’étape {index + 1}
                </button>
              </div>
            </details>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            patchJourneySteps([
              ...value.steps,
              {
                id: newId(),
                action: 'click',
                effect: 'unknown',
                target: { strategy: 'role', value: 'button', name: '' },
              },
            ])
          }
        >
          Ajouter une étape
        </button>
        <fieldset>
          <legend>Paramètres</legend>
          {value.parameters.map((parameter, index) => (
            <div className="applications-parameter" key={index}>
              <div className="applications-form-grid">
                <label className="field">
                  <span>Nom du paramètre</span>
                  <input
                    value={parameter.name}
                    onChange={(event) =>
                      patch({
                        parameters: value.parameters.map((item, at) =>
                          at === index ? { ...item, name: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Libellé du paramètre</span>
                  <input
                    value={parameter.label}
                    onChange={(event) =>
                      patch({
                        parameters: value.parameters.map((item, at) =>
                          at === index ? { ...item, label: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Type</span>
                  <select
                    value={parameter.type}
                    onChange={(event) =>
                      patch({
                        parameters: value.parameters.map((item, at) =>
                          at === index
                            ? { ...item, type: event.target.value as NavigationParameter['type'] }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="string">Texte</option>
                    <option value="number">Nombre</option>
                    <option value="boolean">Booléen</option>
                  </select>
                </label>
              </div>
              <label className="applications-check">
                <input
                  type="checkbox"
                  checked={parameter.required}
                  onChange={(event) =>
                    patch({
                      parameters: value.parameters.map((item, at) =>
                        at === index ? { ...item, required: event.target.checked } : item,
                      ),
                    })
                  }
                />{' '}
                Obligatoire
              </label>
              <label className="applications-check">
                <input
                  type="checkbox"
                  checked={parameter.sensitive ?? false}
                  onChange={(event) =>
                    patch({
                      parameters: value.parameters.map((item, at) =>
                        at === index ? { ...item, sensitive: event.target.checked } : item,
                      ),
                    })
                  }
                />{' '}
                Valeur sensible · exclure du rejeu automatique
              </label>
              <p className="field-help">
                Décochez uniquement pour une donnée de test non sensible, après revue. Les
                identifiants de connexion restent saisis manuellement dans le navigateur.
              </p>
              <button
                type="button"
                onClick={() =>
                  patch({ parameters: value.parameters.filter((_, at) => at !== index) })
                }
              >
                Retirer le paramètre {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              patch({
                parameters: [
                  ...value.parameters,
                  { name: '', label: '', type: 'string', required: true },
                ],
              })
            }
          >
            Ajouter un paramètre
          </button>
        </fieldset>
        <ConditionsEditor value={value.arrival} onChange={(arrival) => patch({ arrival })} />
        <div className="applications-actions">
          <button type="button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="primary">
            Enregistrer une nouvelle révision
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}

function InspectionPanel({
  data,
  application,
  command,
  journeyId,
}: {
  journeyId?: string;
  data: NavigationSnapshot;
  application: ApplicationProfile;
  command: Command;
}) {
  const [target, setTarget] = useState<NavigationLocator>({
    strategy: 'role',
    value: 'heading',
    name: '',
  });
  const [source, setSource] = useState('');
  const [projectId, setProjectId] = useState(application.projectIds[0] ?? '');
  return (
    <details className="applications-inspection">
      <summary>Observations, inspection et indices de code</summary>
      <LocatorEditor value={target} onChange={setTarget} />
      <button onClick={() => command({ action: 'inspect', target })}>Inspecter cette cible</button>
      {data.inspection && (
        <>
          <h3>{data.inspection.title}</h3>
          <p className="field-help">
            Observation du {shortDate(data.inspection.observedAt)}
            {data.inspection.truncated ? ' · extrait tronqué' : ''}
          </p>
          <pre>{data.inspection.text}</pre>
          {data.inspection.elements.map((element, index) => (
            <article className="applications-run" key={index}>
              <strong>
                {element.role || element.tag} · {element.name}
              </strong>
              <code>{element.selector}</code>
              {element.styles && <pre>{JSON.stringify(element.styles, null, 2)}</pre>}
            </article>
          ))}
          {data.inspection.resources.length > 0 && (
            <details>
              <summary>Ressources observées</summary>
              <ul>
                {data.inspection.resources.map((resource, index) => (
                  <li key={index}>{resource}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <h3>Rechercher dans les sources</h3>
      <SourceSearch data={data} application={application} command={command} />
      {journeyId && (
        <div>
          <h3>Mémoire écran-code de ce parcours</h3>
          {(data.codeAnchors ?? [])
            .filter((a) => a.applicationId === application.id)
            .map((anchor) => (
              <p key={anchor.id}>
                {anchor.relativePath} ·{' '}
                {anchor.state === 'stale'
                  ? 'Source modifiée, à revoir'
                  : anchor.journeyIds?.includes(journeyId)
                    ? 'Association confirmée'
                    : 'Candidat'}{' '}
                <button
                  disabled={anchor.state === 'stale' || anchor.journeyIds?.includes(journeyId)}
                  onClick={() => command({ action: 'linkSource', anchorId: anchor.id, journeyId })}
                >
                  Confirmer le lien avec cet écran
                </button>
              </p>
            ))}
        </div>
      )}
      <h3>Vérifier un fichier candidat</h3>
      <p className="field-help">
        Une ressemblance de nom n’est pas une correspondance prouvée. Ouvrez le code pour corroborer
        cet indice.
      </p>
      <div className="applications-form-grid">
        <label className="field">
          <span>Dépôt de l’indice</span>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {application.projectIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Chemin relatif du fichier candidat</span>
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="src/components/Invoice.tsx"
          />
        </label>
      </div>
      <button
        disabled={!source.trim() || !projectId}
        onClick={() => command({ action: 'openSource', relativePath: source, projectId })}
      >
        Ouvrir la source
      </button>
    </details>
  );
}
function Metrics({
  data,
  applicationId,
  command,
}: {
  data: NavigationSnapshot;
  applicationId: string;
  command: Command;
}) {
  const runs = data.runs.filter((run) => run.applicationId === applicationId);
  const totals = runs.reduce(
    (sum, run) => ({
      actions: sum.actions + run.metrics.actions,
      durationMs: sum.durationMs + run.metrics.durationMs,
      outputChars: sum.outputChars + run.metrics.outputChars,
      providerCalls: sum.providerCalls + run.metrics.providerCalls,
    }),
    { actions: 0, durationMs: 0, outputChars: 0, providerCalls: 0 },
  );
  return (
    <details className="applications-metrics">
      <summary>Consommation et couverture des mesures</summary>
      <div className="applications-status-grid">
        <div>
          <small>Actions de rejeu mesurées</small>
          <strong>{totals.actions}</strong>
        </div>
        <div>
          <small>Durée des rejeux</small>
          <strong>{(totals.durationMs / 1000).toLocaleString('fr-FR')} s</strong>
        </div>
        <div>
          <small>Sorties des rejeux</small>
          <strong>{totals.outputChars.toLocaleString('fr-FR')} caractères</strong>
        </div>
        <div>
          <small>Appels modèle des rejeux</small>
          <strong>{totals.providerCalls}</strong>
        </div>
      </div>
      <p className="field-help">
        <CircleHelp size={14} /> Ces mesures couvrent {runs.length} rejeu(x). Apprentissage,
        entretien, attente humaine et consommation fournisseur : consultez les sessions associées ;
        agrégation complète inconnue. Aucun gain économique n’est déduit de ces seuls compteurs.
      </p>
      {data.metrics && (
        <>
          <h3>Consommation fournisseur des sessions de navigation</h3>
          <p className="field-help">
            Projection du registre des sessions du projet, toutes applications confondues. Ces
            usages ne sont pas ajoutés une seconde fois aux totaux.
          </p>
          <div className="applications-metric-phases">
            {data.metrics.phases.map((phase) => (
              <article className="applications-run" key={phase.phase}>
                <strong>
                  {
                    {
                      'learning-maintenance': 'Apprentissage et entretien',
                      analysis: 'Analyse',
                      development: 'Développement',
                      verification: 'Recette',
                      unclassified: 'Non ventilé',
                    }[phase.phase]
                  }
                </strong>
                <p>
                  {phase.attempts} tentative(s) · {phase.failed} échec(s) ou interruption(s) ·{' '}
                  {phase.measuredAttempts} mesurée(s)
                </p>
                <dl>
                  <dt>Tokens entrée / sortie</dt>
                  <dd>
                    {phase.inputTokens?.toLocaleString('fr-FR') ?? 'Inconnu'} /{' '}
                    {phase.outputTokens?.toLocaleString('fr-FR') ?? 'Inconnu'} ·{' '}
                    {phase.completeTokens ? 'couverture complète' : 'couverture partielle'}
                  </dd>
                  <dt>Cache lecture / écriture</dt>
                  <dd>
                    {phase.cacheReadTokens?.toLocaleString('fr-FR') ?? 'Inconnu'} /{' '}
                    {phase.cacheWriteTokens?.toLocaleString('fr-FR') ?? 'Inconnu'}
                  </dd>
                  <dt>Consommation reçue</dt>
                  <dd>
                    {phase.cost === undefined || phase.unit === 'mixed'
                      ? 'Inconnue ou unités incompatibles'
                      : `${phase.cost.toLocaleString('fr-FR')} ${phase.unit ?? ''}`}{' '}
                    · {phase.completeCost ? 'complète' : 'partielle'}
                  </dd>
                  <dt>Durée API mesurée</dt>
                  <dd>
                    {phase.apiDurationMs === undefined
                      ? 'Inconnue'
                      : `${(phase.apiDurationMs / 1000).toLocaleString('fr-FR')} s`}
                  </dd>
                </dl>
              </article>
            ))}
          </div>
          {!data.metrics.phases.length && (
            <p>Aucun usage fournisseur lié à un contexte de navigation pour le moment.</p>
          )}
          <p className="field-help">{data.metrics.note} Gain économique : non établi.</p>
        </>
      )}
      <button onClick={() => command({ action: 'exportMetrics' })}>
        Exporter les mesures agrégées
      </button>
    </details>
  );
}

export function NavigationLaunchPicker({
  data,
  value,
  onChange,
}: {
  data?: NavigationSnapshot;
  value?: NavigationSelection;
  onChange: (value: NavigationSelection | undefined) => void;
}) {
  if (!data?.applications.length) return null;
  const application = data.applications.find((app) => app.id === value?.applicationId);
  const journeys = publishedJourneys(data).filter(
    (journey) => journey.applicationId === application?.id,
  );
  const selected = journeys.find(
    (journey) => journey.id === value?.journeyId && journey.revision === value?.revision,
  );
  let plan: ReturnType<typeof navigationPlan> | undefined;
  let planError = '';
  try {
    if (selected) plan = navigationPlan(selected, data);
  } catch (error) {
    planError = (error as Error).message;
  }
  const outputs = navigationOutputs(plan?.steps ?? []);
  return (
    <fieldset className="applications-launch">
      <legend>Contexte de navigation</legend>
      <label className="field">
        <span>Application du parcours</span>
        <select
          value={value?.applicationId ?? ''}
          onChange={(event) =>
            onChange(
              event.target.value
                ? {
                    applicationId: event.target.value,
                    parameters: {},
                    intent: 'reproduce',
                    allowInteractions: false,
                  }
                : undefined,
            )
          }
        >
          <option value="">Aucun contexte de navigation</option>
          {data.applications.map((app) => (
            <option value={app.id} key={app.id}>
              {app.name}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <>
          <label className="field">
            <span>Parcours et révision figée</span>
            <select
              value={value.journeyId ?? ''}
              onChange={(event) => {
                const journey = journeys.find((item) => item.id === event.target.value);
                onChange({
                  ...value,
                  journeyId: journey?.id,
                  revision: journey?.revision,
                  parameters: {},
                });
              }}
            >
              <option value="">Découverte · aucun parcours sélectionné</option>
              {journeys.map((journey) => (
                <option key={journey.id} value={journey.id}>
                  {journey.title} · r{journey.revision}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Intention de navigation</span>
            <select
              value={value.intent}
              onChange={(event) =>
                onChange({ ...value, intent: event.target.value as NavigationSelection['intent'] })
              }
            >
              <option value="reproduce">Reproduire ce parcours exact</option>
              <option value="reach-state">Atteindre cet état</option>
            </select>
          </label>
          {planError && <p role="alert">{planError}</p>}
          {(plan?.parameters ?? selected?.parameters ?? [])
            .filter((parameter) => !parameter.sensitive && !outputs.has(parameter.name))
            .map((parameter) => (
              <label className="field" key={parameter.name}>
                <span>{parameter.label || parameter.name}</span>
                <input
                  value={value.parameters[parameter.name] ?? parameter.defaultValue ?? ''}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      parameters: { ...value.parameters, [parameter.name]: event.target.value },
                    })
                  }
                />
              </label>
            ))}
          {outputs.size > 0 && (
            <p className="field-help">
              Le parcours choisit les données correspondantes et conserve leurs identifiants pour la
              correction : {[...outputs].join(', ')}.
            </p>
          )}
          <label className="applications-check">
            <input
              type="checkbox"
              checked={value.allowInteractions}
              onChange={(event) => onChange({ ...value, allowInteractions: event.target.checked })}
            />{' '}
            Autoriser les interactions dans les limites du profil
          </label>
          <label className="applications-check">
            <input
              type="checkbox"
              checked={value.prerequisitesConfirmed ?? false}
              onChange={(event) =>
                onChange({ ...value, prerequisitesConfirmed: event.target.checked })
              }
            />{' '}
            Prérequis de navigation vérifiés
          </label>
          <label className="applications-check">
            <input
              type="checkbox"
              checked={value.prepareRepair ?? false}
              onChange={(e) => onChange({ ...value, prepareRepair: e.target.checked })}
            />{' '}
            Préparer automatiquement une mission du Navigateur si l’accès bloque
          </label>
          <p className="field-help">
            L’aperçu hôte précise les références, le volume et les omissions. Changer le contexte
            figé ouvre une nouvelle tentative. Les critères du Testeur restent indépendants des
            conditions d’arrivée.
          </p>
        </>
      )}
    </fieldset>
  );
}

function RevisionHistory({
  journey,
  data,
  command,
}: {
  journey: NavigationJourney;
  data: NavigationSnapshot;
  command: Command;
}) {
  const revisions =
    data.revisions
      ?.filter((revision) => revision.id === journey.id)
      .sort((a, b) => b.revision - a.revision) ?? [];
  return (
    <details className="applications-history">
      <summary>Historique et différences de définition</summary>
      <button onClick={() => command({ action: 'history', journeyId: journey.id })}>
        Charger les révisions
      </button>
      {revisions.map((revision, index) => {
        const prior = revisions[index + 1];
        const fields = [
          'title',
          'intent',
          'prerequisites',
          'parameters',
          'steps',
          'arrival',
          'tags',
        ] as const;
        const changed = prior
          ? fields.filter((key) => JSON.stringify(prior[key]) !== JSON.stringify(revision[key]))
          : [];
        return (
          <article className="applications-run" key={revision.hash ?? revision.revision}>
            <strong>
              Révision {revision.revision} · {definitionLabels[revision.status]}
            </strong>
            <small>{shortDate(revision.updatedAt)}</small>
            <p className="applications-hash">{revision.hash}</p>
            {prior ? (
              <p>
                Champs modifiés depuis r{prior.revision} :{' '}
                {changed.join(', ') || 'aucun champ de parcours'}
              </p>
            ) : (
              <p>Première révision chargée.</p>
            )}
            <details>
              <summary>Consulter cette définition figée</summary>
              <pre>
                {JSON.stringify(
                  {
                    title: revision.title,
                    intent: revision.intent,
                    prerequisites: revision.prerequisites,
                    parameters: revision.parameters,
                    steps: revision.steps,
                    arrival: revision.arrival,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </article>
        );
      })}
    </details>
  );
}
function SourceSearch({
  data,
  application,
  command,
}: {
  data: NavigationSnapshot;
  application: ApplicationProfile;
  command: Command;
}) {
  const [query, setQuery] = useState('');
  return (
    <>
      <label className="field">
        <span>Texte observé à retrouver dans le code</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <button disabled={!query.trim()} onClick={() => command({ action: 'sourceSearch', query })}>
        Rechercher des indices
      </button>
      {data.codeAnchors
        ?.filter((anchor) => anchor.applicationId === application.id)
        .map((anchor) => (
          <article className="applications-run" key={anchor.id}>
            <strong>
              {anchor.state === 'corroborated'
                ? 'Corroboré'
                : anchor.state === 'stale'
                  ? 'À revérifier'
                  : 'Candidat'}{' '}
              · {anchor.relativePath}:{anchor.line}
            </strong>
            <p>{anchor.reason}</p>
            <button
              onClick={() =>
                command({
                  action: 'openSource',
                  relativePath: anchor.relativePath,
                  projectId: anchor.projectId,
                })
              }
            >
              Ouvrir {anchor.relativePath}
            </button>
          </article>
        ))}
    </>
  );
}
function CaptureComparison({
  data,
  applicationId,
}: {
  data: NavigationSnapshot;
  applicationId: string;
}) {
  const captures =
    data.captures?.filter((capture) => capture.applicationId === applicationId) ?? [];
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');
  const after = captures.find((capture) => capture.id === afterId) ?? captures.at(-1);
  const before =
    captures.find((capture) => capture.id === beforeId) ??
    (after?.caseKey
      ? [...captures]
          .reverse()
          .find(
            (capture) =>
              capture.id !== after.id &&
              capture.caseKey === after.caseKey &&
              capture.createdAt <= after.createdAt,
          )
      : undefined);
  return (
    <details className="applications-inspection">
      <summary>Captures et comparaison avant / après ({captures.length})</summary>
      <p className="field-help">
        Ces images attestent une observation. Elles ne remplacent ni les assertions du Testeur ni
        votre acceptation.
      </p>
      {!captures.length ? (
        <p>Aucune capture disponible pour cette application.</p>
      ) : (
        <>
          <div className="applications-form-grid">
            {[
              { label: 'Avant', value: before?.id ?? '', set: setBeforeId },
              { label: 'Après', value: after?.id ?? '', set: setAfterId },
            ].map((slot) => (
              <label className="field" key={slot.label}>
                <span>Capture {slot.label.toLowerCase()}</span>
                <select value={slot.value} onChange={(event) => slot.set(event.target.value)}>
                  <option value="">Choisir une capture</option>
                  {captures.map((capture) => (
                    <option value={capture.id} key={capture.id}>
                      {shortDate(capture.createdAt)} ·{' '}
                      {capture.revision ? `r${capture.revision}` : 'Observation'}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {before &&
            after &&
            (!before.caseKey ||
              before.caseKey !== after.caseKey ||
              before.journeyId !== after.journeyId ||
              before.revision !== after.revision ||
              JSON.stringify(before.viewport) !== JSON.stringify(after.viewport)) && (
              <p className="applications-uncertain">
                Contexte différent : parcours, révision ou taille de fenêtre. Cette comparaison ne
                démontre pas une équivalence d’exécution.
              </p>
            )}
          {!before && (
            <p>
              Aucune capture antérieure du même cas. Choisis une capture explicitement pour une
              comparaison exploratoire.
            </p>
          )}
          <div className="applications-comparison">
            {[
              { label: 'Avant', capture: before },
              { label: 'Après', capture: after },
            ].map(
              ({ label, capture }) =>
                capture && (
                  <figure key={label}>
                    <figcaption>
                      <strong>{label}</strong> ·{' '}
                      {capture.viewport
                        ? `${capture.viewport.width} × ${capture.viewport.height}`
                        : 'Dimensions inconnues'}
                      <small>
                        {shortDate(capture.createdAt)} ·{' '}
                        {capture.journeyId ? `r${capture.revision}` : 'Observation libre'}
                      </small>
                    </figcaption>
                    {capture.previewUrl ? (
                      <img
                        src={capture.previewUrl}
                        alt={`${label} : état observé le ${shortDate(capture.createdAt)}`}
                      />
                    ) : (
                      <p>Aperçu indisponible. Capture conservée par l’hôte.</p>
                    )}
                    <p className="applications-hash">SHA-256 : {capture.sha256}</p>
                  </figure>
                ),
            )}
          </div>
        </>
      )}
    </details>
  );
}

export function NavigationInterventionCard({
  featureId,
  stepId,
  attempt,
  disabled,
  dispatch,
  data,
}: {
  data?: NavigationSnapshot;
  featureId: string;
  stepId: string;
  attempt: Attempt;
  disabled: boolean;
  dispatch: Dispatch;
}) {
  const request = attempt.navigationRequest;
  const [selectedId, setSelectedId] = useState('');
  if (!request) return null;
  const choices = data
    ? publishedJourneys(data).filter((j) => j.applicationId === request.applicationId)
    : [];
  const selected =
    choices.find((j) => j.id === selectedId) ??
    choices.find((j) => j.id === attempt.navigation?.journey?.id) ??
    choices[0];
  return (
    <section className="navigation-intervention" aria-label="Contexte de navigation à compléter">
      <div>
        <span className="eyebrow">CONTEXTE À COMPLÉTER</span>
        <h3>{request.reason}</h3>
        <p>{request.observations}</p>
        <p className="field-help">
          Votre travail et cette tentative restent conservés. Après la recherche du Navigateur,
          choisissez explicitement le parcours et sa révision dans une nouvelle tentative.
        </p>
      </div>
      {request.resolvedJourney ? (
        <p role="status">
          Accès prêt : r{request.resolvedJourney.revision}. Ouvre une nouvelle tentative de cette
          étape ; le contexte est déjà sélectionné.
        </p>
      ) : (
        choices.length > 0 && (
          <div>
            <label className="field">
              <span>Accès à utiliser pour reprendre</span>
              <select value={selected?.id ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
                {choices.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} · r{j.revision}
                  </option>
                ))}
              </select>
            </label>
            <p>
              La tentative d’origine et ses preuves sont conservées. La reprise utilisera la
              révision choisie avec une nouvelle préparation.
            </p>
            <button
              disabled={disabled || !selected}
              onClick={() =>
                selected &&
                dispatch({
                  type: 'resumeNavigation',
                  featureId,
                  stepId,
                  attemptId: attempt.id,
                  journeyId: selected.id,
                  revision: selected.revision,
                })
              }
            >
              Reprendre ma correction avec cet accès
            </button>
          </div>
        )
      )}
      {request.navigatorFeatureId ? (
        <button
          className="button secondary"
          onClick={() =>
            dispatch({ type: 'activateFeature', featureId: request.navigatorFeatureId! })
          }
        >
          Ouvrir la recherche du Navigateur
        </button>
      ) : (
        <button
          className="button primary"
          disabled={disabled}
          onClick={() =>
            dispatch({ type: 'navigationIntervention', featureId, stepId, attemptId: attempt.id })
          }
        >
          Compléter avec le Navigateur
        </button>
      )}
    </section>
  );
}
