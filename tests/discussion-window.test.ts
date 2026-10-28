import { describe, expect, it } from 'vitest';
import { discussionContext, boundedDiscussionSource } from '../src/core/discussionContext';
import type { DiscussionMessage } from '../src/shared/discussions';
const message = (content: string, role: 'user' | 'assistant' = 'user'): DiscussionMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  status: 'complete',
  createdAt: new Date().toISOString(),
});
describe('deterministic discussion continuation', () => {
  it('keeps the recent complete messages and never mutates originals', () => {
    const messages = Array.from({ length: 300 }, (_, i) =>
      message(`Message ${i}: ${'x'.repeat(2000)}`),
    );
    const before = structuredClone(messages);
    const window = discussionContext(messages);
    expect(window.omittedMessages).toBeGreaterThan(200);
    expect(window.history.at(-1)?.content).toBe(messages.at(-1)?.content);
    expect(JSON.stringify(window.history).length).toBeLessThan(111000);
    expect(messages).toEqual(before);
  });
  it('bounds JSON escaping and visibly truncates an oversized last response', () => {
    const original = message('"\\\n'.repeat(100000), 'assistant');
    const window = discussionContext([original], 5000);
    expect(JSON.stringify(window.history).length).toBeLessThan(5100);
    expect(window.truncatedMessages).toBe(1);
    expect(window.history[0].content).toContain('original conservé');
    expect(original.content.length).toBe(300000);
  });
  it('marks archived source excerpts without changing the archive', () => {
    const original = 'archive'.repeat(50000);
    const bounded = boundedDiscussionSource(original);
    expect(bounded.truncated).toBe(true);
    expect(bounded.text.length).toBeLessThan(56000);
    expect(original.length).toBe(350000);
  });
});
