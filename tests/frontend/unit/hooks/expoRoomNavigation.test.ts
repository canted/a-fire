import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ path: '/app/rooms/1/chat', push: vi.fn(), back: vi.fn(), replace: vi.fn(), dismissTo: vi.fn(), transition: vi.fn((_direction, action) => action()) }));
vi.mock('../../../../frontend/node_modules/expo-router', () => ({ usePathname: () => state.path, useRouter: () => ({ push: state.push, back: state.back, replace: state.replace, dismissTo: state.dismissTo, canGoBack: () => true }) }));
vi.mock('../../../../frontend/src/lib/roomTransition', () => ({ transitionRoom: state.transition }));
vi.mock('../../../../frontend/src/hooks/useRoomBenchmark', () => ({ markRoomNavigation: vi.fn() }));
const { useRoomNavigation } = await import('../../../../frontend/src/hooks/useRoomNavigation.web');
afterEach(() => { vi.clearAllMocks(); state.path = '/app/rooms/1/chat'; });
it('uses reverse motion for parent Rooms and forward motion for entering a Room', () => {
  const navigation = useRoomNavigation();
  navigation.parent('2');
  expect(state.transition.mock.calls[0][0]).toBe('shallower');
  expect(state.dismissTo).toHaveBeenCalledWith('/app/rooms/2');
  navigation.enter('3');
  expect(state.transition.mock.calls[1][0]).toBe('deeper');
  expect(state.push).toHaveBeenCalledWith('/app/rooms/3');
});
it('dismisses Save and historical threads without Room motion', () => {
  state.path = '/app/rooms/1/chat/messages/2/save';
  useRoomNavigation().back('1', '2');
  expect(state.back).toHaveBeenCalledOnce();
  expect(state.transition).not.toHaveBeenCalled();
  state.path = '/app/rooms/1/chat/messages/2';
  useRoomNavigation().back('1', '2');
  expect(state.transition).not.toHaveBeenCalled();
});
it('returns to the named Project ancestor rather than unrelated browser history', () => {
  useRoomNavigation().ancestor('/app/projects/9');
  expect(state.transition).not.toHaveBeenCalled();
  expect(state.dismissTo).toHaveBeenCalledWith('/app/projects/9');
  expect(state.back).not.toHaveBeenCalled();
});

it('cuts between Home, Projects and entries but animates Home to a Room', () => {
  state.path = '/app';
  useRoomNavigation().destination('/app/projects/9');
  state.path = '/app/projects/9';
  useRoomNavigation().destination('/app/projects/9/entries/2');
  useRoomNavigation().home();
  expect(state.transition).not.toHaveBeenCalled();
  state.path = '/app';
  useRoomNavigation().enter('3');
  expect(state.transition).toHaveBeenCalledOnce();
});

it('keeps explicit message and source links in Chat while ordinary Room entry opens its home', () => {
  const navigation = useRoomNavigation();
  navigation.thread('1', 42);
  expect(state.push).toHaveBeenCalledWith('/app/rooms/1/chat/messages/42');
  navigation.source('1', '42');
  expect(state.dismissTo).toHaveBeenCalledWith('/app/rooms/1/chat?message=42');
  expect(state.transition).not.toHaveBeenCalled();
});


it('fades Home out on entry and uses reverse diagonal motion from the Room home button', () => {
  state.path = '/app';
  useRoomNavigation().enter('4');
  expect(state.transition.mock.calls[0][0]).toBe('from-home');
  state.path = '/app/rooms/4';
  useRoomNavigation().home();
  expect(state.transition.mock.calls[1][0]).toBe('home');
  expect(state.dismissTo).toHaveBeenCalledWith('/app');
});

it('keeps All Rooms outside spatial navigation in both directions', () => {
  state.path = '/app';
  useRoomNavigation().destination('/app/rooms/all');
  expect(state.push).toHaveBeenCalledWith('/app/rooms/all');
  state.path = '/app/rooms/all';
  useRoomNavigation().home();
  useRoomNavigation().enter('4');
  expect(state.dismissTo).toHaveBeenCalledWith('/app');
  expect(state.push).toHaveBeenCalledWith('/app/rooms/4');
  expect(state.transition).not.toHaveBeenCalled();
});
