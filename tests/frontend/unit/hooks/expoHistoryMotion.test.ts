import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ path: '/app/rooms/7/chat', active: false, transition: vi.fn() }));
vi.mock('../../../../frontend/node_modules/expo-router', () => ({ usePathname: () => state.path }));
vi.mock('../../../../frontend/src/lib/roomTransition', () => ({ roomTransitionActive: () => state.active, transitionRoom: state.transition }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { useHistoryMotion } = await import(`${expo}/src/hooks/useHistoryMotion.web.ts`);
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); state.active = false; });
it('delivers browser traversal to the router once, inside the shared snapshot commit', async () => {
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn() });
  function Probe() { useHistoryMotion(); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  const router = vi.fn(); window.addEventListener('popstate', router);
  window.history.replaceState({ id: 'test' }, '', '/app');
  window.dispatchEvent(new PopStateEvent('popstate', { state: { id: 'test' } }));
  expect(router).not.toHaveBeenCalled();
  expect(state.transition.mock.calls[0][0]).toBe('home');
  await act(async () => state.transition.mock.calls[0][2](state.transition.mock.calls[0][1]));
  expect(router).toHaveBeenCalledOnce();
  expect(router.mock.calls[0][0].state).toEqual({ id: 'test' });
  state.active = true;
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(router).toHaveBeenCalledTimes(2); expect(state.transition).toHaveBeenCalledOnce();
  window.removeEventListener('popstate', router);
});
