import { SessionGitPreparation, type GitSelection } from './SessionGitPreparation';
import { DocumentImport } from './DocumentImport';
import { useTaskDraft } from './useTaskDraft';
import { savedTaskDraft } from './bridge';
import { sessionStarters, type SessionStarterId } from '../src/shared/sessionStarters';
import './first-session.css';
import { ArrowRight, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type NativePermissionMode } from '../src/shared/native';
import type { ClientMessage, StudioState } from '../src/shared/types';
import { AgentModelOverrides } from './AgentModelOverrides';
import {
  isHosted,
  persistView,
  savedFeatureProposal,
  savedSessionStarter,
  subscribe,
} from './bridge';
import { initialSessionStarter } from './launchReadiness';
import { WorkspaceChoice, hasActiveRun } from './GitWorkspaceUI';
import { ImagePicker, useImageDraft } from './Images';
import { PermissionPicker } from './NativeExecutionUI';

import type { DiscussionFeatureDraft } from '../src/shared/discussions';

import { Modal } from './SessionPrimitives';

function CreateForm({
  origin,
  chooseDraft,
  state,
  onClose,
  onCreate,
  dispatch,
}: {
  chooseDraft: (id: string) => void;
  origin?: { discussionId: string; draft: DiscussionFeatureDraft };
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  onClose: () => void;
  onCreate: (message: Extract<ClientMessage, { type: 'createFeature' }>) => void;
}) {
  const [draftSeed] = useState(() =>
    origin && savedTaskDraft()?.origin?.discussionId !== origin.discussionId
      ? undefined
      : savedTaskDraft(),
  );
  const imageDraft = useImageDraft(draftSeed?.images);
  const [starter, setStarter] = useState<SessionStarterId>(
    draftSeed?.starter ?? initialSessionStarter(state, savedSessionStarter()),
  );
  const workflow = state.workflows.find((w) => w.id === starter);
  const invalidStarter =
    !origin &&
    starter !== 'custom' &&
    (!workflow ||
      workflow.steps.some((step) => !state.agents.some((agent) => agent.id === step.agentId)));

  const [restored] = useState(() => {
    const saved = savedFeatureProposal();
    return origin &&
      saved?.discussionId === origin.discussionId &&
      saved.draft.requestId === origin.draft.requestId
      ? saved.draft
      : origin?.draft;
  });
  const [title, setTitle] = useState(restored?.title ?? draftSeed?.title ?? ''),
    [description, setDescription] = useState(restored?.description ?? draftSeed?.description ?? '');
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
  const [gitSelection, setGitSelection] = useState<GitSelection>({ ready: false });
  const [startNow, setStartNow] = useState(false);
  const [pairMode, setPairMode] = useState(draftSeed?.pair ?? false);
  const [progression, setProgression] = useState<'guided' | 'balanced'>(
    draftSeed?.progression ?? 'guided',
  );
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const lastCreation = useRef<{ content: string; requestId: string } | undefined>(undefined);
  const creationError = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) creationError.current?.focus();
  }, [error]);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'featureCreateResult' || message.requestId !== pending) return;
        setPending(undefined);
        if (message.error) setError(message.error);
        else {
          draft.finish();
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
  const [isolated, setIsolated] = useState(
    draftSeed?.isolated ?? (starter !== 'code-review' && Boolean(state.workspace.canIsolate)),
  );
  const [permissionMode, setPermissionMode] = useState<NativePermissionMode>(
    draftSeed?.permissionMode ?? 'manual',
  );
  const [projectPending, setProjectPending] = useState(false);
  const [ids, setIds] = useState(
    draftSeed?.projectIds ?? state.projectCatalog?.selectedProjectIds ?? [],
  );
  const addRequest = useRef<string | undefined>(undefined);
  const addingProjects = useRef<Set<string> | undefined>(undefined);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'projectResult' || message.requestId !== addRequest.current) return;
        setProjectPending(false);
        addRequest.current = undefined;
        if (message.error) {
          setError(message.error);
          addingProjects.current = undefined;
        }
      }),
    [],
  );
  useEffect(() => {
    if (!addingProjects.current) return;
    const added =
      state.projectCatalog?.projects.filter((p) => !addingProjects.current!.has(p.id)) ?? [];
    if (added.length) {
      setIds((current) => [...current, ...added.map((p) => p.id)]);
      addingProjects.current = undefined;
    }
  }, [state.projectCatalog?.projects]);
  const draft = useTaskDraft(
    {
      title,
      description,
      starter,
      projectIds: ids,
      isolated,
      permissionMode,
      images: imageDraft.images,
      pair: pairMode,
      progression,
      ...(origin
        ? {
            origin: {
              ...origin,
              draft: { ...origin.draft, title, description, criteria: criteria.split('\n'), team },
            },
          }
        : {}),
    },
    dispatch,
  );
  const multiple = (ids?.length ?? 0) > 1;
  const missing = Boolean(state.projectCatalog && !ids?.length);
  const needsGitPreparation = !multiple && Boolean(state.workspace.canIsolate);
  const busy =
    (needsGitPreparation && !gitSelection.ready) ||
    Boolean(state.workspaceOperation) ||
    hasActiveRun(state) ||
    projectPending ||
    Boolean(pending) ||
    imageDraft.loading;
  return (
    <Modal
      title="Nouvelle session"
      subtitle={
        origin
          ? 'Relisez le besoin, les critères et l’équipe avant de créer la session.'
          : 'Décrivez votre besoin, puis choisissez une équipe pour vous accompagner.'
      }
      wide
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        className="session-creation"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && !busy && !missing && !invalidProposal && !invalidStarter) {
            const request: Extract<ClientMessage, { type: 'createFeature' }> = {
              type: 'createFeature',
              ...(needsGitPreparation && gitSelection.choice
                ? { gitChoice: gitSelection.choice }
                : {}),
              ...(startNow ? { start: { pair: pairMode, progression } } : {}),
              ...(imageDraft.images.length ? { images: imageDraft.images } : {}),
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
              ...(!origin && starter !== 'custom' ? { workflowId: starter } : {}),
              title: title.trim(),
              permissionMode,
              description: description.trim(),
              isolated: !multiple && isolated && Boolean(state.workspace.canIsolate),
              ...(state.projectCatalog ? { projectIds: ids } : {}),
            };
            // A failed save may already own a worktree. Retry the same request without duplicating it.
            const content = JSON.stringify(request);
            const requestId =
              lastCreation.current?.content === content
                ? lastCreation.current.requestId
                : crypto.randomUUID();
            lastCreation.current = { content, requestId };
            if (isHosted) setPending(requestId);
            setError('');
            onCreate({ ...request, requestId });
          }
        }}
      >
        <div className="draft-controls">
          <label className="field" hidden={!draft.drafts.length}>
            <span>Brouillons enregistrés</span>
            <select
              value={draftSeed?.id ?? ''}
              onChange={(e) => {
                const selected = draft.drafts.find((d) => d.id === e.target.value);
                persistView({ taskDraft: selected });
                chooseDraft(selected?.id ?? crypto.randomUUID());
              }}
            >
              <option value="">Nouveau brouillon</option>
              {draft.drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || 'Sans titre'}
                </option>
              ))}
            </select>
          </label>
          <p role="status">{draft.status}</p>
          <button
            type="button"
            className="text-button"
            hidden={
              !draft.saved && !title.trim() && !description.trim() && !imageDraft.images.length
            }
            disabled={Boolean(pending)}
            onClick={() => {
              draft.finish();
              onClose();
            }}
          >
            Abandonner ce brouillon
          </button>
          <button type="button" className="text-button" hidden={!draft.error} onClick={draft.retry}>
            Réessayer l’enregistrement
          </button>
        </div>
        {state.projectCatalog && (
          <details className="project-picker">
            <summary>
              Projets :{' '}
              {ids
                .map((id) => state.projectCatalog?.projects.find((p) => p.id === id)?.name ?? id)
                .join(' + ') || 'Choisir un projet'}
            </summary>
            <fieldset>
              <legend>Projets de la session</legend>
              {state.projectCatalog.projects
                .filter((p) => !p.hidden)
                .map((p) => (
                  <div className="draft-project" key={p.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={ids.includes(p.id)}
                        onChange={(e) =>
                          setIds(
                            e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                          )
                        }
                      />
                      {p.name}
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Projet principal : ${p.name}`}
                      aria-pressed={ids[0] === p.id}
                      disabled={!ids.includes(p.id)}
                      onClick={() => setIds([p.id, ...ids.filter((id) => id !== p.id)])}
                    >
                      {ids[0] === p.id ? 'Projet principal' : 'Utiliser comme principal'}
                    </button>
                  </div>
                ))}
              <button
                type="button"
                className="button secondary"
                disabled={projectPending || !state.workspace.trusted}
                onClick={() => {
                  const requestId = crypto.randomUUID();
                  addRequest.current = requestId;
                  addingProjects.current = new Set(state.projectCatalog?.projects.map((p) => p.id));
                  setProjectPending(true);
                  dispatch({ type: 'addProjects', requestId });
                }}
              >
                Ajouter un espace de travail
              </button>
            </fieldset>
          </details>
        )}
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
            onPaste={imageDraft.onPaste}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <DocumentImport
          value={description}
          onChange={setDescription}
          maxLength={origin ? 30000 : 500000}
          disabled={Boolean(pending)}
        />
        <ImagePicker draft={imageDraft} disabled={Boolean(pending) || imageDraft.loading} />
        {!origin && (
          <fieldset className="session-starters" disabled={Boolean(pending) || imageDraft.loading}>
            <legend>Comment souhaitez-vous avancer ?</legend>
            {sessionStarters.map((choice) => {
              const available =
                choice.id === 'custom' || state.workflows.some((w) => w.id === choice.id);
              return (
                <label
                  className={`session-starter ${starter === choice.id ? 'selected' : ''}`}
                  key={choice.id}
                >
                  <input
                    type="radio"
                    name="session-starter"
                    value={choice.id}
                    checked={starter === choice.id}
                    disabled={!available}
                    onChange={() => {
                      setStarter(choice.id);
                      persistView({ sessionStarter: choice.id });
                      setIsolated(
                        choice.id !== 'code-review' && Boolean(state.workspace.canIsolate),
                      );
                    }}
                  />
                  <span>
                    <strong>{choice.label}</strong>
                    <small>
                      {available ? choice.description : 'Équipe indisponible dans ce projet.'}
                    </small>
                  </span>
                </label>
              );
            })}
            {workflow && (
              <p className="starter-preview">
                Équipe : {workflow.steps.map((step) => step.name).join(' → ')}. Chaque résultat
                reste à valider.
              </p>
            )}
            {invalidStarter && (
              <p role="alert">
                Cette équipe ou un de ses agents n’est plus disponible. Choisissez un autre parcours
                ou composez votre équipe.
              </p>
            )}
          </fieldset>
        )}
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
        {needsGitPreparation && (
          <SessionGitPreparation
            projectId={ids[0]}
            title={title}
            isolated={isolated}
            disabled={Boolean(pending)}
            onChange={setGitSelection}
          />
        )}
        <details className="creation-options">
          <summary>Options de travail</summary>
          <p className="muted">
            Les permissions sont vérifiées avant le lancement. Vous pouvez préparer la session sans
            lancer d’agent.
          </p>
          <p>
            <strong>Copilot natif</strong> · Les outils de Copilot réalisent le travail.
          </p>
          <PermissionPicker
            state={state}
            value={permissionMode}
            onChange={setPermissionMode}
            disabled={Boolean(pending) || imageDraft.loading}
          />
        </details>
        <p className="creation-summary" role="status">
          {permissionMode === 'manual'
            ? 'Autorisations demandées au besoin.'
            : 'Permissions personnalisées : vérifiez les options avant le lancement.'}{' '}
          {multiple
            ? 'Travail dans les dossiers sélectionnés.'
            : isolated && state.workspace.canIsolate
              ? 'Une branche et un dossier dédiés seront créés.'
              : 'Travail dans le dossier courant.'}
        </p>
        {pending && (
          <div className="creation-feedback" role="status" aria-label="Création de la session">
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
            <span>{state.workspaceOperation?.label ?? 'Création de la session…'}</span>
          </div>
        )}
        {error && (
          <div className="creation-feedback error" role="alert" tabIndex={-1} ref={creationError}>
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <strong>Impossible de créer la session</strong>
              <p>{error}</p>
            </div>
          </div>
        )}
        <fieldset>
          <legend>Comment avancer</legend>
          <label className="field">
            <span>Pendant une étape</span>
            <select
              value={pairMode ? 'pair' : 'solo'}
              onChange={(e) => setPairMode(e.target.value === 'pair')}
            >
              <option value="solo">Confier le travail à l’agent</option>
              <option value="pair">Travailler en pair</option>
            </select>
          </label>
          <label className="field">
            <span>Entre les étapes</span>
            <select
              value={progression}
              onChange={(e) => setProgression(e.target.value as 'guided' | 'balanced')}
            >
              <option value="guided">Je valide chaque étape</option>
              <option value="balanced">Je valide le plan et le résultat</option>
            </select>
          </label>
          <p className="field-help">
            Les questions et autorisations restent à ta main. En pair, l’agent propose son
            organisation avant le travail.
          </p>
        </fieldset>
        <div className="modal-actions">
          <span className="muted">Créer seulement la session, ou démarrer son premier agent.</span>
          <button
            type="button"
            className="button secondary"
            disabled={Boolean(pending)}
            onClick={onClose}
          >
            Garder en brouillon
          </button>
          <button
            type="submit"
            onClick={() => setStartNow(false)}
            className="button secondary"
            disabled={!title.trim() || busy || missing || invalidProposal || invalidStarter}
          >
            {pending ? 'Création en cours…' : 'Créer la session'} <ArrowRight size={16} />
          </button>
          <button
            type="submit"
            className="button primary"
            onClick={() => setStartNow(true)}
            disabled={
              !title.trim() ||
              busy ||
              missing ||
              invalidProposal ||
              invalidStarter ||
              (starter === 'custom' && !origin)
            }
          >
            Créer et démarrer
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateModal(props: Omit<Parameters<typeof CreateForm>[0], 'chooseDraft'>) {
  const [draftKey, setDraftKey] = useState(() => savedTaskDraft()?.id ?? 'new');
  return (
    <CreateForm
      key={draftKey}
      {...props}
      origin={props.origin ?? savedTaskDraft()?.origin}
      chooseDraft={setDraftKey}
    />
  );
}
