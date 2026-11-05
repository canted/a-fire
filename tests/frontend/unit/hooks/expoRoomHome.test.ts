import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), room: { data: { id: 7 }, error: undefined as unknown } }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: { get: mocks.get } }));
vi.mock('../../../../frontend/src/hooks/useRounds', () => ({ useRoomRounds: () => ({ room: mocks.room, rounds: {} }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useRoomHome } = await import(`${expo}/src/hooks/useRoomHome.ts`);
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); vi.clearAllMocks(); mocks.room.error = undefined; });
it.each(['available', 'disabled', 'denied'])('uses Room identity with no memberBoard when %s', async mode => {
  mocks.get.mockResolvedValue({ roomId: '7', members: [] });
  if (mode === 'denied') mocks.room.error = new Error('Forbidden');
  let state: ReturnType<typeof useRoomHome>;
  function Subject() { state = useRoomHome('7', mode !== 'disabled'); void state.home.data; return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => { root.render(createElement(SWRConfig, { value: { provider: () => new Map(), shouldRetryOnError: false } }, createElement(Subject))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  if (mode === 'available') {
    expect(mocks.get).toHaveBeenCalledWith('/v1/rooms/7/home');
    expect(state!.home.data?.members).toEqual([]);
  } else expect(mocks.get).not.toHaveBeenCalled();
});
