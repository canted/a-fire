import { expect, it, vi } from 'vitest';
import { hasPendingScopedDrafts, scopedDrafts, subscribePendingScopedDrafts } from '../../../../frontend/src/lib/scopedDrafts';
it('retains pending work after route subscribers leave, even for silent writes', () => {
  const session = {}, listener = vi.fn();
  const store = scopedDrafts(session, () => ({ text: '' }), value => Boolean(value.text));
  const stop = store.subscribe('room', vi.fn());
  subscribePendingScopedDrafts(session, listener);
  store.write('room', { text: 'unsent' }, false);
  stop();
  expect(hasPendingScopedDrafts(session)).toBe(true);
  expect(listener).toHaveBeenCalledOnce();
  const revisited = scopedDrafts(session, () => ({ text: '' }), value => Boolean(value.text));
  expect(revisited.read('room').text).toBe('unsent');
  revisited.write('room', { text: '' });
  expect(hasPendingScopedDrafts(session)).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);
});
it('isolates sessions and clears pending ownership when a bounded draft is evicted', () => {
  const session = {}, nextSession = {};
  const store = scopedDrafts(session, () => '', value => Boolean(value));
  store.write('old', 'unsent');
  expect(hasPendingScopedDrafts(nextSession)).toBe(false);
  for (let index = 0; index < 32; index++) store.write(String(index), '');
  expect(hasPendingScopedDrafts(session)).toBe(false);
});
