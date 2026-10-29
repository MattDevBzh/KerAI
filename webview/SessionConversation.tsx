import { ImagePicker, ImageGallery, useImageDraft } from './Images';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Bot, Check, FileText, Pause, Play, Users } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Attempt,
  ClientMessage,
  Feature,
  FeatureStep,
  StudioState,
} from '../src/shared/types';
import { canDiscussResult, nextPairBlock, pairPlan, type PairAction } from '../src/shared/pair';
import { permissionLabels } from '../src/shared/native';
import { Avatar } from './Avatar';
import { NativeContextPanel } from './NativeContextPanel';
import { HumanRequests } from './ExecutionUI';
import { PairPreferencesUI } from './PairPreferencesUI';
import { savedPairDraft, savePairDraft, subscribe } from './bridge';
import './conversation.css';
import './work-focus.css';

const paceLabels = {
  small: 'Pas à pas',
  blocks: 'Par blocs',
  oneshot: 'En une fois après cadrage',
};
const visibleText = (text: string) =>
  text.replace(/```feature-studio-pair-(?:plan|result)[\s\S]*?(?:```|$)/g, '').trim();

/** The same persisted conversation is shown in solo and pair; only the human controls change. */
export function SessionConversation({
  feature,
  step,
  attempt,
  state,
  dispatch,
  showArtifact,
}: {
  feature: Feature;
  step: FeatureStep;
  attempt: Attempt;
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  showArtifact: () => void;
}) {
  const imageDraft = useImageDraft();
  const pair = attempt.pair!;
  const historic = step.attempts.at(-1)?.id !== attempt.id;
  const locked =
    historic ||
    feature.archived ||
    ['approved', 'stale'].includes(step.status) ||
    !state.workspace.trusted;
  const mode = pair.requestedMode ?? pair.mode;
  const [draft, setDraft] = useState(() => savedPairDraft(attempt.id));
  const [preferences, setPreferences] = useState(pair.preferences);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const sent = useRef<{ id: string; draft?: string } | undefined>(undefined);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const feed = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const requests = (state.humanRequests ?? []).filter(
    (r) => r.featureId === feature.id && r.stepId === step.id,
  );
  const unanswered = attempt.questions.filter(
    (q) => !attempt.answers[q.id]?.trim() && !requests.some((r) => r.id === q.id),
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'pairActionResult' || message.requestId !== sent.current?.id) return;
        setPending(undefined);
        setError(message.error ?? '');
        if (!message.error && sent.current.draft === draftRef.current) {
          setDraft('');
          imageDraft.setImages([]);
          savePairDraft(attempt.id, '');
        }
        sent.current = undefined;
      }),
    [attempt.id],
  );
  useEffect(() => {
    setPreferences(pair.preferences);
  }, [pair.preferences]);
  const latestMessage = pair.messages.at(-1);
  useEffect(() => {
    if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [latestMessage?.content, pair.messages.length, attempt.nativeActivity?.length]);
  const act = (action: PairAction['action'], content?: string, messageId?: string) => {
    if (locked || pending || imageDraft.loading) return;
    const id = crypto.randomUUID();
    sent.current = { id, draft: action === 'message' ? draft : content };
    setPending(id);
    setError('');
    dispatch({
      type: 'pairAction',
      featureId: feature.id,
      stepId: step.id,
      attemptId: attempt.id,
      expectedVersion: pair.version,
      requestId: id,
      action,
      ...(action === 'message' && imageDraft.images.length ? { images: imageDraft.images } : {}),
      ...(content?.trim() ? { content: content.trim() } : {}),
      ...(messageId ? { messageId } : {}),
      ...(action === 'preferences' ? { preferences } : {}),
    });
  };
  const plan = pairPlan(pair),
    next = nextPairBlock(pair);
  const accepted = Boolean(plan?.acceptedAt && pair.approvedRevision === plan.revision);
  const idleDisabled = Boolean(locked || pending || pair.busy || state.workspaceOperation);
  const timeline = [
    ...pair.messages.map((message) => ({
      kind: 'message' as const,
      at: message.at,
      id: message.id,
      message,
    })),
    ...(attempt.nativeActivity ?? []).map((tool) => ({
      kind: 'tool' as const,
      at: tool.startedAt,
      id: tool.id,
      tool,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const renderEntry = (entry: (typeof timeline)[number]) =>
    entry.kind === 'tool' ? (
      <details className="conversation-tool" key={entry.id}>
        <summary>
          <strong>{entry.tool.tool}</strong>
          <span>
            {entry.tool.status === 'running'
              ? 'En cours'
              : entry.tool.status === 'completed'
                ? 'Terminé'
                : entry.tool.status === 'interrupted'
                  ? 'Interrompu'
                  : 'Échec'}
            {entry.tool.exitCode !== undefined && ` · code ${entry.tool.exitCode}`}
          </span>
        </summary>
        <small>Source : Copilot · {entry.tool.directory}</small>
        <pre>{entry.tool.command ?? entry.tool.arguments}</pre>
        {entry.tool.output && <pre>{entry.tool.output}</pre>}
        {entry.tool.truncated && (
          <small>Extrait tronqué ; événements conservés dans l’archive.</small>
        )}
      </details>
    ) : (
      <article
        key={entry.id}
        className={`conversation-message ${entry.message.role} ${entry.message.kind === 'reasoning' || entry.message.role === 'system' ? 'technical' : ''}`}
      >
        <div className="conversation-message-meta">
          <strong>
            {entry.message.role === 'user'
              ? 'Toi'
              : entry.message.role === 'system'
                ? 'Suivi du travail'
                : (attempt.agentName ?? pair.snapshot.agent.name)}
          </strong>
          <time dateTime={entry.at}>
            {new Date(entry.at).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </div>
        <ImageGallery images={entry.message.images} />
        {entry.message.kind === 'reasoning' ? (
          <details className="conversation-reasoning">
            <summary>Réflexion transmise par Copilot</summary>
            <div className="markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{entry.message.content}</Markdown>
            </div>
          </details>
        ) : (
          <div className="markdown">
            <Markdown remarkPlugins={[remarkGfm]}>
              {visibleText(entry.message.content) ||
                (entry.message.status === 'streaming'
                  ? 'La réponse arrive…'
                  : 'Organisation proposée ci-dessous.')}
            </Markdown>
          </div>
        )}
        {entry.message.status === 'interrupted' && (
          <small>Réponse interrompue · contenu conservé</small>
        )}
        {entry.message.delivery && (
          <small className="conversation-delivery">
            {
              {
                pending: 'En attente de transmission',
                sent: 'Transmission en cours',
                received: 'Reçu par Copilot',
                uncertain: 'Transmission à vérifier · message conservé',
                skipped: 'Conservé sans renvoi',
              }[entry.message.delivery]
            }
          </small>
        )}
        {!locked && entry.message.delivery === 'uncertain' && (
          <div className="conversation-next">
            <small>
              Copilot a peut-être déjà traité ce message. Relis sa réponse avant de choisir.
            </small>
            <button
              className="button secondary small"
              disabled={idleDisabled}
              onClick={() => act('retry-message', undefined, entry.message.id)}
            >
              Renvoyer explicitement
            </button>
            <button
              className="button secondary small"
              disabled={idleDisabled}
              onClick={() => act('keep-message', undefined, entry.message.id)}
            >
              Garder sans renvoyer
            </button>
          </div>
        )}
      </article>
    );
  const [historyPage, setHistoryPage] = useState(0);
  const historyPages = Math.max(1, Math.ceil(timeline.length / 100));
  const currentHistoryPage = Math.min(historyPage, historyPages - 1);
  const windowEnd = timeline.length - currentHistoryPage * 100;
  const visibleTimeline = timeline.slice(Math.max(0, windowEnd - 100), windowEnd);
  const groups: { id: string; intermediate: boolean; entries: typeof timeline }[] = [];
  for (const entry of visibleTimeline) {
    const intermediate =
      entry.kind === 'tool' ||
      entry.message.kind === 'reasoning' ||
      entry.message.role === 'system';
    const previous = groups.at(-1);
    if (intermediate && previous?.intermediate) previous.entries.push(entry);
    else groups.push({ id: `${entry.kind}:${entry.id}`, intermediate, entries: [entry] });
  }
  return (
    <section className="session-conversation" aria-label="Conversation de l’étape">
      <header className="conversation-header">
        <Avatar agent={pair.snapshot.agent} small status={pair.busy ? 'running' : attempt.status} />
        <div className="conversation-identity">
          <strong>{attempt.agentName ?? pair.snapshot.agent.name}</strong>
          <span>
            {step.subplan
              ? `Orchestrateur · ${step.subplan.mode === 'pair' ? 'Découpage accompagné' : 'Découpage automatique'}`
              : `${mode === 'pair' ? 'Pair' : 'Solo'} · ${paceLabels[pair.preferences.pace]}`}
          </span>
          <small>
            {feature.execution &&
              `Permissions : ${permissionLabels[feature.execution.permissionMode]}`}
          </small>
        </div>
        {!locked && (
          <div className="conversation-controls">
            {mode === 'solo' ? (
              <button
                className="button secondary small"
                disabled={Boolean(pending)}
                onClick={() => act('pair')}
              >
                <Users size={14} /> Passer en pair
              </button>
            ) : (
              (pair.phase === 'review' ||
                (accepted && (next || pair.busy)) ||
                (!plan && pair.turn?.kind === 'solo')) && (
                <button
                  className="button secondary small"
                  disabled={Boolean(pending || requests.length)}
                  onClick={() => act('solo')}
                >
                  <Bot size={14} />{' '}
                  {pair.phase === 'review' ? 'Passer en solo' : 'Confier la suite'}
                </button>
              )
            )}
            {(pair.busy ||
              (step.subplanState && !step.subplanState.paused && pair.phase !== 'review')) && (
              <button
                className="button secondary small"
                disabled={Boolean(pending || pair.pauseRequested)}
                onClick={() => act('pause')}
              >
                <Pause size={14} /> Reprendre la main
              </button>
            )}
          </div>
        )}
      </header>
      <div className="conversation-state" role="status">
        {locked
          ? historic
            ? 'Tentative antérieure · consultation'
            : step.status === 'approved'
              ? 'Étape validée · conversation conservée en lecture seule'
              : 'Conversation en lecture seule'
          : pair.pauseRequested && pair.busy
            ? 'Arrêt demandé · attends la confirmation avant de modifier les fichiers'
            : pair.requestedMode
              ? `Passage en ${pair.requestedMode} demandé · le travail actuel continue jusqu’au point de contrôle`
              : requests.length
                ? 'Une réponse de ta part est attendue'
                : pair.busy
                  ? pair.turn?.kind === 'work' || pair.turn?.kind === 'solo'
                    ? 'L’agent travaille'
                    : 'L’agent examine le contexte et répond'
                  : pair.phase === 'paused'
                    ? 'À toi · exécution arrêtée, travail conservé'
                    : pair.phase === 'interrupted'
                      ? 'Exécution interrompue · reprise explicite nécessaire'
                      : pair.phase === 'review'
                        ? 'Résultat prêt · pose tes questions, demande un ajustement ou relis le livrable'
                        : pair.phase === 'checkpoint'
                          ? 'Point de contrôle · à toi de décider de la suite'
                          : 'Convenons de l’organisation'}
      </div>
      <ImageGallery images={feature.images} />
      <NativeContextPanel loads={attempt.nativeContextLoads ?? []} />
      <div
        className="conversation-feed"
        role="log"
        aria-label="Historique de la conversation"
        ref={feed}
        onScroll={() => {
          const el = feed.current;
          if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        {historyPages > 1 && (
          <nav className="work-pagination" aria-label="Pages de la conversation">
            <button
              className="button secondary small"
              disabled={currentHistoryPage + 1 >= historyPages}
              onClick={() => {
                follow.current = false;
                setHistoryPage(currentHistoryPage + 1);
              }}
            >
              Plus anciens
            </button>
            <span>
              {Math.max(0, windowEnd - 100) + 1}–{windowEnd} / {timeline.length} événements
              conservés
            </span>
            <button
              className="button secondary small"
              disabled={currentHistoryPage === 0}
              onClick={() => {
                follow.current = true;
                setHistoryPage(0);
              }}
            >
              Derniers événements
            </button>
          </nav>
        )}
        {groups.map((group, index) =>
          group.intermediate ? (
            <IntermediateMessages
              key={group.id}
              active={index === groups.length - 1}
              count={group.entries.length}
            >
              {group.entries.map(renderEntry)}
            </IntermediateMessages>
          ) : (
            group.entries.map(renderEntry)
          ),
        )}
      </div>
      {plan && (
        <section className="conversation-plan" aria-label="Organisation proposée">
          <strong>
            {accepted ? 'Organisation convenue' : 'Proposition à valider'} ·{' '}
            {paceLabels[pair.preferences.pace]}
          </strong>
          <p>{plan.summary}</p>
          <ol>
            {plan.blocks.map((block) => (
              <li key={block.id}>
                <strong>{block.title}</strong>{' '}
                {pair.results.some(
                  (r) => r.planRevision === plan.revision && r.blockId === block.id,
                )
                  ? '· Terminé'
                  : next?.id === block.id
                    ? '· Prochaine étape'
                    : ''}
                <p>{block.description}</p>
              </li>
            ))}
          </ol>
          {!locked && pair.phase === 'planning' && (
            <button
              className="button primary"
              disabled={idleDisabled || Boolean(pair.error)}
              onClick={() => act('approve-plan')}
            >
              <Check size={14} />{' '}
              {step.subplan
                ? 'Valider le découpage et lancer la sous-équipe'
                : 'Valider l’organisation et démarrer'}
            </button>
          )}
        </section>
      )}
      {!locked && (
        <div className="conversation-next">
          {!plan &&
            ['checkpoint', 'planning'].includes(pair.phase) &&
            attempt.questions.length > 0 && (
              <button
                className="button primary"
                disabled={idleDisabled || unanswered.length > 0}
                onClick={() => act('resume')}
              >
                <Play size={14} /> Poursuivre après mes réponses
              </button>
            )}
          {!step.subplan && pair.phase === 'checkpoint' && accepted && next && (
            <button
              className="button primary"
              disabled={idleDisabled || unanswered.length > 0}
              onClick={() => act('continue')}
            >
              <Play size={14} />{' '}
              {pair.preferences.pace === 'small'
                ? 'Continuer avec le prochain pas'
                : 'Continuer avec le prochain bloc'}
            </button>
          )}
          {['paused', 'interrupted'].includes(pair.phase) && (
            <button
              className="button primary"
              disabled={idleDisabled || unanswered.length > 0}
              onClick={() => act('resume')}
            >
              <Play size={14} /> Reprendre le travail
            </button>
          )}
          {attempt.artifact && (
            <button className="button secondary" onClick={showArtifact}>
              <FileText size={14} /> Relire le livrable
            </button>
          )}
        </div>
      )}
      {!locked && <HumanRequests requests={requests} dispatch={dispatch} />}
      {!locked && unanswered.length > 0 && (
        <form
          className="conversation-questions"
          onSubmit={(event) => {
            event.preventDefault();
            dispatch({ type: 'answerQuestions', featureId: feature.id, stepId: step.id, answers });
          }}
        >
          <strong>Questions conservées avant l’interruption</strong>
          {unanswered.map((q) => (
            <label className="field" key={q.id}>
              <span>{q.text}</span>
              <textarea
                required
                value={answers[q.id] ?? ''}
                onChange={(event) => setAnswers({ ...answers, [q.id]: event.target.value })}
              />
            </label>
          ))}
          <button
            className="button secondary"
            disabled={unanswered.some((q) => !answers[q.id]?.trim())}
          >
            Enregistrer mes réponses
          </button>
        </form>
      )}
      {(error || pair.error) && (
        <p className="inline-error" role="alert">
          {error || pair.error}
        </p>
      )}
      {!locked && !step.subplan && (
        <details className="conversation-preferences">
          <summary>
            {paceLabels[pair.preferences.pace]} · Ajuster le rythme et les explications
          </summary>
          <PairPreferencesUI
            value={preferences}
            onChange={setPreferences}
            disabled={idleDisabled}
          />
          <p className="field-help">
            Un nouveau rythme peut demander une nouvelle organisation du travail restant. Ce qui est
            déjà fait est conservé.
          </p>
          <button
            className="button secondary"
            disabled={idleDisabled}
            onClick={() => act('preferences')}
          >
            Appliquer mes préférences
          </button>
        </details>
      )}
      {!locked &&
        (mode === 'pair' || canDiscussResult(step.status, pair) ? (
          <form
            className="conversation-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim() || imageDraft.images.length)
                act('message', draft.trim() || 'Analyse les images jointes.');
            }}
          >
            <label className="field">
              <span>Ton message à l’agent</span>
              <textarea
                rows={3}
                maxLength={30000}
                value={draft}
                onPaste={imageDraft.onPaste}
                disabled={Boolean(pending)}
                placeholder="Une question sur son choix, une précision, une correction…"
                onChange={(event) => {
                  setDraft(event.target.value);
                  savePairDraft(attempt.id, event.target.value);
                }}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === 'Enter' &&
                    (draft.trim() || imageDraft.images.length)
                  ) {
                    event.preventDefault();
                    act('message', draft.trim() || 'Analyse les images jointes.');
                  }
                }}
              />
            </label>
            <ImagePicker draft={imageDraft} disabled={Boolean(pending)} />
            <div className="conversation-composer-actions">
              <small>
                {pair.busy
                  ? 'Le message est conservé et transmis pendant le travail si Copilot l’accepte ; son état reste visible.'
                  : 'Une question conserve le livrable. Les corrections restent à relire avant validation.'}
              </small>
              <button
                className="button primary"
                disabled={
                  Boolean(pending) ||
                  imageDraft.loading ||
                  (!draft.trim() && !imageDraft.images.length)
                }
              >
                <ArrowUp size={15} /> Envoyer
              </button>
            </div>
          </form>
        ) : (
          <div className="conversation-readonly">
            <Bot size={18} />
            <p>
              Tu suis le travail en solo. Passe en pair pour poser une question ou demander un
              ajustement.
            </p>
            <button
              className="button secondary"
              disabled={Boolean(pending)}
              onClick={() => act('pair')}
            >
              Intervenir en pair
            </button>
          </div>
        ))}
      <footer className="conversation-footnote">
        {pair.calls} appel{pair.calls > 1 ? 's' : ''} · même conversation ·{' '}
        {attempt.changedFiles.length} fichier(s) observé(s)
        <details>
          <summary>Contexte et organisations précédentes</summary>
          <pre>{pair.snapshot.prompt}</pre>
          {pair.plans.slice(0, -1).map((p) => (
            <p key={p.revision}>
              Organisation {p.revision} : {p.summary}
            </p>
          ))}
        </details>
      </footer>
    </section>
  );
}

function IntermediateMessages({
  active,
  count,
  children,
}: {
  active: boolean;
  count: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(active);
  useEffect(() => setExpanded(active), [active]);
  return (
    <section className="conversation-intermediate" aria-label="Messages intermédiaires">
      <button
        className="text-button intermediate-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Masquer les messages intermédiaires' : 'Afficher les messages intermédiaires'}{' '}
        <span>· {count}</span>
      </button>
      {expanded && <div className="intermediate-content">{children}</div>}
    </section>
  );
}
