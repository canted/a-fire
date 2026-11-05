import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
vi.mock('../../../../frontend/node_modules/react-native', () => ({ PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) } }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useRoomMemberCarry } = await import(`${expo}/src/hooks/useRoomMemberCarry.ts`);
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); });
it('retains measured targets through rerenders and rechecks permissions at release', async () => {
  const drop = vi.fn(); let allowed = true; let carry!: ReturnType<typeof useRoomMemberCarry>;
  function Probe() { carry = useRoomMemberCarry(true, drop); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  const ref = carry.targetRef('side:new', () => allowed);
  ref({ measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(100, 0, 100, 100) } as never);
  const handlers = carry.handlers(7, true) as unknown as Record<string, (...args: unknown[]) => unknown>;
  handlers.onStartShouldSetPanResponderCapture();
  expect(handlers.onMoveShouldSetPanResponderCapture({}, { dx: 30, dy: 1 })).toBe(true);
  expect(handlers.onPanResponderTerminationRequest()).toBe(false);
  await act(async () => handlers.onPanResponderGrant());
  expect(carry.targetRef('side:new', () => allowed)).toBe(ref);
  await act(async () => handlers.onPanResponderMove({}, { dx: 120, dy: 0, moveX: 150, moveY: 50 }));
  expect(carry.drag?.target).toBe('side:new');
  expect(carry.handlers(7, true)).toBe(handlers);
  await act(async () => handlers.onPanResponderRelease());
  expect(drop).toHaveBeenCalledWith(7, 'side:new');
  handlers.onStartShouldSetPanResponderCapture();
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove({}, { dx: 120, dy: 0, moveX: 150, moveY: 50 }));
  allowed = false;
  await act(async () => handlers.onPanResponderRelease());
  expect(drop).toHaveBeenCalledOnce();
});
it('refreshes a stationary pointer after edge scrolling and clamps the scroll extent', async () => {
  vi.useFakeTimers();
  const drop = vi.fn(); let offset = 0; let carry!: ReturnType<typeof useRoomMemberCarry>;
  const scrollTo = vi.fn(({ y }: { y: number }) => { offset = y; });
  const scroll = { current: { getNativeScrollRef: () => ({ measureInWindow: (callback: (...args: number[]) => void) => callback(0, 0, 300, 200) }), scrollTo } };
  function Probe() { carry = useRoomMemberCarry(true, drop, scroll as never); return null; }
  root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(createElement(Probe)));
    carry.onContentSizeChange(300, 260);
    carry.targetRef('lower', () => true)({ measureInWindow: (callback: (...args: number[]) => void) => callback(100, 220 - offset, 100, 40) } as never);
    const handlers = carry.handlers(7, true) as unknown as Record<string, (...args: unknown[]) => unknown>;
    handlers.onStartShouldSetPanResponderCapture();
    await act(async () => handlers.onPanResponderGrant());
    await act(async () => handlers.onPanResponderMove({}, { dx: 120, dy: 0, moveX: 150, moveY: 180 }));
    expect(carry.drag?.target).toBeUndefined();
    await act(async () => vi.advanceTimersByTime(540));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 60, animated: false });
    expect(carry.drag?.target).toBe('lower');
    await act(async () => carry.onScroll({ nativeEvent: { contentOffset: { y: 60 } } } as never));
    expect(carry.drag?.y).toBe(60);
    await act(async () => handlers.onPanResponderRelease());
    expect(drop).toHaveBeenCalledWith(7, 'lower');
  } finally { vi.useRealTimers(); }
});
it('remeasures the release point after a final scroll frame', async () => {
  const drop = vi.fn(); let top = 220; let carry!: ReturnType<typeof useRoomMemberCarry>;
  function Probe() { carry = useRoomMemberCarry(true, drop); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  carry.targetRef('side:9', () => true)({ measureInWindow: (done: (...args: number[]) => void) => done(100, top, 100, 40) } as never);
  const handlers = carry.handlers(7, true) as unknown as Record<string, (...args: unknown[]) => unknown>;
  handlers.onStartShouldSetPanResponderCapture();
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove({}, { dx: 120, dy: 0, moveX: 150, moveY: 180 }));
  expect(carry.drag?.target).toBeUndefined();
  top = 160; // Layout moved, but its scroll notification has not reached JS yet.
  await act(async () => handlers.onPanResponderRelease({}, { moveX: 150, moveY: 180 }));
  expect(drop).toHaveBeenCalledWith(7, 'side:9');
});
