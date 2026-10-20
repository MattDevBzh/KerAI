import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  FolderGit2,
  GitBranch,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { ClientMessage, StudioState } from '../src/shared/types';
import {
  defaultSessionFilters,
  selectSessionRange,
  sessionProjects,
  type SessionBatchAction,
  type SessionBatchResult,
  type SessionListFilters,
} from '../src/shared/sessionList';
import { progressLabel, stepResolved } from '../src/shared/optionalSteps';
import { searchText } from './Ergonomics';
import { isHosted, persistView, savedSessionList, subscribe } from './bridge';
import './sessions.css';

const statuses = {
  draft: { label: 'À démarrer', tone: 'neutral' },
  running: { label: 'En cours', tone: 'lavender' },
  attention: { label: 'À votre tour', tone: 'apricot' },
  awaiting_final_validation: { label: 'Dernière validation', tone: 'apricot' },
  completed: { label: 'Terminée', tone: 'green' },
};
const date = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const projectColor = (id: string) =>
  [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 6, 0);

function SelectAll({
  total,
  selected,
  disabled,
  onChange,
}: {
  total: number;
  selected: number;
  disabled: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && selected < total;
  }, [selected, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={`Sélectionner les ${total} sessions affichées`}
      checked={total > 0 && selected === total}
      disabled={disabled || !total}
      onChange={onChange}
    />
  );
}

export function Sessions({
  state,
  onCreate,
  onOpen,
  dispatch,
}: {
  state: StudioState;
  onCreate: () => void;
  onOpen: (id: string) => void;
  dispatch: (message: ClientMessage) => void;
}) {
  const [filters, setFilters] = useState<SessionListFilters>(() => ({
    ...defaultSessionFilters,
    ...savedSessionList(),
  }));
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const request = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState<{ completed: number; total: number }>();
  const [result, setResult] = useState<SessionBatchResult>();
  const catalog = state.projectCatalog?.projects;
  const projects = useMemo(() => {
    const all = new Map((catalog ?? []).map((project) => [project.id, project]));
    for (const feature of state.features)
      for (const project of sessionProjects(feature, catalog)) all.set(project.id, project);
    return [...all.values()].sort(
      (a, b) => a.name.localeCompare(b.name, 'fr') || a.path.localeCompare(b.path),
    );
  }, [catalog, state.features]);
  const attributed = useMemo(
    () =>
      state.features.map((feature) => ({ feature, projects: sessionProjects(feature, catalog) })),
    [state.features, catalog],
  );
  const scoped = attributed.filter(
    ({ projects }) =>
      !filters.project ||
      (filters.project === '__none'
        ? !projects.length
        : projects.some((project) => project.id === filters.project)),
  );
  const activeCount = scoped.filter(({ feature }) => !feature.archived).length;
  const archivedCount = scoped.length - activeCount;
  const query = searchText(filters.search);
  const rows = scoped
    .filter(
      ({ feature, projects }) =>
        Boolean(feature.archived) === filters.archived &&
        (filters.status === 'all' ||
          feature.status === filters.status ||
          (filters.status === 'attention' && feature.status === 'awaiting_final_validation')) &&
        (!query ||
          searchText(
            `${feature.title} ${feature.description} ${feature.branch} ${feature.workflowName} ${projects.map((p) => `${p.name} ${p.path}`).join(' ')}`,
          ).includes(query)),
    )
    .sort(
      (a, b) =>
        (filters.sort === 'title'
          ? a.feature.title.localeCompare(b.feature.title, 'fr')
          : filters.sort === 'oldest'
            ? a.feature.updatedAt.localeCompare(b.feature.updatedAt)
            : b.feature.updatedAt.localeCompare(a.feature.updatedAt)) ||
        a.feature.id.localeCompare(b.feature.id),
    );
  const visibleIds = rows.map(({ feature }) => feature.id);
  const visibleKey = JSON.stringify(visibleIds);
  useEffect(() => {
    const visible = new Set<string>(JSON.parse(visibleKey));
    setSelected((ids) =>
      ids.every((id) => visible.has(id)) ? ids : ids.filter((id) => visible.has(id)),
    );
    if (anchor.current && !visible.has(anchor.current)) anchor.current = undefined;
  }, [visibleKey]);
  useEffect(() => persistView({ sessionList: filters }), [filters]);
  useEffect(
    () =>
      subscribe((message) => {
        if (!('requestId' in message) || message.requestId !== request.current) return;
        if (message.type === 'sessionBatchProgress')
          setPending({ completed: message.completed, total: message.total });
        if (message.type === 'sessionBatchResult') {
          request.current = undefined;
          setPending(undefined);
          setResult(message);
          setSelected((ids) => ids.filter((id) => !message.succeeded.includes(id)));
        }
      }),
    [],
  );
  const change = (patch: Partial<SessionListFilters>) => {
    setFilters((value) => ({ ...value, ...patch }));
    setSelected([]);
    anchor.current = undefined;
  };
  const reset = () => change({ search: '', project: '', status: 'all' });
  const select = (id: string, extend: boolean) => {
    if (pending) return;
    const start = anchor.current;
    setSelected((ids) => selectSessionRange(visibleIds, ids, start, id, extend));
    if (!extend || !anchor.current || !visibleIds.includes(anchor.current)) anchor.current = id;
  };
  const blocked = Boolean(
    pending || state.workspaceOperation || !state.workspace.trusted || !isHosted,
  );
  const blockedReason = !isHosted
    ? 'Disponible dans VS Code.'
    : !state.workspace.trusted
      ? 'Approuve le projet dans VS Code pour gérer ses sessions.'
      : (state.workspaceOperation?.label ?? '');
  const manage = (action: SessionBatchAction, ids = selected) => {
    if (blocked || !ids.length || request.current) return;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setResult(undefined);
    setPending({ completed: 0, total: ids.length });
    dispatch({ type: 'manageSessions', requestId, action, featureIds: [...ids] });
  };
  const filtered = Boolean(filters.search || filters.project || filters.status !== 'all');
  return (
    <div className="page sessions-page">
      <header className="sessions-heading">
        <div>
          <span className="eyebrow">VOTRE ATELIER</span>
          <h1>
            Sessions <span className="count-pill">{state.features.length}</span>
          </h1>
        </div>
        <button
          className="button primary"
          disabled={Boolean(pending || state.workspaceOperation)}
          onClick={() => onCreate()}
        >
          <Plus size={16} /> Nouvelle session
        </button>
      </header>
      <section aria-label="Liste des sessions">
        <div className="sessions-controls">
          <div className="sessions-tabs">
            <button
              className={!filters.archived ? 'selected' : ''}
              aria-pressed={!filters.archived}
              disabled={Boolean(pending)}
              onClick={() => change({ archived: false })}
            >
              Actives <span>{activeCount}</span>
            </button>
            <button
              className={filters.archived ? 'selected' : ''}
              aria-pressed={filters.archived}
              disabled={Boolean(pending)}
              onClick={() => change({ archived: true })}
            >
              <Archive size={14} /> Archives <span>{archivedCount}</span>
            </button>
            <span className="sessions-shortcuts">
              <button
                aria-label="Afficher toutes les sessions"
                disabled={Boolean(pending)}
                onClick={() => change({ status: 'all', search: '', archived: false })}
              >
                Toutes
              </button>
              <button
                aria-label="Afficher les sessions à votre tour"
                disabled={Boolean(pending)}
                onClick={() => change({ status: 'attention', search: '', archived: false })}
              >
                À votre tour
              </button>
              <button
                aria-label="Afficher les sessions terminées"
                disabled={Boolean(pending)}
                onClick={() => change({ status: 'completed', search: '', archived: false })}
              >
                Terminées
              </button>
            </span>
          </div>
          <div className="sessions-filters">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Rechercher une session"
                placeholder="Titre, branche, projet…"
                value={filters.search}
                disabled={Boolean(pending)}
                onChange={(event) => change({ search: event.target.value })}
              />
              {filters.search && (
                <button
                  className="icon-button"
                  aria-label="Effacer la recherche"
                  disabled={Boolean(pending)}
                  onClick={() => change({ search: '' })}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <label>
              <span>Projet</span>
              <select
                aria-label="Filtrer par projet"
                value={filters.project}
                disabled={Boolean(pending)}
                onChange={(event) => change({ project: event.target.value })}
              >
                <option value="">Tous les projets</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {projects.some((p) => p.id !== project.id && p.name === project.name)
                      ? ` — ${project.path}`
                      : ''}
                  </option>
                ))}
                {attributed.some((row) => !row.projects.length) && (
                  <option value="__none">Sans projet associé</option>
                )}
                {filters.project &&
                  filters.project !== '__none' &&
                  !projects.some((project) => project.id === filters.project) && (
                    <option value={filters.project}>Projet indisponible</option>
                  )}
              </select>
            </label>
            <label>
              <span>État</span>
              <select
                aria-label="Filtrer les sessions"
                value={filters.status}
                disabled={Boolean(pending)}
                onChange={(event) => change({ status: event.target.value })}
              >
                <option value="all">Tous les états</option>
                <option value="attention">À votre tour</option>
                <option value="awaiting_final_validation">Dernière validation</option>
                <option value="running">En cours</option>
                <option value="draft">À démarrer</option>
                <option value="completed">Terminées</option>
              </select>
            </label>
            <label>
              <span>Trier</span>
              <select
                aria-label="Trier les sessions"
                value={filters.sort}
                disabled={Boolean(pending)}
                onChange={(event) =>
                  change({ sort: event.target.value as SessionListFilters['sort'] })
                }
              >
                <option value="recent">Activité récente</option>
                <option value="oldest">Plus anciennes</option>
                <option value="title">Titre A → Z</option>
              </select>
            </label>
          </div>
        </div>
        <div className="sessions-selection" aria-live="polite">
          <strong>
            {selected.length
              ? `${selected.length} sélectionnée${selected.length > 1 ? 's' : ''}`
              : `${rows.length} session${rows.length > 1 ? 's' : ''} affichée${rows.length > 1 ? 's' : ''}`}
          </strong>
          {selected.length > 0 ? (
            <>
              <button
                className="button secondary small"
                title={blockedReason}
                disabled={blocked}
                onClick={() => manage(filters.archived ? 'restore' : 'archive')}
              >
                {filters.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                {filters.archived ? 'Restaurer' : 'Archiver'} ({selected.length})
              </button>
              <button
                className="button secondary small session-delete"
                title={blockedReason}
                disabled={blocked}
                onClick={() => manage('delete')}
              >
                <Trash2 size={14} /> Supprimer ({selected.length})
              </button>
              <button
                className="text-button"
                disabled={Boolean(pending)}
                onClick={() => {
                  setSelected([]);
                  anchor.current = undefined;
                }}
              >
                Désélectionner
              </button>
            </>
          ) : (
            <span className="muted sessions-selection-hint">
              Clic : sélectionner · Maj+clic : sélectionner une plage · Ouvrir : consulter
            </span>
          )}
          {filtered && (
            <button
              className="text-button sessions-reset"
              disabled={Boolean(pending)}
              onClick={reset}
            >
              Réinitialiser les filtres
            </button>
          )}
          {pending && (
            <span role="status">
              Traitement : {pending.completed}/{pending.total}…
            </span>
          )}
        </div>
        {result && (
          <div className="sessions-result" role="status">
            {result.error ? (
              <span>{result.error}</span>
            ) : result.cancelled ? (
              <span>Suppression annulée. La sélection est conservée.</span>
            ) : (
              <span>
                <Check size={14} /> {result.succeeded.length} session
                {result.succeeded.length > 1 ? 's' : ''}{' '}
                {result.action === 'delete'
                  ? 'supprimée'
                  : result.action === 'archive'
                    ? 'archivée'
                    : 'restaurée'}
                {result.succeeded.length > 1 ? 's' : ''}.
                {result.action === 'delete' &&
                  result.freedBytes > 0 &&
                  ` ${(result.freedBytes / 1024 ** 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mio libérés.`}
              </span>
            )}
            {!!result.failed.length && (
              <details open>
                <summary>
                  {result.failed.length} session{result.failed.length > 1 ? 's' : ''} non traitée
                  {result.failed.length > 1 ? 's' : ''}
                </summary>
                <ul>
                  {result.failed.map((item) => (
                    <li key={item.featureId}>
                      <strong>{item.title}</strong> : {item.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <button
              className="icon-button"
              aria-label="Fermer le résultat"
              onClick={() => setResult(undefined)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <table className="sessions-table" aria-label="Sessions" aria-busy={Boolean(pending)}>
          <thead>
            <tr>
              <th>
                <SelectAll
                  total={rows.length}
                  selected={selected.length}
                  disabled={Boolean(pending)}
                  onChange={() => {
                    setSelected(selected.length === rows.length ? [] : visibleIds);
                    anchor.current = undefined;
                  }}
                />
              </th>
              <th>Session</th>
              <th>Projet</th>
              <th>État / progression</th>
              <th>Dernière activité</th>
              <th>
                <span className="sessions-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ feature, projects }) => {
              const status = statuses[feature.status];
              const resolved = feature.steps.filter(stepResolved).length;
              const running =
                feature.steps.some((step) => step.status === 'running') ||
                feature.autopilot?.status === 'running';
              return (
                <tr
                  key={feature.id}
                  className={`session-row ${selected.includes(feature.id) ? 'is-selected' : ''}`}
                  onClick={(event) => {
                    if (!(event.target as HTMLElement).closest('button,input,a,label,select'))
                      select(feature.id, event.shiftKey);
                  }}
                  onMouseDown={(event) => {
                    if (event.shiftKey && !(event.target as HTMLElement).closest('button,input'))
                      event.preventDefault();
                  }}
                >
                  <td className="session-select">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${feature.title}`}
                      checked={selected.includes(feature.id)}
                      disabled={Boolean(pending)}
                      onChange={() => {}}
                      onClick={(event) => select(feature.id, event.shiftKey)}
                      onKeyDown={(event) => {
                        if (event.key === ' ' && event.shiftKey) {
                          event.preventDefault();
                          select(feature.id, true);
                        }
                      }}
                    />
                  </td>
                  <td className="session-name">
                    <h3 title={feature.title}>{feature.title}</h3>
                    <div
                      title={`${feature.workflowName} · ${feature.branch || 'Branche courante'}`}
                    >
                      <span>{feature.workflowName}</span>
                      <span>
                        <GitBranch size={12} /> {feature.branch || 'Branche courante'}
                      </span>
                    </div>
                  </td>
                  <td className="session-project-cell">
                    {projects.length ? (
                      projects.map((project) => (
                        <span
                          key={project.id}
                          className={`session-project-tag project-color-${projectColor(project.id)}`}
                          title={`${project.name} — ${project.path}`}
                        >
                          <FolderGit2 size={12} />
                          <span>{project.name}</span>
                        </span>
                      ))
                    ) : (
                      <span className="muted">Sans projet associé</span>
                    )}
                  </td>
                  <td className="session-state">
                    <span className={`badge ${status.tone}`}>
                      <span />
                      {status.label}
                    </span>
                    <div className="session-progress">
                      <div
                        role="progressbar"
                        aria-label={progressLabel(feature)}
                        aria-valuetext={progressLabel(feature)}
                        aria-valuemin={0}
                        aria-valuemax={feature.steps.length || 1}
                        aria-valuenow={resolved}
                      >
                        <span
                          style={{
                            width: `${feature.steps.length ? (resolved / feature.steps.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <small>
                        {resolved}/{feature.steps.length}
                      </small>
                    </div>
                  </td>
                  <td className="session-date">
                    <time
                      dateTime={feature.updatedAt}
                      title={new Date(feature.updatedAt).toLocaleString('fr-FR')}
                    >
                      {date.format(new Date(feature.updatedAt))}
                    </time>
                  </td>
                  <td className="session-row-actions">
                    <button
                      className="text-button session-open"
                      aria-label={`Ouvrir ${feature.title}`}
                      disabled={Boolean(pending)}
                      onClick={() => onOpen(feature.id)}
                    >
                      Ouvrir <ArrowUpRight size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`${feature.archived ? 'Restaurer' : 'Archiver'} ${feature.title}`}
                      title={
                        running
                          ? 'Arrête la session avant cette action.'
                          : blockedReason || (feature.archived ? 'Restaurer' : 'Archiver')
                      }
                      disabled={blocked || running}
                      onClick={() => manage(feature.archived ? 'restore' : 'archive', [feature.id])}
                    >
                      {feature.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    </button>
                    <button
                      className="icon-button session-delete"
                      aria-label={`Supprimer ${feature.title}`}
                      title={
                        running
                          ? 'Arrête la session avant cette action.'
                          : blockedReason || 'Supprimer'
                      }
                      disabled={blocked || running}
                      onClick={() => manage('delete', [feature.id])}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="sessions-empty">
            <Search size={24} />
            <h2>
              {filtered
                ? 'Aucune session ne correspond'
                : filters.archived
                  ? 'Aucune session archivée'
                  : 'Votre prochaine session commence ici'}
            </h2>
            <p>
              {filtered
                ? 'Essayez une autre recherche ou un autre projet.'
                : filters.archived
                  ? 'Les sessions archivées restent consultables et peuvent être restaurées.'
                  : 'Créez une session et choisissez les projets concernés.'}
            </p>
            {filtered ? (
              <button className="button secondary" onClick={reset}>
                Effacer les filtres
              </button>
            ) : (
              !filters.archived && (
                <button className="button primary" onClick={() => onCreate()}>
                  Créer ma première session
                </button>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}
