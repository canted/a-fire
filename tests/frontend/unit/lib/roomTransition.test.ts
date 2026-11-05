import { afterEach, expect, it, vi } from 'vitest';
import { transitionRoom } from '../../../../frontend/src/lib/roomTransition';
afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.roomDetailsTransition; });
it('navigates immediately with reduced motion or without View Transitions', () => {
  const navigate = vi.fn(); const commit = vi.fn(action => action());
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  const start = vi.fn();
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  transitionRoom('deeper', navigate, commit);
  expect(navigate).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled();
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
  transitionRoom('home', navigate, commit);
  expect(navigate).toHaveBeenCalledTimes(2);
});
it('interrupts old transitions and commits the requested destination once', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  const skip = vi.fn(); const callbacks: Array<() => Promise<void>> = [];
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn(callback => {
    callbacks.push(callback); return { ready: Promise.resolve(), finished, skipTransition: skip };
  }) });
  const old = vi.fn(); const next = vi.fn();
  transitionRoom('deeper', old, action => action());
  transitionRoom('home', next, action => action());
  await callbacks[0](); await callbacks[1]();
  expect(old).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledOnce(); expect(skip).toHaveBeenCalledOnce();
  expect(document.documentElement.dataset.roomDetailsTransition).toBe('home');
  finish(); await finished; await Promise.resolve();
  expect(document.documentElement.dataset.roomDetailsTransition).toBeUndefined();
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
});

it('holds the destination snapshot until its authorized content mounts', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  let update!: () => Promise<void>;
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn(callback => {
    update = callback;
    return { ready: Promise.resolve(), finished: new Promise(() => {}), skipTransition: vi.fn() };
  }) });
  transitionRoom('from-home', () => history.replaceState({}, '', '/app/rooms/4'), action => action(), '/app/rooms/4');
  let captured = false;
  const pending = update().then(() => { captured = true; });
  await Promise.resolve(); await Promise.resolve();
  expect(captured).toBe(false);
  const surface = document.createElement('div');
  surface.dataset.roomNavigationReady = '/app/rooms/4';
  document.body.append(surface);
  await pending;
  expect(captured).toBe(true);
  surface.remove(); history.replaceState({}, '', '/');
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
});

it('releases a slow destination instead of indefinitely freezing navigation', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  let update!: () => Promise<void>;
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn(callback => {
    update = callback;
    return { ready: Promise.resolve(), finished: new Promise(() => {}), skipTransition: vi.fn() };
  }) });
  transitionRoom('from-home', () => {}, action => action(), '/app/rooms/9');
  const pending = update();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1800);
  await pending;
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
});
