import { expect, it } from 'vitest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { avatarIds } from '../src/shared/avatars';
import { DRAGON_BALL_CODE, dragonBallPortrait } from '../src/shared/dragonBall';
import { parseMessage } from '../src/host/messages';

it('accepts only the exact eight-key code with a bounded request and no invented entitlements', () => {
  const message = { type: 'unlockDragonBall', sequence: DRAGON_BALL_CODE, requestId: 'secret' };
  expect(parseMessage(message)).toEqual(message);
  for (const value of [
    { ...message, unlocked: true },
    { ...message, sequence: [...DRAGON_BALL_CODE, 'b', 'a'] },
    { ...message, sequence: DRAGON_BALL_CODE.slice(1) },
    { ...message, sequence: [...DRAGON_BALL_CODE].reverse() },
  ])
    expect(() => parseMessage(value)).toThrow();
});

it('maps all twenty identities and three distinct poses to complete transparent atlas cells', async () => {
  const coordinates = new Set<string>();
  const hashes = new Set<string>();
  for (let sheet = 1; sheet <= 4; sheet++) {
    const image = sharp(`webview/public/avatar-events/dragonball/team-${sheet}.png`);
    const meta = await image.metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width! / meta.height!).toBeCloseTo(3 / 5, 2);
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBeLessThanOrEqual(2);
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++) {
        const hash = createHash('sha256');
        let visible = 0,
          transparent = 0;
        const startX = Math.floor((col * info.width) / 3),
          endX = Math.floor(((col + 1) * info.width) / 3);
        for (
          let y = Math.floor((row * info.height) / 5);
          y < Math.floor(((row + 1) * info.height) / 5);
          y++
        ) {
          hash.update(data.subarray((y * info.width + startX) * 4, (y * info.width + endX) * 4));
          for (let x = startX; x < endX; x++) {
            if (data[(y * info.width + x) * 4 + 3] > 100) visible++;
            else transparent++;
          }
        }
        expect(visible).toBeGreaterThan(1000);
        expect(transparent).toBeGreaterThan(1000);
        hashes.add(hash.digest('hex'));
      }
  }
  for (const id of avatarIds)
    for (const pose of ['idle.png', 'working.gif', 'approved.png'] as const) {
      const cell = dragonBallPortrait(id, pose)!;
      expect(cell.sheet).toBeGreaterThanOrEqual(1);
      expect(cell.sheet).toBeLessThanOrEqual(4);
      coordinates.add(`${cell.sheet}:${cell.row}:${cell.column}`);
    }
  expect(coordinates.size).toBe(60);
  expect(hashes.size).toBe(60);
  expect(dragonBallPortrait('../../other', 'idle.png')).toBeUndefined();
});
