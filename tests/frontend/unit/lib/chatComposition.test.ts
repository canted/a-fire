import { expect, it } from 'vitest';
import { acknowledgeChatSend, emptyRoomDraft, type PendingChatSend } from '../../../../frontend/src/lib/chatComposition';
import { scopedDrafts } from '../../../../frontend/src/lib/scopedDrafts';
const pending: PendingChatSend = { body: 'Original', content: { type: 'doc' }, nonce: 'same-attempt', revision: 1 };
it('acknowledges only the original Room snapshot and retains its reading state', () => {
  const store = scopedDrafts({}, emptyRoomDraft);
  const original = { ...emptyRoomDraft(), text: 'Original', revision: 1, pending, offset: 50 };
  store.write('viewer:room-a', original);
  store.write('viewer:room-b', { ...emptyRoomDraft(), text: 'Other Room' });
  store.write('viewer:room-a', { ...original, ...acknowledgeChatSend(store.read('viewer:room-a'), pending) });
  expect(store.read('viewer:room-a')).toMatchObject({ text: '', pending: null, offset: 50 });
  expect(store.read('viewer:room-b').text).toBe('Other Room');
});
it('never clears later edits or a different pending send', () => {
  expect(acknowledgeChatSend({ ...emptyRoomDraft(), text: 'New edit', revision: 2, pending }, pending)).not.toHaveProperty('text');
  expect(acknowledgeChatSend({ ...emptyRoomDraft(), pending: { ...pending, nonce: 'other' } }, pending)).toEqual({});
});
it('notifies a remounted composer when its earlier async operation finishes', () => {
  const scope = {};
  const oldMount = scopedDrafts(scope, emptyRoomDraft);
  const newMount = scopedDrafts(scope, emptyRoomDraft);
  const owner = Symbol('send');
  oldMount.write('room', { ...emptyRoomDraft(), operation: { owner, stage: 'sending' } });
  let observed = 0;
  const unsubscribe = newMount.subscribe('room', () => observed++);
  expect(newMount.read('room').operation?.owner).toBe(owner);
  oldMount.write('room', { ...oldMount.read('room'), operation: undefined });
  expect(observed).toBe(1);
  expect(newMount.read('room').operation).toBeUndefined();
  oldMount.write('room', { ...oldMount.read('room'), offset: 30 }, false);
  expect(observed).toBe(1);
  unsubscribe();
});
