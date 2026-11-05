import { afterEach, expect, it, vi } from 'vitest';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { useAudioSeekControl } = await import(`${expo}/src/hooks/useAudioSeekControl.ts`);
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); });
it('uses the same keyboard and measured-pointer seek contract in both audio presentations', async () => {
  const seek = vi.fn(); let control: ReturnType<typeof useAudioSeekControl>;
  function Probe() { control = useAudioSeekControl({ position: 20, duration: 100, seek }); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => { root.render(createElement(Probe)); });
  const preventDefault = vi.fn();
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) control!.onKeyDown({ nativeEvent: { key }, preventDefault });
  expect(seek.mock.calls.map(call => call[0])).toEqual([15, 25, 0, 100]);
  expect(preventDefault).toHaveBeenCalledTimes(4);
  control!.ref.current = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(20, 0, 200, 40) } as never;
  control!.onPress({ nativeEvent: { pageX: 120 } } as never);
  expect(seek).toHaveBeenLastCalledWith(50);
  expect(control!.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 20 });
});
