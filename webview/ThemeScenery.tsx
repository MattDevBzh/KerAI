import { useThemeAppearance } from './ThemePicker';

/** Decorative scenery stays outside the interaction and accessibility trees. */
export function ThemeScenery() {
  const { family } = useThemeAppearance();
  if (family === 'native') return null;
  return (
    <div className={`theme-scenery scenery-${family}`} aria-hidden="true">
      {family === 'jardin' && (
        <svg viewBox="0 0 550 260" fill="none">
          <circle cx="330" cy="50" r="95" fill="currentColor" opacity=".16" />
          <path
            d="M570 220C350 260 460 70 210 15M540 220C420 160 310 160 270 80"
            stroke="currentColor"
            strokeWidth="2"
          />
          {[
            [440, 155, -25],
            [390, 100, 25],
            [335, 62, -20],
            [480, 198, 20],
            [354, 160, 30],
            [298, 117, -30],
          ].map(([x, y, r]) => (
            <ellipse
              key={x}
              cx={x}
              cy={y}
              rx="47"
              ry="15"
              fill="currentColor"
              opacity=".45"
              transform={`rotate(${r} ${x} ${y})`}
            />
          ))}
        </svg>
      )}
      {family === 'papier' && (
        <>
          <i className="paper-sheet" />
          <i className="paper-sheet second" />
          <span className="paper-stamp">
            IDÉES EN COURS
            <br />
            ATELIER CRÉATIF
          </span>
        </>
      )}
      {family === 'guilde' && (
        <>
          <i className="pixel-mountain" />
          <i className="pixel-mountain second" />
          <span className="pixel-stars">
            ✦<br />
            　+　✦
          </span>
        </>
      )}
      {family === 'event' && (
        <svg viewBox="0 0 550 270" fill="none">
          <circle cx="395" cy="90" r="68" fill="currentColor" opacity=".35" />
          <path
            d="M310 94l12-20 10 10 7-23 8 23 13-10 10 20-30-7zM440 180l17-28 14 13 10-29 10 29 16-13 15 28-40-10z"
            fill="currentColor"
          />
          <g stroke="currentColor" opacity=".6">
            <path d="M550 0L365 180M550 0L300 35M550 0L500 245M550 0L370 95M550 0L440 220" />
            <path d="M490 10q10 42 48 50M432 18q20 80 96 95M375 26q30 120 140 145" />
          </g>
          <g transform="translate(200 170)" fill="currentColor">
            <ellipse cx="30" cy="30" rx="31" ry="28" />
            <ellipse cx="10" cy="30" rx="20" ry="25" />
            <ellipse cx="50" cy="30" rx="20" ry="25" />
            <path d="M27 5l3-15 8 2-5 14z" />
          </g>
          <path
            d="M212 195l9-8 4 10zM238 197l4-10 9 8zM217 208l11 8 10-2 9-9-4 17-21 1z"
            fill="var(--bg)"
          />
        </svg>
      )}
    </div>
  );
}
