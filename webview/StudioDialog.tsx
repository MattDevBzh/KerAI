import { useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogAccessibility } from './Ergonomics';

export function StudioDialog({
  title,
  subtitle,
  children,
  onClose,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogAccessibility(ref, onClose);
  return (
    <div className="modal-backdrop">
      <div
        className={`modal wide ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? `${titleId}-description` : undefined}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={`${titleId}-description`}>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Fermer" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
