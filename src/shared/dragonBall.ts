// Frozen artwork order: reordering the general catalog must not swap costumes.
export const DRAGON_BALL_AVATARS: readonly string[] = [
  'software-architect',
  'backend-developer',
  'frontend-developer',
  'qa-tester',
  'qa-automation',
  'technical-writer',
  'infrastructure-engineer',
  'devops-engineer',
  'sre-engineer',
  'security-engineer',
  'data-engineer',
  'data-scientist',
  'database-administrator',
  'cloud-architect',
  'ux-designer',
  'product-owner',
  'business-analyst',
  'code-reviewer',
  'support-engineer',
  'release-manager',
];

// Bounds of the unmodified generated sheets, measured in their transparent gutters.
// A literal five-way split can show the next agent's hair/antenna at the edge.
const rowCuts = [
  [0, 316, 637, 943, 1245, 1619],
  [0, 335, 651, 957, 1266, 1619],
  [0, 313, 641, 957, 1278, 1619],
  [0, 308, 646, 952, 1266, 1619],
];
const columnCuts = [
  [
    [0, 314, 634, 971],
    [0, 312, 638, 971],
    [0, 314, 631, 971],
    [0, 312, 633, 971],
    [0, 314, 647, 971],
  ],
  [
    [0, 318, 634, 971],
    [0, 315, 635, 971],
    [0, 320, 634, 971],
    [0, 318, 634, 971],
    [0, 316, 642, 971],
  ],
  [
    [0, 316, 634, 971],
    [0, 312, 638, 971],
    [0, 320, 640, 971],
    [0, 316, 644, 971],
    [0, 317, 634, 971],
  ],
  [
    [0, 314, 622, 971],
    [0, 320, 642, 971],
    [0, 307, 630, 971],
    [0, 309, 631, 971],
    [0, 312, 629, 971],
  ],
];

export const DRAGON_BALL_CODE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
] as const;
export const DRAGON_BALL_UNLOCK_KEY = 'secretThemes.dragonball';

/** The atlas uses the stable, existing twenty avatar identities, never profile edits. */
export function dragonBallPortrait(id: string, pose: 'idle.png' | 'working.gif' | 'approved.png') {
  const index = DRAGON_BALL_AVATARS.indexOf(id);
  if (index < 0) return undefined;
  const sheet = Math.floor(index / 5);
  const row = index % 5;
  const column = pose === 'approved.png' ? 2 : pose === 'working.gif' ? 1 : 0;
  const xs = columnCuts[sheet][row];
  const ys = rowCuts[sheet];
  return {
    sheet: sheet + 1,
    row,
    column,
    bounds: {
      x: xs[column],
      y: ys[row],
      width: xs[column + 1] - xs[column],
      height: ys[row + 1] - ys[row],
    },
    viewBox: `${xs[column]} ${ys[row]} ${xs[column + 1] - xs[column]} ${ys[row + 1] - ys[row]}`,
  };
}
