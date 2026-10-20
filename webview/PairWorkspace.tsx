import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, Check, FileText, LoaderCircle, Play, Send, Square, Users } from 'lucide-react';
import type { ClientMessage, Feature, FeatureStep, StudioState } from '../src/shared/types';
import { pairPaces, PAIR_PACES, type PairAction, type PairPace } from '../src/shared/pair';
import { approvalBlockers } from '../src/core/validation';
import { formatCredits, toCredits } from '../src/shared/credits';
import { Avatar } from './Avatar';
import { HumanRequests } from './ExecutionUI';
import { subscribe, savedPairDraft, persistView } from './bridge';
import './pair.css';

export function PairWorkspace({
  feature,
  step,
  state,
  dispatch,
  back,
  confirm,
}: {
  feature: Feature;
  step: FeatureStep;
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  back: () => void;
  confirm: (title: string, description: string, action: () => void) => void;
}) {
  const attempt = step.attempts.at(-1)!;
  const pair = attempt.pair!;
  const agent = state.agents.find((a) => a.id === step.agentId);
  const [draft, setDraft] = useState(() => savedPairDraft(attempt.id));
  useEffect(
    () => persistView({ pairDraft: { attemptId: attempt.id, text: draft } }),
    [attempt.id, draft],
  );
  const [pace, setPace] = useState<PairPace>(pair.pace);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [context, setContext] = useState<string>();
  const [contextPending, setContextPending] = useState('');
  const [approving, setApproving] = useState(false);
  const sentDraft = useRef('');
  const busy = step.status === 'running';
  const blocked =
    !state.workspace.trusted ||
    Boolean(feature.archived) ||
    state.runtime.state !== 'ready' ||
    Boolean(state.workspaceOperation) ||
    state.features.some(
      (f) => f.steps.some((s) => s.status === 'running') || f.autopilot?.status === 'running',
    );
  const canContinue = ['waiting_input', 'failed', 'cancelled', 'interrupted'].includes(step.status);
  const ready = pair.phase === 'review';
  const blockers = approvalBlockers(feature, step, 'human');
  useEffect(() => setPace(pair.pace), [pair.pace]);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'pairTurnResult' && message.requestId === pending) {
          setPending('');
          setError(message.error ?? '');
          if (!message.error) setDraft((value) => (value === sentDraft.current ? '' : value));
        }
        if (message.type === 'pairContextResult' && message.requestId === contextPending) {
          setContextPending('');
          setContext(message.context);
          setError(message.error ?? '');
        }
        if (
          message.type === 'stepApprovalResult' &&
          message.featureId === feature.id &&
          message.stepId === step.id &&
          message.attemptId === attempt.id
        ) {
          setApproving(false);
          setError(message.error ?? '');
          if (!message.error) back();
        }
      }),
    [pending, contextPending, feature.id, step.id, attempt.id, back],
  );
  useEffect(() => {
    if (!pending || busy) return;
    const timer = setTimeout(() => {
      setPending('');
      setError('La réponse du host tarde. Vérifie l’état de la conversation avant de réessayer.');
    }, 30000);
    return () => clearTimeout(timer);
  }, [pending, busy]);
  const act = (action: PairAction) => {
    const id = crypto.randomUUID();
    sentDraft.current = draft;
    setError('');
    setPending(id);
    dispatch({
      type: 'pairTurn',
      requestId: id,
      featureId: feature.id,
      stepId: step.id,
      attemptId: attempt.id,
      expectedRevision: pair.revision,
      action,
      message: draft.trim(),
      pace,
    });
  };
  const credits =
    attempt.usage?.unit === 'nano-AIU' && attempt.usage.cost !== undefined
      ? `${formatCredits(toCredits(attempt.usage.cost))} crédits${attempt.usage.incompleteCost ? ' connus (partiel)' : ''}`
      : 'Crédits non communiqués';
  const activity = attempt.logs.filter(
    (log) => !pair.turnStartedAt || log.at >= pair.turnStartedAt,
  );
  return (
    <section className="pair-workspace" aria-label="Travail en mode pair">
      <header className="pair-heading">
        <button className="button secondary small" onClick={back}>
          <ArrowLeft size={15} /> Revenir à la session
        </button>
        <div className="pair-title">
          <Avatar agent={agent} status={step.status} />
          <div>
            <span className="eyebrow">
              <Users size={14} /> MODE PAIR
            </span>
            <h2>{step.name}</h2>
            <p>
              {feature.title} · {attempt.agentName || agent?.name || step.agentId}
            </p>
          </div>
        </div>
        <span className="pair-credit">
          {credits} · {pair.turns} tour{pair.turns > 1 ? 's' : ''}
        </span>
      </header>
      <div className="pair-grid">
        <main className="pair-conversation">
          <div className="pair-status" role="status">
            <strong>
              {ready
                ? 'Livrable prêt pour ta validation'
                : busy
                  ? 'L’agent prépare sa réponse…'
                  : pair.organizationApproved
                    ? 'Point d’arrêt — à toi de choisir la suite'
                    : 'Cadrons le travail ensemble'}
            </strong>
            <p>
              {ready
                ? 'Relis le livrable avant de valider l’étape.'
                : 'Tu peux quitter cet écran. Le rythme convenu reste actif ; seul « Continuer en solo » autorise la suite sans pause entre les lots.'}
            </p>
          </div>
          <div
            className="pair-messages"
            role="log"
            aria-label="Conversation de l’étape"
            aria-live="polite"
          >
            {pair.messages.map((message) => (
              <article key={message.id} className={`pair-message pair-${message.role}`}>
                <span className="eyebrow">
                  {message.role === 'user'
                    ? 'Toi'
                    : message.role === 'assistant'
                      ? attempt.agentName || 'Agent'
                      : 'Feature Studio'}
                </span>
                <div className="markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                </div>
              </article>
            ))}
            {busy && (
              <article className="pair-message pair-assistant">
                <span className="eyebrow">
                  <LoaderCircle size={14} className="spin" /> En cours
                </span>
                <div className="pair-stream">
                  {activity
                    .filter((log) => log.kind === 'message')
                    .map((log) => (
                      <p key={log.id}>{log.message}</p>
                    ))}
                </div>
                <p className="muted">
                  {
                    activity.filter((log) => log.kind === 'tool' || log.kind === 'info').at(-1)
                      ?.message
                  }
                </p>
              </article>
            )}
          </div>
          <HumanRequests
            requests={(state.humanRequests ?? []).filter(
              (r) => r.featureId === feature.id && r.stepId === step.id,
            )}
            dispatch={dispatch}
          />
          {(error || attempt.error) && (
            <p className="inline-error" role="alert">
              {error || attempt.error}
            </p>
          )}
          {!ready && (
            <div className="pair-composer">
              <label className="field">
                <span>Ton message, tes préférences ou tes ajustements</span>
                <textarea
                  rows={4}
                  maxLength={30000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Commençons par comprendre le problème, puis faisons une petite modification…"
                />
              </label>
              <button
                className="button secondary"
                disabled={blocked || !!pending || !canContinue || !draft.trim()}
                onClick={() => act('discuss')}
              >
                <Send size={15} /> Envoyer et ajuster
              </button>
              <p className="field-help">
                Un message ajuste l’organisation. Le travail commence avec le bouton de lancement
                ci-contre.
              </p>
            </div>
          )}
        </main>
        <aside className="pair-sidebar">
          {!ready && (
            <div className="pair-card">
              <h3>Notre rythme</h3>
              <fieldset className="pair-paces">
                <legend>Rythme du prochain tour</legend>
                {PAIR_PACES.map((value) => (
                  <label key={value} className={pace === value ? 'selected' : ''}>
                    <input
                      type="radio"
                      name={`pair-pace-${attempt.id}`}
                      value={value}
                      checked={pace === value}
                      disabled={busy || !!pending}
                      onChange={() => setPace(value)}
                    />
                    <span>
                      <strong>{pairPaces[value].label}</strong>
                      <small>{pairPaces[value].description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                className="button primary"
                disabled={
                  blocked ||
                  !!pending ||
                  !canContinue ||
                  !pair.messages.some((m) => m.role === 'assistant')
                }
                onClick={() => act('work')}
              >
                <Play size={15} />{' '}
                {pair.organizationApproved
                  ? 'Lancer la suite convenue'
                  : 'Valider l’organisation et démarrer'}
              </button>
              <button
                className="button secondary"
                disabled={
                  (!busy && blocked) ||
                  !!pair.soloRequested ||
                  !state.workspace.trusted ||
                  (!busy && !!pending) ||
                  (!busy && !canContinue) ||
                  !pair.organizationApproved
                }
                onClick={() =>
                  confirm(
                    'Continuer en solo ?',
                    'L’agent poursuivra les tâches restantes avec les décisions prises ici, jusqu’au livrable. Les questions bloquantes et la validation finale restent humaines.',
                    () => act('solo'),
                  )
                }
              >
                <Play size={15} />{' '}
                {pair.soloRequested ? 'Relais solo demandé' : 'Continuer en solo'}
              </button>
              <button
                className="text-button"
                disabled={blocked || !!pending || !canContinue || !pair.organizationApproved}
                onClick={() => act('finish')}
              >
                <FileText size={15} /> Préparer le livrable actuel
              </button>
            </div>
          )}
          {ready && (
            <div className="pair-card">
              <h3>Valider le travail</h3>
              <p>La validation débloque les étapes suivantes et te ramène à la session.</p>
              {blockers.length > 0 && (
                <ul>
                  {blockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              <button
                className="button primary"
                disabled={blocked || approving || blockers.length > 0}
                onClick={() =>
                  confirm(
                    'Valider cette étape ?',
                    'Approuver le livrable actuel et débloquer la suite du parcours.',
                    () => {
                      setApproving(true);
                      dispatch({
                        type: 'approveStep',
                        featureId: feature.id,
                        stepId: step.id,
                        expectedAttemptId: attempt.id,
                        expectedRevision: attempt.revision ?? 0,
                      });
                    },
                  )
                }
              >
                <Check size={16} /> Valider l’étape
              </button>
              <button className="button secondary" onClick={back}>
                Relire ou corriger dans la session
              </button>
            </div>
          )}
          <div className="pair-card">
            <h3>Contexte et travail</h3>
            <p>
              Le contexte confirmé au lancement, les décisions et le travail restent attachés à
              cette tentative.
            </p>
            <button
              className="button secondary small"
              disabled={!!contextPending}
              onClick={() => {
                const requestId = crypto.randomUUID();
                setContextPending(requestId);
                dispatch({
                  type: 'pairContext',
                  requestId,
                  featureId: feature.id,
                  stepId: step.id,
                  attemptId: attempt.id,
                });
              }}
            >
              Voir le contexte confirmé
            </button>
            {context !== undefined && (
              <details open>
                <summary>Contexte complet</summary>
                <pre className="pair-context">{context}</pre>
              </details>
            )}
            <p>
              {attempt.changedFiles.length} fichier{attempt.changedFiles.length > 1 ? 's' : ''}{' '}
              modifié{attempt.changedFiles.length > 1 ? 's' : ''}
            </p>
            {attempt.changedFiles.length > 0 && (
              <ul className="pair-files">
                {attempt.changedFiles.map((path) => (
                  <li key={path}>
                    <button
                      className="text-button"
                      onClick={() => dispatch({ type: 'openDiff', featureId: feature.id, path })}
                    >
                      {path}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {busy && (
            <button
              className="button secondary"
              onClick={() =>
                confirm(
                  'Arrêter le tour en cours ?',
                  'Les changements déjà faits seront conservés. Tu pourras reprendre explicitement la conversation.',
                  () => dispatch({ type: 'cancelRun', featureId: feature.id }),
                )
              }
            >
              <Square size={14} /> Arrêter le tour
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
