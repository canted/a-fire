import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const mocks = vi.hoisted(() => ({ focus: undefined as (() => void) | undefined, save: vi.fn(), reader: false, platform: 'ios', native: {} as Record<string, (...args: any[]) => any>, handlers: {} as Record<string, (...args: any[]) => any> }));
vi.mock('../../../../frontend/node_modules/expo-router', () => ({ useFocusEffect: (callback: () => void) => { mocks.focus = callback; } }));
vi.mock('../../../../frontend/src/lib/messageSwipeSelection', async () => await import('../../../../frontend/src/lib/messageSwipeSelection.web'));
vi.mock('../../../../frontend/src/lib/contentInteraction', async () =>
  await import('../../../../frontend/src/lib/browserContentInteraction'));
vi.mock('../../../../frontend/node_modules/react-native-reanimated', () => ({ useSharedValue: (value: unknown) => ({ value }) }));
vi.mock('../../../../frontend/node_modules/react-native-worklets', () => ({ scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => callback(...args) }));
vi.mock('../../../../frontend/node_modules/react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: any) => children,
  Gesture: { Pan: () => {
    const gesture: Record<string, any> = { manualActivation: () => gesture };
    for (const name of ['onTouchesDown', 'onTouchesMove', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) gesture[name] = (callback: (...args: any[]) => any) => { mocks.native[name] = callback; return gesture; };
    return gesture;
  } },
}));
vi.mock('../../../../frontend/src/hooks/useRoomNavigation', () => ({ useRoomNavigation: () => ({ save: mocks.save, thread: vi.fn() }) }));
vi.mock('../../../../frontend/src/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../../frontend/src/hooks/useScreenReaderEnabled', () => ({ useScreenReaderEnabled: () => mocks.reader }));
vi.mock('../../../../frontend/node_modules/react-native', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const React = await import(path);
  const View = ({ ref, children, onTouchStart, onKeyDown, onFocus, onBlur, tabIndex, accessibilityLabel }: any) => React.createElement('div', { ref, onTouchStart, onKeyDown, onFocus, onBlur, tabIndex, 'aria-label': accessibilityLabel }, children);
  return { Platform: { get OS() { return mocks.platform; } }, StyleSheet: { create: (value: unknown) => value }, View,
    Easing: { out: () => undefined, exp: undefined },
    PanResponder: { create: (handlers: typeof mocks.handlers) => { mocks.handlers = handlers; return { panHandlers: {} }; } },
    Animated: { View, Value: class { setValue() {} stopAnimation() {} interpolate() { return 0; } }, timing: () => ({ start() {} }) } };
});
vi.mock('../../../../frontend/src/components/Button', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const React = await import(path);
  return { Button: ({ children, onPress, accessibilityLabel }: any) => React.createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children) };
});
// Keep pointer coordinates realistic: web measures travel from pageX, while native uses dx.
const pointerEvent = (pageX = 100) => ({ nativeEvent: { pageX }, preventDefault: vi.fn() });
const expo = '../../../../frontend';
const { act, createElement, useContext } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { MessageGestureBoundary, useMessageTextSelectable } = await import(`${expo}/src/hooks/useMessageGestureBoundary.ts`);
const { MessageActions } = await import(`${expo}/src/features/rooms/MessageActions.tsx`);
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); mocks.save.mockClear(); mocks.reader = false; mocks.platform = 'ios'; });
async function render(children: unknown = 'Rich message', actionProps: Record<string, unknown> = {}) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(MessageActions, { room: '7', message: { id: 12, kind: 'message', entry: { available: true }, content: { type: 'doc', content: [{ type: 'heading' }] } }, children, ...actionProps })));
  mocks.handlers.onStartShouldSetPanResponderCapture(pointerEvent());
  await act(async () => container.firstElementChild!.dispatchEvent(new Event('touchstart', { bubbles: true })));
}
it('lets rich messages acquire a rightward gesture but leaves vertical scrolling alone', async () => {
  await render();
  expect(container.querySelector('button')).toBeNull();
  expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: 15, dy: 40 })).toBe(false);
  expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: 40, dy: 2 })).toBe(true);
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderMove(pointerEvent(280), { dx: 180 }); mocks.handlers.onPanResponderRelease(); });
  expect(mocks.save).toHaveBeenCalledWith('7', 12);
});
it('cancels an interrupted swipe without opening Save', async () => {
  await render();
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderMove(pointerEvent(150), { dx: 50 }); mocks.handlers.onPanResponderTerminate(); });
  expect(mocks.save).not.toHaveBeenCalled();
  expect(container.querySelector('button')).toBeNull();
});
it('retains an explicit Save action when a native screen reader is active', async () => {
  mocks.reader = true;
  await render();
  const button = container.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Save message 12 to project');
  await act(async () => button.click());
  expect(mocks.save).toHaveBeenCalledWith('7', 12);
});

it('does not acquire a swipe when an interactive descendant protects its touch', async () => {
  let protect = () => {};
  function MediaControl() { protect = useContext(MessageGestureBoundary); return createElement('span', null, 'Media control'); }
  await render(createElement(MediaControl));
  mocks.handlers.onStartShouldSetPanResponderCapture(pointerEvent());
  protect();
  expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: 180, dy: 0 })).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('acquires prose gestures even when native Text does not bubble touch-start', async () => {
  await render();
  mocks.handlers.onStartShouldSetPanResponderCapture(pointerEvent());
  expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: 40, dy: 2 })).toBe(true);
});

it('closes a revealed action on a deliberate reverse drag without saving', async () => {
  await render();
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderMove(pointerEvent(180), { dx: 80 }); mocks.handlers.onPanResponderRelease(); });
  expect(container.querySelector('button')).not.toBeNull();
  expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: -100, dy: 0 })).toBe(true);
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderMove(pointerEvent(-50), { dx: -150 }); mocks.handlers.onPanResponderRelease(); });
  expect(container.querySelector('button')).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});

it('uses the final release displacement when move events were coalesced', async () => {
  await render();
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderRelease(pointerEvent(180), { dx: 80 }); });
  expect(container.querySelector('button')).not.toBeNull();
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderRelease(pointerEvent(-50), { dx: -150 }); });
  expect(container.querySelector('button')).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});

it('uses complete web pointer travel when grant resets dx and move events are coalesced', async () => {
  mocks.platform = 'web';
  await render();
  await act(async () => {
    mocks.handlers.onPanResponderGrant(pointerEvent(140));
    mocks.handlers.onPanResponderRelease(pointerEvent(350), { dx: 0 });
  });
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('7', 12);
});

it('retains native text selection inside and outside Chat', async () => {
  const values: boolean[] = [];
  function Prose() { values.push(useMessageTextSelectable()); return createElement('span', null, 'Message prose'); }
  await render(createElement(Prose));
  expect(values.at(-1)).toBe(true);
  await act(async () => root!.render(createElement(Prose)));
  expect(values.at(-1)).toBe(true);
});

it('activates early horizontal native movement but yields held and vertical touches', async () => {
  await render();
  const manager = { activate: vi.fn(), fail: vi.fn() };
  const event = (x: number, y: number) => ({ allTouches: [{ absoluteX: x, absoluteY: y }] });
  mocks.native.onTouchesDown(event(10, 10));
  mocks.native.onTouchesMove(event(50, 12), manager);
  expect(manager.activate).toHaveBeenCalledOnce();
  manager.activate.mockClear();
  mocks.native.onTouchesDown(event(10, 10));
  mocks.native.onTouchesMove(event(12, 50), manager);
  expect(manager.fail).toHaveBeenCalledOnce();
  const now = vi.spyOn(Date, 'now'); now.mockReturnValue(1000);
  mocks.native.onTouchesDown(event(10, 10));
  now.mockReturnValue(1500);
  mocks.native.onTouchesMove(event(60, 10), manager);
  expect(manager.activate).not.toHaveBeenCalled();
  now.mockRestore();
});
it('never commits a cancelled native gesture, even after crossing the save threshold', async () => {
  await render();
  await act(async () => { mocks.native.onStart(); mocks.native.onUpdate({ translationX: 250 }); mocks.native.onEnd({ translationX: 250 }, false); });
  expect(mocks.save).not.toHaveBeenCalled();
});

it('does not show Save merely from tapping or focusing a web message', async () => {
  mocks.platform = 'web';
  await render();
  const surface = container.firstElementChild as HTMLElement;
  await act(async () => { surface.focus(); surface.click(); });
  expect(container.querySelector('button')).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('reveals the same behind-message action by keyboard and dismisses it with Escape', async () => {
  mocks.platform = 'web';
  await render();
  const surface = container.firstElementChild as HTMLElement;
  await act(async () => surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Save revealed message 12 to project');
  await act(async () => surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector('button')).toBeNull();
});

it('routes reply swipe and accessible action to the source-specific callback without chat navigation', async () => {
  mocks.platform = 'web';
  const onSave = vi.fn();
  await render('Reply', { onSave, saveLabel: 'Save reply to source entry' });
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderRelease(pointerEvent(350), { dx: 250 }); });
  expect(onSave).toHaveBeenCalledOnce();
  expect(mocks.save).not.toHaveBeenCalled();
  const surface = container.firstElementChild as HTMLElement;
  await act(async () => surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  const button = container.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Save reply to source entry');
  await act(async () => button.click());
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('does not duplicate a reply save gesture while its mutation is pending', async () => {
  const onSave = vi.fn();
  await render('Reply', { onSave, saveDisabled: true });
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderRelease(pointerEvent(350), { dx: 250 }); });
  expect(onSave).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it.each(['slider', 'button', 'link'])('web swipes yield to nested %s controls', async role => {
  mocks.platform = 'web';
  await render(createElement('div', { role }, createElement('span', null, 'Interactive target')));
  mocks.handlers.onStartShouldSetPanResponderCapture(pointerEvent());
  const target = container.querySelector(`[role="${role}"] span`)!;
  await act(async () => target.dispatchEvent(new Event('touchstart', { bubbles: true })));
  expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: 180, dy: 0 })).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('does not erase protection from a child when its touch bubbles through the web surface', async () => {
  mocks.platform = 'web';
  function MediaControl() {
    const protect = useContext(MessageGestureBoundary);
    return createElement('span', { onTouchStart: protect }, 'Protected media');
  }
  await render(createElement(MediaControl));
  mocks.handlers.onStartShouldSetPanResponderCapture(pointerEvent());
  await act(async () => container.querySelector('span')!.dispatchEvent(new Event('touchstart', { bubbles: true })));
  expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: 180, dy: 0 })).toBe(false);
});
it('leaves an existing web text selection with the browser instead of revealing Save', async () => {
  mocks.platform = 'web';
  await render(createElement('span', null, 'Selected feedback text'));
  const range = document.createRange();
  range.selectNodeContents(container.querySelector('span')!);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  expect(selection.toString()).toBe("Selected feedback text");
  mocks.handlers.onStartShouldSetPanResponderCapture(pointerEvent());
  try {
    expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: 180, dy: 0 })).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  } finally { selection.removeAllRanges(); }
});
it('claims a new rightward drag even when the browser has begun selecting its text', async () => {
  mocks.platform = 'web';
  await render(createElement('span', null, 'New drag selection'));
  mocks.handlers.onStartShouldSetPanResponderCapture(pointerEvent());
  const range = document.createRange(); range.selectNodeContents(container.querySelector('span')!);
  window.getSelection()!.addRange(range);
  expect(mocks.handlers.onMoveShouldSetPanResponderCapture({}, { dx: 40, dy: 0 })).toBe(true);
  await act(async () => mocks.handlers.onPanResponderGrant(pointerEvent()));
  expect(window.getSelection()!.toString()).toBe('');
});
it('consumes Escape for a revealed action before the enclosing drawer sees it', async () => {
  mocks.platform = 'web'; await render();
  const surface = container.firstElementChild as HTMLElement;
  const outer = vi.fn(); window.addEventListener('keydown', outer);
  try {
    await act(async () => surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await act(async () => surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(outer).not.toHaveBeenCalled();
    await act(async () => surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(outer).toHaveBeenCalledOnce();
  } finally { window.removeEventListener('keydown', outer); }
});
it('restores focus to the source message when the Save route closes', async () => {
  mocks.platform = 'web'; await render();
  await act(async () => { mocks.handlers.onPanResponderGrant(pointerEvent()); mocks.handlers.onPanResponderRelease(pointerEvent(350), { dx: 250 }); });
  await act(async () => { mocks.focus?.(); await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(document.activeElement).toBe(container.firstElementChild);
});
it('keeps a claimed web swipe through delayed selectionchange but yields to scrolling', async () => {
  mocks.platform = 'web'; await render('Swipe text');
  await act(async () => mocks.handlers.onPanResponderGrant(pointerEvent()));
  expect(mocks.handlers.onPanResponderTerminationRequest({ nativeEvent: { type: 'selectionchange' } })).toBe(false);
  expect(mocks.handlers.onPanResponderTerminationRequest({ nativeEvent: { type: 'scroll' } })).toBe(true);
});
