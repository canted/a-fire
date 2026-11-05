import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), append: vi.fn() }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: mocks }));
vi.mock('../../../../frontend/src/lib/chatFiles', () => ({ appendPickedFile: mocks.append }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { SWRConfig } = await import(`${expo}/node_modules/swr/dist/index/index.mjs`);
const { useRoomCreation } = await import(`${expo}/src/hooks/useRoomCreation.ts`);
const { useProfiles } = await import(`${expo}/src/hooks/useProfiles.ts`);
const { useHome } = await import(`${expo}/src/hooks/useHome.ts`);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => { mocks.get.mockImplementation(async (path: string) => path === '/v1/memberships' ? { user: { id: 1, username: 'Original' }, memberships: [] } : { recentRooms: [] }); });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.resetAllMocks(); });
async function mount(Subject: () => null) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false } }, createElement(Subject))); });
}
it('creates one Room during repeated submission and refreshes the actual timezone-keyed Home query', async () => {
  let state: ReturnType<typeof useRoomCreation>;
  function Subject() { state = useRoomCreation(); useHome(); return null; }
  let finish!: (value: unknown) => void;
  mocks.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(Subject);
  const homeReads = mocks.get.mock.calls.length;
  await act(async () => {
    const first = state!.submit({ name: '  New Room  ' });
    const second = state!.submit({ name: 'Duplicate' });
    expect(first).toBe(second);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    const [path, form] = mocks.post.mock.calls[0];
    expect(path).toBe('/v2/rooms'); expect(form.get("room[name]")).toBe('New Room');
    finish({ id: 12, name: 'New Room', porosity: 'open' });
    await first;
  });
  expect(mocks.get.mock.calls.length).toBeGreaterThan(homeReads);
});
it('preserves explicit cleared overrides and false notification preferences through the shared multipart contract', async () => {
  let state: ReturnType<typeof useProfiles>;
  function Subject() { state = useProfiles(); return null; }
  mocks.patch.mockResolvedValue({ id: 4 });
  await mount(Subject);
  await act(async () => { await state!.submit({ kind: 'membership', id: 4, fields: { username_override: '', profile_line_override: null, notify: false } }); });
  const [path, form] = mocks.patch.mock.calls[0];
  expect(path).toBe('/v1/memberships/4');
  expect([...form.entries()]).toEqual([['membership[username_override]', ''], ['membership[profile_line_override]', ''], ['membership[notify]', 'false']]);
  expect(mocks.get.mock.calls.filter(([path]) => path === '/v1/memberships').length).toBeGreaterThan(1);
});
it('retains failed mutation errors and allows a later retry without performing a second concurrent change', async () => {
  let state: ReturnType<typeof useProfiles>;
  function Subject() { state = useProfiles(); return null; }
  mocks.patch.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ id: 1 });
  await mount(Subject);
  await act(async () => { await expect(state!.submit({ kind: 'identity', fields: { username: 'Updated' } })).rejects.toThrow('Offline'); });
  await act(async () => { await state!.submit({ kind: 'identity', fields: { username: 'Updated' } }); });
  expect(mocks.patch).toHaveBeenCalledTimes(2);
});
