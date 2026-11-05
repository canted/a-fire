import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../../../../frontend/src/lib/api', () => ({ apiBaseUrl: 'https://example.test/api', client: { get: state.get } }));
const { fetchMediaAsset } = await import('../../../../frontend/src/hooks/useMediaSource');
afterEach(() => vi.clearAllMocks());
it('starts peaks and spectrum together and publishes them as one presentation', async () => {
  let resolveSpectrum!: (value: unknown) => void;
  const spectrum = new Promise(resolve => { resolveSpectrum = resolve; });
  state.get.mockImplementation((url: string) => url.endsWith('/spectrum') ? spectrum : Promise.resolve({ id: 12, waveform_peaks: [.2, .8], processing_status: 'ready' }));
  let presented = false;
  const request = fetchMediaAsset('audio', '12').then(value => { presented = true; return value; });
  expect(state.get.mock.calls.map(call => call[0])).toEqual(['/v1/audio-assets/12', '/v1/audio-assets/12/spectrum']);
  await Promise.resolve();
  expect(presented).toBe(false);
  const ready = { status: 'ready', bands: [[.2, .3, .5]] };
  resolveSpectrum(ready);
  expect(await request).toMatchObject({ waveform_peaks: [.2, .8], spectrum: ready });
});
it('allows real peaks while spectral processing is pending', async () => {
  state.get.mockImplementation((url: string) => Promise.resolve(url.endsWith('/spectrum') ? { status: 'pending' } : { id: 12, waveform_peaks: [.5], processing_status: 'ready' }));
  expect(await fetchMediaAsset('audio', '12')).toMatchObject({ waveform_peaks: [.5], spectrum: { status: 'pending' } });
});
it('does not lose playable audio if optional spectrum fails, or request spectra for videos', async () => {
  state.get.mockImplementation((url: string) => url.endsWith('/spectrum') ? Promise.reject(new Error('offline')) : Promise.resolve({ id: 12, processing_status: 'ready' }));
  expect(await fetchMediaAsset('audio', '12')).toMatchObject({ id: 12 });
  state.get.mockClear();
  await fetchMediaAsset('video', '12');
  expect(state.get).toHaveBeenCalledTimes(1);
});
