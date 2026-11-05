import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
vi.mock('../../../../frontend/node_modules/react-native', async () => {
  const path = '../../../../frontend/node_modules/react/index.js'; const React = await import(path);
  return { StyleSheet: { create: (value: unknown) => value }, View: ({ children, nativeID }: { children: unknown; nativeID?: string }) => React.createElement('section', { id: nativeID }, children) };
});
const expo = '../../../../frontend';
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { ViewportToolbarProvider, ViewportToolbar, ViewportToolbarHost } = await import(`${expo}/src/components/ViewportToolbar.tsx`);
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); });
it('docks the mounted editor controls outside content, updates them, and removes them on exit', async () => {
  const container = document.createElement('div'); root = createRoot(container);
  function Screen({ label }: { label?: string }) { return h(ViewportToolbarProvider, null, h('main', null, 'Document', label && h(ViewportToolbar, null, h('button', null, label))), h('footer', null, h(ViewportToolbarHost))); }
  await act(async () => root.render(h(Screen, { label: 'Bold' })));
  expect(container.querySelector('main button')).toBeNull();
  expect(container.querySelector('footer button')?.textContent).toBe('Bold');
  const original = container.querySelector('footer button');
  await act(async () => root.render(h(Screen, { label: 'Bold selected' })));
  expect(container.querySelector('footer button')).toBe(original);
  expect(container.querySelector('footer button')?.textContent).toBe('Bold selected');
  await act(async () => root.render(h(Screen, {})));
  expect(container.querySelector('footer button')).toBeNull();
});

it('registers a floating action in the existing viewport host and clears its marker on exit', async () => {
  const container = document.createElement('div'); root = createRoot(container);
  function Screen({ floating }: { floating: boolean }) { return h(ViewportToolbarProvider, null, h('main', null, h(ViewportToolbar, { floating }, h('button', null, 'Add'))), h('footer', null, h(ViewportToolbarHost))); }
  await act(async () => root.render(h(Screen, { floating: true })));
  expect(container.querySelector('main button')).toBeNull();
  expect(container.querySelector('footer #floating-viewport-toolbar button')?.textContent).toBe('Add');
  await act(async () => root.render(h(Screen, { floating: false })));
  expect(container.querySelector('#floating-viewport-toolbar')).toBeNull();
  expect(container.querySelector('footer button')?.textContent).toBe('Add');
});
