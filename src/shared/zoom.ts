export const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150, 175, 200] as const;
export type ZoomPreference = 'auto' | (typeof ZOOM_LEVELS)[number];

export function normalizeZoom(value: unknown): ZoomPreference {
  return typeof value === 'number' && ZOOM_LEVELS.some((level) => level === value)
    ? (value as ZoomPreference)
    : 'auto';
}

/** CSS pixels already account for the display scaling selected in Windows / VS Code. */
export function automaticZoom(width: number, height: number): number {
  const horizontal = width >= 3200 ? 175 : width >= 2400 ? 150 : width >= 1800 ? 125 : 100;
  const vertical = height >= 1500 ? 175 : height >= 1100 ? 150 : height >= 900 ? 125 : 100;
  return Math.min(horizontal, vertical);
}

export function adjacentZoom(current: number, direction: -1 | 1): ZoomPreference {
  return direction > 0
    ? (ZOOM_LEVELS.find((level) => level > current) ?? ZOOM_LEVELS.at(-1)!)
    : ([...ZOOM_LEVELS].reverse().find((level) => level < current) ?? ZOOM_LEVELS[0]);
}
