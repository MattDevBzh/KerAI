import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { emptyRewardSelection, type RewardId, type RewardState } from '../src/shared/rewards';
import { isDemo, isHosted, send, subscribe } from './bridge';

interface RewardContextValue {
  state?: RewardState;
  pending: RewardId | null;
  error: string;
  newlyUnlocked: RewardId[];
  dismiss: (id: RewardId) => void;
  equip: (id: RewardId, enabled?: boolean) => void;
}
const RewardContext = createContext<RewardContextValue>({
  pending: null,
  error: '',
  newlyUnlocked: [],
  dismiss: () => {},
  equip: () => {},
});
export const useRewards = () => useContext(RewardContext);
export function RewardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RewardState | undefined>(
    isDemo ? { ready: true, unlocked: [], selection: emptyRewardSelection() } : undefined,
  );
  const [pending, setPending] = useState<RewardId | null>(null);
  const [error, setError] = useState('');
  const [newlyUnlocked, setNewlyUnlocked] = useState<RewardId[]>([]);
  const known = useRef<Set<RewardId> | null>(null);
  const request = useRef<{ id: string; reward: RewardId } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const control = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'rewardState') return;
      if (message.requestId && message.requestId !== request.current?.id) return;
      setState(message.state);
      if (message.state.ready && !message.state.error) {
        if (known.current) {
          const fresh = message.state.unlocked.filter((id) => !known.current!.has(id));
          if (fresh.length) setNewlyUnlocked((current) => [...new Set([...current, ...fresh])]);
        }
        known.current = new Set([...(known.current ?? []), ...message.state.unlocked]);
      }
      if (message.requestId) {
        clearTimeout(timer.current);
        const appliedReward = request.current?.reward;
        if (!message.error) setNewlyUnlocked((ids) => ids.filter((id) => id !== appliedReward));
        request.current = null;
        setPending(null);
        setError(message.error ?? '');
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!pending && control.current) {
      if (document.activeElement === document.body && control.current.isConnected)
        control.current.focus();
      control.current = null;
    }
  }, [pending]);
  const equip = (id: RewardId, enabled = true) => {
    if (request.current || !state?.ready || state.error || !state.unlocked.includes(id)) return;
    if (!isHosted) return;
    const requestId = crypto.randomUUID();
    request.current = { id: requestId, reward: id };
    control.current = document.activeElement as HTMLElement;
    setPending(id);
    setError('');
    send({ type: 'setReward', rewardId: id, enabled, requestId });
    timer.current = setTimeout(() => {
      request.current = null;
      setPending(null);
      setError(
        'VS Code n’a pas confirmé l’enregistrement. Actualise les récompenses avant de réessayer.',
      );
      send({ type: 'refreshRewards' });
    }, 15000);
  };
  return (
    <RewardContext.Provider
      value={{
        state,
        pending,
        error,
        newlyUnlocked,
        equip,
        dismiss: (id) => setNewlyUnlocked((ids) => ids.filter((value) => value !== id)),
      }}
    >
      {children}
    </RewardContext.Provider>
  );
}
