import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import type { ReviewApprovalRequest } from '../src/shared/reviewApproval';
import { useDialogAccessibility } from './Ergonomics';

export function ReviewApprovalDialog({
  warning,
  disabled,
  onConfirm,
  onClose,
}: {
  warning: ReviewApprovalRequest;
  disabled: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    titleId = useId();
  useDialogAccessibility(ref, onClose);
  const count = (warning.review?.findings.length ?? 0) + warning.comments.length;
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2 id={titleId}>Valider malgré les remarques ?</h2>
          <button className="icon-button" aria-label="Fermer" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <p>
          La relecture contient des remarques. En confirmant, tu valides l’étape en l’état et
          débloques la suite. Les remarques restent visibles et ne sont pas marquées comme
          corrigées.
        </p>
        <div className="review-approval-warnings">
          {warning.review && (
            <>
              {warning.review.verdict === 'changes_requested' && (
                <strong>La relecture demande des corrections.</strong>
              )}
              <p>{warning.review.summary}</p>
            </>
          )}
          {count > 0 && (
            <p>
              {count} remarque{count > 1 ? 's' : ''}
            </p>
          )}
          <ul>
            {warning.review?.findings.map((finding) => (
              <li key={`finding-${finding.id}`}>
                <strong>
                  {finding.severity === 'blocking'
                    ? 'Bloquante'
                    : finding.severity === 'warning'
                      ? 'Avertissement'
                      : 'Information'}
                </strong>
                {' — '}
                {finding.message}
                {finding.file && (
                  <small>
                    {' '}
                    · {finding.file}
                    {finding.line ? `:${finding.line}` : ''}
                  </small>
                )}
              </li>
            ))}
            {warning.comments.map((comment) => (
              <li key={`comment-${comment.id}`}>
                <strong>{comment.blocking ? 'Commentaire bloquant' : 'Commentaire'}</strong>
                {' — '}
                {comment.text}
                {comment.file && (
                  <small>
                    {' '}
                    · {comment.file}
                    {comment.line ? `:${comment.line}` : ''}
                  </small>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="button primary" disabled={disabled} onClick={onConfirm}>
            Valider malgré les remarques
          </button>
        </div>
      </div>
    </div>
  );
}
