import { describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { avatarSchema } from '../src/core/registry';
import { avatarIds, legacyAvatarAliases, resolveAvatar } from '../src/shared/avatars';

describe('professional avatar compatibility and packaged artwork', () => {
  it('ships exactly twenty characters, all accepted in profiles and kits', async () => {
    expect(avatarIds).toHaveLength(20);
    expect(new Set(avatarIds).size).toBe(20);
    expect((await readdir('webview/public/avatars')).sort()).toEqual([...avatarIds].sort());
    for (const id of avatarIds) expect(avatarSchema.parse(id)).toBe(id);
  });
  it.each(Object.entries(legacyAvatarAliases))(
    'keeps the legacy profile %s valid',
    (id, target) => {
      expect(avatarSchema.parse(id)).toBe(id);
      expect(avatarIds).toContain(target);
      expect(resolveAvatar(id)).toBe(target);
    },
  );
  it('resolves role defaults and rejects untrusted image paths', () => {
    expect(resolveAvatar(undefined, 'fs-plan')).toBe('software-architect');
    expect(resolveAvatar('frontend-developer', 'fs-plan')).toBe('frontend-developer');
    for (const id of ['../../other', 'toString', '__proto__', 'unknown']) {
      expect(avatarSchema.safeParse(id).success).toBe(false);
      expect(resolveAvatar(id, id)).toBe('backend-developer');
    }
  });
  it.each(avatarIds)(
    '%s has transparent idle/success and four distinct looping work frames',
    async (id) => {
      const root = `webview/public/avatars/${id}`;
      expect((await readdir(root)).sort()).toEqual(['approved.png', 'idle.png', 'working.gif']);
      const staticHashes: string[] = [];
      for (const pose of ['idle', 'approved']) {
        const file = `${root}/${pose}.png`;
        const meta = await sharp(file).metadata();
        expect([meta.width, meta.height, meta.hasAlpha]).toEqual([256, 256, true]);
        const { data } = await sharp(file)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        for (const pixel of [0, 255, 256 * 255, 256 * 256 - 1]) expect(data[pixel * 4 + 3]).toBe(0);
        staticHashes.push(createHash('sha256').update(data).digest('hex'));
      }
      expect(new Set(staticHashes).size).toBe(2);
      const gif = sharp(`${root}/working.gif`, { animated: true });
      const meta = await gif.metadata();
      expect([meta.width, meta.pageHeight, meta.pages, meta.loop, meta.hasAlpha]).toEqual([
        256,
        256,
        4,
        0,
        true,
      ]);
      expect(meta.delay).toEqual([320, 320, 320, 320]);
      const raw = await gif.ensureAlpha().raw().toBuffer();
      const hashes = [];
      for (let frame = 0; frame < 4; frame++) {
        const data = raw.subarray(frame * 256 * 256 * 4, (frame + 1) * 256 * 256 * 4);
        for (const pixel of [0, 255, 256 * 255, 256 * 256 - 1]) expect(data[pixel * 4 + 3]).toBe(0);
        hashes.push(createHash('sha256').update(data).digest('hex'));
      }
      expect(new Set(hashes).size).toBe(4);
    },
  );
});

describe('Halloween seasonal pack', () => {
  it('covers every original without introducing new profile identities', async () => {
    expect((await readdir('webview/public/avatar-events/halloween')).sort()).toEqual(
      [...avatarIds].sort(),
    );
  });
  it.each(avatarIds)('%s keeps transparent poses and four distinct animated frames', async (id) => {
    const root = `webview/public/avatar-events/halloween/${id}`;
    for (const file of ['idle.png', 'approved.png', 'working.gif']) {
      const image = sharp(`${root}/${file}`, { animated: true });
      const meta = await image.metadata();
      expect([meta.width, meta.pageHeight ?? meta.height, meta.hasAlpha]).toEqual([256, 256, true]);
      const original = await sharp(`webview/public/avatars/${id}/${file}`, { animated: true })
        .raw()
        .toBuffer();
      const raw = await image.ensureAlpha().raw().toBuffer();
      expect(raw.equals(original)).toBe(false);
      const frames = file.endsWith('gif') ? 4 : 1;
      if (frames === 4) {
        expect(meta.pages).toBe(4);
        expect(meta.loop).toBe(0);
        expect(meta.delay).toEqual([320, 320, 320, 320]);
      }
      const hashes = [];
      for (let frame = 0; frame < frames; frame++) {
        const pixels = raw.subarray(frame * 256 * 256 * 4, (frame + 1) * 256 * 256 * 4);
        for (const pixel of [0, 255, 256 * 255, 256 * 256 - 1])
          expect(pixels[pixel * 4 + 3]).toBe(0);
        hashes.push(createHash('sha256').update(pixels).digest('hex'));
      }
      expect(new Set(hashes).size).toBe(frames);
    }
  });
});
