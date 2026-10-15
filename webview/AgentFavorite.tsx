import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import type { AgentProfile, ClientMessage, StudioState } from '../src/shared/types';
import { subscribe } from './bridge';

export function AgentFavorite({
  agent,
  state,
  dispatch,
}: {
  agent: AgentProfile;
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
}) {
  const request = useRef('');
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const favorite = Boolean(state.favoriteAgentIds?.includes(agent.id));
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'agentFavoriteResult' || message.requestId !== request.current) return;
        setPending(false);
        setError(message.error ?? '');
      }),
    [],
  );
  return (
    <span className="agent-favorite-control">
      <button
        type="button"
        className={`icon-button agent-favorite ${favorite ? 'selected' : ''}`}
        aria-label={`${favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} : ${agent.nickname || agent.name}`}
        aria-pressed={favorite}
        disabled={pending}
        title={error || (favorite ? 'Retirer des favoris' : 'Ajouter aux favoris')}
        onClick={(event) => {
          event.stopPropagation();
          request.current = crypto.randomUUID();
          setPending(true);
          setError('');
          dispatch({
            type: 'setAgentFavorite',
            requestId: request.current,
            agentId: agent.id,
            favorite: !favorite,
          });
        }}
      >
        <Star size={17} fill={favorite ? 'currentColor' : 'none'} />
      </button>
      {error && (
        <small role="alert" className="team-error">
          {error}
        </small>
      )}
    </span>
  );
}
