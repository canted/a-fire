import { afterEach, expect, it, vi } from 'vitest';
import { createWallTransition } from '../../../../frontend/src/lib/wallTransition';
afterEach(() => { vi.restoreAllMocks(); delete document.documentElement.dataset.roomWallTransition; });
it('commits the Wall inside its named snapshot and clears state afterwards', async () => {
  const update = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn((commit: () => Promise<void>) => {
    expect(document.documentElement.dataset.roomWallTransition).toBe('opening');
    const done = commit(); return { updateCallbackDone: done, finished: done, skipTransition: vi.fn() };
  }) });
  await createWallTransition().run('opening', update);
  expect(update).toHaveBeenCalledOnce();
  expect(document.documentElement.dataset.roomWallTransition).toBeUndefined();
});
it('respects reduced motion without a second state transition', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  const snapshot = vi.fn(); Object.defineProperty(document, 'startViewTransition', { configurable: true, value: snapshot });
  const update = vi.fn(); await createWallTransition().run('closing', update);
  expect(update).toHaveBeenCalledOnce(); expect(snapshot).not.toHaveBeenCalled();
});
it('cancels a superseded snapshot before it can commit stale open state', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  const commits: Array<() => Promise<void>> = [];
  const skip = vi.fn();
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn((commit: () => Promise<void>) => { commits.push(commit); return { updateCallbackDone: Promise.resolve(), finished: Promise.resolve(), skipTransition: skip }; }) });
  const motion = createWallTransition(); const open = vi.fn(); const close = vi.fn();
  const first = motion.run('opening', open); const second = motion.run('closing', close);
  await commits[0](); await commits[1](); await Promise.all([first, second]);
  expect(skip).toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
