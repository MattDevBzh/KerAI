import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Minus, Plus, Scaling } from 'lucide-react';
import {
  adjacentZoom,
  automaticZoom,
  normalizeZoom,
  ZOOM_LEVELS,
  type ZoomPreference,
} from '../src/shared/zoom';
import { isDemo, isHosted, send, subscribe } from './bridge';
import './zoom.css';

const demoKey = 'featureStudio.demo.zoom';
function initialZoom(): ZoomPreference {
  if (isDemo) {
    try {
      return normalizeZoom(JSON.parse(localStorage.getItem(demoKey) ?? 'null'));
    } catch {
      return 'auto';
    }
  }
  return normalizeZoom(Number(document.documentElement.dataset.studioZoom));
}
function applyZoom(preference: ZoomPreference) {
  const percent = preference === 'auto' ? automaticZoom(innerWidth, innerHeight) : preference;
  const root = document.documentElement;
  root.dataset.studioZoom = String(preference);
  root.dataset.studioZoomEffective = String(percent);
  root.style.setProperty('--studio-zoom', String(percent / 100));
  return percent;
}
// Apply before the first React render, including when reopening a hosted webview.
applyZoom(initialZoom());

interface ZoomContextValue {
  preference: ZoomPreference;
  effective: number;
  pending: boolean;
  error: string;
  choose: (next: ZoomPreference) => void;
}
const ZoomContext = createContext<ZoomContextValue | null>(null);

export function ZoomProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(initialZoom);
  const [effective, setEffective] = useState(() => applyZoom(preference));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const confirmed = useRef(preference);
  const request = useRef<string | null>(null);
  const choiceFocus = useRef<HTMLElement | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    const update = () => setEffective(applyZoom(preference));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [preference]);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'zoomState') return;
      if (message.requestId && message.requestId !== request.current) return;
      const next = normalizeZoom(message.zoom);
      confirmed.current = next;
      setPreference(next);
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
    if (!pending && choiceFocus.current) {
      if (document.activeElement === document.body) choiceFocus.current.focus();
      choiceFocus.current = null;
    }
  }, [pending]);
  const choose = (next: ZoomPreference) => {
    if (request.current || next === preference || (!isDemo && !isHosted)) return;
    setError('');
    setPreference(next);
    if (isDemo) {
      try {
        localStorage.setItem(demoKey, JSON.stringify(next));
      } catch {
        setError('Zoom appliqué pour cette ouverture ; le navigateur refuse sa mémorisation.');
      }
      return;
    }
    const requestId = crypto.randomUUID();
    choiceFocus.current = document.activeElement as HTMLElement | null;
    request.current = requestId;
    setPending(true);
    send({ type: 'setZoom', zoom: next, requestId });
    timeout.current = setTimeout(() => {
      request.current = null;
      setPending(false);
      setPreference(confirmed.current);
      setError('VS Code n’a pas confirmé le zoom. Réessayez.');
    }, 15000);
  };
  return (
    <ZoomContext.Provider value={{ preference, effective, pending, error, choose }}>
      {children}
    </ZoomContext.Provider>
  );
}

export function ZoomControls({ settings = false }: { settings?: boolean }) {
  const value = useContext(ZoomContext)!;
  return (
    <div className={`zoom-control ${settings ? 'zoom-control-settings' : ''}`}>
      <div className="zoom-buttons" role="group" aria-label="Taille de l’interface">
        <button
          type="button"
          aria-label="Réduire le zoom"
          title="Réduire la taille de Feature Studio"
          disabled={value.pending || value.effective <= ZOOM_LEVELS[0]}
          onClick={() => value.choose(adjacentZoom(value.effective, -1))}
        >
          <Minus size={15} />
        </button>
        <select
          aria-label="Zoom de Feature Studio"
          title="Taille de l’interface, mémorisée pour tous vos projets"
          value={value.preference}
          disabled={value.pending}
          onChange={(event) => value.choose(normalizeZoom(Number(event.target.value)))}
        >
          <option value="auto">
            Auto ·{' '}
            {value.preference === 'auto' ? value.effective : automaticZoom(innerWidth, innerHeight)}{' '}
            %
          </option>
          {ZOOM_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level} %
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Agrandir le zoom"
          title="Agrandir Feature Studio"
          disabled={value.pending || value.effective >= ZOOM_LEVELS.at(-1)!}
          onClick={() => value.choose(adjacentZoom(value.effective, 1))}
        >
          <Plus size={15} />
        </button>
      </div>
      {value.error && !settings && (
        <p className="zoom-error" role="alert">
          {value.error}
        </p>
      )}
      {settings && (
        <p className="muted" role="status">
          {value.pending ? 'Enregistrement…' : `Taille actuelle : ${value.effective} %.`}
        </p>
      )}
    </div>
  );
}

export function ZoomSettings() {
  return (
    <section className="settings-card" aria-labelledby="zoom-title">
      <div className="settings-card-title">
        <span className="settings-icon color-2">
          <Scaling size={21} />
        </span>
        <div>
          <h2 id="zoom-title">Taille de l’interface</h2>
          <p>Agrandissez les textes, les boutons et les avatars ensemble.</p>
        </div>
      </div>
      <ZoomControls settings />
      <p className="muted zoom-help">
        Auto adapte la taille à l’espace disponible dans la fenêtre. Choisissez un pourcentage pour
        garder une taille fixe. Ce réglage personnel s’applique à tous vos projets.
      </p>
    </section>
  );
}
