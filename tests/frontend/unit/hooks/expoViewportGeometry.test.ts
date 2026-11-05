import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const expo = '../../../../frontend';
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useViewportGeometry } = await import(`${expo}/src/hooks/useViewportGeometry.web.ts`);
let root: Root;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('keeps shell and portal geometry aligned through keyboard resize, pan, rotation and recovery', async () => {
  vi.useFakeTimers();
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, pageTop: 0, scale: 1 });
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
  vi.stubGlobal('visualViewport', viewport);
  function Surface({ name }: { name: string }) {
    const value = useViewportGeometry();
    return h('output', { 'data-surface': name }, JSON.stringify(value));
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(h('main', null, h('textarea'), h(Surface, { name: 'shell' }), h(Surface, { name: 'portal' }))));
  container.querySelector('textarea')!.focus();
  await act(async () => { viewport.height = 410; viewport.offsetTop = 24; viewport.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(300); });
  const states = () => [...container.querySelectorAll('output')].map(e => JSON.parse(e.textContent!));
  expect(states()).toEqual([expect.objectContaining({ height: 410, offsetTop: 24, keyboardOpen: true }), expect.objectContaining({ height: 410, offsetTop: 24, keyboardOpen: true })]);
  await act(async () => { viewport.height = 300; viewport.offsetTop = 0; window.dispatchEvent(new Event('orientationchange')); vi.advanceTimersByTime(300); });
  expect(states()[0]).toEqual(states()[1]); expect(states()[0].height).toBe(300);
  container.querySelector('textarea')!.blur();
  await act(async () => { window.dispatchEvent(new Event('pageshow')); vi.advanceTimersByTime(1200); });
  expect(states()[0]).toMatchObject({ height: 844, offsetTop: 0, keyboardOpen: false });
  expect(states()[0]).toEqual(states()[1]);
  vi.unstubAllGlobals();
});
