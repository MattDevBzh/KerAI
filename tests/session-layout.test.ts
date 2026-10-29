import { describe, expect, it } from 'vitest';
import { normalizeSessionLayout, SESSION_MODULE_IDS } from '../src/shared/sessionLayout';
import { parseMessage } from '../src/host/messages';

describe('personal session layout', () => {
  it('preserves chosen order and visibility while recovering defaults and new modules', () => {
    expect(normalizeSessionLayout(null)).toEqual({ order: [...SESSION_MODULE_IDS], hidden: [] });
    const layout = normalizeSessionLayout({
      order: ['team', 'team', 'obsolete', 'work'],
      hidden: ['ticket', 'ticket', 'obsolete'],
    });
    expect(layout.order.slice(0, 2)).toEqual(['team', 'work']);
    expect(new Set(layout.order)).toEqual(new Set(SESSION_MODULE_IDS));
    expect(layout.hidden).toEqual(['ticket']);
    expect(normalizeSessionLayout({ order: 'work', hidden: {} })).toEqual(
      normalizeSessionLayout(null),
    );
  });
  it('accepts complete display preferences and rejects malformed or unknown modules', () => {
    const message = {
      type: 'setSessionLayout',
      requestId: 'layout',
      layout: normalizeSessionLayout({ hidden: SESSION_MODULE_IDS }),
    };
    expect(parseMessage(message)).toEqual(message);
    for (const layout of [
      { ...message.layout, order: ['work'] },
      { ...message.layout, order: [...SESSION_MODULE_IDS.slice(1), 'work'] },
      { ...message.layout, hidden: ['unknown'] },
      { ...message.layout, hidden: ['work', 'work'] },
    ])
      expect(() => parseMessage({ ...message, layout })).toThrow();
  });
  it('requires a boolean and correlated request to change automatic answers', () => {
    const message = {
      type: 'setAutopilotAnswers',
      featureId: 'feature',
      enabled: false,
      requestId: 'toggle',
    };
    expect(parseMessage(message)).toEqual(message);
    expect(() => parseMessage({ ...message, enabled: 'false' })).toThrow();
    expect(() => parseMessage({ ...message, requestId: undefined })).toThrow();
  });
});
