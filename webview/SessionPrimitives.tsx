import { ChevronDown, Sparkles, X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import type { Feature, StepStatus, StudioState } from '../src/shared/types';
import { useDialogAccessibility } from './Ergonomics';

export const statuses: Record<StepStatus, { label: string; tone: string }> = {
  pending: { label: 'À venir', tone: 'neutral' },
  running: { label: 'En cours', tone: 'lavender' },
  waiting_input: { label: 'Votre réponse', tone: 'apricot' },
  awaiting_review: { label: 'À valider', tone: 'apricot' },
  approved: { label: 'Validée', tone: 'green' },
  skipped: { label: 'Passée', tone: 'apricot' },
  failed: { label: 'Échec', tone: 'coral' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
  stale: { label: 'À actualiser', tone: 'apricot' },
  interrupted: { label: 'Interrompue', tone: 'coral' },
};
export const featureStatus: Record<Feature['status'], { label: string; tone: string }> = {
  draft: { label: 'À démarrer', tone: 'neutral' },
  running: { label: 'En cours', tone: 'lavender' },
  attention: { label: 'À votre tour', tone: 'apricot' },
  awaiting_final_validation: { label: 'Dernière validation', tone: 'apricot' },
  completed: { label: 'Terminée', tone: 'green' },
};
export const policyLabels = {
  'read-only': 'Lecture seule',
  'workspace-write': 'Écriture dans le projet',
  tests: 'Exécution des tests autorisés',
};
export const date = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <span />
      {label}
    </span>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <Sparkles />}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogAccessibility(ref, onClose);
  return (
    <div className="modal-backdrop">
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? `${titleId}-description` : undefined}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={`${titleId}-description`}>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Fermer" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function ModelSelect({
  state,
  value,
  onChange,
  label = 'Modèle',
  emptyLabel = 'Automatique · choix du CLI',
}: {
  state: StudioState;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  emptyLabel?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="select-wrap">
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{emptyLabel}</option>
          {value && !state.runtime.models.some((m) => m.id === value) && (
            <option value={value}>{value} · configuré</option>
          )}
          {state.runtime.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.multiplier !== undefined ? ` · ×${m.multiplier}` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </div>
      {!state.runtime.models.length && (
        <small>Vérifiez Copilot pour consulter les modèles disponibles.</small>
      )}
    </label>
  );
}
