import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/host/messages';

describe('webview protocol boundary', () => {
  it('requires explicit bounded restore paths, a checkpoint id and a full fingerprint', () => {
    const restore = {
      type: 'restoreCheckpoint',
      featureId: 'feature',
      checkpointId: '66090868-36d2-4c18-bf11-25baef0fbe13',
      paths: ['src/a.ts'],
      expectedFingerprint: 'a'.repeat(64),
    };
    expect(parseMessage(restore)).toEqual(restore);
    for (const invalid of [
      { ...restore, paths: [] },
      { ...restore, paths: ['src/a.ts', 'src/a.ts'] },
      { ...restore, paths: Array.from({ length: 201 }, (_, i) => `file-${i}`) },
      { ...restore, expectedFingerprint: '' },
      { ...restore, checkpointId: '../../checkpoint' },
      { ...restore, targetCheckpointId: restore.checkpointId },
      { type: 'createCheckpoint', featureId: 'feature', label: 'x'.repeat(201) },
    ])
      expect(() => parseMessage(invalid)).toThrow();
  });
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
    const request = {
      type: 'saveAgent',
      agent,
      requestId: 'save-profile',
      options: { scope: 'workspace', expectedRevision: null },
    };
    expect(parseMessage(request)).toEqual(request);
    expect(() => parseMessage({ type: 'saveAgent', agent })).toThrow();
    expect(() =>
      parseMessage({
        type: 'saveAgent',
        agent: { ...agent, avatar: 'https://example.invalid/tracker.png' },
      }),
    ).toThrow();
  });
  it('strictly validates context, human replies and versioned approvals', () => {
    const launch = {
      initialContext: 'US-42',
      mcpServerIds: ['ado'],
      memoryIds: [],
      useProjectMemory: false,
    };
    expect(
      parseMessage({
        type: 'previewRun',
        requestId: 'preview',
        featureId: 'feature',
        stepId: 'dev',
        launch,
      }),
    ).toMatchObject({ launch });
    expect(
      parseMessage({ type: 'answerHumanRequest', requestId: 'question', answer: 'Use CSV' }),
    ).toMatchObject({ answer: 'Use CSV' });
    for (const payload of [
      {
        type: 'previewRun',
        requestId: 'preview',
        featureId: 'feature',
        stepId: 'dev',
        launch: { ...launch, mcpServerIds: ['ado', 'ado'] },
      },
      { type: 'runStep', featureId: 'feature', stepId: 'dev', previewFingerprint: 'unverified' },
      { type: 'approveStep', featureId: 'feature', stepId: 'dev', expectedRevision: -1 },
      { type: 'setMcpSecret', serverId: 'ado', key: '../secret', value: 'never stored' },
    ])
      expect(() => parseMessage(payload)).toThrow();
  });
});
