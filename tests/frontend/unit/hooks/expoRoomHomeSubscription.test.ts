import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ mutate: vi.fn(), effect: undefined as undefined | (() => () => void), options: undefined as any }));
vi.mock('../../../../frontend/node_modules/react', () => ({ useRef: (value: unknown) => ({ current: value }), useState: () => ['connecting', vi.fn()], useEffect: (effect: typeof state.effect) => { state.effect = effect; } }));
vi.mock('../../../../frontend/node_modules/swr', () => ({ useSWRConfig: () => ({ mutate: state.mutate }) }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) } }));
vi.mock('../../../../frontend/src/lib/cable', () => ({ cable: { getCableConsumer: vi.fn(), ensureCableConnected: vi.fn(), refreshChatPresence: vi.fn() } }));
vi.mock('../../../../frontend/src/lib/roomSubscription', () => ({ subscribeToRoom: (options: unknown) => { state.options = options; return { refresh: vi.fn(), disconnected: vi.fn(), unsubscribe: vi.fn() }; } }));
import { useRoomSubscription } from '../../../../frontend/src/hooks/useRoomSubscription';
let cleanup: (() => void) | undefined;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); state.mutate.mockResolvedValue(undefined); useRoomSubscription('7', async () => {}); cleanup = state.effect!(); });
afterEach(() => { cleanup?.(); vi.useRealTimers(); });
it('refreshes Room metadata and home on catch-up, and invalidates home on content events only', async () => {
  await state.options.refresh();
  expect(state.mutate).toHaveBeenCalledWith(['room', '7']);
  expect(state.mutate).toHaveBeenCalledWith(['room-home', '7']);
  const catchUp = state.mutate.mock.calls.find(call => typeof call[0] === 'function' && call[0](['room-rounds', '7']))![0];
  const homeRefresh = state.mutate.mock.calls.find(call => typeof call[0] === 'function' && call[0](['home', 'UTC']))![0];
  expect(homeRefresh(['home', 'America/Los_Angeles'])).toBe(true);
  expect(homeRefresh(['room-home', '7'])).toBe(false);
  expect(catchUp(['activity', '42'])).toBe(false);
  expect(catchUp(['room-rounds', '8'])).toBe(false);
  expect(catchUp(['room-rounds', '7'])).toBe(true);
  expect(catchUp(['post', '1'])).toBe(false);
  state.mutate.mockClear();
  state.options.changed({ type: 'presence' });
  expect(state.mutate).not.toHaveBeenCalled();
  state.options.changed({ type: 'message_updated' });
  const predicate = state.mutate.mock.calls[0][0];
  expect(predicate(['room-home', '7'])).toBe(true);
  expect(predicate(['board', '91'])).toBe(true);
  expect(predicate(['room-rounds', '7'])).toBe(true);
  expect(predicate(['post', '1'])).toBe(false);
});
it('propagates home refresh failures so the subscription cannot report successful recovery', async () => {
  state.mutate.mockImplementation((key: string[]) => key[0] === 'room-home' ? Promise.reject(new Error('Home unavailable')) : Promise.resolve());
  await expect(state.options.refresh()).rejects.toThrow('Home unavailable');
});

it('refreshes the mounted Round detail through the canonical subscription', async () => {
  cleanup?.();
  const detail = vi.fn().mockResolvedValue(undefined);
  useRoomSubscription('7', async () => {}, detail);
  cleanup = state.effect!();
  await state.options.refresh();
  expect(detail).toHaveBeenCalledOnce();
  detail.mockRejectedValue(new Error('Round unavailable'));
  await expect(state.options.refresh()).rejects.toThrow('Round unavailable');
});
