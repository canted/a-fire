import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
vi.mock('../../../../frontend/node_modules/react-native', async () => {
  const reactPath = '../../../../frontend/node_modules/react/index.js';
  const { createElement } = await import(reactPath) as typeof import('react');
  const View = ({ children }: { children?: import("react").ReactNode }) => createElement('div', null, children);
  return { View, Text: View, StyleSheet: { create: (styles: unknown) => styles }, Animated: { View, Value: class { interpolate() { return 0; } }, timing: () => ({ start() {}, stop() {} }) } };
});
vi.mock('../../../../frontend/src/components/Button', async () => {
  const reactPath = '../../../../frontend/node_modules/react/index.js';
  const { createElement } = await import(reactPath) as typeof import('react');
  return { Button: ({ children, onPress, accessibilityLabel, disabled }: any) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children) };
});
vi.mock('../../../../frontend/src/components/PopupMenu', async () => {
  const reactPath = '../../../../frontend/node_modules/react/index.js';
  const { createElement } = await import(reactPath) as typeof import('react');
  return { PopupMenu: ({ children, open }: any) => open ? createElement('section', null, children) : null };
});
vi.mock('../../../../frontend/src/features/content/AudioWaveform', () => ({ AudioWaveform: () => null }));
vi.mock('../../../../frontend/src/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { RecordingDrawer } = await import(`${expo}/src/features/content/RecordingDrawer.tsx`);
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); });
it('opens idle, starts explicitly, and transfers stopped audio exactly once without confirmation', async () => {
  const host = document.createElement('div'); root = createRoot(host);
  let complete!: (success: boolean) => void;
  const recording = { start: vi.fn(), finish: vi.fn(), cancel: vi.fn(), useRecording: vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; })), recording: false, preparing: false, seconds: 0, peaks: [], review: undefined as { id: string; uri: string } | undefined };
  const onClose = vi.fn();
  const render = () => act(async () => root.render(createElement(RecordingDrawer, { recording, open: true, onClose })));
  await render();
  expect(host.textContent).toContain('0:00');
  expect(host.textContent).toContain('Start audio recording');
  expect(recording.start).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(recording.start).toHaveBeenCalledOnce();
  recording.recording = true; recording.seconds = 3; await render();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Stop recording and attach"]')!.click());
  expect(recording.finish).toHaveBeenCalledOnce();
  recording.recording = false; recording.review = { id: 'take-1', uri: 'blob:take-1' }; await render(); await render();
  expect(recording.useRecording).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(host.textContent).not.toMatch(/Use recording|Review recording|Record again/);
  await act(async () => complete(true));
  expect(onClose).toHaveBeenCalledOnce();
});
it('offers retry only after a failed transfer and does not retry on rerender', async () => {
  const host = document.createElement('div'); root = createRoot(host);
  const recording = { start: vi.fn(), finish: vi.fn(), cancel: vi.fn(), useRecording: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true), recording: false, preparing: false, seconds: 3, peaks: [], review: { id: 'failed-take', uri: 'blob:failed-take' } };
  const onClose = vi.fn();
  const render = () => act(async () => root.render(createElement(RecordingDrawer, { recording, open: true, onClose })));
  await render(); await render();
  expect(recording.useRecording).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Retry attachment');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry attachment')!.click());
  expect(recording.useRecording).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledOnce();
});

it('prepares on open without starting and releases preparation on close', async () => {
  const host = document.createElement('div'); root = createRoot(host);
  const recording = {
    prepare: vi.fn().mockResolvedValue(undefined), start: vi.fn(), finish: vi.fn(),
    cancel: vi.fn(), useRecording: vi.fn(), recording: false, preparing: true,
    preparationMessage: 'Opening microphone…', seconds: 0, peaks: [], review: undefined,
  };
  const onClose = vi.fn();
  await act(async () => root.render(createElement(RecordingDrawer, { recording, open: true, onClose })));
  expect(recording.prepare).toHaveBeenCalledOnce();
  expect(recording.start).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Opening microphone…');
  expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  await act(async () => root.render(createElement(RecordingDrawer, { recording, open: false, onClose })));
  expect(recording.cancel).toHaveBeenCalledOnce();
});
