import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const layout = vi.hoisted(() => ({ handler: undefined as undefined | ((event: { nativeEvent: { layout: { width: number } } }) => void) }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({
  Platform: { OS: 'web' },
  View: ({ onLayout, children, style }: { onLayout: typeof layout.handler; children: React.ReactNode; style: React.CSSProperties }) => {
    layout.handler = onLayout;
    return createElement('div', { style }, children);
  },
}));
vi.mock('../../../../frontend/node_modules/react-native-svg', () => ({ default: 'svg', Defs: 'defs', LinearGradient: 'linearGradient', Stop: 'stop', Line: 'line', Polygon: 'polygon' }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { AudioWaveform } = await import(`${expo}/src/features/content/AudioWaveform.tsx`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; });
it('shows no partial saved contour, then displays spectral amplitude and color together', async () => {
  const container = document.createElement('div');
  root = createRoot(container);
  const peaks = Array(96).fill(1);
  await act(async () => root!.render(createElement(AudioWaveform, { peaks, progress: 0 })));
  expect(container.querySelector('polygon')!.getAttribute('points')).toBe('0,50 1000,50 1000,50 0,50');
  await act(async () => root!.render(createElement(AudioWaveform, { peaks, progress: 0, spectrum: { version: 3, status: 'ready', peaks: [0, 1, 0], bands: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } })));
  expect(container.querySelector('polygon')!.getAttribute('points')).toBe('0,50 166.66666666666666,50 500,4 833.3333333333334,50 1000,50 1000,50 833.3333333333334,50 500,96 166.66666666666666,50 0,50');
  expect(container.querySelectorAll('stop')).toHaveLength(3);
  expect(container.querySelector('polygon')!.getAttribute('stroke-width')).toBe('0.264');
  expect(container.querySelectorAll('line')).toHaveLength(1);
  expect(container.querySelector('svg')!.style.backgroundColor).toBe('');
});
it('renders amplitude alone only when explicitly used as a temporary recording preview', async () => {
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(createElement(AudioWaveform, { peaks: Array(160).fill(0.5), progress: 1, recordingPreview: true })));
  expect(container.querySelector('polygon')!.getAttribute('points')).toContain('0,27');
  expect(container.querySelector('polygon')!.getAttribute('fill')).not.toContain('url(');
  expect(container.querySelector('polygon')!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  expect(container.querySelector('line')!.getAttribute('x2')).toBe('1000');
  await act(async () => root!.render(createElement(AudioWaveform, { peaks: Array(160).fill(0.5), progress: 0 })));
  expect(container.querySelector('polygon')!.getAttribute('points')).toBe('0,50 1000,50 1000,50 0,50');
});

it('measures the surrounding view and only draws an explicitly requested playhead', async () => {
  const container = document.createElement('div');
  root = createRoot(container);
  const error = vi.spyOn(console, 'error');
  try {
    await act(async () => root!.render(createElement(AudioWaveform, { height: 46 })));
    expect(container.querySelectorAll('line')).toHaveLength(0);
    expect(container.firstElementChild!.getAttribute('style')).toContain('height: 46px');
    expect(layout.handler).toBeTypeOf('function');
    await act(async () => layout.handler!({ nativeEvent: { layout: { width: 320 } } }));
    expect(error.mock.calls.flat().join(' ')).not.toContain('onLayout');
    await act(async () => root!.render(createElement(AudioWaveform, { progress: 0.25 })));
    expect(container.querySelector('line')!.getAttribute('x1')).toBe('250');
    await act(async () => root!.render(createElement(AudioWaveform, { progress: 0 })));
    expect(container.querySelector('line')!.getAttribute('x1')).toBe('0');
  } finally {
    error.mockRestore();
  }
});
