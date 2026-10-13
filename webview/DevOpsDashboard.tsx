import { useEffect, useState } from 'react';
import {
  GitPullRequest,
  Tickets,
  Search,
  RefreshCw,
  Link2,
  Sparkles,
  FilterX,
  ArrowUpRight,
} from 'lucide-react';
import type { DevOpsState, DevOpsTicket, DevOpsPullRequest } from '../src/shared/devops';
import {
  PullRequestCard,
  TicketCard,
  devOpsDate,
  devOpsPrStatus,
  type DevOpsUIProps,
} from './DevOpsUI';

type Kind = 'prs' | 'tickets';
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const time = (value?: string) =>
  value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
export function DevOpsDashboard({
  active,
  kind,
  state,
  features,
  dispatch,
  onOpenFeature,
  onConfigure,
}: {
  active: boolean;
  kind: Kind;
  state: DevOpsState;
  features: DevOpsUIProps['features'];
  dispatch: DevOpsUIProps['dispatch'];
  onOpenFeature: DevOpsUIProps['onOpenFeature'];
  onConfigure: () => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [linked, setLinked] = useState('all');
  const [sort, setSort] = useState('recent');
  const prs = kind === 'prs';
  const scopeKey = state.config
    ? `${state.config.organization}/${state.config.project}/${state.config.repository}`.toLowerCase()
    : '';
  useEffect(() => {
    setQuery('');
    setStatus('all');
    setLinked('all');
    setSort('recent');
  }, [scopeKey]);
  const scopeLinks = state.links.filter((link) => link.projectKey === scopeKey);
  const items: (DevOpsTicket | DevOpsPullRequest)[] = prs ? state.pullRequests : state.tickets;
  const itemLinks = (id: number) =>
    scopeLinks.filter((link) => (prs ? link.pullRequestIds.includes(id) : link.ticketId === id));
  const itemState = (item: DevOpsTicket | DevOpsPullRequest) =>
    'status' in item ? item.status : item.state;
  const itemDate = (item: DevOpsTicket | DevOpsPullRequest) =>
    'status' in item ? item.creationDate : item.changedDate || item.createdDate;
  const states = [...new Set(items.map(itemState))].sort((a, b) => a.localeCompare(b, 'fr'));
  const reset = () => {
    setQuery('');
    setStatus('all');
    setLinked('all');
    setSort('recent');
  };
  const filtered = items
    .filter((item) => {
      const search =
        'status' in item
          ? `${item.id} ${item.title} ${item.sourceBranch} ${item.targetBranch} ${item.createdBy ?? ''}`
          : `${item.id} ${item.title} ${item.tags?.join(' ') ?? ''} ${item.assignedTo ?? ''} ${item.workItemType ?? ''}`;
      return (
        normalize(search).includes(normalize(query.trim())) &&
        (status === 'all' || itemState(item) === status) &&
        (linked === 'all' || (linked === 'linked') === Boolean(itemLinks(item.id).length))
      );
    })
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'fr') || b.id - a.id
        : sort === 'number'
          ? b.id - a.id
          : time(itemDate(b)) - time(itemDate(a)) || b.id - a.id,
    );
  const Icon = prs ? GitPullRequest : Tickets;
  const received = Boolean(state.refreshedAt || items.length);
  const count = (value: number) => (received ? value : '—');
  const linkedCount = items.filter((item) => itemLinks(item.id).length).length;
  const drafts = state.pullRequests.filter((pr) => pr.isDraft).length;
  const ready = Boolean(state.config && state.authenticated);
  const hasFilters = Boolean(query || status !== 'all' || linked !== 'all' || sort !== 'recent');
  if (!active) return null;
  return (
    <div
      className={`devops-panel devops-dashboard ${prs ? 'devops-dashboard-prs' : 'devops-dashboard-tickets'}`}
    >
      <header className="devops-hero">
        <div className="devops-hero-copy">
          <span className="devops-eyebrow">
            <Sparkles size={13} aria-hidden="true" /> AZURE DEVOPS ·{' '}
            {state.config?.project || 'TON ATELIER'}
          </span>
          <h1>{prs ? 'Tes PR, en mouvement.' : 'Tes tickets, au clair.'}</h1>
          <p>
            {prs
              ? 'Les branches, les revues et les features qui les font avancer.'
              : 'Les détails, les échanges et la prochaine feature à construire.'}
          </p>
          <div className="devops-hero-scope">
            <span className="devops-tag">
              {state.authenticated ? 'Compte connecté' : 'Compte non connecté'}
            </span>
            {state.config?.repository && <span>{state.config.repository}</span>}
          </div>
        </div>
        <div className="devops-hero-art" aria-hidden="true">
          <i />
          <span>
            <Icon size={38} strokeWidth={1.5} />
          </span>
          <i />
          <span className="devops-art-link">
            <Link2 size={17} />
          </span>
        </div>
      </header>
      <div className="devops-dashboard-toolbar">
        <p className="devops-muted">
          {state.refreshedAt
            ? `Actualisé le ${devOpsDate(state.refreshedAt)}.`
            : 'Aucune actualisation reçue.'}
        </p>
        <div className="devops-actions">
          <button onClick={onConfigure}>Configuration</button>
          <button
            disabled={state.busy || !ready}
            onClick={() => dispatch({ type: 'devopsRefresh' })}
          >
            <RefreshCw size={14} aria-hidden="true" /> Actualiser
          </button>
        </div>
      </div>
      {state.busy && (
        <p className="devops-notice" role="status">
          Actualisation ou opération en cours… Les données déjà reçues restent affichées.
        </p>
      )}
      {state.error && (
        <div className="devops-error" role="alert">
          <strong>Azure DevOps a rencontré un problème</strong>
          <p>{state.error}</p>
          <p>Vérifie la connexion ou réessaie avec Actualiser.</p>
        </div>
      )}
      {state.notices.map((notice, i) => (
        <p className="devops-notice" key={i}>
          {notice}
        </p>
      ))}
      {state.truncated && (
        <p className="devops-notice">
          Liste partielle : jusqu’à 200 tickets et 200 PR. Les compteurs et filtres portent sur les
          éléments reçus.
        </p>
      )}
      {!ready ? (
        <section className="devops-empty">
          <Icon size={30} aria-hidden="true" />
          <h2>
            {state.config ? 'Connecte ton compte pour démarrer' : 'Ton dashboard attend son projet'}
          </h2>
          <p>
            {state.config
              ? 'La connexion Azure DevOps permet de charger tes tickets assignés et tes PR créées.'
              : 'Renseigne l’organisation, le projet et le dépôt dans Azure DevOps.'}
          </p>
          <button onClick={onConfigure}>
            {state.config ? 'Ouvrir la connexion' : 'Configurer Azure DevOps'}{' '}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </section>
      ) : (
        <>
          <section
            className="devops-stats"
            aria-label={`Statistiques ${prs ? 'PR' : 'tickets'} reçues`}
          >
            <div>
              <Icon size={18} aria-hidden="true" />
              <strong>{count(items.length)}</strong>
              <span>{prs ? 'PR reçues' : 'Tickets reçus'}</span>
            </div>
            <div>
              <Link2 size={18} aria-hidden="true" />
              <strong>{count(linkedCount)}</strong>
              <span>Avec une feature</span>
            </div>
            <div>
              <Sparkles size={18} aria-hidden="true" />
              <strong>{count(prs ? drafts : states.length)}</strong>
              <span>{prs ? 'Brouillons' : 'États présents'}</span>
            </div>
            <div>
              <Search size={18} aria-hidden="true" />
              <strong>{count(items.length - linkedCount)}</strong>
              <span>Sans feature</span>
            </div>
          </section>
          <section className="devops-filters" aria-label="Filtres du dashboard">
            <label className="devops-search">
              {prs ? 'Rechercher une PR' : 'Rechercher un ticket'}
              <span>
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder={prs ? 'Numéro, titre, branche…' : 'Numéro, titre, tag…'}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </span>
            </label>
            <label>
              État
              <select aria-label="État" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">Tous les états</option>
                {status !== 'all' && !states.includes(status) && (
                  <option value={status}>
                    {prs ? devOpsPrStatus(status) : status} (aucun élément)
                  </option>
                )}
                {states.map((value) => (
                  <option value={value} key={value}>
                    {prs ? devOpsPrStatus(value) : value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lien feature
              <select
                aria-label="Lien feature"
                value={linked}
                onChange={(e) => setLinked(e.target.value)}
              >
                <option value="all">Tous les liens</option>
                <option value="linked">Avec une feature</option>
                <option value="unlinked">Sans feature</option>
              </select>
            </label>
            <label>
              Trier par
              <select aria-label="Trier par" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="recent">{prs ? 'Création récente' : 'Modification récente'}</option>
                <option value="number">Numéro décroissant</option>
                <option value="title">Titre A → Z</option>
              </select>
            </label>
            <button disabled={!hasFilters} onClick={reset}>
              <FilterX size={14} aria-hidden="true" /> Réinitialiser
            </button>
          </section>
          <div className="devops-results-heading">
            <h2>{prs ? 'Mes PR créées' : 'Mes tickets assignés'}</h2>
            <p role="status">
              {received ? (
                <>
                  {filtered.length} / {items.length} affiché{filtered.length > 1 ? 's' : ''}
                </>
              ) : (
                'Données non chargées'
              )}
            </p>
          </div>
          {filtered.length ? (
            <div className="devops-dashboard-grid">
              {filtered.map((item) =>
                'status' in item ? (
                  <PullRequestCard
                    key={scopeKey + ':' + item.id}
                    pr={item}
                    links={itemLinks(item.id)}
                    tickets={state.tickets}
                    features={features}
                    busy={state.busy}
                    dispatch={dispatch}
                    onOpenFeature={onOpenFeature}
                    expanded
                  />
                ) : (
                  <TicketCard
                    key={scopeKey + ':' + item.id}
                    ticket={item}
                    links={itemLinks(item.id)}
                    features={features}
                    busy={state.busy}
                    dispatch={dispatch}
                    onOpenFeature={onOpenFeature}
                    expanded
                  />
                ),
              )}
            </div>
          ) : (
            <section className="devops-empty">
              <Icon size={28} aria-hidden="true" />
              <h3>
                {state.busy
                  ? 'Chargement en cours'
                  : hasFilters
                    ? 'Aucun résultat pour ces filtres'
                    : state.error
                      ? 'Les données ne sont pas disponibles'
                      : !state.refreshedAt
                        ? 'Charge tes premières données'
                        : prs
                          ? 'Aucune PR créée dans ce périmètre'
                          : 'Aucun ticket assigné dans ce périmètre'}
              </h3>
              <p>
                {hasFilters
                  ? 'Essaie une autre recherche ou réinitialise les filtres.'
                  : state.busy
                    ? 'Le dashboard se remplira à réception des données.'
                    : 'Actualise les données et vérifie le compte, le projet et le dépôt sélectionnés.'}
              </p>
              {hasFilters && <button onClick={reset}>Réinitialiser les filtres</button>}
            </section>
          )}
          {sort === 'recent' && items.some((item) => !time(itemDate(item))) && (
            <p className="devops-muted">
              Les éléments sans date connue apparaissent après les éléments datés, par numéro
              décroissant.
            </p>
          )}
        </>
      )}
    </div>
  );
}
