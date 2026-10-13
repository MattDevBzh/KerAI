import { useEffect, useState } from 'react';
import type {
  DevOpsClientMessage,
  DevOpsConfig,
  DevOpsState,
  DevOpsLink,
  DevOpsPullRequest,
  DevOpsTicket,
} from '../src/shared/devops';
import './devops.css';
import { devOpsPlainText } from '../src/shared/devopsText';
export interface DevOpsUIProps {
  state?: DevOpsState;
  features: Array<{ id: string; title: string }>;
  dispatch: (message: DevOpsClientMessage) => void;
  onOpenFeature: (id: string) => void;
  mode: 'dashboard' | 'delivery';
  visible?: boolean;
}
export function PullRequestCard({
  pr,
  links,
  tickets,
  features,
  busy,
  dispatch,
  onOpenFeature,
  expanded = false,
}: {
  expanded?: boolean;
  pr: DevOpsPullRequest;
  links: DevOpsLink[];
  tickets: DevOpsState['tickets'];
  features: DevOpsUIProps['features'];
  busy: boolean;
  dispatch: DevOpsUIProps['dispatch'];
  onOpenFeature: DevOpsUIProps['onOpenFeature'];
}) {
  const [featureId, setFeatureId] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [replaces, setReplaces] = useState<{ featureId: string; ticketId?: number }>();
  const cancel = () => {
    setReplaces(undefined);
    setFeatureId('');
    setTicketId('');
  };
  return (
    <article className="devops-card" aria-label={`PR ${pr.id}`}>
      <h3>
        <a href={pr.url} target="_blank" rel="noreferrer">
          #{pr.id} · {pr.title}
        </a>
      </h3>
      <p>
        <span className="devops-tag">
          {pr.isDraft ? 'Brouillon' : expanded ? devOpsPrStatus(pr.status) : pr.status}
        </span>{' '}
        {pr.sourceBranch.replace('refs/heads/', '')} → {pr.targetBranch.replace('refs/heads/', '')}
      </p>
      {expanded && (
        <>
          <dl className="devops-metadata">
            <div>
              <dt>Auteur</dt>
              <dd>{pr.createdBy || 'Non renseigné'}</dd>
            </div>
            <div>
              <dt>Créée</dt>
              <dd>{devOpsDate(pr.creationDate)}</dd>
            </div>
            {pr.closedDate && (
              <div>
                <dt>Clôturée</dt>
                <dd>{devOpsDate(pr.closedDate)}</dd>
              </div>
            )}
            <div>
              <dt>Calcul de fusion Azure</dt>
              <dd>{pr.mergeStatus ? devOpsMergeStatus(pr.mergeStatus) : 'Non renseigné'}</dd>
            </div>
          </dl>
          <details>
            <summary>Aperçu de la description</summary>
            <pre className="devops-text">
              {devOpsPlainText(pr.description ?? '') || 'Aucune description.'}
            </pre>
          </details>
          <details>
            <summary>Relecteurs ({pr.reviewers?.length ?? 'non renseignés'})</summary>
            {pr.reviewers?.length ? (
              <ul className="devops-reviewers">
                {pr.reviewers.map((reviewer) => (
                  <li key={reviewer.id}>
                    <strong>{reviewer.displayName}</strong>
                    <span>
                      {reviewer.isRequired ? 'Obligatoire · ' : ''}
                      {reviewVote(reviewer.vote)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Aucun relecteur renseigné.</p>
            )}
            <p className="devops-muted">
              Les votes sont indicatifs. Les politiques de validation sont à vérifier dans Azure
              DevOps.
            </p>
          </details>
        </>
      )}
      {links.map((link) => (
        <div className="devops-actions" key={link.featureId + String(link.ticketId)}>
          <button onClick={() => onOpenFeature(link.featureId)}>
            Feature {features.find((f) => f.id === link.featureId)?.title ?? link.featureId}
            {link.ticketId ? ` · ticket #${link.ticketId}` : ''}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setFeatureId(link.featureId);
              setTicketId(link.ticketId === undefined ? '' : String(link.ticketId));
              setReplaces({ featureId: link.featureId, ticketId: link.ticketId });
            }}
          >
            Modifier le lien
          </button>
          <button
            disabled={busy}
            onClick={() =>
              dispatch({
                type: 'devopsUnlinkPullRequest',
                pullRequestId: pr.id,
                featureId: link.featureId,
                ...(link.ticketId === undefined ? {} : { ticketId: link.ticketId }),
              })
            }
          >
            Retirer le lien PR
          </button>
        </div>
      ))}
      <form
        className="devops-pr-link"
        onSubmit={(event) => {
          event.preventDefault();
          if (!featureId) return;
          dispatch({
            type: 'devopsLinkPullRequest',
            pullRequestId: pr.id,
            featureId,
            ...(ticketId ? { ticketId: Number(ticketId) } : {}),
            ...(replaces ? { replaces } : {}),
          });
          cancel();
        }}
      >
        <label>
          Session feature pour la PR #{pr.id}
          <select
            value={featureId}
            disabled={busy || !features.length}
            onChange={(event) => setFeatureId(event.target.value)}
            required
          >
            <option value="">Choisir une feature…</option>
            {features.map((feature) => (
              <option key={feature.id} value={feature.id}>
                {feature.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ticket facultatif pour la PR #{pr.id}
          <select
            value={ticketId}
            disabled={busy}
            onChange={(event) => setTicketId(event.target.value)}
          >
            <option value="">Sans ticket</option>
            {tickets.map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                #{ticket.id} · {ticket.title}
              </option>
            ))}
            {ticketId && !tickets.some((ticket) => String(ticket.id) === ticketId) && (
              <option value={ticketId}>
                #{ticketId} · actualiser le ticket pour conserver ce choix
              </option>
            )}
          </select>
        </label>
        <div className="devops-actions">
          <button disabled={busy || !featureId} type="submit">
            {replaces ? 'Remplacer ce lien PR' : 'Lier cette PR'}
          </button>
          {replaces && (
            <button type="button" disabled={busy} onClick={cancel}>
              Annuler la modification
            </button>
          )}
        </div>
      </form>
    </article>
  );
}

export function devOpsPrStatus(status: string) {
  return (
    (
      { active: 'En cours', completed: 'Terminée', abandoned: 'Abandonnée' } as Record<
        string,
        string
      >
    )[status] ?? status
  );
}
function devOpsMergeStatus(status: string) {
  return (
    (
      {
        conflicts: 'Conflits détectés',
        succeeded: 'Aucun conflit détecté',
        queued: 'Calcul en attente',
        notSet: 'Non calculé',
        failure: 'Échec du calcul',
        rejected: 'Calcul rejeté',
      } as Record<string, string>
    )[status] ?? status
  );
}
export function devOpsDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Non renseignée';
  return new Date(value).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function reviewVote(vote: number) {
  return (
    (
      {
        10: 'Approuvé',
        5: 'Approuvé avec réserves',
        0: 'Sans vote',
        [-5]: 'En attente de l’auteur',
        [-10]: 'Refusé',
      } as Record<number, string>
    )[vote] ?? `Vote inconnu (${vote})`
  );
}
export function TicketCard({
  ticket,
  links,
  features,
  busy,
  dispatch,
  onOpenFeature,
  expanded = false,
}: {
  ticket: DevOpsTicket;
  links: DevOpsLink[];
  features: DevOpsUIProps['features'];
  busy: boolean;
  dispatch: DevOpsUIProps['dispatch'];
  onOpenFeature: DevOpsUIProps['onOpenFeature'];
  expanded?: boolean;
}) {
  return (
    <article className="devops-card" aria-label={`Ticket ${ticket.id}`}>
      <h3>
        <a href={ticket.url} target="_blank" rel="noreferrer">
          #{ticket.id} · {ticket.title}
        </a>
      </h3>
      <span className="devops-tag">{ticket.state}</span>
      {expanded && (
        <>
          <dl className="devops-metadata">
            <div>
              <dt>Type</dt>
              <dd>{ticket.workItemType || 'Non renseigné'}</dd>
            </div>
            <div>
              <dt>Assigné à</dt>
              <dd>{ticket.assignedTo || 'Non renseigné'}</dd>
            </div>
            <div>
              <dt>Modifié</dt>
              <dd>{devOpsDate(ticket.changedDate)}</dd>
            </div>
            {ticket.createdDate && (
              <div>
                <dt>Créé</dt>
                <dd>{devOpsDate(ticket.createdDate)}</dd>
              </div>
            )}
            {ticket.iterationPath && (
              <div>
                <dt>Itération</dt>
                <dd>{ticket.iterationPath}</dd>
              </div>
            )}
            {ticket.areaPath && (
              <div>
                <dt>Zone</dt>
                <dd>{ticket.areaPath}</dd>
              </div>
            )}
          </dl>
          {ticket.tags?.length ? (
            <div className="devops-tags" aria-label="Tags">
              {ticket.tags.map((tag, i) => (
                <span className="devops-tag" key={i}>
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <p className="devops-muted">Aucun tag renseigné.</p>
          )}
        </>
      )}
      <details>
        <summary>Description et critères d’acceptation</summary>
        <h4>Description</h4>
        <pre className="devops-text">
          {devOpsPlainText(ticket.description) || 'Aucune description.'}
        </pre>
        <h4>Critères d’acceptation</h4>
        <pre className="devops-text">
          {devOpsPlainText(ticket.acceptanceCriteria) || 'Non renseignés.'}
        </pre>
      </details>
      <details>
        <summary
          onClick={() => {
            if (!ticket.commentsLoaded && !busy)
              dispatch({ type: 'devopsLoadTicket', ticketId: ticket.id });
          }}
        >
          Commentaires ({ticket.commentsLoaded ? ticket.comments.length : 'charger'})
        </summary>
        {!ticket.commentsLoaded && (
          <button
            disabled={busy}
            onClick={() => dispatch({ type: 'devopsLoadTicket', ticketId: ticket.id })}
          >
            Charger les commentaires
          </button>
        )}
        {ticket.comments.map((c) => (
          <blockquote key={c.id}>
            <strong>{c.author}</strong>
            <pre className="devops-text">{devOpsPlainText(c.text)}</pre>
          </blockquote>
        ))}
        {ticket.commentsLoaded && !ticket.comments.length && <p>Aucun commentaire.</p>}
        {ticket.commentsTruncated && (
          <p>200 commentaires affichés. Consulte le ticket pour la suite.</p>
        )}
      </details>
      <div className="devops-actions">
        {links.map((l) => (
          <button key={l.featureId} onClick={() => onOpenFeature(l.featureId)}>
            Ouvrir la feature {features.find((f) => f.id === l.featureId)?.title ?? l.featureId}
          </button>
        ))}
        <button
          disabled={busy}
          onClick={() => dispatch({ type: 'devopsCreateFeature', ticketId: ticket.id })}
        >
          Créer une feature
        </button>
        <select
          aria-label={`Lier le ticket ${ticket.id} à une feature`}
          value=""
          disabled={busy || !features.length}
          onChange={(e) => {
            if (e.target.value)
              dispatch({
                type: 'devopsLinkFeature',
                ticketId: ticket.id,
                featureId: e.target.value,
              });
          }}
        >
          <option value="">Lier à une feature…</option>
          {features.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

export function DevOpsUI({
  state,
  features,
  dispatch,
  onOpenFeature,
  mode,
  visible = true,
}: DevOpsUIProps) {
  const [config, setConfig] = useState<DevOpsConfig>({
      organization: '',
      project: '',
      repository: '',
      remote: 'origin',
    }),
    [selected, setSelected] = useState<string[]>([]),
    [intent, setIntent] = useState(''),
    [title, setTitle] = useState(''),
    [chat, setChat] = useState(''),
    [target, setTarget] = useState('main'),
    [description, setDescription] = useState(''),
    [ticketId, setTicketId] = useState(''),
    [featureId, setFeatureId] = useState(''),
    [remote, setRemote] = useState('origin');
  useEffect(() => {
    if (state?.config) {
      setConfig(state.config);
      setRemote(state.config.remote);
    }
  }, [
    state?.config?.organization,
    state?.config?.project,
    state?.config?.repository,
    state?.config?.remote,
  ]);
  useEffect(() => {
    setSelected((current) =>
      current.filter((p) => state?.snapshot?.files.some((f) => f.path === p && !f.blocked)),
    );
  }, [state?.snapshot]);
  useEffect(() => {
    if (state?.preview?.kind === 'commit') setTitle(state.preview.title);
  }, [state?.preview]);
  if (!visible) return null;
  if (!state)
    return (
      <div className="devops-panel">
        <h1>{mode === 'dashboard' ? 'Azure DevOps' : 'Livraison'}</h1>
        <p>Initialisation…</p>
      </div>
    );
  const send = (message: DevOpsClientMessage) => dispatch(message),
    busy = state.busy,
    scopeKey = state.config
      ? `${state.config.organization}/${state.config.project}/${state.config.repository}`.toLowerCase()
      : '';
  const previewNeedsRefresh =
    !!state.preview &&
    (state.preview.kind === 'commit'
      ? title !== state.preview.title ||
        [...selected].sort().join('\0') !== [...state.preview.paths].sort().join('\0')
      : state.preview.kind === 'push'
        ? remote !== state.preview.remote
        : title !== state.preview.title ||
          description !== state.preview.description ||
          target !== state.preview.target ||
          (ticketId ? Number(ticketId) : undefined) !== state.preview.ticketId ||
          (featureId || undefined) !== state.preview.featureId);
  const inputConfig = (key: keyof DevOpsConfig, label: string) => (
    <label>
      {label}
      <input
        value={config[key]}
        onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
        required
        maxLength={200}
      />
    </label>
  );
  const commitPreview = () =>
    send({
      type: 'deliveryPreviewCommit',
      paths: selected,
      intent,
      ...(title.trim() ? { title: title.trim() } : {}),
    });
  return (
    <div className="devops-panel">
      <header>
        <div>
          <h1>{mode === 'dashboard' ? 'Azure DevOps' : 'Agent de livraison'}</h1>
          <p>
            {mode === 'dashboard'
              ? 'Tes tickets, tes PR et leurs liens avec les features.'
              : 'Prépare un commit, publie ta branche, puis ouvre une PR. Sans consommation IA.'}
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() => send({ type: mode === 'dashboard' ? 'devopsRefresh' : 'deliveryInspect' })}
        >
          Actualiser
        </button>
      </header>
      {state.error && (
        <div className="devops-error" role="alert">
          {state.error}
          <p>Corrige les champs ou la connexion, puis réessaie.</p>
        </div>
      )}
      {state.notices.map((n, i) => (
        <p className="devops-notice" key={i}>
          {n}
        </p>
      ))}
      {mode === 'dashboard' ? (
        <>
          <details className="devops-card" open={!state.config}>
            <summary>
              Configuration et connexion {state.account ? `· ${state.account}` : ''}
            </summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send({ type: 'devopsConfigure', config });
              }}
            >
              <div className="devops-fields">
                {inputConfig('organization', 'Organisation')}
                {inputConfig('project', 'Projet')}
                {inputConfig('repository', 'Dépôt')}
                {inputConfig('remote', 'Remote Git')}
              </div>
              <p>
                Exemple : https://dev.azure.com/<strong>organisation</strong>/
                <strong>projet</strong>/_git/<strong>dépôt</strong>. Ces champs sont configurables
                ici.
              </p>
              <div className="devops-actions">
                <button disabled={busy} type="submit">
                  Enregistrer la configuration
                </button>
                <button
                  disabled={busy || !state.config}
                  type="button"
                  onClick={() => send({ type: 'devopsAuthenticate' })}
                >
                  {state.authenticated ? 'Remplacer le jeton' : 'Connecter Azure DevOps'}
                </button>
                {state.authenticated && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send({ type: 'devopsDisconnect' })}
                  >
                    Déconnecter
                  </button>
                )}
              </div>
              <p>
                Le jeton est saisi dans une fenêtre sécurisée VS Code et conservé dans
                SecretStorage. Lecture : Work Items et Code ; Build et Test Management pour le kit
                DevOps. Écriture Code uniquement pour créer des PR. Les identifiants Git du push
                restent ceux de ton environnement.
              </p>
            </form>
          </details>
          <section className="devops-card">
            <h2>À faire</h2>
            <ul>
              {!state.config && <li>Renseigner l’organisation, le projet et le dépôt.</li>}
              {state.config && !state.authenticated && <li>Connecter ton compte Azure DevOps.</li>}
              {state.config && state.authenticated && !state.refreshedAt && (
                <li>Actualiser pour charger tes tickets et tes PR.</li>
              )}
              {state.tickets
                .filter((t) => !['Closed', 'Done', 'Removed'].includes(t.state))
                .slice(0, 8)
                .map((t) => (
                  <li key={t.id}>
                    <a href={t.url} target="_blank" rel="noreferrer">
                      #{t.id} — {t.title}
                    </a>
                    <span>
                      {' '}
                      ·{' '}
                      {state.links.some((l) => l.ticketId === t.id && l.projectKey === scopeKey)
                        ? 'Feature liée'
                        : 'Feature à créer ou lier'}
                    </span>
                  </li>
                ))}
              {state.pullRequests
                .filter((p) => p.status === 'active')
                .slice(0, 8)
                .map((p) => (
                  <li key={'pr' + p.id}>
                    <a href={p.url} target="_blank" rel="noreferrer">
                      PR #{p.id} — {p.title}
                    </a>{' '}
                    · {p.isDraft ? 'Brouillon' : 'En attente de revue'}
                  </li>
                ))}
              {state.refreshedAt &&
                state.tickets.length === 0 &&
                state.pullRequests.length === 0 && (
                  <li>Aucun ticket assigné ni PR créée pour ce compte dans ce périmètre.</li>
                )}
            </ul>
          </section>
          <div className="devops-columns">
            <section>
              <h2>Mes tickets assignés ({state.tickets.length})</h2>
              {state.tickets.map((ticket) => (
                <TicketCard
                  key={scopeKey + ':' + ticket.id}
                  ticket={ticket}
                  links={state.links.filter(
                    (l) => l.ticketId === ticket.id && l.projectKey === scopeKey,
                  )}
                  features={features}
                  busy={busy}
                  dispatch={send}
                  onOpenFeature={onOpenFeature}
                />
              ))}
            </section>
            <section>
              <h2>Mes PR créées ({state.pullRequests.length})</h2>
              {state.pullRequests.map((pr) => (
                <PullRequestCard
                  key={scopeKey + ':' + pr.id}
                  pr={pr}
                  links={state.links.filter(
                    (l) => l.projectKey === scopeKey && l.pullRequestIds.includes(pr.id),
                  )}
                  tickets={state.tickets}
                  features={features}
                  busy={busy}
                  dispatch={send}
                  onOpenFeature={onOpenFeature}
                />
              ))}
            </section>
          </div>
          {state.truncated && (
            <p>
              Vue limitée à 200 tickets et 200 PR. Consulte Azure DevOps pour la liste complète.
            </p>
          )}
          {state.refreshedAt && (
            <p>Actualisé le {new Date(state.refreshedAt).toLocaleString('fr-FR')}.</p>
          )}
        </>
      ) : (
        <>
          <section className="devops-card">
            <h2>Conversation</h2>
            <div className="delivery-conversation" aria-live="polite">
              {!state.history.length && (
                <p>
                  Je t’accompagne pour livrer tes changements. Commence par sélectionner les
                  fichiers du commit ; tes autres fichiers indexés seront conservés.
                </p>
              )}
              {state.history.map((entry) => (
                <article className={entry.role} key={entry.id}>
                  <strong>{entry.role === 'user' ? 'Toi' : 'Livraison'}</strong>
                  <p>{entry.text}</p>
                </article>
              ))}
            </div>
            <form
              className="devops-actions"
              onSubmit={(e) => {
                e.preventDefault();
                if (chat.trim()) {
                  send({ type: 'deliveryChat', text: chat });
                  setChat('');
                }
              }}
            >
              <input
                aria-label="Message à l’agent de livraison"
                placeholder="Aide-moi à préparer mon commit…"
                value={chat}
                maxLength={4000}
                onChange={(e) => setChat(e.target.value)}
              />
              <button disabled={busy || !chat.trim()}>Envoyer</button>
            </form>
            <p>
              Profil éditable : <code>fs-delivery</code> dans le catalogue Agents. Les échanges
              restent locaux et n’autorisent aucune action Git.
            </p>
          </section>
          <section className="devops-card">
            <h2>1. Préparer le commit</h2>
            <p>
              Branche courante : <strong>{state.snapshot?.branch ?? 'à inspecter'}</strong> ·{' '}
              {state.snapshot?.head.slice(0, 12)}
            </p>
            <p>
              Chaque fichier sélectionné sera inclus entièrement : changements indexés et non
              indexés. Les autres fichiers déjà indexés resteront intacts.
            </p>
            <div className="delivery-files">
              {state.snapshot?.files.map((file) => (
                <label key={file.path}>
                  <input
                    type="checkbox"
                    disabled={busy || !!file.blocked}
                    checked={selected.includes(file.path)}
                    onChange={(e) => {
                      setSelected(
                        e.target.checked
                          ? [...selected, file.path]
                          : selected.filter((p) => p !== file.path),
                      );
                      setTitle('');
                    }}
                  />
                  <code>{file.path}</code>
                  <span className="devops-tag">
                    {file.untracked
                      ? 'nouveau'
                      : `${file.staged !== ' ' ? 'indexé ' + file.staged : ''} ${file.unstaged !== ' ' ? 'travail ' + file.unstaged : ''}`}
                  </span>
                  {file.blocked && <span>{file.blocked}</span>}
                </label>
              ))}
              {state.snapshot?.files.length === 0 && <p>Aucun fichier modifié.</p>}
            </div>
            <details>
              <summary>Diff des fichiers suivis (HEAD → travail)</summary>
              <pre className="delivery-diff">
                {state.snapshot?.diff ||
                  'Aucun diff suivi. Les fichiers nouveaux sont listés au-dessus.'}
              </pre>
              {state.snapshot?.diffTruncated && (
                <p>Diff tronqué à 100 000 caractères. Inspecte le diff complet dans Git.</p>
              )}
            </details>
            {(
              [
                ['Indexé', state.snapshot?.stagedDiff],
                ['Non indexé', state.snapshot?.unstagedDiff],
                ['Nouveaux fichiers', state.snapshot?.untrackedDiff],
              ] as const
            ).map(([name, content]) => (
              <details key={name}>
                <summary>{name}</summary>
                <pre className="delivery-diff">{content || 'Aucun changement.'}</pre>
              </details>
            ))}
            <label>
              Intention du changement
              <input
                value={intent}
                onChange={(e) => {
                  setIntent(e.target.value);
                  setTitle('');
                }}
                placeholder="ajouter le tableau de bord Azure DevOps"
                maxLength={1000}
              />
            </label>
            <label>
              Titre du commit (modifiable)
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Proposé selon le profil après préparation"
                maxLength={200}
              />
            </label>
            <button disabled={busy || !selected.length} onClick={commitPreview}>
              {title ? 'Actualiser l’aperçu du commit' : 'Proposer le titre et préparer'}
            </button>
          </section>
          <div className="devops-columns">
            <section className="devops-card">
              <h2>2. Publier la branche</h2>
              <label>
                Remote Git
                <input value={remote} onChange={(e) => setRemote(e.target.value)} maxLength={100} />
              </label>
              <p>{state.snapshot?.remoteUrl ?? 'Vérifie la destination dans l’aperçu.'}</p>
              <button
                disabled={busy || !remote}
                onClick={() => send({ type: 'deliveryPreviewPush', remote })}
              >
                Préparer le push
              </button>
            </section>
            <section className="devops-card">
              <h2>3. Créer une PR Azure DevOps</h2>
              <p>
                {state.config
                  ? `${state.config.organization} / ${state.config.project} / ${state.config.repository}`
                  : 'Configure Azure DevOps dans son menu dédié.'}
              </p>
              <label>
                Branche cible
                <input value={target} onChange={(e) => setTarget(e.target.value)} />
              </label>
              <label>
                Titre de la PR
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </label>
              <label>
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={20000}
                />
              </label>
              <label>
                Ticket associé
                <select value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
                  <option value="">Aucun</option>
                  {state.tickets.map((t) => (
                    <option value={t.id} key={t.id}>
                      #{t.id} · {t.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Feature associée
                <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
                  <option value="">Aucune</option>
                  {features.map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy || !state.authenticated || !title.trim() || !target}
                onClick={() =>
                  send({
                    type: 'deliveryPreviewPr',
                    title,
                    description,
                    target,
                    ...(ticketId ? { ticketId: Number(ticketId) } : {}),
                    ...(featureId ? { featureId } : {}),
                  })
                }
              >
                Préparer la PR brouillon
              </button>
            </section>
          </div>
          {state.preview && (
            <section className="devops-card delivery-preview">
              <h2>Aperçu à confirmer · {state.preview.kind}</h2>
              <strong>{state.preview.title}</strong>
              <p>
                {state.preview.branch}
                {state.preview.target ? ` → ${state.preview.target}` : ''} ·{' '}
                {state.preview.head.slice(0, 12)}
              </p>
              {state.preview.remote && (
                <p>
                  Destination : {state.preview.remote} · {state.snapshot?.remoteUrl}
                </p>
              )}
              {state.preview.description && (
                <pre className="devops-text">{state.preview.description}</pre>
              )}
              {state.preview.paths.length > 0 && (
                <ul>
                  {state.preview.paths.map((p) => (
                    <li key={p}>
                      <code>{p}</code>
                    </li>
                  ))}
                </ul>
              )}
              <p>
                Un changement de fichiers, d’index, de branche ou de destination invalide cet
                aperçu. Une confirmation VS Code sera demandée.
              </p>
              {state.preview.kind === 'commit' && (
                <p>
                  Hooks et signature Git non exécutés dans ce mode. Utilise le terminal si ton
                  projet les impose.
                </p>
              )}
              <button
                disabled={busy || previewNeedsRefresh}
                onClick={() =>
                  send({
                    type: 'deliveryExecute',
                    kind: state.preview!.kind,
                    fingerprint: state.preview!.fingerprint,
                  })
                }
              >
                {state.preview.kind === 'commit'
                  ? 'Confirmer le commit'
                  : state.preview.kind === 'push'
                    ? 'Confirmer le push'
                    : 'Confirmer la création de PR'}
              </button>
              {previewNeedsRefresh && (
                <p>
                  Actualise l’aperçu pour prendre en compte les champs ou la sélection modifiés.
                </p>
              )}
            </section>
          )}
        </>
      )}
      {busy && <p role="status">Opération en cours…</p>}
    </div>
  );
}

export function DevOpsFeatureLinks({
  state,
  featureId,
  onOpenDashboard,
}: {
  state?: DevOpsState;
  featureId: string;
  onOpenDashboard?: () => void;
}) {
  const links = state?.links.filter((l) => l.featureId === featureId) ?? [];
  if (!links.length) return null;
  return (
    <div className="devops-feature-links" aria-label="Liens Azure DevOps">
      {links.map((link, i) => (
        <span key={i}>
          {link.ticketId && link.ticketUrl && (
            <a href={link.ticketUrl} target="_blank" rel="noreferrer">
              Ticket #{link.ticketId}
            </a>
          )}
          {link.pullRequestIds.map((id) => {
            const pr = state?.pullRequests.find(
              (p) =>
                p.id === id &&
                state?.config &&
                `${state.config.organization}/${state.config.project}/${state.config.repository}`.toLowerCase() ===
                  link.projectKey,
            );
            return pr || link.pullRequestUrls?.[id] ? (
              <a
                key={id}
                href={pr?.url ?? link.pullRequestUrls?.[id]}
                target="_blank"
                rel="noreferrer"
              >
                PR #{id}
                {pr ? ` · ${pr.status}` : ''}
              </a>
            ) : (
              <span key={id}>
                PR #{id} ({link.projectKey})
              </span>
            );
          })}
        </span>
      ))}
      {onOpenDashboard && <button onClick={onOpenDashboard}>Voir Azure DevOps</button>}
    </div>
  );
}
