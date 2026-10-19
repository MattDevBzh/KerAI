import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Sparkles, X } from 'lucide-react';
import { DRAGON_BALL_CODE } from '../src/shared/dragonBall';
import { isHosted, send, subscribe } from './bridge';
import { useDialogAccessibility } from './Ergonomics';
import './dragonball.css';

const SecretThemes = createContext({ dragonBallUnlocked: false, pending: false, unlock: () => {} });
export const useSecretThemes = () => useContext(SecretThemes);

export function DragonBalls() {
  return (
    <div className="dragon-balls" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => (
        <span className="dragon-ball" key={index}>
          <i>{'★'.repeat(index + 1)}</i>
        </span>
      ))}
    </div>
  );
}

function DragonReveal({ close }: { close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const title = useId();
  useDialogAccessibility(ref, close);
  return (
    <div className="modal-backdrop dragon-reveal-backdrop">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        tabIndex={-1}
        className="dragon-reveal"
      >
        <div className="dragon-reveal-art" aria-hidden="true" />
        <button className="dragon-close" aria-label="Fermer" onClick={close}>
          <X size={20} />
        </button>
        <div className="dragon-reveal-copy">
          <span className="eyebrow">SECRET DÉCOUVERT</span>
          <h2 id={title}>
            Le dragon a entendu
            <br />
            <em>ton appel.</em>
          </h2>
          <DragonBalls />
          <p>
            <strong>Dragon Ball est débloqué et activé.</strong>
            <br />
            Vingt guerriers du code, un nouveau QG et de quoi dépasser tes limites.
          </p>
          <p className="dragon-reveal-hint">
            Ton thème reste disponible dans les réglages, pour tous tes projets.
          </p>
          <button className="button primary" onClick={close}>
            <Sparkles size={18} /> Entrer dans le dojo
          </button>
        </div>
      </div>
    </div>
  );
}

export function SecretThemeProvider({ children }: { children: ReactNode }) {
  const [dragonBallUnlocked, setUnlocked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(false);
  const request = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'secretThemeState') return;
      if (message.requestId && message.requestId !== request.current) return;
      setUnlocked(message.dragonBallUnlocked);
      if (message.requestId) {
        clearTimeout(timer.current);
        request.current = null;
        setPending(false);
        setError(message.error ?? '');
        if (!message.error && message.dragonBallUnlocked) setReveal(true);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
    };
  }, []);
  const unlock = useCallback(() => {
    if (request.current || !isHosted) return;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setPending(true);
    setError('');
    send({ type: 'unlockDragonBall', sequence: [...DRAGON_BALL_CODE], requestId });
    timer.current = setTimeout(() => {
      request.current = null;
      setPending(false);
      setError('Le déblocage n’a pas été confirmé. Réessaie le code après la reconnexion.');
      send({ type: 'refreshSecretThemes' });
    }, 15000);
  }, []);
  return (
    <SecretThemes.Provider value={{ dragonBallUnlocked, pending, unlock }}>
      {children}
      {pending && (
        <div className="dragon-feedback" role="status">
          Une énergie mystérieuse se réveille…
        </div>
      )}
      {error && (
        <div className="dragon-feedback" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Fermer le message"
            onClick={() => setError('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {reveal && <DragonReveal close={() => setReveal(false)} />}
    </SecretThemes.Provider>
  );
}

/** Mounted only on Dashboard, including its detached control window. Never consumes arrows. */
export function DashboardSecret() {
  const { unlock } = useSecretThemes();
  useEffect(() => {
    let keys: string[] = [];
    let last = 0;
    const reset = () => {
      keys = [];
      last = 0;
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"], [role="tablist"], [role="radiogroup"]',
        ) ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        reset();
        return;
      }
      if (event.repeat) return;
      const now = Date.now();
      if (now - last > 4000) keys = [];
      last = now;
      if (!event.key.startsWith('Arrow')) {
        reset();
        return;
      }
      keys = [...keys, event.key].slice(-DRAGON_BALL_CODE.length);
      if (
        keys.length === DRAGON_BALL_CODE.length &&
        keys.every((key, i) => key === DRAGON_BALL_CODE[i])
      ) {
        reset();
        unlock();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', reset);
    };
  }, [unlock]);
  return null;
}
