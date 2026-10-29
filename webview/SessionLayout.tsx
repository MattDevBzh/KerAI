import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from 'lucide-react';
import {
  normalizeSessionLayout,
  SESSION_MODULES,
  type SessionLayoutPreference,
  type SessionModuleId,
} from '../src/shared/sessionLayout';
import { isDemo, isHosted, send, subscribe } from './bridge';
import { StudioDialog } from './StudioDialog';
import './session-layout.css';

const demoKey = 'featureStudio.demo.sessionLayout';
function initialLayout() {
  try {
    if (isDemo) return normalizeSessionLayout(JSON.parse(localStorage.getItem(demoKey) ?? 'null'));
  } catch {
    /* Use the defaults. */
  }
  return normalizeSessionLayout(undefined);
}
interface LayoutContext {
  layout: SessionLayoutPreference;
  pending: boolean;
  error: string;
  save: (layout: SessionLayoutPreference) => Promise<boolean>;
}
const SessionLayoutContext = createContext<LayoutContext | null>(null);
export const useSessionLayout = () => useContext(SessionLayoutContext)!;

export function SessionLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState(initialLayout);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ id: string; resolve: (saved: boolean) => void } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'sessionLayoutState') return;
      if (message.requestId && message.requestId !== request.current?.id) return;
      setLayout(normalizeSessionLayout(message.layout));
      if (message.requestId) {
        clearTimeout(timer.current);
        setPending(false);
        setError(message.error ?? '');
        request.current?.resolve(!message.error);
        request.current = undefined;
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
      request.current?.resolve(false);
      request.current = undefined;
    };
  }, []);
  const save = async (next: SessionLayoutPreference): Promise<boolean> => {
    if (request.current) return false;
    setError('');
    const normalized = normalizeSessionLayout(next);
    if (isDemo) {
      try {
        localStorage.setItem(demoKey, JSON.stringify(normalized));
      } catch {
        setError('Le navigateur refuse de mémoriser cet affichage.');
        return false;
      }
      setLayout(normalized);
      return true;
    }
    if (!isHosted) {
      setError('Ouvre Feature Studio dans VS Code pour enregistrer cet affichage.');
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const id = crypto.randomUUID();
      request.current = { id, resolve };
      setPending(true);
      send({ type: 'setSessionLayout', layout: normalized, requestId: id });
      timer.current = setTimeout(() => {
        if (request.current?.id !== id) return;
        request.current = undefined;
        setPending(false);
        setError('VS Code n’a pas confirmé l’enregistrement. Réessaie.');
        resolve(false);
      }, 15000);
    });
  };
  return (
    <SessionLayoutContext.Provider value={{ layout, pending, error, save }}>
      {children}
    </SessionLayoutContext.Provider>
  );
}

export function SessionLayoutEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { layout, pending, error, save } = useSessionLayout();
  const [draft, setDraft] = useState(() => structuredClone(layout));
  const [dragging, setDragging] = useState<SessionModuleId>();
  const move = (id: SessionModuleId, to: number) => {
    setDraft((current) => {
      const order = [...current.order],
        from = order.indexOf(id);
      if (from < 0 || to < 0 || to >= order.length) return current;
      order.splice(from, 1);
      order.splice(to, 0, id);
      return { ...current, order };
    });
  };
  return (
    <StudioDialog
      title="Personnaliser l’affichage de la session"
      subtitle="Choisis les modules visibles et leur ordre. Ce choix sera conservé pour toutes tes sessions et tous tes projets."
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <p className="field-help">
        Glisse les modules ou utilise les flèches. Les modules liés à un ticket, à Azure DevOps ou
        au bilan apparaissent lorsque la session contient ces informations.
      </p>
      <fieldset disabled={pending} className="session-layout-fields">
        <ol className="session-layout-list" aria-label="Modules de la session">
          {draft.order.map((id, index) => (
            <li
              key={id}
              data-layout-module={id}
              className={dragging === id ? 'dragging' : ''}
              onDragOver={(event) => {
                if (dragging && !pending) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && !pending) move(dragging, index);
                setDragging(undefined);
              }}
            >
              <button
                type="button"
                className="icon-button module-drag"
                draggable={!pending}
                aria-label={`Déplacer ${SESSION_MODULES[id].title}`}
                title="Glisser pour déplacer"
                onDragStart={(event) => {
                  setDragging(id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', id);
                }}
                onDragEnd={() => setDragging(undefined)}
              >
                <GripVertical size={16} />
              </button>
              <label>
                <input
                  type="checkbox"
                  aria-label={`Afficher ${SESSION_MODULES[id].title}`}
                  checked={!draft.hidden.includes(id)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      hidden: event.target.checked
                        ? draft.hidden.filter((value) => value !== id)
                        : [...draft.hidden, id],
                    })
                  }
                />
                <span>
                  <strong>{SESSION_MODULES[id].title}</strong>
                  <small>{SESSION_MODULES[id].description}</small>
                </span>
              </label>
              <div className="module-move-actions">
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === 0 || pending}
                  aria-label={`Monter ${SESSION_MODULES[id].title}`}
                  onClick={() => move(id, index - 1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === draft.order.length - 1 || pending}
                  aria-label={`Descendre ${SESSION_MODULES[id].title}`}
                  onClick={() => move(id, index + 1)}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button secondary small"
          onClick={() => setDraft(normalizeSessionLayout(undefined))}
        >
          <RotateCcw size={14} /> Rétablir l’affichage par défaut
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" disabled={pending} onClick={onClose}>
          Annuler
        </button>
        <button
          className="button primary"
          disabled={pending}
          onClick={async () => {
            if (await save(draft)) {
              onSaved();
              onClose();
            }
          }}
        >
          {pending ? 'Enregistrement…' : 'Appliquer l’affichage'}
        </button>
      </div>
    </StudioDialog>
  );
}

export function SessionModule({ children }: { id: SessionModuleId; children: ReactNode }) {
  return <>{children}</>;
}
/** Stable keyed wrappers retain drafts and component state when modules move or become hidden. */
export function SessionModules({
  children,
  revealed,
}: {
  children: ReactNode;
  revealed: SessionModuleId[];
}) {
  const { layout } = useSessionLayout();
  const modules = new Map(
    Children.toArray(children)
      .filter(
        (child) => isValidElement<{ id: SessionModuleId }>(child) && child.type === SessionModule,
      )
      .map((child) => {
        const element = child as React.ReactElement<{ id: SessionModuleId }>;
        return [element.props.id, element] as const;
      }),
  );
  return (
    <div className="session-modules">
      {layout.order.map((id) => (
        <div
          key={id}
          data-session-module={id}
          className="session-module"
          tabIndex={-1}
          hidden={layout.hidden.includes(id) && !revealed.includes(id)}
        >
          {modules.get(id)}
        </div>
      ))}
    </div>
  );
}
