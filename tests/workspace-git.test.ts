import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { runWorkspaceGit } from '../src/host/workspaceGit';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
function processStub() {
  return Object.assign(new EventEmitter(), {
    pid: 24680,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    unref: vi.fn(),
  });
}
let child: ReturnType<typeof processStub>;
beforeEach(() => {
  vi.useFakeTimers();
  child = processStub();
  spawn
    .mockReset()
    .mockImplementation((command: string) => (command === 'git' ? child : processStub()));
  vi.spyOn(process, 'kill').mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('workspace Git deadlines', () => {
  it('allows a checkout lasting three minutes and preserves binary machine output', async () => {
    const pending = runWorkspaceGit(
      '/repo',
      ['worktree', 'add', '-b', 'feature', '--', '/target', 'HEAD'],
      ['core.hooksPath=/empty'],
      1024,
    );
    await vi.advanceTimersByTimeAsync(180_000);
    expect(process.kill).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
    const bytes = Buffer.from([0xff, 0x00, 0xc3, 0xa9]);
    child.stdout.emit('data', bytes.subarray(0, 3));
    child.stdout.emit('data', bytes.subarray(3));
    child.emit('close', 0, null);
    expect(await pending).toEqual({ code: 0, stdout: bytes, stderr: Buffer.alloc(0) });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(process.kill).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it('also permits a slow repository status beyond the former 30-second limit', async () => {
    const pending = runWorkspaceGit('/repo', ['status', '--porcelain=v1', '-z'], [], 1024);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(process.kill).not.toHaveBeenCalled();
    child.emit('close', 0, null);
    expect((await pending).code).toBe(0);
  });
  it.each([
    { args: ['worktree', 'add', '/target'], deadline: 600_000, operation: 'git worktree add' },
    { args: ['status'], deadline: 120_000, operation: 'git status' },
  ])(
    'reports the deadline for $operation even when termination returns an exit code',
    async ({ args, deadline, operation }) => {
      const pending = runWorkspaceGit('/repo', args, [], 1024);
      const outcome = pending.catch((error: Error) => error);
      child.stderr.emit('data', Buffer.from('Updating files: 48% password=private-value'));
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(process.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      if (process.platform === 'win32') {
        expect(spawn).toHaveBeenLastCalledWith(
          'taskkill.exe',
          ['/pid', '24680', '/t', '/f'],
          expect.objectContaining({ stdio: 'ignore' }),
        );
      } else expect(process.kill).toHaveBeenCalledWith(-24680, 'SIGKILL');
      child.emit('close', 1, null);
      const error = (await outcome) as Error;
      expect(error.message).toContain(`Délai Git dépassé pendant « ${operation} »`);
      expect(error.message).toContain('Updating files: 48%');
      expect(error.message).not.toContain('private-value');
    },
  );
  it('keeps interruption, output overflow and process startup errors distinct', async () => {
    const interrupted = runWorkspaceGit('/repo', ['status'], [], 8).catch((error: Error) => error);
    child.emit('close', null, 'SIGTERM');
    expect(((await interrupted) as Error).message).toMatch(/interrompue.*git status.*SIGTERM/);
    const overflow = runWorkspaceGit('/repo', ['status'], [], 8).catch((error: Error) => error);
    child.stdout.emit('data', Buffer.from('123456789'));
    child.emit('close', null, 'SIGKILL');
    expect(((await overflow) as Error).message).toMatch(/Sortie Git trop volumineuse/);
    const missing = runWorkspaceGit('/repo', ['status'], [], 8).catch((error: Error) => error);
    child.emit('error', new Error('spawn git ENOENT'));
    expect(((await missing) as Error).message).toContain('ENOENT');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps Git overrides and environment isolation for every operation', async () => {
    vi.stubEnv('GIT_DIR', '/other-repository');
    const pending = runWorkspaceGit(
      '/repo',
      ['status'],
      ['filter.custom.process=', 'filter.custom.required=false'],
      1024,
    );
    const [, args, options] = spawn.mock.calls[0];
    expect(args).toContain('core.fsmonitor=false');
    expect(args).toContain('filter.custom.process=');
    expect(args).toContain('filter.custom.required=false');
    expect(options.env.GIT_DIR).toBeUndefined();
    expect(options.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(options.shell).toBe(false);
    child.emit('close', 0, null);
    await pending;
  });
});
