import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import type { AgentProfile, StepStatus } from '../src/shared/types';
export const avatarOptions = [
  { id: 'wizard', name: 'Le mage' },
  { id: 'hacker', name: 'Le hacker' },
  { id: 'detective', name: 'Le détective' },
  { id: 'lumberjack', name: 'Le bûcheron' },
  { id: 'scientist', name: 'La scientifique' },
  { id: 'robot', name: 'Le robot' },
  { id: 'ninja', name: 'Le ninja' },
  { id: 'captain', name: 'La capitaine' },
  { id: 'devops-scout', name: 'Éclaireur' },
  { id: 'devops-architect', name: 'Architecte DevOps' },
  { id: 'devops-builder', name: 'Bâtisseur' },
  { id: 'devops-sentinel', name: 'Vigie' },
  { id: 'devops-lab', name: 'Laborantin' },
  { id: 'devops-controller', name: 'Contrôleur' },
];
export const avatarDefaults: Record<string, string> = {
  'fs-specs': 'detective',
  'fs-plan': 'wizard',
  'fs-dev': 'hacker',
  'fs-tests': 'scientist',
  'fs-review': 'ninja',
  analyst: 'detective',
  architect: 'wizard',
  builder: 'hacker',
  tester: 'scientist',
  reviewer: 'ninja',
};
export function Avatar({
  agent,
  status = 'pending',
  small = false,
}: {
  agent?: AgentProfile;
  status?: StepStatus;
  small?: boolean;
}) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [failed, setFailed] = useState(false);
  const id = agent?.avatar || avatarDefaults[agent?.id ?? ''] || 'robot';
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
