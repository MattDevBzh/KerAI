import { describe, expect, it, vi } from 'vitest';
import { applySessionBatch, type SessionBatchTarget } from '../src/host/SessionBatch';
import { selectSessionRange, sessionProjects } from '../src/shared/sessionList';
import { demoState } from '../webview/demo';
import { parseMessage } from '../src/host/messages';

describe('visible session selection', () => {
  it('extends inclusively in both directions in displayed order and excludes hidden rows', () => {
    const visible = ['d', 'b', 'e', 'a'];
    expect(selectSessionRange(visible, ['b', 'hidden'], 'b', 'a', true)).toEqual(['b', 'e', 'a']);
    expect(selectSessionRange(visible, ['a'], 'a', 'b', true)).toEqual(['a', 'b', 'e']);
    expect(selectSessionRange(visible, ['b'], 'hidden', 'e', true)).toEqual(['b', 'e']);
    expect(selectSessionRange(visible, ['b'], 'b', 'b', false)).toEqual([]);
  });
  it('keeps multi-project attribution and uses the renamed catalog entry', () => {
    const feature = structuredClone(demoState.features[0]);
    feature.projects = [
      { id: 'lms', name: 'Old LMS', path: '/lms', branch: 'main' },
      { id: 'lxp', name: 'LXP', path: '/lxp', branch: 'develop' },
    ];
    expect(
      sessionProjects(feature, [{ id: 'lms', name: 'LMS renommé', path: '/lms' }]).map(
        (p) => p.name,
      ),
    ).toEqual(['LMS renommé', 'LXP']);
    feature.projects = undefined;
    expect(sessionProjects(feature, [{ id: 'lms', name: 'LMS', path: '/lms' }])).toEqual([]);
  });
});

function target(id: string): SessionBatchTarget {
  const feature = { ...structuredClone(demoState.features[0]), id, title: id };
  feature.steps.forEach((step) => {
    step.status = 'approved';
  });
  const getFeature = vi.fn(() => feature);
  return {
    service: {
      engine: { getFeature } as SessionBatchTarget['service']['engine'],
      assertConfigurable: vi.fn(),
      deleteFeature: vi.fn(async () => 123),
      archiveFeature: vi.fn(async () => {}),
      recordHumanAction: vi.fn(async () => {}),
    },
    removeDeletedFeature: vi.fn(async () => {}),
  };
}
const request = { requestId: 'batch', action: 'delete' as const, featureIds: ['a', 'b', 'a'] };
describe('cross-project session actions', () => {
  it('confirms once, deduplicates IDs and deletes only each owning store and links', async () => {
    const a = target('a'),
      b = target('b');
    const confirm = vi.fn(async () => true),
      progress = vi.fn();
    const result = await applySessionBatch(
      request,
      (id) => (id === 'a' ? a : b),
      confirm,
      progress,
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]).toEqual([
      [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })],
    ]);
    expect(a.service.deleteFeature).toHaveBeenCalledExactlyOnceWith('a');
    expect(b.service.deleteFeature).toHaveBeenCalledExactlyOnceWith('b');
    expect(a.removeDeletedFeature).toHaveBeenCalledExactlyOnceWith('a');
    expect(b.removeDeletedFeature).toHaveBeenCalledExactlyOnceWith('b');
    expect(result).toMatchObject({ succeeded: ['a', 'b'], failed: [], freedBytes: 246 });
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });
  it('cancellation never mutates a session', async () => {
    const a = target('a');
    const result = await applySessionBatch(
      { ...request, featureIds: ['a'] },
      () => a,
      async () => false,
      vi.fn(),
    );
    expect(result.cancelled).toBe(true);
    expect(a.service.deleteFeature).not.toHaveBeenCalled();
    expect(a.removeDeletedFeature).not.toHaveBeenCalled();
  });
  it('rechecks after confirmation if a session starts running', async () => {
    const a = target('a');
    const result = await applySessionBatch(
      { ...request, featureIds: ['a'] },
      () => a,
      async () => {
        a.service.engine.getFeature('a').steps[0].status = 'running';
        return true;
      },
      vi.fn(),
    );
    expect(result.succeeded).toEqual([]);
    expect(result.failed[0].error).toContain('a démarré');
    expect(a.service.deleteFeature).not.toHaveBeenCalled();
  });
  it('continues after a failed project and reports success and failure separately', async () => {
    const a = target('a'),
      b = target('b');
    vi.mocked(a.service.deleteFeature).mockRejectedValue(new Error('Disque indisponible'));
    const result = await applySessionBatch(
      request,
      (id) => (id === 'a' ? a : b),
      async () => true,
      vi.fn(),
    );
    expect(result.succeeded).toEqual(['b']);
    expect(result.failed).toEqual([{ featureId: 'a', title: 'a', error: 'Disque indisponible' }]);
    expect(a.removeDeletedFeature).not.toHaveBeenCalled();
  });
  it('skips a blocked session before confirmation and restores the others without deleting', async () => {
    const a = target('a'),
      b = target('b');
    vi.mocked(a.service.assertConfigurable).mockImplementation(() => {
      throw new Error('Projet non approuvé');
    });
    const confirm = vi.fn(async () => true);
    const result = await applySessionBatch(
      { ...request, action: 'restore' },
      (id) => (id === 'a' ? a : b),
      confirm,
      vi.fn(),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(result.failed).toHaveLength(1);
    expect(b.service.archiveFeature).toHaveBeenCalledExactlyOnceWith('b', false);
    expect(a.service.archiveFeature).not.toHaveBeenCalled();
    expect(b.service.deleteFeature).not.toHaveBeenCalled();
  });
  it('rejects empty selections, unknown actions and extra deletion paths', () => {
    expect(() => parseMessage({ type: 'manageSessions', ...request })).not.toThrow();
    expect(() => parseMessage({ type: 'manageSessions', ...request, featureIds: [] })).toThrow();
    expect(() =>
      parseMessage({ type: 'manageSessions', ...request, action: 'purgeProject' }),
    ).toThrow();
    expect(() => parseMessage({ type: 'manageSessions', ...request, path: '/source' })).toThrow();
  });
});
