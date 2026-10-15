import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, Monitor, Plus, Star } from 'lucide-react';
import type { ClientMessage, StudioState } from '../src/shared/types';
import type { StudioProject, ProjectClientMessage } from '../src/shared/projects';
import { subscribe } from './bridge';
import './projects.css';
type Dispatch = (message: ClientMessage) => void;
type Requested = Exclude<ProjectClientMessage, { type: 'activateFeature' | 'activateProject' }>;

function useProjectAction(dispatch: Dispatch, onPending?: (value: boolean) => void) {
  const request = useRef('');
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'projectResult' || message.requestId !== request.current) return;
        setPending(false);
        onPending?.(false);
        setError(message.error ?? '');
        setNotice(message.message ?? '');
      }),
    [onPending],
  );
  const run = (message: Requested) => {
    if (pending) return;
    request.current = message.requestId;
    setPending(true);
    onPending?.(true);
    setError('');
    setNotice('');
    dispatch(message);
  };
  return { pending, error, notice, run };
}

export function ProjectPicker({
  state,
  dispatch,
  onPendingChange,
}: {
  state: StudioState;
  dispatch: Dispatch;
  onPendingChange?: (pending: boolean) => void;
}) {
  const action = useProjectAction(dispatch, onPendingChange);
  const catalog = state.projectCatalog;
  useEffect(() => {
    const selected = catalog?.selectedProjectIds;
    if (selected?.length && catalog?.activeProjectId !== selected[0])
      action.run({
        type: 'selectProjects',
        projectIds: [...selected],
        requestId: crypto.randomUUID(),
      });
  }, [catalog?.activeProjectId, catalog?.selectedProjectIds.join('|')]);
  if (!catalog) return null;
  const ids = catalog.selectedProjectIds,
    projects = catalog.projects.filter((project) => !project.hidden);
  const names = ids.map((id) => projects.find((project) => project.id === id)?.name ?? id);
  const select = (projectIds: string[]) =>
    action.run({ type: 'selectProjects', projectIds, requestId: crypto.randomUUID() });
  return (
    <div className="project-picker">
      <label>Projets de la session</label>
      <details>
        <summary>
          <FolderOpen size={16} />
          <span>{names.length ? names.join(' + ') : 'Choisir un ou plusieurs projets'}</span>
          <ChevronDown size={16} />
        </summary>
        <div className="project-options" role="group" aria-label="Projets de la session">
          {projects.map((project) => (
            <div className="project-option" key={project.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={action.pending}
                  checked={ids.includes(project.id)}
                  onChange={(event) =>
                    select(
                      event.target.checked
                        ? [...ids, project.id]
                        : ids.filter((id) => id !== project.id),
                    )
                  }
                />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                </span>
              </label>
              {ids.includes(project.id) && (
                <button
                  type="button"
                  className="icon-button"
                  disabled={action.pending || ids[0] === project.id}
                  title="Utiliser les profils de ce projet"
                  aria-label={`Projet principal : ${project.name}`}
                  aria-pressed={ids[0] === project.id}
                  onClick={() => select([project.id, ...ids.filter((id) => id !== project.id)])}
                >
                  <Star size={15} fill={ids[0] === project.id ? 'currentColor' : 'none'} />
                </button>
              )}
            </div>
          ))}
          {!projects.length && (
            <p className="muted">Ajoutez vos dossiers de travail pour créer une session.</p>
          )}
          <button
            type="button"
            className="button secondary small"
            disabled={action.pending}
            onClick={() => action.run({ type: 'addProjects', requestId: crypto.randomUUID() })}
          >
            <Plus size={14} />
            Ajouter un espace de travail
          </button>
        </div>
      </details>
      <small className="muted">
        Sélection mémorisée pour la prochaine création.
        {ids.length > 1 &&
          ` Les profils et skills du projet principal « ${names[0]} » complètent vos profils utilisateur.`}
      </small>
      {action.pending && (
        <small role="status" className="muted">
          Enregistrement de la sélection…
        </small>
      )}
      {action.error && (
        <p className="project-error" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  state,
  dispatch,
  disabled,
}: {
  project: StudioProject;
  state: StudioState;
  dispatch: Dispatch;
  disabled: boolean;
}) {
  const action = useProjectAction(dispatch);
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.name]);
  return (
    <div className={`project-row ${project.hidden ? 'hidden-project' : ''}`}>
      <FolderOpen size={20} />
      <div className="project-row-body">
        <label>
          <span className="team-sr-only">Nom du projet {project.name}</span>
          <input
            value={name}
            maxLength={100}
            disabled={action.pending || disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <code>{project.path}</code>
        {action.error && (
          <p className="project-error" role="alert">
            {action.error}
          </p>
        )}
      </div>
      <div className="project-row-actions">
        {name.trim() !== project.name && (
          <button
            type="button"
            className="button secondary small"
            disabled={!name.trim() || action.pending || disabled}
            onClick={() =>
              action.run({
                type: 'renameProject',
                projectId: project.id,
                name: name.trim(),
                requestId: crypto.randomUUID(),
              })
            }
          >
            <Check size={14} />
            Renommer
          </button>
        )}
        <button
          type="button"
          className="button secondary small"
          disabled={
            disabled || project.hidden || state.projectCatalog?.activeProjectId === project.id
          }
          onClick={() => dispatch({ type: 'activateProject', projectId: project.id })}
        >
          {state.projectCatalog?.activeProjectId === project.id
            ? 'Réglages affichés'
            : 'Configurer ce projet'}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={action.pending || disabled}
          onClick={() =>
            action.run({
              type: 'hideProject',
              projectId: project.id,
              hidden: !project.hidden,
              requestId: crypto.randomUUID(),
            })
          }
        >
          {project.hidden ? 'Afficher dans le sélecteur' : 'Masquer du sélecteur'}
        </button>
      </div>
    </div>
  );
}

export function ProjectSettings({
  state,
  dispatch,
  dirty = false,
}: {
  state: StudioState;
  dispatch: Dispatch;
  dirty?: boolean;
}) {
  const action = useProjectAction(dispatch);
  const catalog = state.projectCatalog;
  if (!catalog) return null;
  return (
    <section className="project-settings">
      <div className="section-heading">
        <div>
          <h2>Espaces de travail</h2>
          <p className="muted">
            Un seul cockpit pour vos projets. Les dossiers restent à leur emplacement.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={action.pending || dirty}
          onClick={() => action.run({ type: 'addProjects', requestId: crypto.randomUUID() })}
        >
          <Plus size={15} />
          Ajouter des dossiers
        </button>
      </div>
      {catalog.projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          state={state}
          dispatch={dispatch}
          disabled={dirty}
        />
      ))}
      {!catalog.projects.length && (
        <p className="muted">Aucun projet enregistré. Ajoutez un ou plusieurs dossiers.</p>
      )}
      {dirty && (
        <p className="muted">Enregistrez les réglages en cours avant de changer de projet.</p>
      )}
      {!!catalog.errors?.length && (
        <p className="project-error" role="alert">
          {catalog.errors.join(' ')}
        </p>
      )}
      <div className="project-window-actions">
        <Monitor size={22} />
        <div>
          <strong>Feature Studio dans sa propre fenêtre</strong>
          <p className="muted">
            Le raccourci ouvre directement le cockpit et retrouve sa fenêtre si elle est déjà
            ouverte.
          </p>
        </div>
        {!catalog.dedicated && (
          <button
            type="button"
            className="button secondary"
            disabled={action.pending}
            onClick={() =>
              action.run({ type: 'openDedicatedWindow', requestId: crypto.randomUUID() })
            }
          >
            Ouvrir la fenêtre dédiée
          </button>
        )}
        {catalog.windows && (
          <button
            type="button"
            className="button primary"
            disabled={action.pending}
            onClick={() =>
              action.run({ type: 'createWindowsShortcut', requestId: crypto.randomUUID() })
            }
          >
            Créer le raccourci Windows
          </button>
        )}
      </div>
      {action.error && (
        <p className="project-error" role="alert">
          {action.error}
        </p>
      )}
      {action.notice && <p role="status">{action.notice}</p>}
      {!!catalog.projects.length && (
        <p className="project-current-settings">
          Les réglages Copilot, MCP, tests et scripts ci-dessous concernent{' '}
          <strong>
            {catalog.projects.find((project) => project.id === catalog.activeProjectId)?.name ??
              state.workspace.name}
          </strong>
          .
        </p>
      )}
    </section>
  );
}

export function ProjectSwitcher({
  state,
  dispatch,
  disabled = false,
}: {
  state: StudioState;
  dispatch: Dispatch;
  disabled?: boolean;
}) {
  const catalog = state.projectCatalog;
  if (!catalog?.projects.length) return null;
  return (
    <label className="project-switcher">
      <span>Projet actif</span>
      <select
        aria-label="Projet actif"
        value={catalog.activeProjectId ?? ''}
        disabled={disabled || Boolean(state.workspaceOperation)}
        onChange={(event) => dispatch({ type: 'activateProject', projectId: event.target.value })}
      >
        {!catalog.activeProjectId && (
          <option value="" disabled>
            Choisir un projet
          </option>
        )}
        {catalog.projects
          .filter((project) => !project.hidden || project.id === catalog.activeProjectId)
          .map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
      </select>
    </label>
  );
}
