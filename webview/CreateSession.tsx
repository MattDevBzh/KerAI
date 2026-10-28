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
import { ProjectPicker } from './ProjectUI';

import type { DiscussionFeatureDraft } from '../src/shared/discussions';

import { Modal } from './SessionPrimitives';

export function CreateModal({
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
  const imageDraft = useImageDraft();
  const [starter, setStarter] = useState<SessionStarterId>(
    initialSessionStarter(state, savedSessionStarter()),
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
    starter !== 'code-review' && Boolean(state.workspace.canIsolate),
  );
  const [permissionMode, setPermissionMode] = useState<NativePermissionMode>('manual');
  const [projectPending, setProjectPending] = useState(false);
  const ids = state.projectCatalog?.selectedProjectIds;
  const multiple = (ids?.length ?? 0) > 1;
  const missing = Boolean(state.projectCatalog && !ids?.length);
  const busy =
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
              ...(ids ? { projectIds: ids } : {}),
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
        <ProjectPicker state={state} dispatch={dispatch} onPendingChange={setProjectPending} />
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
        <ImagePicker draft={imageDraft} disabled={busy} />
        {!origin && (
          <fieldset className="session-starters" disabled={busy}>
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
            disabled={busy}
          />
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
            disabled={!title.trim() || busy || missing || invalidProposal || invalidStarter}
          >
            {pending ? 'Création en cours…' : 'Créer la session'} <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
