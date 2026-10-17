import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Code2,
  Eye,
  FilterX,
  GitBranch,
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  Tickets,
} from 'lucide-react';
import type { DevOpsState, DevOpsTicket, Feature } from '../src/shared/types';
import {
  defaultTicketFilters,
  ticketBranchName,
  ticketContext,
  ticketLinkProjectKey,
  ticketProjectKey,
  type TicketFilters,
  type TicketPreparation,
} from '../src/shared/devopsTickets';
import { devOpsPlainText } from '../src/shared/devopsText';
import { devOpsDate, type DevOpsUIProps } from './DevOpsUI';
import { StudioDialog } from './ExecutionUI';
import './tickets.css';

type Props = {
  active: boolean;
  state: DevOpsState;
  features: DevOpsUIProps['features'];
  dispatch: DevOpsUIProps['dispatch'];
  onOpenFeature: DevOpsUIProps['onOpenFeature'];
  onConfigure: () => void;
};
export function TicketsUI({
  active,
  state,
  features,
  dispatch,
  onOpenFeature,
  onConfigure,
}: Props) {
  const scopeKey = state.config ? ticketProjectKey(state.config) : '';
  const [filters, setFilters] = useState<TicketFilters>(() =>
    structuredClone(state.ticketFilters ?? defaultTicketFilters),
  );
  const [modal, setModal] = useState<{ ticketId: number; kind: 'detail' | 'prepare' } | null>(null);
  const autoSearch = useRef('');
  useEffect(() => {
    setFilters(structuredClone(state.ticketFilters ?? defaultTicketFilters));
    setModal(null);
    autoSearch.current = '';
  }, [scopeKey]);
  useEffect(() => {
    if (!active) setModal(null);
  }, [active]);
  useEffect(() => {
    if (
      active &&
      state.authenticated &&
      scopeKey &&
      !state.busy &&
      !state.ticketSearch &&
      autoSearch.current !== scopeKey
    ) {
      autoSearch.current = scopeKey;
      dispatch({
        type: 'devopsSearchTickets',
        sourceProjectKey: scopeKey,
        filters: state.ticketFilters ?? defaultTicketFilters,
      });
    }
  }, [active, state.authenticated, state.busy, scopeKey, state.ticketSearch]);
  useEffect(() => {
    if (state.ticketPreparation?.sourceProjectKey === scopeKey)
      setModal({ ticketId: state.ticketPreparation.ticketId, kind: 'prepare' });
  }, [state.ticketPreparation?.snapshotId]);
  const search = state.ticketSearch;
  const ready = Boolean(state.authenticated && scopeKey);
  const edit = (patch: Partial<TicketFilters>) => setFilters((old) => ({ ...old, ...patch }));
  const runSearch = (next = filters) => {
    setModal(null);
    dispatch({
      type: 'devopsSearchTickets',
      sourceProjectKey: scopeKey,
      filters: { ...next, tags: next.tags.map((tag) => tag.trim()).filter(Boolean) },
    });
  };
  const linksFor = (id: number) =>
    state.links.filter(
      (link) =>
        link.ticketId === id &&
        ticketLinkProjectKey(link) === scopeKey &&
        features.some((feature) => feature.id === link.featureId),
    );
  const prepare = (id: number) => {
    setModal({ ticketId: id, kind: 'prepare' });
    dispatch({ type: 'devopsPrepareTicket', ticketId: id, sourceProjectKey: scopeKey });
  };
  const typeOptions = state.ticketMetadata?.types ?? [];
  const states = [
    ...new Set(
      typeOptions
        .filter((type) => !filters.types.length || filters.types.includes(type.name))
        .flatMap((type) => type.states),
    ),
  ].sort();
  const detail = state.ticketDetail?.id === modal?.ticketId ? state.ticketDetail : undefined;
  const preparation =
    state.ticketPreparation &&
    state.ticketPreparation.ticketId === modal?.ticketId &&
    state.ticketPreparation.snapshotId === detail?.snapshotId
      ? state.ticketPreparation
      : undefined;
  const detailError =
    state.ticketDetailError && state.ticketDetailError.ticketId === modal?.ticketId
      ? state.ticketDetailError.message
      : undefined;
  if (!active) return null;
  return (
    <div className="devops-panel devops-dashboard devops-dashboard-tickets tickets-panel">
      <header className="tickets-heading">
        <div>
          <span className="devops-eyebrow">
            <Tickets size={14} /> AZURE DEVOPS · {state.config?.project || 'TON PROJET'}
          </span>
          <h1>Tes tickets, au clair.</h1>
          <p>Explore le projet, choisis le bon contexte et prépare ta prochaine session.</p>
          <p className="devops-muted">
            {state.config
              ? `${state.config.organization} / ${state.config.project} · Tickets de tout le projet`
              : 'Configure ton projet pour commencer.'}
          </p>
        </div>
        <button onClick={onConfigure}>
          Configuration <ArrowUpRight size={14} />
        </button>
      </header>
      {!ready ? (
        <section className="devops-empty">
          <Tickets size={30} />
          <h2>
            {state.config ? 'Connecte ton compte pour démarrer' : 'Ton dashboard attend son projet'}
          </h2>
          <p>La connexion donne accès aux tickets du projet, quel que soit leur type.</p>
          <button onClick={onConfigure}>
            {state.config ? 'Ouvrir la connexion' : 'Configurer Azure DevOps'}
          </button>
        </section>
      ) : (
        <>
          <form
            className="ticket-search-form"
            aria-label="Recherche Azure DevOps"
            onSubmit={(event) => {
              event.preventDefault();
              runSearch();
            }}
          >
            <div className="ticket-search-main">
              <label>
                Rechercher un ticket
                <div className="ticket-search-input">
                  <Search size={17} />
                  <input
                    type="search"
                    maxLength={500}
                    value={filters.query}
                    onChange={(event) => edit({ query: event.target.value })}
                    placeholder="Numéro ou texte du titre…"
                  />
                </div>
              </label>
              <button className="primary" type="submit" disabled={state.busy}>
                <Search size={15} /> Rechercher
              </button>
              <button
                type="button"
                disabled={state.busy}
                onClick={() => runSearch(search?.filters ?? filters)}
                title="Relancer la dernière recherche"
              >
                <RefreshCw size={15} /> Actualiser
              </button>
            </div>
            <div className="ticket-shortcuts" aria-label="Raccourcis d’assignation">
              {(
                [
                  ['me', 'Mes tickets'],
                  ['unassigned', 'Non assignés'],
                  ['all', 'Tous'],
                ] as const
              ).map(([assignment, label]) => (
                <button
                  type="button"
                  key={assignment}
                  aria-pressed={filters.assignment === assignment}
                  disabled={state.busy}
                  onClick={() => {
                    const next = { ...filters, assignment };
                    setFilters(next);
                    runSearch(next);
                  }}
                >
                  {label}
                </button>
              ))}
              <span>Recherche enregistrée par projet</span>
            </div>
            <div className="ticket-filter-grid">
              <label>
                Type
                <select
                  aria-label="Type de ticket"
                  value={filters.types[0] ?? ''}
                  onChange={(event) =>
                    edit({ types: event.target.value ? [event.target.value] : [], states: [] })
                  }
                >
                  <option value="">Tous les types</option>
                  {[...new Set([...typeOptions.map((type) => type.name), ...filters.types])].map(
                    (name) => (
                      <option key={name}>{name}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                État
                <select
                  aria-label="État du ticket"
                  value={filters.states[0] ?? ''}
                  onChange={(event) =>
                    edit({ states: event.target.value ? [event.target.value] : [] })
                  }
                >
                  <option value="">Tous les états</option>
                  {[...new Set([...states, ...filters.states])].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Assignation
                <select
                  value={filters.assignment}
                  onChange={(event) =>
                    edit({ assignment: event.target.value as TicketFilters['assignment'] })
                  }
                >
                  <option value="me">Moi</option>
                  <option value="unassigned">Non assignés</option>
                  <option value="all">Tout le monde</option>
                  <option value="identity">Une autre personne</option>
                </select>
              </label>
              {filters.assignment === 'identity' && (
                <label>
                  Identité Azure DevOps
                  <input
                    required
                    maxLength={500}
                    value={filters.identity}
                    onChange={(event) => edit({ identity: event.target.value })}
                    placeholder="Nom ou adresse du compte"
                  />
                </label>
              )}
              <label>
                Tags
                <input
                  maxLength={2000}
                  value={filters.tags.join(';')}
                  onChange={(event) =>
                    edit({
                      tags: event.target.value.split(';'),
                    })
                  }
                  placeholder="UX ; navigation"
                />
              </label>
              <label>
                Zone
                <input
                  maxLength={500}
                  list="ticket-areas"
                  value={filters.areaPath}
                  onChange={(event) => edit({ areaPath: event.target.value })}
                  placeholder="Toutes les zones"
                />
                <datalist id="ticket-areas">
                  {state.ticketMetadata?.areas.map((area) => (
                    <option key={area} value={area} />
                  ))}
                </datalist>
              </label>
              <label>
                Sprint / itération
                <input
                  maxLength={500}
                  list="ticket-iterations"
                  value={filters.iterationPath}
                  onChange={(event) => edit({ iterationPath: event.target.value })}
                  placeholder="Toutes les itérations"
                />
                <datalist id="ticket-iterations">
                  {state.ticketMetadata?.iterations.map((iteration) => (
                    <option key={iteration} value={iteration} />
                  ))}
                </datalist>
              </label>
            </div>
            <div className="ticket-filter-footer">
              <p>
                Les filtres sont combinés dans Azure DevOps. Zones et itérations incluent leurs
                sous-chemins.
              </p>
              <button
                type="button"
                disabled={state.busy}
                onClick={() => {
                  const next = structuredClone(defaultTicketFilters);
                  setFilters(next);
                  runSearch(next);
                }}
              >
                <FilterX size={14} /> Réinitialiser
              </button>
            </div>
          </form>
          {state.ticketMetadata?.notices.length ? (
            <details className="ticket-metadata-notices">
              <summary>
                Informations sur les filtres ({state.ticketMetadata.notices.length})
              </summary>
              {state.ticketMetadata.notices.map((notice, index) => (
                <p key={index}>{notice}</p>
              ))}
            </details>
          ) : null}
          {state.error && (
            <div className="devops-error" role="alert">
              <strong>Cette opération n’a pas abouti</strong>
              <p>{state.error}</p>
            </div>
          )}
          <div className="ticket-results-header">
            <h2>
              {search
                ? `${search.tickets.length} ticket${search.tickets.length > 1 ? 's' : ''} chargé${search.tickets.length > 1 ? 's' : ''}`
                : 'Tickets du projet'}
            </h2>
            <p role="status">
              {state.busy ? (
                <>
                  <LoaderCircle size={14} className="ticket-spinner" /> Chargement…
                </>
              ) : search?.searchedAt ? (
                `N° décroissant · ${devOpsDate(search.searchedAt)}`
              ) : (
                'Recherche en attente'
              )}
            </p>
          </div>
          {search && JSON.stringify(filters) !== JSON.stringify(search.filters) && (
            <p className="devops-notice">
              Filtres modifiés : clique sur Rechercher pour les appliquer à la liste.
            </p>
          )}
          {search?.tickets.length ? (
            <div className="ticket-list" aria-label="Résultats des tickets">
              <div className="ticket-list-heading" aria-hidden="true">
                <span>Ticket / type</span>
                <span>Titre</span>
                <span>État</span>
                <span>Responsable</span>
                <span>Modifié</span>
                <span>Actions</span>
              </div>
              {search.tickets.map((ticket) => {
                const links = linksFor(ticket.id);
                return (
                  <article
                    key={ticket.id}
                    className="ticket-list-row"
                    aria-label={`Ticket ${ticket.id}`}
                  >
                    <div className="ticket-id-type">
                      <strong>#{ticket.id}</strong>
                      <span>{ticket.workItemType || 'Type inconnu'}</span>
                    </div>
                    <div className="ticket-title">
                      <strong>{ticket.title}</strong>
                      {links.length > 0 && (
                        <span className="ticket-session-badge">
                          <Link2 size={12} /> Session existante
                        </span>
                      )}
                      {ticket.tags?.length ? <small>{ticket.tags.join(' · ')}</small> : null}
                    </div>
                    <span className="devops-tag ticket-state">
                      {ticket.state || 'État inconnu'}
                    </span>
                    <span className="ticket-assignee">{ticket.assignedTo || 'Non assigné'}</span>
                    <time className="ticket-date">{devOpsDate(ticket.changedDate)}</time>
                    <div className="ticket-row-actions">
                      <button
                        className="icon-button"
                        aria-label={`Voir le détail du ticket ${ticket.id}`}
                        title="Voir le détail"
                        disabled={state.busy}
                        onClick={() => {
                          setModal({ ticketId: ticket.id, kind: 'detail' });
                          dispatch({ type: 'devopsLoadTicket', ticketId: ticket.id });
                        }}
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`${links.length ? 'Reprendre la session du' : 'Préparer le développement du'} ticket ${ticket.id}`}
                        title={links.length ? 'Reprendre la session' : 'Préparer le développement'}
                        disabled={state.busy}
                        onClick={() => prepare(ticket.id)}
                      >
                        {links.length ? <ArrowUpRight size={18} /> : <Code2 size={18} />}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <section className="devops-empty">
              <Tickets size={28} />
              <h3>
                {state.busy
                  ? 'Recherche en cours'
                  : search?.error
                    ? 'La recherche est indisponible'
                    : search?.searchedAt
                      ? 'Aucun résultat pour ces filtres'
                      : 'Recherche dans tout le projet'}
              </h3>
              <p>
                {search?.error
                  ? 'Réessaie la recherche ou vérifie la connexion.'
                  : 'Choisis une assignation et combine les filtres pour trouver les tickets qui t’intéressent.'}
              </p>
            </section>
          )}
          {search && (
            <div className="ticket-pagination">
              <p>
                {search.limitReached
                  ? 'Limite de 1 000 tickets chargés : précise tes filtres pour continuer.'
                  : search.hasMore
                    ? 'Liste partielle : d’autres tickets correspondent à cette recherche.'
                    : search.searchedAt
                      ? 'Tous les résultats de cette recherche ont été parcourus.'
                      : ''}
                {search.omitted > 0
                  ? ` ${search.omitted} ticket(s) n’ont pas pu être lus (droits ou suppression).`
                  : ''}
              </p>
              {search.hasMore && !search.limitReached && (
                <button
                  disabled={state.busy}
                  onClick={() =>
                    dispatch({
                      type: 'devopsSearchTickets',
                      sourceProjectKey: scopeKey,
                      filters: search.filters,
                      more: true,
                    })
                  }
                >
                  Charger les 50 suivants
                </button>
              )}
            </div>
          )}
        </>
      )}
      {modal && (
        <StudioDialog
          title={
            modal.kind === 'prepare'
              ? `Préparer le développement · #${modal.ticketId}`
              : `Détail du ticket · #${modal.ticketId}`
          }
          subtitle={
            modal.kind === 'prepare'
              ? 'Prépare le contexte et le dépôt. Tu choisiras l’équipe dans la session.'
              : 'Les informations sont lues dans Azure DevOps ; aucune modification du ticket.'
          }
          className="ticket-dialog"
          onClose={() => setModal(null)}
        >
          {detailError ? (
            <div className="devops-error" role="alert">
              <p>{detailError}</p>
              <button
                disabled={state.busy}
                onClick={() =>
                  modal.kind === 'prepare'
                    ? prepare(modal.ticketId)
                    : dispatch({ type: 'devopsLoadTicket', ticketId: modal.ticketId })
                }
              >
                Réessayer le chargement
              </button>
            </div>
          ) : !detail || (modal.kind === 'prepare' && !preparation) ? (
            <p role="status">
              {state.busy
                ? 'Chargement du ticket et des dépôts disponibles…'
                : state.error || 'Informations non chargées.'}
            </p>
          ) : modal.kind === 'detail' ? (
            <>
              <TicketDetail ticket={detail} />
              <div className="ticket-dialog-footer">
                <a href={detail.url} target="_blank" rel="noreferrer">
                  Ouvrir dans Azure DevOps <ArrowUpRight size={14} />
                </a>
                <button
                  className="primary"
                  disabled={state.busy}
                  onClick={() => prepare(detail.id)}
                >
                  <Code2 size={16} />{' '}
                  {linksFor(detail.id).length
                    ? 'Reprendre la session'
                    : 'Préparer le développement'}
                </button>
              </div>
            </>
          ) : (
            <TicketPreparationForm
              key={preparation!.snapshotId}
              ticket={detail}
              preparation={preparation!}
              state={state}
              dispatch={dispatch}
              onClose={() => setModal(null)}
            />
          )}
        </StudioDialog>
      )}
    </div>
  );
}

function TicketDetail({ ticket }: { ticket: DevOpsTicket }) {
  return (
    <div className="ticket-detail-content">
      <h3>{ticket.title}</h3>
      <div className="ticket-detail-meta">
        {[
          ['Type', ticket.workItemType],
          ['État', ticket.state],
          ['Assignation', ticket.assignedTo || 'Non assigné'],
          ['Zone', ticket.areaPath],
          ['Itération', ticket.iterationPath],
          ['Créé', devOpsDate(ticket.createdDate)],
          ['Modifié', devOpsDate(ticket.changedDate)],
          ['Révision', String(ticket.revision)],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value || 'Non renseigné'}</strong>
          </div>
        ))}
      </div>
      {ticket.tags?.length ? (
        <p className="devops-tags">
          {ticket.tags.map((tag) => (
            <span key={tag} className="devops-tag">
              {tag}
            </span>
          ))}
        </p>
      ) : null}
      <section>
        <h4>Description</h4>
        <pre className="devops-text">
          {devOpsPlainText(ticket.description) || 'Aucune description renseignée.'}
        </pre>
      </section>
      <section>
        <h4>Critères d’acceptation</h4>
        <pre className="devops-text">
          {devOpsPlainText(ticket.acceptanceCriteria) || 'Aucun critère d’acceptation renseigné.'}
        </pre>
      </section>
      {(ticket.extraFields ?? [])
        .filter((field) => field.referenceName === 'Microsoft.VSTS.TCM.ReproSteps')
        .map((field) => (
          <section key={field.referenceName}>
            <h4>Étapes de reproduction</h4>
            <pre className="devops-text">{devOpsPlainText(field.value)}</pre>
          </section>
        ))}
      <details>
        <summary>
          Autres champs du ticket (
          {
            (ticket.extraFields ?? []).filter(
              (field) => field.referenceName !== 'Microsoft.VSTS.TCM.ReproSteps',
            ).length
          }
          )
        </summary>
        <dl className="ticket-extra-fields">
          {(ticket.extraFields ?? [])
            .filter((field) => field.referenceName !== 'Microsoft.VSTS.TCM.ReproSteps')
            .map((field) => (
              <div key={field.referenceName}>
                <dt>{field.name}</dt>
                <dd>
                  <pre className="devops-text">{devOpsPlainText(field.value)}</pre>
                </dd>
              </div>
            ))}
        </dl>
      </details>
      {ticket.detailNotices?.map((notice, index) => (
        <p className="devops-notice" key={index}>
          {notice}
        </p>
      ))}
      <section>
        <h4>Commentaires {ticket.commentsLoaded ? `(${ticket.comments.length})` : ''}</h4>
        <CommentNotices ticket={ticket} />
        {ticket.comments.map((comment) => (
          <article className="ticket-comment" key={comment.id}>
            <strong>{comment.author || 'Auteur inconnu'}</strong>
            <time>
              {devOpsDate(comment.createdDate)}
              {comment.modifiedDate && comment.modifiedDate !== comment.createdDate
                ? ` · modifié ${devOpsDate(comment.modifiedDate)}`
                : ''}
            </time>
            <pre className="devops-text">{devOpsPlainText(comment.text)}</pre>
          </article>
        ))}
      </section>
      <section>
        <h4>Liens et pièces jointes ({ticket.relations?.length ?? 0})</h4>
        {ticket.relations?.length ? (
          <ul className="ticket-relations">
            {ticket.relations.map((relation, index) => (
              <li key={index}>
                {relation.url ? (
                  <a href={relation.url} target="_blank" rel="noreferrer">
                    {relation.name} <ArrowUpRight size={13} />
                  </a>
                ) : (
                  <span>
                    {relation.name} · {relation.reference}
                  </span>
                )}
                <small>
                  {relation.kind === 'attachment'
                    ? 'Pièce jointe · contenu non importé'
                    : relation.kind === 'pr'
                      ? 'Pull request'
                      : relation.kind === 'ticket'
                        ? 'Ticket lié'
                        : 'Référence'}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>Aucun lien renseigné.</p>
        )}
      </section>
      <p className="devops-muted">
        Copie lue le {devOpsDate(ticket.fetchedAt)}. Le contenu HTML est présenté en texte sûr.
      </p>
    </div>
  );
}
function CommentNotices({ ticket }: { ticket: DevOpsTicket }) {
  return (
    <>
      {ticket.commentsError ? (
        <p className="devops-error" role="alert">
          Commentaires indisponibles ou partiels : {ticket.commentsError}
        </p>
      ) : !ticket.commentsLoaded ? (
        <p>Commentaires non chargés.</p>
      ) : !ticket.comments.length ? (
        <p>Aucun commentaire.</p>
      ) : null}
      {ticket.commentsTruncated && (
        <p className="devops-notice">
          Commentaires partiels : les 200 plus récents sont proposés. Consulte le ticket pour la
          suite.
        </p>
      )}
    </>
  );
}
function TicketPreparationForm({
  ticket,
  preparation,
  state,
  dispatch,
  onClose,
}: {
  ticket: DevOpsTicket;
  preparation: TicketPreparation;
  state: DevOpsState;
  dispatch: DevOpsUIProps['dispatch'];
  onClose: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(`#${ticket.id} — ${ticket.title}`.slice(0, 500));
  const [targetId, setTargetId] = useState(preparation.targets[0]?.id ?? '');
  const target = preparation.targets.find((item) => item.id === targetId);
  const [isolated, setIsolated] = useState(Boolean(target?.canIsolate));
  const initialBranch =
    target?.branches.find((branch) => branch.ref === `refs/heads/${target.branch}`) ??
    target?.branches[0];
  const [baseRef, setBaseRef] = useState(initialBranch?.ref ?? '');
  const [branchName, setBranchName] = useState(ticketBranchName(ticket));
  const [instructions, setInstructions] = useState('');
  const [commentIds, setCommentIds] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const result =
    state.ticketCreateResult?.requestId === requestId ? state.ticketCreateResult : undefined;
  useEffect(() => {
    if (result) setPending(false);
  }, [result]);
  const branch = target?.branches.find((item) => item.ref === baseRef);
  const disabled = state.busy || pending;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !target) return;
        setPending(true);
        dispatch({
          type: 'devopsCreateFeature',
          ticketId: ticket.id,
          plan: {
            requestId,
            sourceProjectKey: preparation.sourceProjectKey,
            snapshotId: preparation.snapshotId,
            targetProjectId: target.id,
            title,
            isolated,
            ...(isolated ? { baseRef, baseCommit: branch?.commit, branchName } : {}),
            commentIds,
            instructions,
          },
        });
      }}
    >
      <div className="ticket-preparation-grid">
        <div className="ticket-preparation-options">
          <div className="ticket-source-pill">
            <Tickets size={17} />
            <div>
              <strong>
                #{ticket.id} · {ticket.title}
              </strong>
              <small>
                {preparation.sourceProjectKey} · révision {ticket.revision} ·{' '}
                {devOpsDate(ticket.fetchedAt)}
              </small>
            </div>
          </div>
          <label>
            Titre de la session
            <input
              required
              maxLength={500}
              value={title}
              disabled={disabled}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Dépôt local cible
            <select
              value={targetId}
              disabled={disabled}
              onChange={(event) => {
                const next = preparation.targets.find((item) => item.id === event.target.value)!;
                setTargetId(next.id);
                setIsolated(next.canIsolate);
                setBaseRef(
                  (
                    next.branches.find((branch) => branch.ref === `refs/heads/${next.branch}`) ??
                    next.branches[0]
                  )?.ref ?? '',
                );
              }}
            >
              {preparation.targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <small>{target?.path}</small>
          </label>
          <fieldset className="ticket-space-choice">
            <legend>
              <GitBranch size={14} /> Espace de développement
            </legend>
            <label>
              <input
                type="radio"
                name="ticket-space"
                disabled={disabled || !target?.canIsolate}
                checked={isolated}
                onChange={() => setIsolated(true)}
              />{' '}
              Worktree isolé <span>Recommandé</span>
            </label>
            <label>
              <input
                type="radio"
                name="ticket-space"
                disabled={disabled}
                checked={!isolated}
                onChange={() => setIsolated(false)}
              />{' '}
              Dossier courant
            </label>
          </fieldset>
          {isolated ? (
            <>
              <label>
                Branche de départ
                <select
                  required
                  value={baseRef}
                  disabled={disabled}
                  onChange={(event) => setBaseRef(event.target.value)}
                >
                  {target?.branches.map((branch) => (
                    <option key={branch.ref} value={branch.ref}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                <small>
                  Commit sélectionné : {branch?.commit.slice(0, 12)} · références déjà présentes
                  localement
                </small>
              </label>
              <label>
                Nouvelle branche
                <input
                  required
                  maxLength={200}
                  value={branchName}
                  disabled={disabled}
                  onChange={(event) => setBranchName(event.target.value)}
                />
              </label>
              <p className="devops-notice">
                Un dossier et une branche dédiés seront créés à partir de ce commit. Les changements
                non commités restent dans le dossier source.
              </p>
            </>
          ) : (
            <p className="devops-notice">
              La session utilisera les fichiers et les changements présents dans {target?.name}, sur
              la branche {target?.branch}.
              {target?.dirtyCount !== undefined
                ? ` ${target.dirtyCount} fichier(s) modifié(s) ou non suivi(s).`
                : ''}
              {target?.isolationReason ? ` Worktree indisponible : ${target.isolationReason}` : ''}
            </p>
          )}
          <label>
            Consignes complémentaires
            <textarea
              maxLength={10000}
              rows={4}
              value={instructions}
              disabled={disabled}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Précisions, contraintes et points d’attention pour l’équipe…"
            />
          </label>
        </div>
        <div className="ticket-import-options">
          <h3>Contexte transmis aux agents</h3>
          <p>
            La description, les critères, les champs utiles et les liens seront copiés. Les pièces
            jointes restent des liens.
          </p>
          <details className="ticket-comment-picker" open={ticket.comments.length > 0}>
            <summary>
              Commentaires à importer · {commentIds.length} sélectionné
              {commentIds.length > 1 ? 's' : ''}
            </summary>
            <CommentNotices ticket={ticket} />
            {ticket.comments.length > 0 && (
              <div className="devops-actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setCommentIds(ticket.comments.map((comment) => comment.id))}
                >
                  Tout sélectionner
                </button>
                <button type="button" disabled={disabled} onClick={() => setCommentIds([])}>
                  Tout retirer
                </button>
              </div>
            )}
            {ticket.comments.map((comment) => (
              <label key={comment.id}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={commentIds.includes(comment.id)}
                  onChange={(event) =>
                    setCommentIds((ids) =>
                      event.target.checked
                        ? [...ids, comment.id]
                        : ids.filter((id) => id !== comment.id),
                    )
                  }
                />
                <span>
                  <strong>
                    {comment.author || 'Auteur inconnu'} · {devOpsDate(comment.createdDate)}
                  </strong>
                  <pre className="devops-text">{devOpsPlainText(comment.text)}</pre>
                </span>
              </label>
            ))}
          </details>
          <details className="ticket-context-preview" open>
            <summary>Aperçu exact de la copie importée</summary>
            <pre className="devops-text" aria-label="Contexte qui sera importé">
              {ticketContext(ticket, commentIds, instructions)}
            </pre>
          </details>
        </div>
      </div>
      {result?.error && (
        <div className="devops-error" role="alert">
          {result.error}
        </div>
      )}
      <div className="ticket-dialog-footer">
        <p>La session sera créée sans équipe. Tu choisiras les agents avant de lancer.</p>
        <div className="devops-actions">
          <button type="button" disabled={disabled} onClick={onClose}>
            Annuler
          </button>
          <button
            className="primary"
            type="submit"
            disabled={
              disabled || !title.trim() || !target || (isolated && (!branch || !branchName.trim()))
            }
          >
            {pending ? <LoaderCircle size={16} className="ticket-spinner" /> : <Code2 size={16} />}{' '}
            Créer la session
          </button>
        </div>
      </div>
    </form>
  );
}
export function TicketSourceCard({ feature }: { feature: Feature }) {
  const source = feature.ticketSource;
  if (!source) return null;
  return (
    <details className="ticket-source-archive">
      <summary>
        <Tickets size={15} /> Ticket #{source.ticketId} · copie importée, révision {source.revision}
      </summary>
      <p>
        <a href={source.url} target="_blank" rel="noreferrer">
          {source.title}
        </a>{' '}
        · importé le {devOpsDate(source.importedAt)}
      </p>
      <p className="devops-muted">
        Cette copie conserve le contexte initial, indépendamment des modifications du besoin et du
        ticket distant.
      </p>
      <pre className="devops-text">{source.context}</pre>
    </details>
  );
}
