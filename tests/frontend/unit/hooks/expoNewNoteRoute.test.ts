import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: mocks }));
vi.mock('../../../../frontend/src/lib/cable', () => ({ cable: {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = '../../../../frontend';
const { act, createElement, StrictMode } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useNewNoteRoute } = await import(`${expo}/src/hooks/useNotes.ts`);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let state: ReturnType<typeof useNewNoteRoute>;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.resetAllMocks(); });
async function mount(member = true) {
  mocks.get.mockImplementation(async (url: string) => url.includes('/rooms/') && !url.includes('/pages') ? { id: 7, access: { kind: member ? 'member' : 'visitor', can_view_notes: member } } : { pages: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  function Subject() { state = useNewNoteRoute('7'); return null; }
  await act(async () => root.render(createElement(StrictMode, null, createElement(SWRConfig, { value: { provider: () => new Map(), shouldRetryOnError: false } }, createElement(Subject)))));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
it('allocates once through effect replay and access refresh', async () => {
  mocks.post.mockResolvedValue({ id: 91 });
  await mount();
  await act(async () => { await state.room.mutate(); });
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(state.id).toBe(91);
});
it('does not create a Note for a visitor', async () => {
  await mount(false);
  expect(state.allowed).toBe(false);
  expect(mocks.post).not.toHaveBeenCalled();
});
it('retains an error until explicit retry rather than creating on each revalidation', async () => {
  mocks.post.mockRejectedValueOnce(new Error('Could not save')).mockResolvedValue({ id: 92 });
  await mount();
  expect(state.error).toBe('Could not save');
  await act(async () => { await state.room.mutate(); });
  expect(mocks.post).toHaveBeenCalledTimes(1);
  await act(async () => state.retry());
  expect(state.id).toBe(92);
  expect(mocks.post).toHaveBeenCalledTimes(2);
});
