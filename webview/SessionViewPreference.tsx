import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { House } from 'lucide-react';
import { isDemo, isHosted, send, subscribe } from './bridge';

const demoKey = 'featureStudio.demo.livingHq';
function initialPreference() {
  if (isDemo) {
    try {
      return localStorage.getItem(demoKey) === 'true';
    } catch {
      return false;
    }
  }
  return document.documentElement.dataset.studioLivingHq === 'true';
}

interface SessionViewPreference {
  enabled: boolean;
  pending: boolean;
  error: string;
  choose: (enabled: boolean) => void;
}
const SessionViewContext = createContext<SessionViewPreference | null>(null);
export const useSessionView = () => useContext(SessionViewContext)!;

/** A personal display preference; never changes a session or starts an agent. */
export function SessionViewProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(initialPreference);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const confirmed = useRef(enabled);
  const request = useRef<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    document.documentElement.dataset.studioLivingHq = String(enabled);
  }, [enabled]);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'livingHqState') return;
      if (message.requestId && message.requestId !== request.current) return;
      confirmed.current = message.enabled;
      setEnabled(message.enabled);
      if (message.requestId) {
        clearTimeout(timeout.current);
        request.current = null;
        setPending(false);
        setError(message.error ?? '');
      } else if (!request.current) setError('');
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout.current);
    };
  }, []);
  useEffect(() => {
    if (!pending && focus.current) {
      if (document.activeElement === document.body) focus.current.focus();
      focus.current = null;
    }
  }, [pending]);
  const choose = (next: boolean) => {
    if (request.current || next === enabled || (!isDemo && !isHosted)) return;
    setError('');
    setEnabled(next);
    if (isDemo) {
      try {
        localStorage.setItem(demoKey, String(next));
      } catch {
        setError('Vue appliquée pour cette ouverture ; le navigateur refuse sa mémorisation.');
      }
      return;
    }
    const requestId = crypto.randomUUID();
    focus.current = document.activeElement as HTMLElement | null;
    request.current = requestId;
    setPending(true);
    send({ type: 'setLivingHq', enabled: next, requestId });
    timeout.current = setTimeout(() => {
      request.current = null;
      setPending(false);
      setEnabled(confirmed.current);
      setError('VS Code n’a pas confirmé la préférence d’affichage. Réessaie.');
    }, 15000);
  };
  return (
    <SessionViewContext.Provider value={{ enabled, pending, error, choose }}>
      {children}
    </SessionViewContext.Provider>
  );
}

export function SessionViewToggle() {
  const { enabled, pending, error, choose } = useSessionView();
  return (
    <div className="session-view-preference">
      <label className="session-view-toggle" title="Préférence mémorisée pour toutes tes sessions">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(event) => choose(event.target.checked)}
        />
        <House size={16} aria-hidden="true" />
        Afficher le QG vivant
      </label>
      {pending && <span role="status">Enregistrement…</span>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
