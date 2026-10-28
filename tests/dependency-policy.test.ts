import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { taskBoardTools } from '../src/host/TaskBoardTools';
import { updateTaskBoard } from '../src/core/taskBoard';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@github/copilot-sdk'));

describe('patched schema validation shared with Copilot', () => {
  it('resolves the same patched Zod from the application and SDK', () => {
    expect(sdkRequire.resolve('zod')).toBe(require.resolve('zod'));
    expect(sdkRequire('zod/package.json').version).toBe('4.6.7');
  });

  it('rejects oversized arrays before visiting elements, with one bounded issue', () => {
    const visit = vi.fn(() => true);
    const schema = z.array(z.string().refine(visit)).max(2);
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(visit).toHaveBeenCalledTimes(2);
    visit.mockClear();
    const rejected = schema.safeParse(Array.from({ length: 1024 }, () => 'item'));
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues).toMatchObject([{ code: 'too_big' }]);
    if (!rejected.success) expect(rejected.error.issues).toHaveLength(1);
    expect(visit).not.toHaveBeenCalled();
  });

  it('also bounds invalid maps and sets before expanding validation errors', () => {
    for (const [schema, value, legitimate] of [
      [
        z.map(z.string(), z.string()).max(1),
        new Map([
          [1, 2],
          [3, 4],
        ]),
        new Map([['a', 'b']]),
      ],
      [z.set(z.string()).max(1), new Set([1, 2]), new Set(['a'])],
    ] as const) {
      expect(schema.safeParse(legitimate).success).toBe(true);
      const result = schema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].code).toBe('too_big');
      }
    }
  });

  it('keeps valid task board tools working and rejects oversized input before side effects', async () => {
    const onTaskBoard = vi.fn(async (input) => updateTaskBoard(undefined, input));
    const tool = taskBoardTools(
      { onTaskBoard, onEvent() {}, onSession() {} },
      new AbortController().signal,
    )[0];
    const call = (args: unknown) =>
      tool.handler!(args, {
        sessionId: 's',
        toolCallId: 'c',
        toolName: tool.name,
        arguments: args,
      });
    const input = {
      mode: 'plan',
      title: 'Plan',
      items: [{ id: 'one', text: 'Vérifier', status: 'pending' }],
    };
    await expect(call(input)).resolves.toMatchObject({ resultType: 'success' });
    await expect(
      call({ ...input, items: Array.from({ length: 1024 }, () => null) }),
    ).rejects.toThrow();
    expect(onTaskBoard).toHaveBeenCalledOnce();
  });
});
