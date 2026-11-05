import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: mocks }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useProjectEntry, useProjectInvitation, useProject, useProjects } = await import(`${expo}/src/hooks/useProjects.ts`);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.resetAllMocks(); });
async function mount(Subject: () => null) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false } }, createElement(Subject))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
it('pages Project choices and refreshes every loaded page after invitation changes', async () => {
  let removed = false;
  mocks.get.mockImplementation(async (path: string) => path.includes('cursor=after')
    ? { projects: removed ? [] : [{ id: 2, name: 'Second' }], nextCursor: null }
    : { projects: [{ id: 1, name: 'First' }], nextCursor: 'after' });
  mocks.post.mockResolvedValue({ id: 2, viewer_participation: 'declined' });
  let list: ReturnType<typeof useProjects>, invitation: ReturnType<typeof useProjectInvitation>;
  function Subject() { list = useProjects(); invitation = useProjectInvitation('2'); void list.data; void list.error; return null; }
  await mount(Subject);
  expect(mocks.get).toHaveBeenCalledWith('/v1/projects?cursor=');
  await act(async () => { await list!.loadMore(); });
  expect(list!.data?.projects.map((item: { id: number }) => item.id)).toEqual([1, 2]);
  expect(list!.hasMore).toBe(false);
  removed = true;
  await act(async () => { await invitation!.trigger('decline'); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(list!.data?.projects.map((item: { id: number }) => item.id)).toEqual([1]);
  mocks.get.mockRejectedValue(new Error('Forbidden'));
  await act(async () => { await list!.mutate().catch(() => {}); });
  expect(list!.data).toBeUndefined();
});
it('allocates a single fresh entry per visit even after autosave and revalidation', async () => {
  const entry = { id: 42, can_edit: true, draft: true, content: { type: 'doc', content: [] } };
  mocks.post.mockResolvedValue(entry);
  mocks.patch.mockResolvedValue({ ...entry, draft: false });
  let state: ReturnType<typeof useProjectEntry>;
  function Subject() { state = useProjectEntry('9', undefined, true); void state.query.data; return null; }
  await mount(Subject);
  await act(async () => { await state!.save.trigger({ expected_revision: 100, intent: 'Title only', save: true }); });
  await act(async () => { await state!.query.mutate(); });
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/v1/projects/9/entries', { fresh: true, request_key: expect.any(String) });
  expect(mocks.patch).toHaveBeenCalledWith('/v1/projects/9/entries/42', { expected_revision: 100, intent: 'Title only', save: true });
});
it('does not allocate when the viewer cannot add material', async () => {
  function Subject() { useProjectEntry('9', undefined, false); return null; }
  await mount(Subject);
  expect(mocks.post).not.toHaveBeenCalled();
});
it('clears retained project data after declining an invitation', async () => {
  mocks.get.mockResolvedValue({ id: 9, viewer_participation: 'pending', entries: [] });
  mocks.post.mockResolvedValue({ id: 9, viewer_participation: 'declined' });
  let project: ReturnType<typeof useProject>;
  let invitation: ReturnType<typeof useProjectInvitation>;
  function Subject() { project = useProject('9'); void project.data; invitation = useProjectInvitation('9'); return null; }
  await mount(Subject);
  expect(project!.data?.id).toBe(9);
  await act(async () => { await invitation!.trigger('decline'); });
  expect(project!.data).toBeUndefined();
});

it('retries uncertain allocation with the same durable request after remount', async () => {
  mocks.post.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue({ id: 42, can_edit: true });
  let state: ReturnType<typeof useProjectEntry>;
  function Subject() { state = useProjectEntry('9', undefined, true, 'stable-source-request'); void state.query.error; void state.query.data; return null; }
  await mount(Subject);
  expect(state!.query.error).toBeTruthy();
  await act(async () => root.unmount());
  await mount(Subject);
  expect(state!.query.data?.id).toBe(42);
  expect(mocks.post.mock.calls).toEqual([
    ['/v1/projects/9/entries', { fresh: true, request_key: 'stable-source-request' }],
    ['/v1/projects/9/entries', { fresh: true, request_key: 'stable-source-request' }],
  ]);
});

it('refreshes the retained timeline when returning after a new Entry was saved', async () => {
  const { useProjectTimeline } = await import('../../../../frontend/src/hooks/useProjectTimeline');
  let saved = false;
  const entry = { id: 42, can_edit: true, intent: 'Saved Entry', content: { type: 'doc', content: [] } };
  mocks.get.mockImplementation(async (path: string) => path.endsWith('/entries/42') ? entry : { entries: saved ? [entry] : [], nextCursor: null });
  mocks.patch.mockImplementation(async () => { saved = true; return entry; });
  let editor: ReturnType<typeof useProjectEntry>;
  function Editor() { editor = useProjectEntry('9', '42'); void editor.query.data; return null; }
  let timeline: ReturnType<typeof useProjectTimeline>;
  function Timeline() { timeline = useProjectTimeline('9', true); void timeline.query.data; return null; }
  const cache = new Map();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const render = async (visible: boolean) => {
    await act(async () => { root.render(createElement(SWRConfig, { value: { provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false } }, visible ? createElement(Timeline) : createElement(Editor))); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  await render(true);
  expect(timeline!.entries).toEqual([]);
  await render(false);
  await act(async () => { await editor!.save.trigger({ intent: 'Saved Entry', save: true }); });
  await render(true);
  expect(timeline!.entries.map(entry => entry.id)).toEqual([42]);
});
