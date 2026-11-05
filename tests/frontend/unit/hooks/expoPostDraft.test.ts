import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: mocks }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useEntryDraft } = await import(`${expo}/src/hooks/useEntryDraft.ts`);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.resetAllMocks(); });
async function mount(Subject: () => null) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false } }, createElement(Subject))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
const draft = { id: 42, square_id: 9, content: { type: 'doc', content: [] }, subject: { kind: 'project' }, link_preview: { url: 'https://example.com' }, format_data: { title: 'Original', source: 'retained' } };
it('revalidates an existing draft without allocating another draft', async () => {
  mocks.post.mockResolvedValue(draft); mocks.get.mockResolvedValue(draft);
  let state: ReturnType<typeof useEntryDraft>;
  function Subject() { state = useEntryDraft({ existing: '42' }); void state.draft.data; return null; }
  await mount(Subject);
  await act(async () => { await state!.draft.mutate(); });
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.get).toHaveBeenCalledWith('/v1/entries/42/draft');
});
it('retains source metadata when saving title and content', async () => {
  mocks.get.mockResolvedValue(draft); mocks.put.mockResolvedValue(draft);
  let state: ReturnType<typeof useEntryDraft>;
  function Subject() { state = useEntryDraft({ existing: '42' }); void state.draft.data; return null; }
  await mount(Subject);
  await act(async () => { await state!.save.trigger({ content: draft.content, title: 'Updated', expectedRevision: 100 }); });
  expect(mocks.put).toHaveBeenCalledWith('/v1/entries/42/content', expect.objectContaining({ expected_revision: 100, subject: draft.subject, link_preview: draft.link_preview, format_data: { title: 'Updated', source: 'retained' } }));
});
it('deduplicates publication and does not publish when persistence fails', async () => {
  mocks.get.mockResolvedValue(draft); mocks.post.mockResolvedValue(draft);
  let state: ReturnType<typeof useEntryDraft>;
  function Subject() { state = useEntryDraft({ existing: '42' }); void state.draft.data; return null; }
  await mount(Subject);
  await act(async () => { await expect(state!.submit(async () => { throw new Error('Save failed'); })).rejects.toThrow('Save failed'); });
  expect(mocks.post).not.toHaveBeenCalled();
  const persist = vi.fn().mockResolvedValue(undefined);
  await act(async () => { const first = state!.submit(persist); expect(state!.submit(persist)).toBe(first); await first; });
  expect(persist).toHaveBeenCalledTimes(1);
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/v1/entries/42/publish');
});

it('uses the editor revision after the shared cache receives a newer draft', async () => {
  mocks.get.mockResolvedValue({ ...draft, revision: 100 });
  mocks.put.mockRejectedValue(new Error('This Entry changed elsewhere'));
  let state: ReturnType<typeof useEntryDraft>;
  function Subject() { state = useEntryDraft({ existing: '42' }); void state.draft.data; return null; }
  await mount(Subject);
  await act(async () => { await state!.draft.mutate({ ...state!.draft.data!, revision: 200 }, { revalidate: false }); });
  await act(async () => { await expect(state!.save.trigger({ content: draft.content, title: 'My edit', expectedRevision: 100 })).rejects.toThrow('changed elsewhere'); });
  expect(mocks.put).toHaveBeenCalledWith('/v1/entries/42/content', expect.objectContaining({ expected_revision: 100 }));
  expect(state!.draft.data!.revision).toBe(200);
});

it('does not allocate a draft from a retired Square destination', async () => {
  function Subject() { useEntryDraft({ square: '9' }); return null; }
  await mount(Subject);
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled();
});
