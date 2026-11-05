import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void), register: vi.fn(), stop: vi.fn(), navigation: vi.fn() }));
vi.mock('../../../../frontend/node_modules/react', () => ({ useEffect: (effect: () => (() => void)) => { state.cleanup = effect(); } }));
vi.mock('../../../../frontend/src/lib/privateMediaCache', () => ({ registerPrivateMediaCache: state.register }));
vi.mock('../../../../frontend/src/lib/notificationNavigation', () => ({ registerNotificationNavigation: state.navigation.mockImplementation(() => state.stop) }));
const { useWebLifecycle } = await import('../../../../frontend/src/hooks/useWebLifecycle.web');
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('reuses production registration and cleans up notification listeners', () => {
  vi.stubGlobal('__DEV__', false);
  useWebLifecycle();
  expect(state.register).toHaveBeenCalledOnce();
  expect(state.navigation).toHaveBeenCalledOnce();
  state.cleanup?.();
  expect(state.stop).toHaveBeenCalledOnce();
});
it('does not install a persistent worker during Metro development', () => {
  vi.stubGlobal('__DEV__', true);
  useWebLifecycle();
  expect(state.register).not.toHaveBeenCalled();
  expect(state.navigation).toHaveBeenCalledOnce();
});
