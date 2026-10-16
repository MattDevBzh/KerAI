import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountCreditsMonitor } from '../src/host/AccountCreditsMonitor';
import type { AccountCredits } from '../src/shared/credits';

describe('account credits in the visible cockpit', () => {
  afterEach(() => vi.useRealTimers());

  it('polls every 10 seconds, pauses when hidden and stops after disposal', async () => {
    vi.useFakeTimers();
    const read = vi.fn(
      async (): Promise<AccountCredits> => ({ state: 'ready', used: 0, included: 1500 }),
    );
    const publish = vi.fn();
    const monitor = new AccountCreditsMonitor(read, publish);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(read).not.toHaveBeenCalled();
    monitor.setVisible(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenLastCalledWith({ state: 'ready', used: 0, included: 1500 });
    monitor.setVisible(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(read).toHaveBeenCalledTimes(3);
    monitor.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(4);
    monitor.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('does not overlap slow account reads or publish into a closed cockpit', async () => {
    vi.useFakeTimers();
    let finish!: (credits: AccountCredits) => void;
    const read = vi.fn(
      () =>
        new Promise<AccountCredits>((resolve) => {
          finish = resolve;
        }),
    );
    const publish = vi.fn();
    const monitor = new AccountCreditsMonitor(read, publish);
    monitor.setVisible(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledOnce();
    monitor.setVisible(false);
    finish({ state: 'ready', used: 12, included: 1500 });
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).not.toHaveBeenCalled();
    monitor.setVisible(true);
    expect(publish).toHaveBeenLastCalledWith({ state: 'ready', used: 12, included: 1500 });
    monitor.dispose();
    publish.mockClear();
    finish({ state: 'ready', used: 13, included: 1500 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(publish).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('replaces a failed reading with unavailable, never a fabricated zero, and recovers', async () => {
    vi.useFakeTimers();
    const read = vi.fn(
      async (): Promise<AccountCredits> => ({ state: 'ready', used: 7, included: 1500 }),
    );
    const publish = vi.fn();
    const monitor = new AccountCreditsMonitor(read, publish);
    monitor.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    read.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(publish).toHaveBeenLastCalledWith({
      state: 'unavailable',
      message: 'Actualisation des crédits indisponible.',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(publish).toHaveBeenLastCalledWith({ state: 'ready', used: 7, included: 1500 });
    monitor.dispose();
  });
});
