import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ClientMessage } from '../src/shared/types';
import type {
  CatalogueDeletePreview,
  CatalogueDeleteTarget,
} from '../src/shared/catalogueDeletion';
import { subscribe } from './bridge';
import { Modal } from './SessionPrimitives';

export function CatalogueDeleteButton({
  target,
  label,
  dispatch,
  onDeleted,
}: {
  target: CatalogueDeleteTarget;
  label: string;
  dispatch: (message: ClientMessage) => void;
  onDeleted?: () => void;
}) {
  const [preview, setPreview] = useState<CatalogueDeletePreview>(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef('');
  const request = (apply = false) => {
    const requestId = crypto.randomUUID();
    active.current = requestId;
    setBusy(true);
    setError('');
    setOpen(true);
    if (apply && preview)
      dispatch({ type: 'catalogueDeleteApply', requestId, token: preview.token });
    else {
      setPreview(undefined);
      dispatch({ type: 'catalogueDeletePreview', requestId, target });
    }
  };
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== 'catalogueDeleteResult' || event.requestId !== active.current) return;
        setBusy(false);
        if (event.error) {
          setError(event.error);
          return;
        }
        if (event.preview) setPreview(event.preview);
        if (event.message) {
          setOpen(false);
          setPreview(undefined);
          onDeleted?.();
        }
      }),
    [onDeleted],
  );
  return (
    <>
      <button
        className="button ghost small catalogue-delete"
        aria-label={`Supprimer ${label}`}
        onClick={() => request()}
      >
        <Trash2 size={14} />
        Supprimer
      </button>
      {open && (
        <Modal
          title={`Supprimer ${preview?.label ?? label} ?`}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          {busy && <p role="status">Vérification de l’atelier et des sessions…</p>}
          {error && (
            <p className="kit-error" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <>
              <p>
                Cette suppression retire définitivement ces éléments de votre atelier et efface
                leurs fichiers personnels et de projet. Les profils fournis retirés ne
                réapparaîtront pas au redémarrage.
              </p>
              <ul>
                <li>Agents : {preview.agents.join(', ') || 'aucun'}</li>
                <li>Équipes retirées : {preview.workflows.join(', ') || 'aucune'}</li>
                <li>Skills retirés : {preview.skills.join(', ') || 'aucun'}</li>
              </ul>
              {preview.shared.length > 0 && (
                <p>Éléments partagés conservés : {preview.shared.join(', ')}.</p>
              )}
              <p>Les comptes rendus et historiques des sessions terminées sont conservés.</p>
              {preview.blockers.length > 0 && (
                <div className="kit-error" role="alert">
                  <strong>
                    Suppression bloquée : un agent est utilisé dans une session non terminée.
                  </strong>
                  <ul>
                    {preview.blockers.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <div className="form-actions">
            <button className="button secondary" disabled={busy} onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button
              className="button primary"
              disabled={busy || !preview?.canDelete || !!error}
              onClick={() => request(true)}
            >
              Supprimer définitivement
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
