import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Monitor, Palette } from 'lucide-react';
import {
  normalizeTheme,
  THEME_IDS,
  themeDefinitions as themes,
  type ThemeId,
} from '../src/shared/themes';
import { isDemo, isHosted, send, subscribe } from './bridge';
import { themeReward } from '../src/shared/rewards';
import { useRewards } from './RewardProvider';
import { useSecretThemes } from './SecretThemes';

interface ThemeContextValue {
  theme: ThemeId;
  pending: ThemeId | null;
  forcedColors: boolean;
  status: string;
  error: string;
  choose: (theme: ThemeId) => void;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);
export function useThemePreference() {
  return { theme: useContext(ThemeContext)?.theme ?? 'auto' };
}
export function useThemeAppearance() {
  const value = useContext(ThemeContext);
  const effective = value?.forcedColors ? 'auto' : (value?.theme ?? 'auto');
  return { theme: effective, ...themes[effective] };
}

const forcedColorMode = () => window.matchMedia('(forced-colors: active)').matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(() =>
    normalizeTheme(document.documentElement.dataset.studioTheme),
  );
  const [pending, setPending] = useState<ThemeId | null>(null);
  const [forcedColors, setForcedColors] = useState(forcedColorMode);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const request = useRef<string | null>(null);
  const choiceFocus = useRef<HTMLElement | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const forced = window.matchMedia('(forced-colors: active)');
    // Some ordinary editor themes declare uiTheme=hc-black. Only system-enforced
    // colors override an explicit cockpit choice; "auto" still follows VS Code.
    const update = () => setForcedColors(forcedColorMode());
    forced.addEventListener('change', update);
    return () => {
      forced.removeEventListener('change', update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.studioTheme = theme;
    const effective = forcedColors ? 'auto' : theme;
    document.documentElement.dataset.studioThemeEffective = effective;
    document.documentElement.dataset.studioThemeFamily = themes[effective].family;
    document.documentElement.dataset.studioAvatarPack = themes[effective].avatarPack ?? '';
  }, [theme, forcedColors]);
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
        setStatus(message.error ? '' : 'Thème enregistré automatiquement.');
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
    <ThemeContext.Provider value={{ theme, pending, forcedColors, status, error, choose }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemePicker() {
  const value = useContext(ThemeContext)!;
  const { state: rewardState } = useRewards();
  const { dragonBallUnlocked } = useSecretThemes();
  const availableThemes = THEME_IDS.filter((id) => {
    if (id === 'dragonball') return dragonBallUnlocked;
    const reward = themeReward(id);
    return !reward || (!rewardState?.error && rewardState?.unlocked.includes(reward));
  });
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
              : 'Enregistrement automatique, pour tous vos projets.'}
          </p>
        </div>
      </div>
      <p className="theme-collection-note">
        Trois univers en clair et sombre, et un événement à choisir quand vous en avez envie.
      </p>
      <fieldset
        className="theme-grid"
        disabled={value.pending !== null}
        aria-describedby="theme-help"
      >
        <legend className="sr-only">Thème du cockpit</legend>
        {availableThemes.map((id) => (
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
      <p className="theme-event-note">
        🎃 Halloween habille les vingt agents et le cockpit. Les portraits habituels reviennent dès
        que vous choisissez un autre thème.
      </p>
      <p className="theme-help" id="theme-help">
        {dragonBallUnlocked && (
          <span className="dragon-theme-note">
            ✦ Dragon Ball : ton dojo secret, vingt costumes et des auras de ki. Le thème est acquis
            définitivement.
            <br />
          </span>
        )}
        {isDemo
          ? 'Aperçu uniquement : aucun thème n’est enregistré.'
          : 'Choisissez un thème : aucun clic sur Enregistrer les réglages du projet n’est nécessaire.'}
      </p>
      {value.forcedColors && (
        <p className="theme-contrast-note">
          Les couleurs forcées du système sont actives. Votre thème est mémorisé et réapparaîtra
          quand ce mode sera désactivé.
        </p>
      )}
      <p className="theme-feedback" role={value.error ? 'alert' : 'status'} aria-live="polite">
        {value.error || value.status}
      </p>
    </section>
  );
}
