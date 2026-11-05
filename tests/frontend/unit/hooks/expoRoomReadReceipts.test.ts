import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const state = vi.hoisted(() => ({ post: vi.fn(), mutate: vi.fn(), fetcher: undefined as any, trigger: vi.fn((arg: number[]) => state.fetcher(null, { arg })) }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: { post: state.post } }));
vi.mock('../../../../frontend/node_modules/swr', () => ({ useSWRConfig: () => ({ mutate: state.mutate }) }));
vi.mock('../../../../frontend/node_modules/swr/mutation', () => ({ default: (_key: unknown, fetcher: unknown) => { state.fetcher = fetcher; return { trigger: state.trigger }; } }));
const expo = '../../../../frontend';
const { act, createElement: h } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useRoomReadReceipts } = await import(`${expo}/src/hooks/useRoomReadReceipts.ts`);
let root: Root | undefined;
let seen: (id: number) => void;
function Probe() { seen = useRoomReadReceipts('7'); return null; }
beforeEach(() => { vi.useFakeTimers(); state.post.mockReset(); state.mutate.mockReset(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.useRealTimers(); });
async function mount() { root = createRoot(document.createElement('div')); await act(async () => root!.render(h(Probe))); }
it('invalidates visible-session notice queries after persisting a genuine exposure batch', async () => {
  state.post.mockResolvedValue({}); await mount();
  await act(async () => { seen(42); await vi.advanceTimersByTimeAsync(150); });
  expect(state.post).toHaveBeenCalledExactlyOnceWith('/v2/rooms/7/chat/messages/seen', { messageIds: [42] });
  expect(state.mutate).toHaveBeenCalledOnce();
  const accepts = state.mutate.mock.calls[0][0];
  expect(accepts(['home'])).toBe(true); expect(accepts(['unseen'])).toBe(true); expect(accepts(['inbox'])).toBe(true);
  expect(accepts(['room', '7'])).toBe(false);
});
it('finishes the final receipt without touching a disposed SWR provider after leaving', async () => {
  let finish!: () => void;
  state.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await mount();
  await act(async () => { seen(42); });
  await act(async () => root!.unmount()); root = undefined;
  expect(state.post).toHaveBeenCalledExactlyOnceWith('/v2/rooms/7/chat/messages/seen', { messageIds: [42] });
  await act(async () => { finish(); await Promise.resolve(); });
  expect(state.mutate).not.toHaveBeenCalled();
});
