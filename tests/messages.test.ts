import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/host/messages';

describe('webview protocol boundary', () => {
  it('rejects unsupported actions, shell payloads and malformed iteration limits', () => {
    for (const input of [
      null,
      { type: 'exec', command: 'rm' },
      { type: 'runStep', featureId: 'feature', stepId: 'dev', command: 'arbitrary shell' },
      {
        type: 'configureStep',
        featureId: 'feature',
        stepId: 'dev',
        agentId: 'dev',
        skills: [],
        maxAttempts: -1,
      },
    ])
      expect(() => parseMessage(input)).toThrow();
  });
  it('accepts an explicit avatar and nickname without accepting arbitrary image URLs', () => {
    const agent = {
      id: 'dev',
      name: 'Developer',
      description: '',
      instructions: 'Implement the requested feature.',
      tools: ['read', 'edit'],
      skills: [],
      nickname: 'Capitaine Patch',
      avatar: 'captain',
    };
    expect(parseMessage({ type: 'saveAgent', agent })).toEqual({ type: 'saveAgent', agent });
    expect(() =>
      parseMessage({
        type: 'saveAgent',
        agent: { ...agent, avatar: 'https://example.invalid/tracker.png' },
      }),
    ).toThrow();
  });
});
