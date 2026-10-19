import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { Attempt, ClientMessage } from '../src/shared/types';
import { isHosted, subscribe } from './bridge';

export function AgentReportDownload({
  featureId,
  stepId,
  attempt,
  unsaved,
  dispatch,
}: {
  featureId: string;
  stepId: string;
  attempt: Attempt;
  unsaved: boolean;
  dispatch: (message: ClientMessage) => void;
}) {
  const [pending, setPending] = useState<string>();
  const pendingRequest = useRef<string | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'agentReportExported' || message.requestId !== pendingRequest.current)
          return;
        pendingRequest.current = undefined;
        setPending(undefined);
        setError(message.error ?? '');
      }),
    [],
  );
  const unavailable = !isHosted
    ? 'Le téléchargement est disponible dans VS Code.'
    : unsaved
      ? 'Enregistre ou abandonne le brouillon avant de télécharger le compte rendu.'
      : attempt.status === 'running'
        ? 'Disponible à la fin de cette tentative.'
        : '';
  return (
    <>
      <button
        className="text-button"
        disabled={Boolean(pending) || Boolean(unavailable)}
        title={unavailable || 'Enregistrer le compte rendu affiché au format Markdown'}
        onClick={() => {
          if (pendingRequest.current) return;
          const requestId = crypto.randomUUID();
          pendingRequest.current = requestId;
          setError('');
          setPending(requestId);
          dispatch({
            type: 'exportAgentReport',
            requestId,
            featureId,
            stepId,
            attemptId: attempt.id,
            revision: attempt.revision ?? 0,
          });
        }}
      >
        <Download size={14} /> {pending ? 'Enregistrement…' : 'Télécharger .md'}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
