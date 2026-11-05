import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../frontend/src/lib/api/transport';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: mocks }));
vi.mock('../../../../frontend/src/lib/cable', () => ({ cable: {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useRoomNotes, useEntryNoteSave } = await import(`${expo}/src/hooks/useNotes.ts`);
const { useEntryQuery } = await import(`${expo}/src/hooks/useEntryQuery.ts`);
let root: ReturnType<typeof createRoot>, container: HTMLDivElement, state: ReturnType<typeof useRoomNotes>;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.resetAllMocks(); });
async function mount() {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  function Subject() { state = useRoomNotes('7'); return null; }
  await act(async () => root.render(createElement(SWRConfig, { value: { provider: () => new Map(), shouldRetryOnError: false } }, createElement(Subject))));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
it.each([401,403,404])('classifies access response %s as unavailable and prevents mutations', async status => {
  mocks.get.mockRejectedValue(new ApiError('Unavailable', status));
  await mount();
  expect(state.denied).toBe(true);
  expect(state.allowed).toBe(false);
  await expect(state.create.trigger({})).rejects.toThrow('permission');
  expect(mocks.post).not.toHaveBeenCalled();
});
it('honours a denied tree response despite an earlier member snapshot', async () => {
  mocks.get.mockResolvedValueOnce({ id: 7, access: { kind: 'member', can_view_notes: true } }).mockRejectedValue(new ApiError('Unavailable',403));
  await mount();
  expect(state.denied).toBe(true);
  expect(state.allowed).toBe(false);
  await expect(state.remove.trigger(9)).rejects.toThrow('permission');
  expect(mocks.delete).not.toHaveBeenCalled();
});
it('keeps temporary connection errors distinct from access denial', async () => {
  mocks.get.mockRejectedValue(new Error('Offline'));
  await mount();
  expect(state.denied).toBe(false);
  expect(state.room.error).toBeDefined();
});

async function mountEntry(observeSource = false) {
  let entryState: ReturnType<typeof useEntryNoteSave>;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  function Subject() { useEntryQuery(observeSource ? '42' : undefined); entryState = useEntryNoteSave({ id: 42, room_id: 7, status: 'published' } as Parameters<typeof useEntryNoteSave>[0]); return null; }
  await act(async () => root.render(createElement(SWRConfig, { value: { provider: () => new Map(), shouldRetryOnError: false } }, createElement(Subject))));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
  return () => entryState!;
}
it('saves an authorized shared copy through the canonical reflection API', async () => {
  mocks.get.mockImplementation((path: string) => Promise.resolve(path === '/v2/rooms/7' ? { id: 7, access: { kind: 'member', can_view_notes: true } } : { pages: [] }));
  mocks.post.mockResolvedValue({ reflections: [] });
  const state = await mountEntry(true);
  const sourceReadsBefore = mocks.get.mock.calls.filter(([path]) => path === "/v1/entries/42").length;
  expect(sourceReadsBefore).toBe(1);
  expect(state().available).toBe(true);
  await act(async () => { await state().save.trigger(9); });
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/v1/entries/42/reflections', { page_id: 9 });
  expect(mocks.get.mock.calls.filter(([path]) => path === '/v1/entries/42')).toHaveLength(sourceReadsBefore + 1);
});
it('never offers or writes a Note reflection for a visitor', async () => {
  mocks.get.mockResolvedValue({ id: 7, access: { kind: 'visitor', can_view_notes: false } });
  const state = await mountEntry();
  expect(state().available).toBe(false);
  await expect(state().save.trigger(9)).rejects.toThrow('permission');
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.get).toHaveBeenCalledTimes(1);
});
