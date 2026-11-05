import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
vi.mock('../../../../frontend/src/hooks/useRoomNavigation', () => ({ useRoomNavigation: () => ({ destination: vi.fn() }) }));
vi.mock('../../../../frontend/src/hooks/useEntryQuery', () => ({ useEntryQuery: () => ({}) }));
vi.mock('../../../../frontend/src/hooks/useEntryWithdrawal', () => ({ useEntryWithdrawal: () => ({ available: false }) }));
const roundState = vi.hoisted(() => ({ value: { room: {}, rounds: {} } as Record<string, unknown> }));
const scrollState = vi.hoisted(() => ({ top: 0, restore: vi.fn() }));
vi.mock('../../../../frontend/src/hooks/useRounds', () => ({ useRoomRounds: () => roundState.value }));
vi.mock('../../../../frontend/src/features/entries/EntryRepliesScreen', async () => { const path = '../../../../frontend/node_modules/react/index.js'; const React = await import(path); return { EntryFlow: ({ id, onBack, onSelectPost }: { id: string; onBack: () => void; onSelectPost: (id: string) => void }) => React.createElement('div', { 'data-entry-id': id }, React.createElement('button', { onClick: onBack }, 'Back to wall'), React.createElement('button', { onClick: () => onSelectPost('10') }, 'Next project contribution')) }; });
vi.mock('../../../../frontend/src/features/rooms/MessageContent', () => ({ ResponseSummary: () => null }));
vi.mock('../../../../frontend/src/components/Icon', () => ({ Icon: () => null }));
vi.mock('../../../../frontend/src/components/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('../../../../frontend/src/features/content/EntryContent', async () => {
  const path = '../../../../frontend/node_modules/react/index.js'; const React = await import(path);
  return { EntryContent: ({ onOpen }: { onOpen?: () => void }) => React.createElement('button', { onClick: onOpen, 'aria-label': 'Open entry' }, 'Entry content') };
});
vi.mock('../../../../frontend/src/components/PopupMenu', () => ({ PopupMenu: () => null }));
vi.mock('../../../../frontend/src/features/rooms/MessageGroup', () => ({ AuthorStripe: () => null }));
vi.mock('../../../../frontend/node_modules/react-native', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const React = await import(path);
  return { BackHandler: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'web' }, StyleSheet: { create: (value: unknown) => value }, AccessibilityInfo: { announceForAccessibility: vi.fn() }, ActivityIndicator: () => null,
    Text: ({ children, ref, tabIndex, accessibilityRole }: Record<string, unknown>) => React.createElement(accessibilityRole === 'header' ? 'h2' : 'span', { ref, tabIndex }, children),
    View: ({ children }: { children: unknown }) => React.createElement('div', null, children),
    ScrollView: ({ children, ref, onContentSizeChange }: Record<string, unknown>) => { React.useImperativeHandle(ref, () => ({ scrollTo: scrollState.restore, getScrollableNode: () => ({ scrollTop: scrollState.top }) })); React.useEffect(() => { (onContentSizeChange as (() => void) | undefined)?.(); }, []); return React.createElement('div', null, children); } };
});
vi.mock('../../../../frontend/src/components/Button', async () => {
  const path = '../../../../frontend/node_modules/react/index.js';
  const React = await import(path);
  return { Button: ({ children, onPress, accessibilityLabel }: Record<string, unknown>) => React.createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children) };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('../../../../frontend/src/components/PageScrollView', async () => { const rn = await import('../../../../frontend/node_modules/react-native'); return { PageScrollView: rn.ScrollView }; });
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { RoundResultView } = await import(`${expo}/src/features/rooms/RoundResultView.tsx`);
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); roundState.value = { room: {}, rounds: {} }; vi.useRealTimers(); });
it('focuses the loaded selected Wall heading after the activating button disappears', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.useFakeTimers();
  const first = { roomId: '7', publishedAt: '2026-10-15', id: '1', title: 'First Wall', entries: [] };
  const second = { roomId: '7', publishedAt: '2026-10-15', id: '2', title: 'Second Wall', entries: [] };
  let shown = first;
  const render = () => root!.render(createElement(RoundResultView, { roomId: '7', navigate: vi.fn(), query: { walls: { data: { walls: [first, second] } }, detail: { data: shown } }, select: () => { shown = second; render(); }, close: vi.fn() }));
  await act(async () => render());
  const select = [...container.querySelectorAll('button')].find(button => button.textContent === 'Previous collection')!;
  select.focus();
  await act(async () => select.click());
  await act(async () => vi.advanceTimersByTime(20));
  expect(document.activeElement?.textContent).toBe(second.title);
  expect(document.activeElement?.tagName).toBe('H2');
});

it('captures browser scroll synchronously before opening and restores the gallery on return', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const wall = { roomId: '7', publishedAt: '2026-10-15', id: '1', title: 'Wall', entries: [{ id: '1', entryId: '9', authorName: 'Author', available: true, content: { type: 'doc', content: [] }, responseCount: 0, responseParticipants: [] }] };
  await act(async () => root!.render(createElement(RoundResultView, { roomId: '7', navigate: vi.fn(), query: { walls: { data: { walls: [wall] } }, detail: { data: wall } }, select: vi.fn(), close: vi.fn() })));
  scrollState.top = 320; // Browser scrolled, but no throttled scroll event fired.
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open entry"]')!.click());
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Back to wall')!.click());
  expect(scrollState.restore).toHaveBeenLastCalledWith({ y: 320, animated: false });
});
it('restores each Wall independently when history changes the scroll container', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const walls = [{ roomId: '7', id: '1', title: 'New Wall', entries: [], publishedAt: '2026-10-15' }, { roomId: '7', id: '2', title: 'Old Wall', entries: [], publishedAt: '2026-10-14' }];
  let shown = walls[0];
  const render = () => root!.render(createElement(RoundResultView, { roomId: '7', navigate: vi.fn(), query: { walls: { data: { walls } }, detail: { data: shown } }, select: (id: string) => { shown = walls.find(wall => wall.id === id)!; render(); }, close: vi.fn() }));
  await act(async () => render());
  scrollState.top = 320;
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Previous collection')!.click());
  scrollState.top = 0;
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Next collection')!.click());
  expect(scrollState.restore).toHaveBeenLastCalledWith({ y: 320, animated: false });
});

it('lets a Room host continue a Wall template without a Board', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const wall = { roomId: '7', id: '1', title: 'Wall', entries: [], publishedAt: '2026-10-15', templateKey: 'feedback' };
  roundState.value = { room: { data: { canManage: true, memberBoard: null } }, rounds: { data: { currentRounds: [] } } };
  const navigate = vi.fn();
  await act(async () => root!.render(createElement(RoundResultView, { roomId: '7', navigate, query: { walls: { data: { walls: [wall] } }, detail: { data: wall } }, select: vi.fn(), close: vi.fn() })));
  const start = [...container.querySelectorAll('button')].find(button => button.textContent === 'Start another round with this template');
  expect(start).toBeDefined();
  await act(async () => start!.click());
  expect(navigate).toHaveBeenCalledWith('/app/rooms/7/rounds/new?templateKey=feedback');
});

it('keeps unavailable result positions visible without offering an Entry action', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const wall = { roomId: '7', publishedAt: '2026-10-15', id: '1', title: 'Wall', entries: [{ id: '1', entryId: null, authorName: 'Former contributor', available: false, content: null }] };
  await act(async () => root!.render(createElement(RoundResultView, { roomId: '7', navigate: vi.fn(), query: { walls: { data: { walls: [wall] } }, detail: { data: wall } }, select: vi.fn(), close: vi.fn() })));
  expect(container.textContent).toContain('Former contributor');
  expect(container.textContent).toContain('Shared work no longer available.');
  expect(container.querySelector('[aria-label="Open entry"]')).toBeNull();
});
it.each(['denied', 'error'])('hides cached result entries after access %s', async kind => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const wall = { roomId: '7', publishedAt: '2026-10-15', id: '1', title: 'Private collection', entries: [{ id: '1', entryId: '9', authorName: 'Private author', available: true, content: { type: 'doc', content: [] } }] };
  await act(async () => root!.render(createElement(RoundResultView, { roomId: '7', navigate: vi.fn(), query: { denied: kind === 'denied', walls: { data: { walls: [wall] } }, detail: { data: wall, error: kind === 'error' ? new Error('Revoked') : undefined } }, select: vi.fn(), close: vi.fn() })));
  expect(container.textContent).not.toContain('Private author');
  expect(container.textContent).not.toContain('Private collection');
  expect(container.querySelector('[aria-label="Open entry"]')).toBeNull();
});

it('keeps the collection selection while navigating an embedded project contribution', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const wall = { roomId: '7', publishedAt: '2026-10-15', id: '1', title: 'Wall', entries: [{ id: 'collection-member-1', entryId: '9', authorName: 'Author', available: true, content: { type: 'doc', content: [] }, responseCount: 0, responseParticipants: [] }] };
  await act(async () => root!.render(createElement(RoundResultView, { roomId: '7', navigate: vi.fn(), query: { walls: { data: { walls: [wall] } }, detail: { data: wall } }, select: vi.fn(), close: vi.fn() })));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open entry"]')!.click());
  expect(container.querySelector('[data-entry-id="9"]')).not.toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Next project contribution')!.click());
  expect(container.querySelector('[data-entry-id="10"]')).not.toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Back to wall')!.click());
  expect(container.querySelector('[aria-label="Open entry"]')).not.toBeNull();
});
