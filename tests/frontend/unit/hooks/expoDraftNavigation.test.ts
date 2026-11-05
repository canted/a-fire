import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const state = vi.hoisted(() => ({ enabled: false, prevent: undefined as undefined | ((event: { data: { action: object } }) => void), dispatch: vi.fn() }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('../../../../frontend/node_modules/expo-router', () => ({ useNavigation: () => ({ dispatch: state.dispatch }) }));
vi.mock('../../../../frontend/node_modules/expo-router/react-navigation', () => ({ usePreventRemove: (enabled: boolean, callback: typeof state.prevent) => { state.enabled = enabled; state.prevent = callback; } }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useDraftNavigation } = await import(`${expo}/src/hooks/useDraftNavigation.ts`);
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); });
it('blocks native Back during a mutation and allows its successful completion to dismiss once', async () => {
  const save = vi.fn(async () => {}); const error = vi.fn(); let guard!: ReturnType<typeof useDraftNavigation>;
  function Probe() { guard = useDraftNavigation({ dirty: false, busy: true, busyMessage: 'Please wait for this message to finish saving.', save, onError: error }); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  expect(state.enabled).toBe(true);
  const action = { type: 'GO_BACK' };
  state.prevent!({ data: { action } });
  expect(error).toHaveBeenCalledWith('Please wait for this message to finish saving.');
  expect(save).not.toHaveBeenCalled();
  expect(state.dispatch).not.toHaveBeenCalled();
  guard.release(); state.prevent!({ data: { action } });
  expect(state.dispatch).toHaveBeenCalledExactlyOnceWith(action);
});
it('leaves idle dismissal available', async () => {
  function Probe() { useDraftNavigation({ dirty: false, busy: false, save: async () => {}, onError: vi.fn() }); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  expect(state.enabled).toBe(false);
});
