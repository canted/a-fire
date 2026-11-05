import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const state = vi.hoisted(() => ({ reduced: true, timing: vi.fn(), wallRun: vi.fn(), position: 0, back: undefined as undefined | (() => boolean) }));
vi.mock('../../../../frontend/src/lib/wallTransition', () => ({ createWallTransition: () => ({
  run: state.wallRun.mockImplementation(async (_direction: string, update: () => void) => update()), cancel: vi.fn(),
}) }));
vi.mock('../../../../frontend/src/hooks/useReducedMotion', () => ({ useReducedMotion: () => state.reduced }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({
  Platform: { OS: 'web' }, useWindowDimensions: () => ({ height: 800 }), Easing: { bezier: vi.fn() },
  Animated: { Value: class { stopAnimation(done?: (value: number) => void) { done?.(state.position); } interpolate(value: unknown) { return value; } }, timing: (...args: unknown[]) => { state.timing(...args); return { start: (done: (result: { finished: boolean }) => void) => done({ finished: true }), stop: vi.fn() }; } },
  BackHandler: { addEventListener: (_name: string, listener: () => boolean) => { state.back = listener; return { remove: () => { state.back = undefined; } }; } },
}));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useRoomDetailsPresence } = await import(`${expo}/src/hooks/useRoomDetailsPresence.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); vi.clearAllMocks(); });
it('removes panel motion under reduced motion and preserves Back and return focus', async () => {
  const focus = { current: { focus: vi.fn() } };
  const close = vi.fn();
  let present = false;
  function Probe({ open }: { open: boolean }) { present = useRoomDetailsPresence(open, close, focus).present; return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe, { open: true })));
  expect(state.timing.mock.calls.at(-1)?.[1]).toMatchObject({ duration: 0, toValue: 1 });
  expect(present).toBe(true);
  expect(state.back?.()).toBe(true); expect(close).toHaveBeenCalledOnce();
  await act(async () => root!.render(createElement(Probe, { open: false })));
  expect(state.timing.mock.calls.at(-1)?.[1]).toMatchObject({ duration: 0, toValue: 0 });
  expect(present).toBe(false); expect(focus.current.focus).toHaveBeenCalledOnce();
  expect(state.back).toBeUndefined();
});
it('uses the canonical short shelf timing instead of full-panel timing', async () => {
  state.reduced = false;
  const focus = { current: null };
  let presence: ReturnType<typeof useRoomDetailsPresence>;
  function Probe({ compact }: { compact: boolean }) { presence = useRoomDetailsPresence(true, () => {}, focus, compact); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe, { compact: true })));
  expect(presence!.style.opacity).toBe(0);
  await act(async () => presence.onLayout({ nativeEvent: { layout: { height: 200 } } } as never));
  expect(presence!.style.opacity).toBe(1);
  expect(state.timing.mock.calls.at(-1)?.[1]).toMatchObject({ duration: 180 });
  await act(async () => root!.render(createElement(Probe, { compact: false })));
  expect(state.timing.mock.calls.at(-1)?.[1]).toMatchObject({ duration: 420 });
  state.reduced = true;
});

it('scales an interrupted reversal by remaining panel distance', async () => {
  state.reduced = false;
  state.position = 0;
  const focus = { current: null };
  let presence: ReturnType<typeof useRoomDetailsPresence>;
  function Probe({ open }: { open: boolean }) { presence = useRoomDetailsPresence(open, () => {}, focus, true); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe, { open: true })));
  await act(async () => presence.onLayout({ nativeEvent: { layout: { height: 160 } } } as never));
  state.position = 0.25;
  await act(async () => root!.render(createElement(Probe, { open: false })));
  expect(state.timing.mock.calls.at(-1)?.[1]).toMatchObject({ duration: 45, toValue: 0 });
  state.position = 0; state.reduced = true;
});

it('slides the Chat drawer up from its measured bottom edge and returns focus when closed', async () => {
  state.reduced = false;
  state.position = 0;
  const focus = { current: { focus: vi.fn() } };
  let presence: ReturnType<typeof useRoomDetailsPresence>;
  function Probe({ open }: { open: boolean }) {
    presence = useRoomDetailsPresence(open, () => {}, focus, false, 'bottom');
    return null;
  }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe, { open: true })));
  await act(async () => presence.onLayout({ nativeEvent: { layout: { height: 600 } } } as never));
  expect(presence!.style.transform[0].translateY).toMatchObject({ outputRange: [600, 0] });
  expect(presence!.present).toBe(true);
  state.position = 1;
  await act(async () => root!.render(createElement(Probe, { open: false })));
  expect(presence!.present).toBe(false);
  expect(focus.current.focus).toHaveBeenCalledOnce();
  state.position = 0;
  state.reduced = true;
});

it('returns history focus to its live Chat opener and falls back if the row disappeared', async () => {
  const { useRoomWallMotion } = await import('../../../../frontend/src/hooks/useRoomWallMotion.web');
  const fallback = { current: { focus: vi.fn() } };
  const opener = document.createElement('button');
  document.body.append(opener);
  function Probe({ open }: { open: boolean }) { useRoomWallMotion(open, () => {}, fallback); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe, { open: false })));
  opener.focus();
  await act(async () => root!.render(createElement(Probe, { open: true })));
  opener.blur();
  await act(async () => root!.render(createElement(Probe, { open: false })));
  expect(document.activeElement).toBe(opener);
  expect(fallback.current.focus).not.toHaveBeenCalled();
  // Forward can mount and focus the panel before the opener is captured.
  const panel = document.createElement('div');
  panel.dataset.wallSnapshot = 'panel';
  const heading = document.createElement('h2');
  heading.tabIndex = -1;
  panel.append(heading);
  document.body.append(panel);
  heading.focus();
  await act(async () => root!.render(createElement(Probe, { open: true })));
  await act(async () => root!.render(createElement(Probe, { open: false })));
  expect(document.activeElement).toBe(opener);
  panel.remove();
  await act(async () => root!.render(createElement(Probe, { open: true })));
  opener.remove();
  await act(async () => root!.render(createElement(Probe, { open: false })));
  expect(fallback.current.focus).toHaveBeenCalledOnce();
});

it('keeps the canonical web history transition for opening and closing', async () => {
  const { useRoomWallMotion } = await import('../../../../frontend/src/hooks/useRoomWallMotion.web');
  let motion!: ReturnType<typeof useRoomWallMotion>;
  const focus = { current: null };
  function Probe() { motion = useRoomWallMotion(false, () => {}, focus); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  const update = vi.fn();
  await act(async () => motion.transition('opening', update));
  await act(async () => motion.transition('closing', update));
  expect(state.wallRun.mock.calls.map(call => call[0])).toEqual(['opening', 'closing']);
  expect(update).toHaveBeenCalledTimes(2);
});
it('uses the Room control when history is mounted directly without an opener', async () => {
  const { useRoomWallMotion } = await import('../../../../frontend/src/hooks/useRoomWallMotion.web');
  const control = document.createElement('button');
  document.body.append(control);
  const fallback = { current: control };
  function Probe({ open }: { open: boolean }) { useRoomWallMotion(open, () => {}, fallback); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe, { open: true })));
  await act(async () => root!.render(createElement(Probe, { open: false })));
  expect(document.activeElement).toBe(control);
  control.remove();
});
