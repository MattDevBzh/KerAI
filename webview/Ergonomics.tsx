import { useEffect, useRef, type RefObject } from 'react';
import { Search, X } from 'lucide-react';

const dialogs: HTMLElement[] = [];
let originalOverflow = '';

/** Keep keyboard and scroll in the topmost dialog, including nested editors. */
export function useDialogAccessibility(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialogs.length) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialogs.push(dialog);
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href],button,input,select,textarea,summary,[tabindex]',
        ),
      ).filter(
        (node) =>
          node.tabIndex >= 0 &&
          !node.matches(':disabled') &&
          !node.closest('[hidden],[inert]') &&
          node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility !== 'hidden',
      );
    (focusable()[0] ?? dialog).focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      } else if (event.key === 'Tab') {
        const nodes = focusable();
        const current = document.activeElement;
        const index = nodes.indexOf(current as HTMLElement);
        if (
          !nodes.length ||
          index < 0 ||
          (event.shiftKey && index === 0) ||
          (!event.shiftKey && index === nodes.length - 1)
        ) {
          event.preventDefault();
          (event.shiftKey ? (nodes.at(-1) ?? dialog) : (nodes[0] ?? dialog)).focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      const index = dialogs.indexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      if (!dialogs.length) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected && (!dialogs.length || dialogs.at(-1)?.contains(previous)))
        previous.focus({ preventScroll: true });
    };
  }, [ref]);
}

export const searchText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .trim();

export function CatalogSearch({
  label,
  value,
  onChange,
  count,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  count: number;
}) {
  return (
    <div className="catalog-search">
      <label className="search-field">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label={label}
          placeholder={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {value && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Effacer : ${label}`}
            onClick={() => onChange('')}
          >
            <X size={16} />
          </button>
        )}
      </label>
      <span className="muted" role="status" aria-live="polite">
        {count} résultat{count > 1 ? 's' : ''}
      </span>
    </div>
  );
}
