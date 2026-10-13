import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Monitor, Palette } from 'lucide-react';
import { normalizeTheme, THEME_IDS, type ThemeId } from '../src/shared/themes';
import { isDemo, isHosted, send, subscribe } from './bridge';

const themes: Record<ThemeId, { name: string; kind: string; description: string }> = {
  auto: { name: 'Suivre VS Code', kind: 'Automatique', description: 'Votre thème de l’éditeur' },
  aube: { name: 'Aube', kind: 'Clair', description: 'Crème & corail' },
  brume: { name: 'Brume', kind: 'Clair', description: 'Bleu & ardoise' },
  sauge: { name: 'Sauge', kind: 'Clair', description: 'Vert & lin' },
  minuit: { name: 'Minuit', kind: 'Sombre', description: 'Bleu & indigo' },
  foret: { name: 'Forêt', kind: 'Sombre', description: 'Vert & cuivre' },
};
interface ThemeContextValue {
  theme: ThemeId;
  pending: ThemeId | null;
  highContrast: boolean;
  status: string;
  error: string;
  choose: (theme: ThemeId) => void;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);
const contrastMode = () =>
  document.body.classList.contains('vscode-high-contrast') ||
  document.body.classList.contains('vscode-high-contrast-light') ||
  window.matchMedia('(forced-colors: active)').matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(() =>
    normalizeTheme(document.documentElement.dataset.studioTheme),
  );
  const [pending, setPending] = useState<ThemeId | null>(null);
  const [highContrast, setHighContrast] = useState(contrastMode);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const request = useRef<string | null>(null);
  const choiceFocus = useRef<HTMLElement | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const forced = window.matchMedia('(forced-colors: active)');
    const update = () => setHighContrast(contrastMode());
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    forced.addEventListener('change', update);
    return () => {
      observer.disconnect();
      forced.removeEventListener('change', update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.studioTheme = theme;
    document.documentElement.dataset.studioThemeEffective = highContrast ? 'auto' : theme;
  }, [theme, highContrast]);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'themeState') return;
      if (message.requestId && message.requestId !== request.current) return;
      setTheme(normalizeTheme(message.theme));
      if (message.requestId) {
        clearTimeout(timeout.current);
        request.current = null;
        setPending(null);
        setError(message.error ?? '');
        setStatus(message.error ? '' : 'Préférence personnelle enregistrée.');
      } else {
        setStatus('');
        setError('');
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout.current);
    };
  }, []);
  useEffect(() => {
    if (pending === null && choiceFocus.current) {
      if (document.activeElement === document.body) choiceFocus.current.focus();
      choiceFocus.current = null;
    }
  }, [pending]);
  const choose = (next: ThemeId) => {
    if (request.current || next === theme) return;
    setError('');
    if (isDemo) {
      setTheme(next);
      setStatus('Aperçu pour cette session de démonstration.');
      return;
    }
    if (!isHosted) return;
    const requestId = crypto.randomUUID();
    choiceFocus.current = document.activeElement as HTMLElement | null;
    request.current = requestId;
    setPending(next);
    setStatus('Enregistrement de la préférence…');
    send({ type: 'setTheme', theme: next, requestId });
    timeout.current = setTimeout(() => {
      request.current = null;
      setPending(null);
      setStatus('');
      setError('VS Code n’a pas confirmé l’enregistrement. Réessayez.');
    }, 15000);
  };
  return (
    <ThemeContext.Provider value={{ theme, pending, highContrast, status, error, choose }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemePicker() {
  const value = useContext(ThemeContext)!;
  return (
    <section className="settings-card appearance-card" aria-labelledby="appearance-title">
      <div className="settings-card-title">
        <span className="settings-icon color-0">
          <Palette size={21} />
        </span>
        <div>
          <h2 id="appearance-title">L’ambiance du cockpit</h2>
          <p>
            {isDemo
              ? 'Explorez les thèmes pendant cette démonstration.'
              : 'Votre préférence personnelle, dans tous vos projets.'}
          </p>
        </div>
      </div>
      <fieldset
        className="theme-grid"
        disabled={value.pending !== null}
        aria-describedby="theme-help"
      >
        <legend className="sr-only">Thème du cockpit</legend>
        {THEME_IDS.map((id) => (
          <label className={`theme-choice ${value.theme === id ? 'selected' : ''}`} key={id}>
            <input
              type="radio"
              name="studio-theme"
              value={id}
              checked={value.theme === id}
              onChange={() => value.choose(id)}
              aria-label={`${themes[id].name} — ${themes[id].kind}`}
            />
            <span className="theme-choice-content">
              <span className={`theme-preview theme-preview-${id}`} aria-hidden="true">
                <span className="theme-preview-sidebar">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="theme-preview-workspace">
                  <i />
                  <span>
                    <i />
                    <i />
                  </span>
                </span>
              </span>
              <span className="theme-choice-title">
                {id === 'auto' && <Monitor size={14} />}
                <strong>{themes[id].name}</strong>
                {value.theme === id && <Check size={16} />}
              </span>
              <span className="theme-choice-description">
                {themes[id].kind} · {themes[id].description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="theme-help" id="theme-help">
        {isDemo
          ? 'Aperçu uniquement : aucun thème n’est enregistré.'
          : 'Le choix est enregistré dès sa sélection, séparément des réglages des agents.'}
      </p>
      {value.highContrast && (
        <p className="theme-contrast-note">
          Le contraste élevé de VS Code est prioritaire. Votre préférence est conservée.
        </p>
      )}
      <p className="theme-feedback" role={value.error ? 'alert' : 'status'} aria-live="polite">
        {value.error || value.status}
      </p>
    </section>
  );
}
