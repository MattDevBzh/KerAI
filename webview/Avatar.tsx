import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import type { AgentProfile, StepStatus } from '../src/shared/types';
import { resolveAvatar } from '../src/shared/avatars';
export { avatarOptions } from '../src/shared/avatars';
export function Avatar({
  agent,
  status = 'pending',
  small = false,
}: {
  agent?: Pick<AgentProfile, 'id' | 'avatar'>;
  status?: StepStatus;
  small?: boolean;
}) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [failed, setFailed] = useState(false);
  const id = resolveAvatar(agent?.avatar, agent?.id);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const pose =
    status === 'approved'
      ? 'approved.png'
      : status === 'running' && !reduced
        ? 'working.gif'
        : 'idle.png';
  useEffect(() => setFailed(false), [id, pose]);
  return (
    <span className={`pixel-avatar ${small ? 'small' : ''} ${status}`} aria-hidden="true">
      {failed ? (
        <Bot size={small ? 21 : 30} />
      ) : (
        <img
          src={`${import.meta.env.BASE_URL}avatars/${id}/${pose}`}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
