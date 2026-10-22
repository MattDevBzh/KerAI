import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, MessageSquare, Minimize2, ShieldCheck } from 'lucide-react';
import type { ClientMessage, Feature, HumanRequest } from '../src/shared/types';
import { allFeatures } from '../src/shared/subplans';
import { useDialogAccessibility } from './Ergonomics';
import { subscribe } from './bridge';
import './human-requests.css';

type Dispatch = (message: ClientMessage) => void;
const permissionKinds: Record<string, string> = {
  read: 'lecture',
  write: 'écriture',
  shell: 'commande',
  url: 'accès à une adresse',
  mcp: 'outil MCP',
};
const RequestContext = createContext<{
  answers: Record<string, string>;
  answer: (id: string, value: string) => void;
  foreground?: string;
  highlight: (id: string) => void;
  submit: (id: string, value: string) => void;
  pending: Set<string>;
} | null>(null);

/** A single queue and draft per request, shared by the chat and the foreground dialog. */
export function HumanRequestProvider({
  requests,
  features,
  className,
  dispatch,
  children,
}: {
  requests: HumanRequest[];
  features: Feature[];
  className?: string;
  dispatch: Dispatch;
  children: ReactNode;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reduced, setReduced] = useState(new Set<string>());
  const [selected, setSelected] = useState<string>();
  const [pending, setPending] = useState(new Set<string>());
  const pendingRef = useRef(pending);
  useEffect(() => {
    const ids = new Set(requests.map((request) => request.id));
    setAnswers((current) =>
      Object.keys(current).every((id) => ids.has(id))
        ? current
        : Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))),
    );
    setReduced((current) =>
      [...current].every((id) => ids.has(id))
        ? current
        : new Set([...current].filter((id) => ids.has(id))),
    );
    if ([...pendingRef.current].some((id) => !ids.has(id))) {
      pendingRef.current = new Set([...pendingRef.current].filter((id) => ids.has(id)));
      setPending(pendingRef.current);
    }
  }, [requests]);
  const active =
    requests.find((r) => r.id === selected) ?? requests.find((r) => !reduced.has(r.id));
  const owner = active && allFeatures(features).find((feature) => feature.id === active.featureId);
  const ownerStep = owner && owner.steps.find((step) => step.id === active?.stepId);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'error') {
          pendingRef.current = new Set();
          setPending(pendingRef.current);
        }
      }),
    [],
  );
  const minimize = () => {
    setReduced((ids) => new Set([...ids, ...requests.map((r) => r.id)]));
    setSelected(undefined);
  };
  return (
    <RequestContext.Provider
      value={{
        answers,
        answer: (id, value) => setAnswers((current) => ({ ...current, [id]: value })),
        foreground: active?.id,
        highlight: setSelected,
        pending,
        submit: (id, value) => {
          if (pendingRef.current.has(id) || !requests.some((r) => r.id === id)) return;
          pendingRef.current = new Set([...pendingRef.current, id]);
          setPending(pendingRef.current);
          dispatch({ type: 'answerHumanRequest', requestId: id, answer: value });
        },
      }}
    >
      <div className={className}>{children}</div>
      {active &&
        createPortal(
          <PromptDialog
            key={active.id}
            request={active}
            count={requests.length}
            context={owner ? `${owner.title}${ownerStep ? ` · ${ownerStep.name}` : ''}` : undefined}
            minimize={minimize}
            dispatch={dispatch}
          />,
          document.body,
        )}
    </RequestContext.Provider>
  );
}

function PromptDialog({
  request,
  count,
  context,
  minimize,
  dispatch,
}: {
  request: HumanRequest;
  count: number;
  context?: string;
  minimize: () => void;
  dispatch: Dispatch;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialogAccessibility(ref, minimize);
  return (
    <div className="human-prompt-backdrop">
      <section
        className="human-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Votre réponse est attendue"
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <div>
            <h2>À toi de jouer</h2>
            {context && <p className="human-prompt-context">{context}</p>}
            <p>
              {count > 1
                ? `${count} demandes en attente`
                : 'L’agent attend ta réponse pour continuer.'}
            </p>
          </div>
          <button className="button secondary small" onClick={minimize}>
            <Minimize2 size={14} /> Réduire au chat
          </button>
        </header>
        <RequestCard request={request} dispatch={dispatch} popup />
      </section>
    </div>
  );
}

export function HumanRequests({
  requests,
  dispatch,
}: {
  requests: HumanRequest[];
  dispatch: Dispatch;
}) {
  return (
    <div className="human-requests">
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} dispatch={dispatch} />
      ))}
    </div>
  );
}

function RequestCard({
  request: r,
  dispatch,
  popup = false,
}: {
  request: HumanRequest;
  dispatch: Dispatch;
  popup?: boolean;
}) {
  const shared = useContext(RequestContext);
  const [localAnswer, setLocalAnswer] = useState('');
  const answer = shared?.answers[r.id] ?? localAnswer;
  const setAnswer = (value: string) =>
    shared ? shared.answer(r.id, value) : setLocalAnswer(value);
  const foreground = !popup && shared?.foreground === r.id;
  const pending = shared?.pending.has(r.id) ?? false;
  const submit = (value: string) =>
    shared
      ? shared.submit(r.id, value)
      : dispatch({ type: 'answerHumanRequest', requestId: r.id, answer: value });
  return (
    <section className={`human-request ${r.kind}`}>
      <div className="human-request-heading">
        <span className="eyebrow">
          {r.kind !== 'question' ? <ShieldCheck size={13} /> : <MessageSquare size={13} />}{' '}
          {r.kind === 'native-permission'
            ? 'AUTORISATION COPILOT · CETTE DEMANDE'
            : r.kind === 'mcp-permission'
              ? 'AUTORISATION MCP'
              : 'VOTRE RÉPONSE EST NÉCESSAIRE'}
        </span>
        {!popup && shared && (
          <button className="text-button" onClick={() => shared.highlight(r.id)}>
            <ArrowUpRight size={14} /> Mettre en avant le prompt
          </button>
        )}
      </div>
      <h3>{r.question}</h3>
      {r.details && <pre>{r.details}</pre>}
      {foreground ? (
        <p className="field-help">Réponse ouverte dans la popin. Réduis-la pour répondre ici.</p>
      ) : (
        <fieldset className="human-response" disabled={pending}>
          {r.kind !== 'question' ? (
            <div className="human-actions">
              <button className="button secondary small" onClick={() => submit('deny')}>
                Refuser
              </button>
              <button className="button primary small" onClick={() => submit('allow')}>
                <ShieldCheck size={13} /> Autoriser cette demande
              </button>
              {r.choices?.includes('allow-workspace-read') && (
                <button
                  className="button secondary small"
                  onClick={() => submit('allow-workspace-read')}
                >
                  Autoriser les lectures dans cette solution
                </button>
              )}
              {r.choices?.includes('allow-kind') && (
                <button className="button secondary small" onClick={() => submit('allow-kind')}>
                  Autoriser ce type pour la session
                </button>
              )}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (answer.trim()) submit(answer.trim());
              }}
            >
              <div className="human-choices">
                {r.choices?.map((choice) => (
                  <button
                    type="button"
                    key={choice}
                    className={`button small ${answer === choice ? 'primary' : 'secondary'}`}
                    onClick={() => setAnswer(choice)}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              {r.allowFreeform && (
                <label className="field">
                  <span>Votre réponse</span>
                  <textarea
                    aria-label="Votre réponse"
                    rows={3}
                    maxLength={30000}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                </label>
              )}
              <button className="button primary small" disabled={!answer.trim()}>
                Transmettre la réponse <Check size={14} />
              </button>
            </form>
          )}
          {r.choices?.includes('allow-kind') && (
            <p className="field-help">
              Type : {permissionKinds[r.permissionKind ?? ''] ?? r.permissionKind}.{' '}
              {r.permissionKind === 'read' &&
                'L’accord par type couvre aussi les lectures hors de la solution. '}
              Accord valable pour cette session et ses sous-équipes, jusqu’à la fermeture du projet
              ou au changement de mode de permissions.
            </p>
          )}
          {pending && <p role="status">Réponse en cours de transmission…</p>}
        </fieldset>
      )}
    </section>
  );
}
