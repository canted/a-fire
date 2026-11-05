import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
// Use Expo's React 19 at runtime. Dynamic paths keep native ambient declarations
// out of the legacy app's TypeScript program while exercising the real hook.
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useRoomReading, useMessageReading } = await import(`${expo}/src/hooks/useRoomReading.ts`) as {
  useRoomReading: (input: unknown) => { notice: string | null };
  useMessageReading: (input: unknown) => { notice: string | null };
};
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.useRealTimers(); });

it('waits for fresh access before resolving a warm link against a cached visitor window', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const refresh = new Promise<void>(resolve => { finish = resolve; });
  const consumeTarget = vi.fn();
  const room = { live: { data: { viewer_access: { kind: 'visitor' } }, mutate: vi.fn(() => refresh) }, history: { isValidating: false }, messages: [{ id: 61 }, { id: 70 }], hasOlder: false };
  const input = {
    room, draft: { offset: 0, update: vi.fn() }, groups: [] as { key: string; ids: string[]; entries: never[]; continuation: boolean; continues: boolean }[], target: '20', consumeTarget,
    list: { current: { scrollToOffset: vi.fn(), scrollToIndex: vi.fn() } },
    exposure: { rows: { current: new Map() }, viewport: { current: { measureInWindow: (cb: (...values: number[]) => void) => cb(0, 0, 100, 100) } } },
  };
  let notice: string | null = null;
  function Probe() { notice = useRoomReading(input).notice; return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(room.live.mutate).toHaveBeenCalledOnce();
  expect(consumeTarget).not.toHaveBeenCalled();
  expect(notice).toBe('Finding message…');
  room.live.data.viewer_access.kind = 'member';
  room.history.isValidating = true;
  await act(async () => { finish(); root!.render(createElement(Probe)); });
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(consumeTarget).not.toHaveBeenCalled();
  room.history.isValidating = false;
  room.messages = [{ id: 20 }, { id: 70 }];
  input.groups = [{ key: '20', ids: ['20'], entries: [], continuation: false, continues: false }];
  input.exposure.rows.current.set(20, { group: '20', node: { measureInWindow: (cb: (...values: number[]) => void) => cb(0, 38, 100, 24) } } as never);
  await act(async () => { finish(); root!.render(createElement(Probe)); });
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(consumeTarget).toHaveBeenCalledOnce();
  expect(notice).toBeNull();
});


it('retains a reply target through a failed page load and reveals it after retry', async () => {
  vi.useFakeTimers();
  const source = {
    ready: true, error: new Error('Offline') as Error | undefined, validating: false,
    messages: [{ id: 1 }], hasMore: true, loadMore: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const consumeTarget = vi.fn();
  const input = {
    source, draft: { offset: 0, update: vi.fn() }, groups: [{ key: '1', ids: ['1'] }],
    list: { current: { scrollToOffset: vi.fn(), scrollToIndex: vi.fn() } },
    exposure: { rows: { current: new Map() }, viewport: { current: { measureInWindow: (cb: (...values: number[]) => void) => cb(0, 0, 100, 100) } } },
    target: '70', consumeTarget, inverted: false, followInitially: false, noun: 'reply',
  };
  let notice: string | null = null;
  function Probe() { notice = useMessageReading(input).notice; return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(notice).toBe('Could not find the reply. Retry loading history.');
  expect(consumeTarget).not.toHaveBeenCalled();
  expect(source.loadMore).not.toHaveBeenCalled();
  source.error = undefined;
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => { vi.advanceTimersByTime(100); });
  expect(source.loadMore).toHaveBeenCalledOnce();
  source.messages.push({ id: 70 });
  input.groups.push({ key: '70', ids: ['70'] });
  input.exposure.rows.current.set(70, { node: { measureInWindow: (cb: (...values: number[]) => void) => cb(0, 38, 100, 24) } });
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(consumeTarget).toHaveBeenCalledOnce();
  expect(notice).toBeNull();
  expect(input.draft.update).toHaveBeenLastCalledWith({ anchor: { id: 70, top: 38 }, offset: 0 }, false);
});

it('reports a cold reply load failure without consuming the link', async () => {
  vi.useFakeTimers();
  const consumeTarget = vi.fn();
  const source = { ready: false, error: new Error('Denied'), validating: false, messages: [], hasMore: false, loadMore: vi.fn(), refresh: vi.fn().mockRejectedValue(new Error('Denied')) };
  let notice: string | null = null;
  function Probe() {
    notice = useMessageReading({ source, draft: { offset: 0, update: vi.fn() }, groups: [],
      list: { current: null }, exposure: { rows: { current: new Map() }, viewport: { current: null } },
      target: '70', consumeTarget, inverted: false, followInitially: false, noun: 'reply' }).notice;
    return null;
  }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(notice).toBe('Could not find the reply. Retry loading history.');
  expect(consumeTarget).not.toHaveBeenCalled();
  expect(source.loadMore).not.toHaveBeenCalled();
});

it('does not scroll, paginate or consume a message target while chat is hidden', async () => {
  vi.useFakeTimers();
  const input = {
    active: false,
    room: { live: { data: {}, mutate: vi.fn().mockResolvedValue(undefined) }, history: {}, messages: [{ id: 1 }], hasOlder: true, loadOlder: vi.fn() },
    draft: { offset: 80, anchor: { id: 1, top: 10 }, update: vi.fn() },
    groups: [{ key: '1', ids: ['1'] }], target: '1', consumeTarget: vi.fn(),
    list: { current: { scrollToOffset: vi.fn(), scrollToIndex: vi.fn() } },
    exposure: { rows: { current: new Map([[1, { node: { measureInWindow: (cb: (...values: number[]) => void) => cb(0, 10, 100, 24) } }]]) }, viewport: { current: { measureInWindow: (cb: (...values: number[]) => void) => cb(0, 0, 100, 100) } } },
  };
  function Probe() { useRoomReading(input); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(input.list.current.scrollToOffset).not.toHaveBeenCalled();
  expect(input.list.current.scrollToIndex).not.toHaveBeenCalled();
  expect(input.consumeTarget).not.toHaveBeenCalled();
  expect(input.room.loadOlder).not.toHaveBeenCalled();
  input.active = true;
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(input.consumeTarget).toHaveBeenCalledOnce();
});
