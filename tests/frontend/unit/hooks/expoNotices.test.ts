import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: mocks }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useNotices } = await import(`${expo}/src/hooks/useNotices.ts`);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let state: ReturnType<typeof useNotices>;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.resetAllMocks(); });
async function mount() {
  function Subject() { state = useNotices(); void state.items; return null; }
  mocks.get.mockResolvedValue({ items: [{ id: '1', contentSeen: false, notificationEvent: { eventType: 'chat_message_created', actorUsername: 'Peer', createdAt: '2026-10-23T12:00:00Z', payload: {} } }], nextCursor: null, highlightAfter: '2026-10-23T12:00:00Z', visitSeenThroughAt: '2026-10-23T12:00:00Z' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false } }, createElement(Subject))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
it('does not acknowledge Chat from fetching or opening its notice', async () => {
  await mount();
  expect(state!.items).toHaveLength(1);
  await act(async () => { await state!.mark(state!.items[0]); });
  expect(mocks.post).not.toHaveBeenCalled();
});
it('acknowledges all bundled notice IDs for an opened non-Chat notice', async () => {
  await mount(); mocks.post.mockResolvedValue(undefined);
  await act(async () => { await state!.mark({ ...state!.items[0], type: 'reply', bundledNoticeIds: ['1', '2'] }); });
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/v1/notices/seen', { noticeIds: [1, 2] });
});
it('does not report a successful read state when the mutation fails', async () => {
  await mount(); mocks.post.mockRejectedValue(new Error('Offline'));
  await act(async () => { await expect(state!.mark('all')).rejects.toThrow('Offline'); });
  expect(state!.items[0].contentSeen).toBe(false);
});
