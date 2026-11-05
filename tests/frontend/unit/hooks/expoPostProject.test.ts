import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: mocks }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useEntryProject } = await import(`${expo}/src/hooks/useEntryProject.ts`);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.clearAllMocks(); });
it('loads only the post Room projects and associates the original instead of copying Chat', async () => {
  mocks.get.mockImplementation(async (url: string) => url.includes('/entries/') ? { entry: { id: 7, room_id: 12, project_id: null }, replies: { data: [], pagination: {} } } : { projects: [{ id: 18, name: 'Room project' }] });
  mocks.patch.mockResolvedValue({ id: 7, project_id: 18 });
  let state: ReturnType<typeof useEntryProject>;
  function Subject() { state = useEntryProject('7'); return null; }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, createElement(Subject))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(mocks.get).toHaveBeenCalledWith('/v1/projects?cursor=&room_id=12');
  await act(async () => { await state!.assignment.trigger(18); });
  expect(mocks.patch).toHaveBeenCalledWith('/v1/entries/7/project', { project_id: 18 });
});
