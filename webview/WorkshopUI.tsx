import { useEffect, useRef, useState } from 'react';
import { Download, FolderInput, History, RotateCcw, X } from 'lucide-react';
import type { ClientMessage } from '../src/shared/types';
import type {
  WorkshopClientMessage,
  WorkshopHistory,
  WorkshopPreview,
} from '../src/shared/workshop';
import { subscribe } from './bridge';
import './workshop.css';

type Action<T = WorkshopClientMessage> = T extends WorkshopClientMessage
  ? Omit<T, 'requestId'>
  : never;
const labels = {
  added: 'Ajout',
  modified: 'Modification',
  deleted: 'Suppression',
  unchanged: 'Identique',
  conflict: 'Conflit',
};
export function WorkshopUI({ dispatch }: { dispatch: (message: ClientMessage) => void }) {
  const [preview, setPreview] = useState<WorkshopPreview>();
  const [history, setHistory] = useState<WorkshopHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const active = useRef<{ id: string; type: WorkshopClientMessage['type'] } | undefined>(undefined);
  const request = (action: Action) => {
    const requestId = crypto.randomUUID();
    active.current = { id: requestId, type: action.type };
    setBusy(true);
    setError('');
    setMessage('');
    if (action.type === 'workshopImport' || action.type === 'workshopRestorePreview')
      setPreview(undefined);
    dispatch({ ...action, requestId } as WorkshopClientMessage);
  };
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== 'workshopResult' || event.requestId !== active.current?.id) return;
        setBusy(false);
        if (event.error) {
          setError(event.error);
          return;
        }
        if (event.history) setHistory(event.history);
        if (event.preview) setPreview(event.preview);
        if (event.message) setMessage(event.message);
        if (active.current?.type === 'workshopApply' && !event.cancelled) {
          setPreview(undefined);
          setShowHistory(true);
        }
      }),
    [],
  );
  return (
    <section className="workshop-panel" aria-labelledby="workshop-title" aria-busy={busy}>
      <div className="workshop-intro">
        <div>
          <span className="eyebrow">RÉVISION EXTERNE</span>
          <h2 id="workshop-title">Réviser tout l’atelier</h2>
          <p>
            Emportez les agents, skills, équipes et ressources dans un ZIP lisible par l’IA de votre
            choix. Comparez son travail avant de l’appliquer, puis revenez en arrière si besoin.
          </p>
          <p className="workshop-hint">
            Les versions fournies, personnelles et propres à ce projet sont distinguées. Aucun appel
            à Copilot.
          </p>
        </div>
        <div className="workshop-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => request({ type: 'workshopExport' })}
          >
            <Download size={16} />
            Exporter tout l’atelier
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => request({ type: 'workshopImport' })}
          >
            <FolderInput size={16} />
            Comparer un atelier révisé
          </button>
          <button
            className="button ghost"
            disabled={busy}
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory) request({ type: 'workshopHistory' });
            }}
          >
            <History size={16} />
            Historique et restauration
          </button>
        </div>
      </div>
      {busy && <p role="status">Préparation de l’atelier…</p>}
      {error && (
        <p className="kit-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="kit-success" role="status">
          {message}
        </p>
      )}
      {preview && (
        <div className="workshop-preview">
          <div className="workshop-preview-heading">
            <h3>
              {preview.kind === 'restore' ? 'Restaurer l’état précédent' : 'Changements proposés'}
            </h3>
            <button
              className="button ghost small"
              aria-label="Fermer la comparaison"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="workshop-counts">
            {(['added', 'modified', 'deleted', 'conflict'] as const).map((status) => (
              <span className={`workshop-badge ${status}`} key={status}>
                {preview.changes.filter((change) => change.status === status).length} ·{' '}
                {labels[status]}
              </span>
            ))}
          </div>
          {!preview.changes.length && <p>Aucun fichier à modifier.</p>}
          {preview.changes.some((change) => change.status === 'conflict') && (
            <p role="alert">
              Les conflits bloquent l’application. Les modifications locales sont conservées ;
              effectuez un nouvel export pour les intégrer à la révision.
            </p>
          )}
          {preview.report && (
            <details className="workshop-report">
              <summary>Compte rendu de l’IA externe</summary>
              <pre>{preview.report}</pre>
            </details>
          )}
          <div className="workshop-changes">
            {preview.changes.map((change, index) => (
              <details className="workshop-change" key={`${change.path}-${index}`}>
                <summary>
                  <span className={`workshop-badge ${change.status}`}>{labels[change.status]}</span>
                  <span className="workshop-path">{change.path}</span>
                </summary>
                {change.reason && <p>{change.reason}</p>}
                {change.binary ? (
                  <p>
                    Ressource binaire : {change.beforeBytes} → {change.afterBytes} octets.
                  </p>
                ) : (
                  <div className="workshop-diff">
                    <div>
                      <h4>Actuellement</h4>
                      <pre>{change.before ?? 'Fichier absent'}</pre>
                    </div>
                    <div>
                      <h4>
                        {preview.kind === 'restore' ? 'Après restauration' : 'Après application'}
                      </h4>
                      <pre>{change.after ?? 'Fichier supprimé'}</pre>
                    </div>
                  </div>
                )}
              </details>
            ))}
          </div>
          <p className="workshop-hint">
            {preview.kind === 'restore'
              ? 'Seuls les fichiers de cet import seront restaurés. Toute modification ultérieure bloque leur remplacement.'
              : 'Les changements seront appliqués ensemble avec une sauvegarde préalable. Les profils fournis modifiés deviennent des copies personnelles. La compatibilité est vérifiée ; la qualité du comportement reste à évaluer.'}
          </p>
          <button
            className="button primary"
            disabled={busy || !preview.canApply}
            onClick={() => request({ type: 'workshopApply', token: preview.token })}
          >
            {preview.kind === 'restore' ? (
              <>
                <RotateCcw size={16} />
                Restaurer cet état
              </>
            ) : preview.changes.length === 1 ? (
              'Appliquer le changement'
            ) : (
              `Appliquer les ${preview.changes.length} changements`
            )}
          </button>
        </div>
      )}
      {showHistory && (
        <div className="workshop-history">
          <h3>Historique des imports</h3>
          {!history.length && <p>Aucun import enregistré pour ce projet.</p>}
          {history.map((entry) => (
            <div className="workshop-history-row" key={entry.id}>
              <div>
                <strong>{new Date(entry.createdAt).toLocaleString('fr-FR')}</strong>
                <p>
                  {entry.files} fichier(s) ·{' '}
                  {entry.state === 'restored'
                    ? 'Restauré'
                    : entry.state === 'pending'
                      ? 'Interrompu — restauration disponible'
                      : 'Appliqué'}
                </p>
              </div>
              <button
                className="button secondary small"
                disabled={busy || entry.state === 'restored'}
                onClick={() => request({ type: 'workshopRestorePreview', id: entry.id })}
              >
                Comparer avant restauration
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
