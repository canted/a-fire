import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const state = vi.hoisted(() => ({
  player: { pause: vi.fn(), play: vi.fn(), seekTo: vi.fn(async () => {}) },
  status: { isLoaded: true, error: null, duration: 8, currentTime: 3, playing: false, didJustFinish: false },
  get: vi.fn(async () => ({ id: '12', title: 'Study', processing_status: 'ready', playback_url: '/api/v1/audio-assets/12/playback', source_type: 'Note', source_id: '10' })),
}));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, AppState: { addEventListener: () => ({ remove() {} }) } }));
// Native Expo keeps the player when source JSON is unchanged. This intentionally
// returns the same object for repeated authorizations of the same audio URL.
vi.mock('../../../../frontend/node_modules/expo-audio', () => ({ useAudioPlayer: () => state.player, useAudioPlayerStatus: () => state.status }));
vi.mock('../../../../frontend/src/lib/api', () => ({ apiBaseUrl: 'https://localhost:8443/api', client: { get: state.get, getAccessToken: async () => 'synthetic-token' } }));
vi.mock('../../../../frontend/src/hooks/useMediaPlayback', async () => { const { MediaPlaybackSession } = await import('../../../../frontend/src/lib/mediaPlayback'); let session = new MediaPlaybackSession(); return { usePlaybackSession: () => session, resetTestSession: () => { session = new MediaPlaybackSession(); } }; });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { AudioPlaybackProvider, useAudioPlayback } = await import(`${expo}/src/hooks/useAudioPlayback.tsx`);
let root: Root;
let playback: ReturnType<typeof useAudioPlayback>;
async function mount() { function Probe() { playback = useAudioPlayback(); return null; } root = createRoot(document.createElement('div')); await act(async () => root.render(createElement(AudioPlaybackProvider, null, createElement(Probe)))); }
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); });
it('reauthorizes and resumes the same native source without waiting for another loaded event', async () => {
  await mount();
  await act(async () => playback.play('12', { startAt: 2, audioNodeId: 'second-occurrence' }));
  expect(state.player.seekTo).toHaveBeenLastCalledWith(2); expect(state.player.play).toHaveBeenCalledOnce(); expect(playback.loading).toBe(false);
  expect(playback.track?.audioNodeId).toBe('second-occurrence');
  await act(async () => playback.pause());
  await act(async () => playback.play('12', { startAt: 5, audioNodeId: 'second-occurrence' }));
  expect(state.get).toHaveBeenCalledTimes(2); expect(state.player.seekTo).toHaveBeenLastCalledWith(5); expect(state.player.play).toHaveBeenCalledTimes(2); expect(playback.loading).toBe(false);
});
it('does not resurrect a closed player after a delayed authorization', async () => {
  await mount(); let resolve!: (value: Awaited<ReturnType<typeof state.get>>) => void;
  state.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending!: Promise<void>;
  await act(async () => { pending = playback.play('12'); });
  await act(async () => playback.close());
  await act(async () => { resolve({ id: '12', title: 'Study', processing_status: 'ready', playback_url: '/api/v1/audio-assets/12/playback', source_type: 'Note', source_id: '10' }); await pending; });
  expect(playback.track).toBeNull(); expect(playback.targetId).toBeUndefined(); expect(state.player.play).not.toHaveBeenCalled();
});

it('clears private playback when the authenticated playback session changes', async () => {
  await mount();
  await act(async () => playback.play('12'));
  expect(playback.track?.id).toBe('12');
  const adapter = await import(`${expo}/src/hooks/useMediaPlayback.ts`);
  adapter.resetTestSession();
  function Probe() { playback = useAudioPlayback(); return null; }
  await act(async () => root.render(createElement(AudioPlaybackProvider, null, createElement(Probe))));
  expect(playback.track).toBeNull();
  expect(playback.targetId).toBeUndefined();
  expect(state.player.pause).toHaveBeenCalled();
});

it('keeps Pause visible through authorization and transient paused reports, then resets on completion', async () => {
  await mount();
  let resolve!: (value: Awaited<ReturnType<typeof state.get>>) => void;
  state.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending!: Promise<void>;
  await act(async () => { pending = playback.play('12'); });
  expect(playback.playing).toBe(true);
  await act(async () => { resolve({ id: '12', title: 'Study', processing_status: 'ready', playback_url: '/api/v1/audio-assets/12/playback', source_type: 'Note', source_id: '10' }); await pending; });
  expect(playback.playing).toBe(true);
  function Probe() { playback = useAudioPlayback(); return null; }
  const update = async (playing: boolean, didJustFinish = false) => {
    Object.assign(state.status, { playing, didJustFinish });
    await act(async () => root.render(createElement(AudioPlaybackProvider, null, createElement(Probe))));
  };
  await update(true);
  await update(false);
  expect(playback.playing).toBe(true);
  await update(true);
  await update(false, true);
  expect(playback.playing).toBe(false);
  // A stale completion from the last play must not cancel the next request.
  await act(async () => playback.play('12'));
  expect(playback.playing).toBe(true);
  await act(async () => playback.pause());
  expect(playback.playing).toBe(false);
  Object.assign(state.status, { playing: false, didJustFinish: false });
});
