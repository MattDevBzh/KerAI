import { useEffect, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { useRewards } from './RewardProvider';
import './reward-effects.css';

function useQuietMotion() {
  const [quiet, setQuiet] = useState(
    () => document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setQuiet(document.hidden || query.matches);
    query.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      query.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return quiet;
}
export function QgKitten() {
  const { state } = useRewards();
  if (state?.error || state?.selection.mascot !== 'kitten' || !state.unlocked.includes('kitten'))
    return null;
  return <KittenWalk />;
}
function KittenWalk() {
  const quiet = useQuietMotion();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (quiet) {
      setPhase(0);
      return;
    }
    const timer = setTimeout(
      () => setPhase((value) => (value + 1) % 6),
      [2200, 8000, 3200, 5000, 8000, 2600][phase],
    );
    return () => clearTimeout(timer);
  }, [phase, quiet]);
  const walking = phase === 1 || phase === 4;
  return (
    <div
      className="kitten-trail"
      role="img"
      aria-label="Chaton, ton compagnon du QG"
      data-quiet={quiet || undefined}
    >
      <div className="kitten-position" data-phase={phase}>
        <span
          className={`kitten-sprite ${walking ? 'walking' : phase === 3 ? 'sleeping' : 'resting'}`}
        />
      </div>
    </div>
  );
}
export function EiffelCelebration({
  animated,
  onClose,
}: {
  animated: boolean;
  onClose: () => void;
}) {
  return (
    <figure
      className={`eiffel-celebration ${animated ? 'animated' : ''}`}
      aria-label="Feu d’artifice devant la tour Eiffel"
    >
      <img
        src={`${import.meta.env.BASE_URL}rewards/eiffel.png`}
        alt="La tour Eiffel illuminée dans la nuit parisienne"
      />
      <div className="eiffel-fireworks" aria-hidden="true">
        {Array.from({ length: 7 }, (_, burst) => (
          <span
            className="firework"
            key={burst}
            style={
              {
                left: `${[22, 76, 40, 65, 15, 85, 49][burst]}%`,
                top: `${[28, 22, 12, 42, 51, 55, 30][burst]}%`,
                '--burst-delay': `${burst * 0.64}s`,
                '--spark-color': ['#ffe19b', '#9fffd8', '#ffacd1', '#b5c7ff'][burst % 4],
              } as CSSProperties
            }
          >
            {Array.from({ length: 16 }, (_, spark) => (
              <i key={spark} style={{ '--angle': `${spark * 22.5}deg` } as CSSProperties} />
            ))}
          </span>
        ))}
      </div>
      <figcaption>
        <strong>Paris applaudit ton équipe !</strong>
        <span>Session validée · beau travail à tous</span>
      </figcaption>
      <button className="eiffel-close" aria-label="Fermer le feu d’artifice" onClick={onClose}>
        <X size={17} />
      </button>
    </figure>
  );
}
