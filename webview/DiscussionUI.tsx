import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ClientMessage, StudioState } from '../src/shared/types';
import type {
  Discussion,
  DiscussionAgent,
  DiscussionState,
  DiscussionFeatureDraft,
} from '../src/shared/discussions';
import { Avatar } from './Avatar';
import { isHosted, persistView, subscribe } from './bridge';
import './discussions.css';

type Dispatch = (message: ClientMessage) => void;
const nameOf = (agent: DiscussionAgent) => agent.profile.nickname || agent.profile.name;
function dateGroup(value: string) {
  const date = new Date(value),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Aujourd’hui';
  if (date.toDateString() === yesterday.toDateString()) return 'Hier';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function DiscussionUI({
  state,
  studio,
  dispatch,
  visible,
  selectedId,
  onSelect,
  onCreateFeature,
}: {
  state: DiscussionState;
  studio: StudioState;
  dispatch: Dispatch;
  visible: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onCreateFeature: (discussionId: string, draft: DiscussionFeatureDraft) => void;
}) {
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  type Pending = { discussionId: string; action: 'send' | 'delete' | 'prepare'; content?: string };
  const requests = useRef<Record<string, Pending>>({});
  const [pendingRequests, setPendingRequests] = useState<Record<string, Pending>>({});
  const [search, setSearch] = useState('');
  const id = selectedId || newId;
  const selected = state.discussions.find((discussion) => discussion.id === id);
  const currentId = useRef(id);
  currentId.current = id;
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'discussionResult') return;
        const request = requests.current[message.requestId];
        if (!request) return;
        const remaining = { ...requests.current };
        delete remaining[message.requestId];
        requests.current = remaining;
        setPendingRequests(remaining);
        setErrors((current) => ({ ...current, [request.discussionId]: message.error ?? '' }));
        if (message.error || message.cancelled) return;
        setDrafts((current) => {
          if (request.action === 'prepare') return current;
          if (
            request.action === 'send' &&
            current[request.discussionId]?.trim() !== request.content
          )
            return current;
          const next = { ...current };
          delete next[request.discussionId];
          return next;
        });
        if (currentId.current !== request.discussionId) return;
        if (request.action === 'delete') {
          setNewId(crypto.randomUUID());
          select.current('');
        } else select.current(request.discussionId);
      }),
    [],
  );
  const request = (message: ClientMessage) => {
    if (
      message.type === 'sendDiscussion' ||
      message.type === 'deleteDiscussion' ||
      message.type === 'prepareDiscussionFeature'
    ) {
      if (
        Object.values(requests.current).some(
          (pending) => pending.discussionId === message.discussionId,
        )
      )
        return;
      requests.current = {
        ...requests.current,
        [message.requestId]: {
          discussionId: message.discussionId,
          action:
            message.type === 'sendDiscussion'
              ? 'send'
              : message.type === 'prepareDiscussionFeature'
                ? 'prepare'
                : 'delete',
          content: 'content' in message ? message.content : undefined,
        },
      };
      setPendingRequests(requests.current);
      setErrors((current) => ({ ...current, [message.discussionId]: '' }));
    }
    dispatch(message);
  };
  useEffect(() => {
    if (visible && isHosted) dispatch({ type: 'refreshDiscussions' });
  }, [visible]);
  useEffect(() => {
    persistView({ discussionId: selectedId });
  }, [selectedId]);
  const groups = new Map<string, Discussion[]>();
  for (const discussion of [...state.discussions].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )) {
    if (
      search &&
      !discussion.title.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))
    )
      continue;
    const group = dateGroup(discussion.updatedAt);
    groups.set(group, [...(groups.get(group) ?? []), discussion]);
  }
  const fresh = () => {
    setNewId(crypto.randomUUID());
    onSelect('');
  };
  return (
    <section className="discussion-page" aria-label="Discussion">
      <aside className="discussion-history" aria-label="Historique des discussions">
        <div className="discussion-history-heading">
          <MessageSquare size={18} />
          <h1>Discussion</h1>
        </div>
        <button className="button primary" onClick={fresh}>
          <Plus size={15} /> Nouvelle discussion
        </button>
        <label className="discussion-search">
          <Search size={15} />
          <input
            aria-label="Rechercher une discussion"
            placeholder="Rechercher…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="discussion-history-list">
          {[...groups].map(([label, discussions]) => (
            <section key={label}>
              <h2>{label}</h2>
              {discussions.map((discussion) => (
                <button
                  key={discussion.id}
                  className={`discussion-history-item ${id === discussion.id ? 'active' : ''}`}
                  aria-current={id === discussion.id ? 'page' : undefined}
                  onClick={() => onSelect(discussion.id)}
                >
                  <span>{discussion.title}</span>
                  <small>
                    {discussion.messages.some((message) => message.status === 'streaming')
                      ? 'Réponse en cours…'
                      : new Date(discussion.updatedAt).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                  </small>
                </button>
              ))}
            </section>
          ))}
          {!groups.size && (
            <p className="discussion-history-empty">
              {search
                ? 'Aucune discussion trouvée.'
                : 'Vos échanges apparaîtront ici, classés par date.'}
            </p>
          )}
        </div>
      </aside>
      <Conversation
        key={id}
        id={id}
        discussion={selected}
        onCreateFeature={onCreateFeature}
        state={state}
        studio={studio}
        dispatch={request}
        visible={visible}
        draft={drafts[id] ?? ''}
        onDraft={(value) => setDrafts((current) => ({ ...current, [id]: value }))}
        pending={Object.values(pendingRequests).some((request) => request.discussionId === id)}
        error={errors[id] ?? ''}
      />
    </section>
  );
}

function Conversation({
  onCreateFeature,
  id,
  discussion,
  state,
  studio,
  dispatch,
  draft,
  onDraft,
  pending,
  error,
  visible,
}: {
  onCreateFeature: (discussionId: string, draft: DiscussionFeatureDraft) => void;
  id: string;
  discussion?: Discussion;
  state: DiscussionState;
  studio: StudioState;
  dispatch: Dispatch;
  draft: string;
  onDraft: (text: string) => void;
  pending: boolean;
  error: string;
  visible: boolean;
}) {
  const preferred = state.agents.filter((agent) => agent.profile.discussionAgent);
  const [agentKey, setAgentKey] = useState(discussion?.agentKey ?? preferred[0]?.key ?? '');
  const [model, setModel] = useState(discussion?.model ?? '');
  const [reasoning, setReasoning] = useState(discussion?.reasoning ?? '');
  const [expanded, setExpanded] = useState(false);
  const scroll = useRef<HTMLDivElement>(null),
    stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const [preparingFeature, setPreparingFeature] = useState<string>();
  useEffect(() => {
    if (visible && preparingFeature && discussion?.featureDraft?.requestId === preparingFeature) {
      setPreparingFeature(undefined);
      onCreateFeature(id, discussion.featureDraft);
    }
  }, [visible, preparingFeature, discussion?.featureDraft]);
  const source = discussion?.source;
  const selected = source
    ? { key: discussion!.agentKey, profile: source.agent }
    : state.agents.find((agent) => agent.key === agentKey);
  const others = state.agents.filter((agent) => !agent.profile.discussionAgent);
  const shownOthers = expanded ? others : others.filter((agent) => agent.key === agentKey);
  const effectiveModel = model || selected?.profile.model || state.defaultModel;
  const efforts =
    studio.runtime.models.find((entry) => entry.id === effectiveModel)?.reasoningEfforts ?? [];
  const running = discussion?.messages.some((message) => message.status === 'streaming') ?? false;
  useEffect(() => {
    if (discussion && !pending) {
      setAgentKey(discussion.agentKey);
      setModel(discussion.model ?? '');
      setReasoning(discussion.reasoning ?? '');
    }
  }, [discussion?.id]);
  useEffect(() => {
    if (!discussion && !agentKey && preferred.length) setAgentKey(preferred[0].key);
  }, [agentKey, preferred[0]?.key, discussion?.id]);
  const wasPending = useRef(pending);
  useEffect(() => {
    if (visible && wasPending.current && !pending) input.current?.focus();
    wasPending.current = pending;
  }, [pending, visible]);
  useEffect(() => {
    if (visible && stick.current && scroll.current)
      scroll.current.scrollTop = discussion?.messages.length ? scroll.current.scrollHeight : 0;
  }, [discussion?.messages, visible]);
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (
      !draft.trim() ||
      !selected ||
      pending ||
      running ||
      !studio.workspace.trusted ||
      state.error
    )
      return;
    const requestId = crypto.randomUUID();
    stick.current = true;
    dispatch({
      type: 'sendDiscussion',
      requestId,
      discussionId: id,
      agentKey,
      content: draft.trim(),
      model: model || undefined,
      reasoning: reasoning || undefined,
    });
  };
  return (
    <div className="discussion-conversation">
      <header className="discussion-toolbar">
        <div className="discussion-title">
          <span className="eyebrow">AVEC VOTRE ÉQUIPE</span>
          <h2>{discussion?.title ?? 'Une idée à explorer ?'}</h2>
        </div>
        {discussion && (
          <button
            className="icon-button"
            aria-label="Supprimer la discussion"
            disabled={pending}
            onClick={() => {
              const requestId = crypto.randomUUID();
              dispatch({ type: 'deleteDiscussion', discussionId: id, requestId });
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </header>
      {discussion && (!source || discussion.messages.length > 0) && (
        <div className="discussion-feature-actions">
          <button
            className="button secondary small"
            disabled={
              pending ||
              running ||
              !discussion.messages.some(
                (message) => message.role === 'assistant' && message.status === 'complete',
              )
            }
            onClick={() => {
              if (discussion.featureDraft) onCreateFeature(id, discussion.featureDraft);
              else {
                const requestId = crypto.randomUUID();
                setPreparingFeature(requestId);
                dispatch({
                  type: 'prepareDiscussionFeature',
                  requestId,
                  discussionId: id,
                  agentKey,
                  model: model || undefined,
                  reasoning: reasoning || undefined,
                });
              }
            }}
          >
            <Plus size={14} />{' '}
            {running && preparingFeature
              ? 'Préparation du brouillon…'
              : discussion.featureDraft
                ? 'Ajuster et créer la feature'
                : 'Créer une feature'}
          </button>
          {discussion.featureDraft && (
            <button
              className="text-button"
              disabled={pending || running}
              onClick={() => {
                const requestId = crypto.randomUUID();
                setPreparingFeature(requestId);
                dispatch({
                  type: 'prepareDiscussionFeature',
                  requestId,
                  discussionId: id,
                  agentKey,
                  model: model || undefined,
                  reasoning: reasoning || undefined,
                });
              }}
            >
              Actualiser la proposition
            </button>
          )}
        </div>
      )}
      {source && (
        <section className="discussion-source" aria-label="Compte rendu lié">
          <strong>
            {source.featureTitle} · {source.stepName}
          </strong>
          <span>
            Version {source.revision + 1} · {source.agent.nickname || source.agent.name} ·{' '}
            {source.model || 'Modèle automatique'}
            {source.reasoning ? ` · ${source.reasoning}` : ''} · configuration conservée
          </span>
          <div className="discussion-source-actions">
            <button
              className="text-button"
              onClick={() =>
                dispatch({ type: 'returnToDiscussionReport', discussionId: id, edit: false })
              }
            >
              Revenir au compte rendu
            </button>
            <button
              className="button secondary small"
              onClick={() =>
                dispatch({ type: 'returnToDiscussionReport', discussionId: id, edit: true })
              }
            >
              Modifier le compte rendu actuel
            </button>
          </div>
        </section>
      )}
      <div className={`discussion-controls ${source ? 'source-controls' : ''}`}>
        <div className="discussion-agent-control">
          <label className="field">
            <span>Agent</span>
            <select
              aria-label="Agent de discussion"
              value={agentKey}
              disabled={pending || running || Boolean(source)}
              onChange={(event) => {
                setAgentKey(event.target.value);
                setReasoning('');
              }}
            >
              <option value="" disabled>
                Choisir un agent
              </option>
              {source && (
                <option value={agentKey}>
                  {source.agent.nickname || source.agent.name} · configuration d’origine
                </option>
              )}
              {agentKey && !selected && (
                <option value={agentKey}>Agent indisponible — choisir un profil</option>
              )}
              {!source && preferred.length > 0 && (
                <optgroup label="Agents de discussion">
                  {preferred.map((agent) => (
                    <option value={agent.key} key={agent.key}>
                      {nameOf(agent)}
                      {agent.projectName ? ` · ${agent.projectName}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {!source && shownOthers.length > 0 && (
                <optgroup label="Autres agents">
                  {shownOthers.map((agent) => (
                    <option value={agent.key} key={agent.key}>
                      {nameOf(agent)}
                      {agent.projectName ? ` · ${agent.projectName}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {!source && others.length > 0 && (
            <button
              className="text-button discussion-more"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Voir moins' : `Voir plus (${others.length})`}
            </button>
          )}
        </div>
        <label className="field">
          <span>Modèle pour cette discussion</span>
          <select
            aria-label="Modèle de la discussion"
            value={model}
            disabled={pending || running || Boolean(source)}
            onChange={(event) => {
              setModel(event.target.value);
              setReasoning('');
            }}
          >
            <option value="">
              {selected?.profile.model
                ? `Profil · ${selected.profile.model}`
                : state.defaultModel
                  ? `Par défaut · ${state.defaultModel}`
                  : 'Automatique'}
            </option>
            {model && !studio.runtime.models.some((entry) => entry.id === model) && (
              <option value={model}>{model} · à vérifier</option>
            )}
            {studio.runtime.models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Raisonnement</span>
          <select
            aria-label="Raisonnement de la discussion"
            value={reasoning}
            disabled={pending || running || Boolean(source) || !efforts.length}
            onChange={(event) => setReasoning(event.target.value)}
          >
            <option value="">{efforts.length ? 'Par défaut' : 'Automatique'}</option>
            {reasoning && !efforts.includes(reasoning) && (
              <option value={reasoning}>{reasoning} · à vérifier</option>
            )}
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {(
                  {
                    low: 'Léger',
                    medium: 'Moyen',
                    high: 'Élevé',
                    xhigh: 'Très élevé',
                    max: 'Maximum',
                  } as Record<string, string>
                )[effort] ?? effort}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button"
          aria-label="Actualiser les modèles Copilot"
          title="Actualiser les modèles Copilot"
          disabled={studio.runtime.state === 'checking'}
          onClick={() => dispatch({ type: 'checkRuntime' })}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div
        className="discussion-messages"
        ref={scroll}
        role="log"
        aria-label="Messages de la discussion"
        aria-live={running ? 'off' : 'polite'}
        onScroll={() => {
          const element = scroll.current;
          if (element)
            stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        }}
      >
        {source && (
          <div className="discussion-source-copy">
            <p>
              Discutez pour comprendre ou préparer une modification. Vous gardez la main sur
              l’édition et la validation du compte rendu.
            </p>
            {source.warnings.map((warning) => (
              <p className="discussion-context-warning" key={warning}>
                {warning}
              </p>
            ))}
            <details>
              <summary>Compte rendu au début de cette discussion</summary>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{source.output}</ReactMarkdown>
              </div>
            </details>
            {source.originalOutput && (
              <details>
                <summary>Sortie originale de l’agent</summary>
                <div className="markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{source.originalOutput}</ReactMarkdown>
                </div>
              </details>
            )}
            <details>
              <summary>Contexte transmis à l’agent</summary>
              <pre>{source.context}</pre>
            </details>
            {!discussion?.messages.length && (
              <div className="discussion-source-actions">
                {[
                  'Peux-tu m’expliquer tes choix ?',
                  'Quelles sont les alternatives ?',
                  'Quels points dois-je vérifier ?',
                ].map((question) => (
                  <button
                    key={question}
                    className="button secondary small"
                    onClick={() => onDraft(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!source && !discussion?.messages.length && (
          <div className="discussion-welcome">
            <Avatar agent={selected?.profile} />
            <h3>
              {selected ? `Parlons avec ${nameOf(selected)}.` : 'Choisissez votre interlocuteur.'}
            </h3>
            <p>
              {selected?.profile.description ||
                'Une question, une idée, un point à éclaircir : commencez la conversation.'}
            </p>
            {!preferred.length && (
              <small>
                Dans Agents, cochez « Agent de discussion » pour retrouver vos interlocuteurs
                favoris ici.
              </small>
            )}
            <small>
              Les discussions utilisent les instructions et skills du profil. Ajoutez dans vos
              messages le contexte utile.
            </small>
          </div>
        )}
        {discussion?.messages.map((message) => (
          <article
            className={`discussion-message ${message.role}`}
            key={message.id}
            aria-label={
              message.role === 'user'
                ? 'Message envoyé'
                : `Réponse de ${message.agent?.nickname || message.agent?.name || 'l’agent'}`
            }
          >
            {message.role === 'assistant' && (
              <Avatar
                agent={message.agent}
                small
                status={message.status === 'streaming' ? 'running' : 'pending'}
              />
            )}
            <div className="discussion-message-body">
              <div className="discussion-message-meta">
                <strong>
                  {message.role === 'user'
                    ? 'Vous'
                    : message.agent?.nickname || message.agent?.name || 'Agent'}
                </strong>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              <div className="discussion-bubble">
                {message.role === 'user' ? (
                  <p>{message.content}</p>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                )}
                {message.status === 'streaming' && (
                  <span className="discussion-typing">
                    {message.content ? 'Réponse en cours…' : 'L’agent prépare sa réponse…'}
                  </span>
                )}
                {message.error && (
                  <p className="discussion-message-error" role="status">
                    {message.error}
                  </p>
                )}
              </div>
              {message.role === 'assistant' && message.model && (
                <small className="discussion-model-note">
                  {message.model}
                  {message.reasoning ? ` · ${message.reasoning}` : ''}
                </small>
              )}
            </div>
          </article>
        ))}
      </div>
      <form className="discussion-composer" onSubmit={send}>
        {(error || state.error) && (
          <p className="inline-error" role="alert">
            {error || state.error}
          </p>
        )}
        <label className="team-sr-only" htmlFor={`discussion-input-${id}`}>
          Votre message
        </label>
        <div className="discussion-input-box">
          <textarea
            ref={input}
            id={`discussion-input-${id}`}
            value={draft}
            disabled={pending}
            maxLength={40000}
            placeholder={
              selected ? `Écrire à ${nameOf(selected)}…` : 'Choisissez un agent pour commencer…'
            }
            rows={3}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <button
              type="button"
              className="button secondary"
              aria-label="Arrêter la réponse"
              onClick={() => dispatch({ type: 'cancelDiscussion', discussionId: id })}
            >
              <Square size={16} /> Arrêter
            </button>
          ) : (
            <button
              className="button primary"
              aria-label="Envoyer le message"
              disabled={
                pending ||
                !draft.trim() ||
                !selected ||
                !studio.workspace.trusted ||
                Boolean(state.error)
              }
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <div className="discussion-composer-note">
          <span>Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne</span>
          <span>
            {pending
              ? 'Enregistrement…'
              : running
                ? 'Réponse en cours'
                : 'Historique enregistré sur ce poste'}
          </span>
        </div>
      </form>
    </div>
  );
}
