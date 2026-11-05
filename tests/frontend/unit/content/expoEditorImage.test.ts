import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const state = vi.hoisted(() => ({ blob: vi.fn(), scope: {}, epoch: 0 }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../../../frontend/node_modules/expo-router', async () => { const path = '../../../../frontend/node_modules/react/index.js'; const { useEffect } = await import(path); return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) }; });
vi.mock('../../../../frontend/src/lib/api', () => ({ apiBaseUrl: 'https://localhost:8443/api', client: { getBlob: state.blob } }));
vi.mock('../../../../frontend/src/hooks/useSession', () => ({ useSession: () => ({ draftScope: state.scope, epoch: state.epoch }) }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useEditorImage } = await import(`${expo}/src/hooks/useEditorImage.ts`);
let root: Root;
let images: ReturnType<typeof useEditorImage>;
function Probe() { images = useEditorImage(); return null; }
async function mount() { root = createRoot(document.createElement('div')); await act(async () => root.render(createElement(Probe))); }
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); });
it('never routes external images through the credentialed API transport', async () => {
  await mount(); let uri: string | undefined;
  await act(async () => { uri = await images.load({ type: 'image', attrs: { src: 'https://example.test/photo.png' } }); });
  expect(uri).toBe('https://example.test/photo.png'); expect(state.blob).not.toHaveBeenCalled();
});
it('projects private image bytes without credentials and reauthorizes subsequent requests', async () => {
  state.blob.mockResolvedValue(new Blob(['synthetic'], { type: 'image/png' }));
  await mount(); const node = { type: 'image', attrs: { src: '/api/v1/uploads/7' } };
  let uri: string | undefined;
  await act(async () => { uri = await images.load(node); await images.load(node); });
  expect(uri).toMatch(/^data:image\/png;base64,/); expect(state.blob).toHaveBeenCalledTimes(2);
});
it('rejects a delayed image after its session ends', async () => {
  let resolve!: (blob: Blob) => void;
  state.blob.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(); let pending!: Promise<string>;
  await act(async () => { pending = images.load({ type: 'image', attrs: { src: '/api/v1/uploads/7' } }); });
  const rejected = expect(pending).rejects.toThrow('session ended');
  state.scope = {}; state.epoch++;
  await act(async () => root.render(createElement(Probe)));
  await act(async () => { resolve(new Blob(['synthetic'], { type: 'image/png' })); await rejected; });
});
