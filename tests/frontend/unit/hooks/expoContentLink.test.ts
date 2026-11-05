import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ destination: vi.fn(), legacy: vi.fn(), external: vi.fn(), pathname: '/app/note/1' }));
vi.mock('../../../../frontend/node_modules/expo-router', () => ({ usePathname: () => state.pathname, useGlobalSearchParams: () => ({}) }));
vi.mock('../../../../frontend/node_modules/react-native', () => ({ Linking: { openURL: state.external } }));
vi.mock('../../../../frontend/src/hooks/useAudioPlayback', () => ({ useAudioPlayback: () => ({ play: vi.fn() }) }));
vi.mock('../../../../frontend/src/hooks/useRoomNavigation', () => ({ useRoomNavigation: () => ({ destination: state.destination }) }));
vi.mock('../../../../frontend/src/lib/legacyNavigation', () => ({ openLegacy: state.legacy }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`);
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`);
const { useContentLink } = await import(`${expo}/src/hooks/useContentLink.ts`);
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root?.unmount()); state.pathname = '/app/note/1'; vi.clearAllMocks(); });
it('opens Home document links inside Expo while retaining external link handling', async () => {
  let links: ReturnType<typeof useContentLink>;
  function Probe() { links = useContentLink(); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  for (const href of ['/app', '/app/', '/app?filter=all']) await act(async () => links.open(href));
  expect(state.destination.mock.calls.map(call => call[0])).toEqual(['/app', '/app/', '/app?filter=all']);
  expect(state.legacy).not.toHaveBeenCalled();
  await act(async () => links.open('https://example.test/'));
  expect(state.external).toHaveBeenCalledWith('https://example.test/');
});
it('opens same-Room historical links through navigation so browser Back retains Chat', async () => {
  state.pathname = '/app/rooms/7/chat';
  let links: ReturnType<typeof useContentLink>;
  function Probe() { links = useContentLink(); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  await act(async () => links.open('/app/rooms/7/chat?wall=12'));
  expect(state.destination).toHaveBeenCalledExactlyOnceWith('/app/rooms/7/chat?wall=12');
  expect(state.legacy).not.toHaveBeenCalled();
});

it('keeps shared copies and all migrated app destinations in the current router', async () => {
  let links: ReturnType<typeof useContentLink>;
  function Probe() { links = useContentLink(); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  const routes = ['/app/entries/3', '/app/entries/3#reply-7', '/app/rooms/1/round-history', '/app/rounds/9', '/app/projects/1/entries/2'];
  for (const href of routes) await act(async () => links.open(href));
  expect(state.destination.mock.calls.map(call => call[0])).toEqual(routes);
  expect(state.legacy).not.toHaveBeenCalled();
  expect(state.external).not.toHaveBeenCalled();
});
