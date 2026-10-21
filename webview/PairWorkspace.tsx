import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  Circle,
  LoaderCircle,
  Pause,
  Play,
  Users,
  Bot,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ClientMessage, Feature, FeatureStep, StudioState } from '../src/shared/types';
import {
  pairPlan,
  nextPairBlock,
  pairPhaseLabels,
  defaultPairPreferences,
  type PairAction,
} from '../src/shared/pair';
import { approvalBlockers } from '../src/core/validation';
import { Avatar } from './Avatar';
import { HumanRequests } from './ExecutionUI';
import { PairPreferencesUI } from './PairPreferencesUI';
import { subscribe, savedPairDraft, savePairDraft } from './bridge';
import './pair.css';

const visibleText = (text: string) =>
  text.replace(/```feature-studio-pair-(?:plan|result)[\s\S]*?(?:```|$)/g, '').trim();
export function PairWorkspace({
  feature,
  step,
  state,
  dispatch,
  back,
}: {
  feature: Feature;
  step: FeatureStep;
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  back: () => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const latest = step.attempts.at(-1),
    attempt =
      step.attempts.find((a) => a.id === selectedId && a.pair) ??
      step.attempts.filter((a) => a.pair).at(-1) ??
      latest;
  const pair = attempt?.pair,
    plan = pair && pairPlan(pair),
    next = pair && nextPairBlock(pair);
  const historic = attempt?.id !== latest?.id;
  const locked =
    historic ||
    feature.archived ||
    ['approved', 'stale'].includes(step.status) ||
    !state.workspace.trusted;
  const [draft, setDraft] = useState(() => savedPairDraft(attempt?.id ?? ''));
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string>();
  const sent = useRef<{ id: string; content?: string } | undefined>(undefined);
  const [approving, setApproving] = useState(false);
  const approval = useRef(false);
  const [preferences, setPreferences] = useState(pair?.preferences ?? defaultPairPreferences);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const feed = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const exit = useRef(back);
  exit.current = back;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    setDraft(savedPairDraft(attempt?.id ?? ''));
    if (pair) setPreferences(pair.preferences);
  }, [attempt?.id]);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'pairActionResult' && message.requestId === sent.current?.id) {
          setPending(undefined);
          setError(message.error ?? '');
          if (!message.error && sent.current.content === draftRef.current) {
            setDraft('');
            savePairDraft(attempt?.id ?? '', '');
          }
          sent.current = undefined;
        }
        if (
          message.type === 'stepApprovalResult' &&
          message.featureId === feature.id &&
          message.stepId === step.id &&
          message.attemptId === attempt?.id &&
          approval.current
        ) {
          approval.current = false;
          setApproving(false);
          if (message.error) setError(message.error);
          else exit.current();
        }
      }),
    [feature.id, step.id, attempt?.id],
  );
  const last = pair?.messages.at(-1);
  useEffect(() => {
    if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [last?.content, pair?.messages.length]);
  const act = (action: PairAction['action'], content?: string, withPreferences = false) => {
    if (!attempt || !pair || pending || locked) return;
    const requestId = crypto.randomUUID();
    sent.current = { id: requestId, content };
    setPending(requestId);
    setError('');
    dispatch({
      type: 'pairAction',
      featureId: feature.id,
      stepId: step.id,
      attemptId: attempt.id,
      expectedVersion: pair.version,
      requestId,
      action,
      ...(content?.trim() ? { content: content.trim() } : {}),
      ...(withPreferences ? { preferences } : {}),
    });
  };
  const requests = (state.humanRequests ?? []).filter(
    (r) => r.featureId === feature.id && r.stepId === step.id,
  );
  const unanswered = (attempt?.questions ?? []).filter(
    (q) => !attempt?.answers[q.id] && !requests.some((r) => r.id === q.id),
  );
  const blockers = approvalBlockers(feature, step, 'human');
  const accepted = Boolean(plan && pair?.approvedRevision === plan.revision && plan.acceptedAt);
  const unavailable = Boolean(locked || pending);
  const idleUnavailable = unavailable || pair?.busy || Boolean(state.workspaceOperation);
  return (
    <div className="page pair-page">
      <header className="pair-header">
        <button className="text-button" onClick={back}>
          <ArrowLeft size={16} /> Revenir à la session
        </button>
        <div className="pair-heading">
          <Users size={28} />
          <div>
            <span className="eyebrow">{feature.title} · TRAVAIL EN PAIR</span>
            <h1>{step.name}</h1>
          </div>
        </div>
        <div className="pair-toolbar">
          {historic && (
            <span className="pair-status">Tentative antérieure · consultation seule</span>
          )}
          <span className={`pair-status ${pair?.busy ? 'busy' : ''}`} role="status">
            {pair?.busy && <LoaderCircle className="spin" size={14} />}{' '}
            {pair
              ? requests.length
                ? 'Votre réponse est attendue'
                : pair.busy && pair.turn?.kind !== 'work'
                  ? 'Échange avec l’agent'
                  : pairPhaseLabels[pair.phase]
              : 'Préparation du binôme…'}
            {pair?.mode === 'solo' && ' · Autonomie'}
          </span>
          {!locked && pair && (
            <>
              {pair.mode === 'solo' ? (
                <button
                  className="button secondary small"
                  disabled={unavailable}
                  onClick={() => act('pair')}
                >
                  <Users size={14} /> Reprendre en pair
                </button>
              ) : (
                accepted &&
                (next || pair.busy) && (
                  <button
                    className="button secondary small"
                    disabled={unavailable || Boolean(requests.length)}
                    onClick={() => act('solo')}
                  >
                    <Bot size={14} /> Continuer cette étape en solo
                  </button>
                )
              )}
              {pair.busy && (
                <button
                  className="button secondary small"
                  disabled={unavailable}
                  onClick={() => act('pause')}
                >
                  <Pause size={14} /> Mettre en pause
                </button>
              )}
            </>
          )}
        </div>
      </header>
      {!pair ? (
        <section className="pair-empty">
          <LoaderCircle className="spin" />
          <p>Le contexte est transmis à l’agent. Son organisation apparaîtra ici.</p>
          <p className="muted">
            Si le lancement a échoué, reviens à la session pour ajuster le contexte.
          </p>
        </section>
      ) : (
        <>
          <div className="pair-layout">
            <section className="pair-conversation" aria-label="Échanges du binôme">
              <div className="pair-agent">
                <Avatar
                  agent={pair.snapshot.agent}
                  small
                  status={pair.busy ? 'running' : attempt.status}
                />
                <div>
                  <strong>{attempt.agentName ?? pair.snapshot.agent.name}</strong>
                  <small>
                    {pair.snapshot.step.model ||
                      pair.snapshot.agent.model ||
                      'Modèle de la session'}{' '}
                    ·{' '}
                    {pair.mode === 'pair'
                      ? 'Nous avançons ensemble'
                      : 'L’agent poursuit l’organisation convenue'}
                  </small>
                </div>
              </div>
              <div
                className="pair-messages"
                ref={feed}
                role="log"
                aria-label="Historique des échanges"
                aria-live="polite"
                onScroll={() => {
                  const el = feed.current;
                  if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                }}
              >
                {!pair.messages.length && (
                  <p className="muted">
                    L’agent prépare une proposition d’organisation avec le contexte de cette étape.
                  </p>
                )}
                {pair.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`pair-message ${message.role} ${message.status}`}
                  >
                    <div className="pair-message-meta">
                      <strong>
                        {message.role === 'user'
                          ? 'Vous'
                          : message.role === 'system'
                            ? 'Décision de travail'
                            : (attempt.agentName ?? pair.snapshot.agent.name)}
                      </strong>
                      <time dateTime={message.at}>
                        {new Date(message.at).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    <div className="markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {visibleText(message.content) ||
                          (message.status === 'streaming'
                            ? 'L’agent prépare sa réponse…'
                            : 'Organisation présentée dans le panneau de suivi.')}
                      </ReactMarkdown>
                    </div>
                    {message.status === 'interrupted' && (
                      <small>Réponse interrompue · travail partiel conservé</small>
                    )}
                    {pair.pendingMessages.includes(message.id) && (
                      <small>Message enregistré · traité après le bloc en cours</small>
                    )}
                  </article>
                ))}
              </div>
              {!historic && <HumanRequests requests={requests} dispatch={dispatch} />}
              {!historic && unanswered.length > 0 && (
                <form
                  className="pair-recovered-questions"
                  onSubmit={(e) => {
                    e.preventDefault();
                    dispatch({
                      type: 'answerQuestions',
                      featureId: feature.id,
                      stepId: step.id,
                      answers,
                    });
                  }}
                >
                  <strong>Questions conservées avant l’interruption</strong>
                  {unanswered.map((q) => (
                    <label key={q.id} className="field">
                      <span>{q.text}</span>
                      <textarea
                        required
                        value={answers[q.id] ?? ''}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      />
                    </label>
                  ))}
                  <button
                    className="button secondary"
                    disabled={unavailable || !unanswered.every((q) => answers[q.id]?.trim())}
                  >
                    Enregistrer mes réponses
                  </button>
                </form>
              )}
              {(error || pair.error) && (
                <div className="inline-error" role="alert">
                  {error || pair.error}
                </div>
              )}
              {!locked && (
                <form
                  className="pair-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act('message', draft);
                  }}
                >
                  <label className="field">
                    <span>
                      {pair.phase === 'planning'
                        ? 'Convenons de l’organisation'
                        : 'Votre message à l’agent'}
                    </span>
                    <textarea
                      rows={3}
                      maxLength={30000}
                      value={draft}
                      disabled={Boolean(pending)}
                      placeholder="Une question, une préférence, une autre direction…"
                      onChange={(e) => {
                        setDraft(e.target.value);
                        savePairDraft(attempt.id, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && draft.trim()) {
                          e.preventDefault();
                          act('message', draft);
                        }
                      }}
                    />
                  </label>
                  <div className="pair-composer-footer">
                    <small>
                      {pair.busy
                        ? 'Ton message sera traité après le bloc en cours. Tu peux aussi mettre le travail en pause.'
                        : 'Échanger conserve les permissions et les validations convenues.'}
                    </small>
                    <button className="button primary" disabled={unavailable || !draft.trim()}>
                      <ArrowUp size={15} /> Envoyer
                    </button>
                  </div>
                </form>
              )}
            </section>
            <aside className="pair-sidebar" aria-label="Organisation et avancement">
              <section className="pair-plan">
                <span className="eyebrow">NOTRE ORGANISATION</span>
                <h2>
                  {plan
                    ? accepted
                      ? 'Organisation convenue'
                      : 'Proposition à valider'
                    : 'Le cadrage commence'}
                </h2>
                <p>
                  {plan?.summary ??
                    'L’agent propose une manière de travailler adaptée à la mission. Tu pourras l’ajuster avant de commencer.'}
                </p>
                <ol>
                  {plan?.blocks.map((b) => {
                    const done = pair.results.some(
                      (r) => r.planRevision === plan.revision && r.blockId === b.id,
                    );
                    return (
                      <li key={b.id} className={done ? 'done' : next?.id === b.id ? 'current' : ''}>
                        {done ? (
                          <CheckCircle2 size={18} />
                        ) : pair.busy && pair.turn?.blockId === b.id ? (
                          <LoaderCircle size={18} className="spin" />
                        ) : (
                          <Circle size={18} />
                        )}
                        <div>
                          <strong>{b.title}</strong>
                          <p>{b.description}</p>
                          <small>
                            {done ? 'Terminé' : next?.id === b.id ? 'Prochain bloc' : 'À venir'}
                          </small>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {!locked && (
                  <div className="pair-plan-actions">
                    {pair.phase === 'planning' && plan && (
                      <button
                        className="button primary"
                        disabled={idleUnavailable || Boolean(pair.error)}
                        onClick={() => act('approve-plan')}
                      >
                        <Check size={15} /> Valider l’organisation et démarrer
                      </button>
                    )}
                    {pair.phase === 'checkpoint' && accepted && next && (
                      <button
                        className="button primary"
                        disabled={idleUnavailable || unanswered.length > 0}
                        onClick={() => act('continue')}
                      >
                        <Play size={15} />{' '}
                        {pair.error ? 'Reprendre ce bloc' : 'Continuer avec le prochain bloc'}
                      </button>
                    )}
                    {['paused', 'interrupted'].includes(pair.phase) && (
                      <button
                        className="button primary"
                        disabled={idleUnavailable || unanswered.length > 0}
                        onClick={() => act('resume')}
                      >
                        <Play size={15} /> Reprendre le travail
                      </button>
                    )}
                  </div>
                )}
              </section>
              {!locked && (
                <details className="pair-settings">
                  <summary>Ajuster notre façon de travailler</summary>
                  <PairPreferencesUI
                    value={preferences}
                    onChange={setPreferences}
                    disabled={Boolean(idleUnavailable)}
                  />
                  <button
                    className="button secondary"
                    disabled={idleUnavailable}
                    onClick={() => act('reorganize', undefined, true)}
                  >
                    Proposer une nouvelle organisation
                  </button>
                </details>
              )}
              {pair.decisions.length > 0 && (
                <section>
                  <h2>Décisions retenues</h2>
                  <ul>
                    {pair.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </section>
              )}
              <details>
                <summary>Contexte transmis à l’agent</summary>
                <pre className="pair-context">{pair.snapshot.prompt}</pre>
              </details>
              <details>
                <summary>Historique des organisations ({pair.plans.length})</summary>
                {pair.plans.map((p) => (
                  <article key={p.revision}>
                    <strong>
                      Organisation {p.revision} · {p.acceptedAt ? 'Validée' : 'Proposée'}
                    </strong>
                    <p>{p.summary}</p>
                    <ul>
                      {p.blocks.map((b) => (
                        <li key={b.id}>{b.title}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </details>
              <div className="pair-footnote">
                {pair.calls} appel{pair.calls > 1 ? 's' : ''} · {attempt.changedFiles.length}{' '}
                fichier{attempt.changedFiles.length > 1 ? 's' : ''} modifié
                {attempt.changedFiles.length > 1 ? 's' : ''}
                <br />
                {attempt.evidence?.length ?? 0} vérification
                {(attempt.evidence?.length ?? 0) > 1 ? 's' : ''} enregistrée
                {(attempt.evidence?.length ?? 0) > 1 ? 's' : ''}
              </div>
              {step.attempts.filter((a) => a.pair).length > 1 && (
                <label className="field">
                  <span>Historique des tentatives pair</span>
                  <select
                    disabled={Boolean(pending)}
                    value={attempt.id}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    {step.attempts
                      .filter((a) => a.pair)
                      .map((a, i) => (
                        <option key={a.id} value={a.id}>
                          Tentative {i + 1}
                          {a.id === latest?.id ? ' · actuelle' : ''}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </aside>
          </div>
          {pair.phase === 'review' && attempt.artifact && (
            <section className="pair-result">
              <div className="pair-result-heading">
                <CheckCircle2 size={25} />
                <div>
                  <span className="eyebrow">À VOTRE REGARD</span>
                  <h2>Le travail est prêt à relire</h2>
                </div>
              </div>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {attempt.artifact.content}
                </ReactMarkdown>
              </div>
              {!locked && (
                <>
                  <div className="pair-result-actions">
                    <button
                      className="button secondary"
                      disabled={idleUnavailable || !draft.trim()}
                      onClick={() => act('revise', draft)}
                    >
                      Demander la correction décrite dans mon message
                    </button>
                    <button
                      className="button primary"
                      disabled={idleUnavailable || approving || blockers.length > 0}
                      onClick={() => {
                        approval.current = true;
                        setApproving(true);
                        setError('');
                        dispatch({
                          type: 'approveStep',
                          featureId: feature.id,
                          stepId: step.id,
                          expectedAttemptId: attempt.id,
                          expectedRevision: attempt.revision ?? 0,
                        });
                      }}
                    >
                      <Check size={15} />{' '}
                      {approving
                        ? 'Validation en cours…'
                        : 'Valider l’étape et revenir à la session'}
                    </button>
                  </div>
                  {blockers.length > 0 && (
                    <div className="approval-blockers">
                      {blockers.map((b) => (
                        <p key={b}>{b}</p>
                      ))}
                      <button className="text-button" onClick={back}>
                        Ouvrir les critères et les vérifications dans la session
                      </button>
                    </div>
                  )}
                  <p className="muted">
                    Pour demander une correction, décris-la dans le champ de message ci-dessus.
                  </p>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
