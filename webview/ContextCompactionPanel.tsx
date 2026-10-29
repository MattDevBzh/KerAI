import { useEffect, useRef, useState } from 'react';
import type { ClientMessage, RunLaunchOptions, RunPreview } from '../src/shared/types';
import type { ContextSummary } from '../src/shared/evolutions';
import { subscribe } from './bridge';

export function ContextCompactionPanel({
  preview,
  fresh,
  contextKey,
  launch,
  feedback,
  resume,
  dispatch,
  update,
  onBusy,
}: {
  preview: RunPreview;
  fresh: boolean;
  contextKey: string;
  launch: RunLaunchOptions;
  feedback: string;
  resume: boolean;
  dispatch: (message: ClientMessage) => void;
  update: (patch: Partial<RunLaunchOptions>) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ key: string; summary: ContextSummary }>();
  const request = useRef({ id: '', key: '' });
  const latest = useRef(contextKey);
  latest.current = contextKey;
  useEffect(
    () =>
      subscribe((message) => {
        if (
          !request.current.id ||
          !('requestId' in message) ||
          message.requestId !== request.current.id
        )
          return;
        if (message.type === 'contextCompactionProgress')
          setProgress(`${message.completed} / ${message.total} appels terminés`);
        if (message.type === 'error') {
          request.current.id = '';
          setPending(false);
          onBusy(false);
          setError(message.message);
        }
        if (message.type === 'contextCompactionResult') {
          const key = request.current.key;
          request.current.id = '';
          setPending(false);
          onBusy(false);
          if (message.error) setError(message.error);
          else if (key !== latest.current)
            setError(
              'Le contexte a changé pendant la synthèse. Actualise l’aperçu puis recommence ; le résultat reste dans Discussion.',
            );
          else if (message.summary) setDraft({ key, summary: message.summary });
        }
      }),
    [],
  );
  useEffect(
    () => () => {
      if (request.current.id)
        dispatch({ type: 'cancelDiscussion', discussionId: request.current.id });
      onBusy(false);
    },
    [],
  );
  const start = () => {
    if (!fresh || pending || !preview.compaction) return;
    const id = crypto.randomUUID();
    request.current = { id, key: contextKey };
    setDraft(undefined);
    setError('');
    setProgress('Préparation de la synthèse…');
    setPending(true);
    onBusy(true);
    dispatch({
      type: 'compactRunContext',
      requestId: id,
      featureId: preview.featureId,
      stepId: preview.stepId,
      launch,
      feedback,
      resume,
      fingerprint: preview.fingerprint,
    });
  };
  const applied = launch.contextSummary;
  if (!preview.compaction && !applied && !pending && !draft && !error) return null;
  return (
    <section className="context-compaction" aria-label="Compaction du contexte">
      <h4>Compacter l’historique</h4>
      <p className="field-help">
        Résume les anciens livrables et échanges pair. Le besoin, les critères, les instructions et
        les remarques actuelles restent intacts. Les originaux sont conservés. La reprise démarrera
        une nouvelle conversation Copilot pour éviter de réinjecter son ancien historique.
      </p>
      {!applied && (
        <>
          {preview.compaction && (
            <p>
              {preview.compaction.characters.toLocaleString('fr-FR')} caractères à synthétiser ·
              jusqu’à {preview.compaction.calls} appel(s) IA avec le modèle de l’étape. Consomme des
              crédits, comptabilisés dans Discussion, séparément du budget d’exécution de la
              feature.
            </p>
          )}
          <button
            className="button secondary"
            disabled={!fresh || pending || !preview.compaction}
            onClick={start}
          >
            Générer une synthèse IA
          </button>
        </>
      )}
      {pending && (
        <div role="status">
          <p>{progress}</p>
          <button
            className="button secondary"
            onClick={() => {
              dispatch({ type: 'cancelDiscussion', discussionId: request.current.id });
              setProgress('Arrêt demandé…');
            }}
          >
            Arrêter la compaction
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {draft && !applied && (
        <>
          <label className="field">
            <span>Synthèse à relire avant application</span>
            <textarea
              rows={12}
              maxLength={12000}
              value={draft.summary.content}
              onChange={(e) =>
                setDraft({ ...draft, summary: { ...draft.summary, content: e.target.value } })
              }
            />
          </label>
          <p>
            Vérifie les décisions, les fichiers concernés et les problèmes ouverts. Une synthèse
            peut omettre des détails.
          </p>
          <button
            className="button primary"
            disabled={!fresh || draft.key !== contextKey || !draft.summary.content.trim()}
            onClick={() => {
              update({ contextSummary: draft.summary });
              setDraft(undefined);
            }}
          >
            Appliquer cette synthèse
          </button>
          {draft.key !== contextKey && (
            <p role="status">
              Le contexte a changé : génère une nouvelle synthèse avant application.
            </p>
          )}
        </>
      )}
      {applied && (
        <>
          <label className="field">
            <span>Synthèse utilisée pour cette reprise</span>
            <textarea
              rows={10}
              maxLength={12000}
              value={applied.content}
              onChange={(e) => update({ contextSummary: { ...applied, content: e.target.value } })}
            />
          </label>
          <p>
            {applied.sources.length} source(s) remplacée(s) dans le prompt uniquement. Actualise
            l’aperçu pour vérifier la taille finale.
          </p>
          <button
            className="button secondary"
            onClick={() => update({ contextSummary: undefined })}
          >
            Rétablir l’historique complet
          </button>
        </>
      )}
    </section>
  );
}
