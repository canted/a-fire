const wallActions = vi.hoisted(() => ({ allowed: false, source: false, navigate: vi.fn(), withdraw: vi.fn().mockResolvedValue(true), selected: undefined as string | undefined }));
vi.mock('../../../../frontend/src/components/PopupMenu', async () => {
  const { createElement } = await import(String('../../../../frontend/node_modules/react/index.js')) as typeof import('react');
  return { PopupMenu: ({ open, actions }: any) => open ? createElement('div', null, actions.map((action: any) => createElement('button', { key: action.id, disabled: action.disabled, onClick: action.onSelect }, action.label))) : null };
});
vi.mock('../../../../frontend/src/hooks/useEntryQuery', () => ({ useEntryQuery: (id: string) => { wallActions.selected = id; return { data: id ? { entry: { id, ...(wallActions.source ? { source_entry_id: 9, keep_project_id: 2 } : {}) } } : undefined }; } }));
vi.mock('../../../../frontend/src/hooks/useEntryWithdrawal', () => ({ useEntryWithdrawal: (entry: unknown) => ({ available: Boolean(entry) && wallActions.allowed, withdraw: wallActions.withdraw }) }));
import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
vi.mock('../../../../frontend/node_modules/react-native', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const { createElement } = await import(path);
  return { View: ({ children }: any) => createElement('div', null, children), Text: ({ children }: any) => createElement('span', null, children), ActivityIndicator: () => createElement('span', null, 'Loading rounds'), StyleSheet: { create: (value: unknown) => value } };
});
vi.mock('../../../../frontend/src/components/Button', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const { createElement } = await import(path);
  return { Button: ({ children, onPress }: any) => createElement('button', { onClick: onPress }, children) };
});
vi.mock('../../../../frontend/src/components/PageScrollView', () => ({ PageScrollView: ({ children }: any) => children }));
vi.mock('../../../../frontend/src/features/rooms/wall/WallMember', async () => {
  const { createElement } = await import(String('../../../../frontend/node_modules/react/index.js')) as typeof import('react');
  return { WallMember: ({ artist, onActions }: any) => createElement('div', null, artist, createElement('button', { onClick: () => onActions({ id: '42' }, { current: null }) }, 'Options')) };
});
vi.mock('../../../../frontend/src/components/UserIdentity', () => ({ UserIdentity: () => null }));
vi.mock('../../../../frontend/src/features/rounds/RoomRoundsScreen', () => ({ CurrentRound: () => 'Cached private Round' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { RoomRoundContext, RoomHome } = await import(`${expo}/src/features/rooms/RoomHome.tsx`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; });
it.each(["room", 'rounds'])('shows a %s failure instead of cached Round content and retries its owning query', async (owner) => {
  const retryCircle = vi.fn().mockResolvedValue(undefined);
  const retryRounds = vi.fn().mockResolvedValue(undefined);
  const query = { room: { mutate: retryCircle }, rounds: { mutate: retryRounds }, current: [{ id: '1' }], participation: true } as any;
  query[owner].error = new Error('Unavailable');
  const host = document.createElement('div'); root = createRoot(host);
  await act(async () => root!.render(createElement(RoomRoundContext, { query, compact: true })));
  expect(host.textContent).toContain('Could not load current rounds.');
  expect(host.textContent).not.toContain('Cached private Round');
  await act(async () => host.querySelector('button')!.click());
  expect(owner === "room" ? retryCircle : retryRounds).toHaveBeenCalledOnce();
  expect(owner === "room" ? retryRounds : retryCircle).not.toHaveBeenCalled();
  delete query[owner].error;
  await act(async () => root!.render(createElement(RoomRoundContext, { query, compact: true })));
  expect(host.textContent).toBe('Cached private Round');
});
it('keeps the prerequisite Room read visibly loading', async () => {
  const host = document.createElement('div'); root = createRoot(host);
  const query = { room: { isLoading: true }, rounds: {}, current: [] } as any;
  await act(async () => root!.render(createElement(RoomRoundContext, { query })));
  expect(host.textContent).toBe('Loading rounds');
});

it('renders Room membership identities and never falls back to legacy positions', async () => {
  const query = { position: { data: 0 }, room: {}, rounds: {}, current: [], participation: true, home: { data: {
    members: [{ membershipId: '77', userId: '9', username: 'Member without a position', latestEntry: null, recentEntries: [] }],
    squares: [{ id: '77', username: 'Legacy position identity', latestEntry: null }],
  } } } as any;
  const host = document.createElement('div'); root = createRoot(host);
  const render = () => act(async () => root!.render(createElement(RoomHome, { query, openEntry: vi.fn(), openHistory: vi.fn() })));
  await render();
  expect(host.textContent).toContain('Member without a position');
  expect(host.textContent).not.toContain('Legacy position identity');
  query.home.data.members = [];
  await render();
  expect(host.textContent).not.toContain('Member without a position');
  expect(host.textContent).not.toContain('Legacy position identity');
  delete query.home.data.members;
  await render();
  expect(host.textContent).not.toContain('Legacy position identity');
  query.home.error = new Error('Access changed');
  await render();
  expect(host.textContent).not.toContain('Legacy position identity');
});

it('uses authorized withdrawal from wall options without a View entry action', async () => {
  const { RoomWall } = await import('../../../../frontend/src/features/rooms/RoomWall');
  const host = document.createElement('div'); root = createRoot(host);
  const render = () => act(async () => root!.render(createElement(RoomWall, { members: [{ id: '1', name: 'Owner', available: true, slots: [] }], emptyMessage: '', onOpenEntry: vi.fn() })));
  wallActions.allowed = false;
  await render();
  expect(wallActions.selected).toBeUndefined();
  await act(async () => host.querySelector('button')!.click());
  expect(wallActions.selected).toBe('42');
  expect(host.textContent).not.toContain('View entry');
  expect(host.textContent).not.toContain('Remove');
  wallActions.allowed = true;
  await render();
  const click = async (label: string) => act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click(); });
  await click('Remove');
  expect(wallActions.withdraw).not.toHaveBeenCalled();
  await click('Remove');
  expect(wallActions.withdraw).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('Remove');
});

vi.mock('../../../../frontend/src/hooks/useRoomNavigation', () => ({ useRoomNavigation: () => ({ destination: wallActions.navigate }) }));
it('opens the authorized private source from wall options', async () => {
  const { RoomWall } = await import('../../../../frontend/src/features/rooms/RoomWall');
  const host = document.createElement('div'); root = createRoot(host);
  wallActions.source = true;
  await act(async () => root!.render(createElement(RoomWall, { members: [{ id: '1', name: 'Owner', available: true, slots: [] }], emptyMessage: '', onOpenEntry: vi.fn() })));
  await act(async () => host.querySelector('button')!.click());
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'View source')!.click());
  expect(wallActions.navigate).toHaveBeenCalledWith('/app/projects/2/entries/9');
  wallActions.source = false;
});
