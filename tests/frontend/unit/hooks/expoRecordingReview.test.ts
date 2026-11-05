import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const state = vi.hoisted(() => ({ release: vi.fn(), recorder: { isRecording: false, uri: 'file:///cache/recording.m4a', stop: vi.fn(async () => {}), prepareToRecordAsync: vi.fn(async () => {}), record: vi.fn() } }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../../../frontend/node_modules/expo-router', () => ({ useFocusEffect: () => {} }));
vi.mock('../../../../frontend/node_modules/expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: async () => ({ granted: true }), setAudioModeAsync: async () => {}, useAudioRecorder: () => state.recorder, useAudioRecorderState: () => ({ isRecording: false, durationMillis: 2000 }) }));
vi.mock('../../../../frontend/node_modules/expo-file-system', () => ({ File: class { size = 32; constructor(public uri: string) {} } }));
vi.mock('../../../../frontend/src/hooks/useMediaPlayback', () => ({ usePauseMediaPlayback: () => () => {} }));
vi.mock('../../../../frontend/src/lib/chatFiles', () => ({ releaseChatFile: state.release }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useChatRecording } = await import(`${expo}/src/hooks/useChatRecording.ts`);
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); });
it('retains stopped audio for review, transfers it only on Use, and does not delete the transferred attachment', async () => {
  const attach = vi.fn(async () => {}); let recording!: ReturnType<typeof useChatRecording>;
  function Probe() { recording = useChatRecording(attach, vi.fn()); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  await act(async () => recording.finish());
  expect(attach).not.toHaveBeenCalled(); expect(recording.review?.uri).toBe(state.recorder.uri);
  await act(async () => recording.useRecording());
  expect(attach).toHaveBeenCalledOnce(); expect(recording.review).toBeUndefined();
  await act(async () => recording.cancel());
  expect(state.release).not.toHaveBeenCalledWith(expect.objectContaining({ uri: state.recorder.uri }));
});
it('discards reviewed audio without attaching it', async () => {
  const attach = vi.fn(async () => {}); let recording!: ReturnType<typeof useChatRecording>;
  function Probe() { recording = useChatRecording(attach, vi.fn()); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  await act(async () => recording.finish());
  await act(async () => recording.cancel());
  expect(attach).not.toHaveBeenCalled(); expect(recording.review).toBeUndefined();
  expect(state.release).toHaveBeenCalledWith(expect.objectContaining({ uri: state.recorder.uri }));
});
it('keeps reviewed audio after rejected transfer and protects bytes during pending transfer cleanup', async () => {
  let complete!: () => void;
  const attach = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('Try again')).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  let recording!: ReturnType<typeof useChatRecording>;
  function Probe() { recording = useChatRecording(attach, vi.fn()); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  await act(async () => recording.finish());
  await act(async () => recording.useRecording());
  expect(recording.review?.uri).toBe(state.recorder.uri);
  expect(state.release).not.toHaveBeenCalledWith(expect.objectContaining({ uri: state.recorder.uri }));
  let transfer!: Promise<void>;
  await act(async () => { transfer = recording.useRecording(); });
  await act(async () => recording.cancel());
  await act(async () => { complete(); await transfer; });
  expect(state.release).not.toHaveBeenCalledWith(expect.objectContaining({ uri: state.recorder.uri }));
});
