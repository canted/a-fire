import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const state = vi.hoisted(() => ({ ids: ['9'], selected: undefined as string | undefined, pending: false, present: vi.fn(), mutate: vi.fn() }));
vi.mock('../../../../frontend/node_modules/swr', () => ({ default: (key: string[] | null) => {
  if (key?.[0] === 'room-walls') return { data: { walls: state.ids.map(id => ({ id })) }, mutate: state.mutate };
  state.selected = key?.[1];
  return { data: key && !state.pending ? { id: key[1] } : undefined };
} }));
vi.mock('../../../../frontend/node_modules/swr/dist/mutation/index.mjs', () => ({ default: () => ({ trigger: state.present }) }));
vi.mock('../../../../frontend/src/lib/api', () => ({ client: {} }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useRoundResult } = await import(`${expo}/src/hooks/useRoundResult.ts`);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let result: ReturnType<typeof useRoundResult>;
function Probe({ room = '1', wall }: {room?: string; wall?: string}) { result = useRoundResult(room, wall, 'member', true); return null; }
afterEach(async () => { await act(async () => root?.unmount()); state.ids=['9']; state.pending=false; vi.clearAllMocks(); });
it('pins arrival selection across new publications and honors explicit collection navigation', async () => {
  root=createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe, {})));
  expect(state.selected).toBe('9');
  state.ids=['10','9'];
  await act(async () => root.render(createElement(Probe, {})));
  expect(state.selected).toBe('9');
  expect(result.detail.data).toEqual({id:'9'});
  await act(async () => result.dismiss(vi.fn()));
  expect(result.closeError).toBeUndefined();
  expect(state.present).toHaveBeenLastCalledWith('9');
  await act(async () => root.render(createElement(Probe, { wall:'10' })));
  await act(async () => result.dismiss(vi.fn()));
  expect(state.present).toHaveBeenLastCalledWith('10');
  state.ids=['20'];
  await act(async () => root.render(createElement(Probe, { room:'2' })));
  expect(state.selected).toBe('20');
});
it('does not acknowledge a requested collection whose detail has not appeared', async () => {
  root=createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe, {})));
  state.pending=true;
  await act(async () => root.render(createElement(Probe, { wall:'10' })));
  const close=vi.fn();
  await act(async () => result.dismiss(close));
  expect(state.present).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
