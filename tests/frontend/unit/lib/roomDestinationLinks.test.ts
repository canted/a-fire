import { describe, expect, it } from 'vitest';
import { safeRoomReturn } from '../../../../frontend/src/lib/roomLinks';

describe('Room destination authentication returns', () => {
  it.each([
    '/app/note/12', '/app/rooms/7/notes', '/app/rooms/7/rounds',
    '/app/rooms/7/participation', '/app/rooms/7/history',
    '/app/rooms/7/settings', '/app/rooms/7/settings#invites', '/app/rooms/7/invites',
    '/app/rounds/3', '/app/rounds/3/edit',
    '/app/rooms/2/rounds/new', '/app/rooms/2/rounds/new?templateKey=feedback',
    '/app/rooms/2/rounds/new?templateKey=art_before_chorus',
    '/app/entries/12?reply=42', '/app/entries/12#reply-42',
  ])('retains %s', path => expect(safeRoomReturn(path)).toBe(path));
  it.each([
    '/app/note/0', '/app/note/12?next=https://evil.test',
    '/app/rooms/7/settings#unknown', '/app/rooms/7/invites/unknown',
    '/app/board/2/activities/new/unknown', '/app/board/2/activities/3/delete',
    '//evil.test/app/note/12', '/app/note/../12',
    '/app/entries/12?reply=0', '/app/entries/12?reply=42&next=https://evil.test',
  ])('rejects %s', path => expect(safeRoomReturn(path)).toBe('/app'));
});

describe('entry reply targets', () => {
  it('accepts existing fragment links and native query targets', async () => {
    const { entryReplyTarget } = await import('../../../../frontend/src/lib/roomLinks');
    expect(entryReplyTarget('#reply-42')).toBe('42');
    expect(entryReplyTarget('reply-42', '99')).toBe('42');
    expect(entryReplyTarget(undefined, '99')).toBe('99');
    for (const value of ['0', '-1', '1e3', '9007199254740992']) expect(entryReplyTarget(undefined, value)).toBeNull();
    expect(entryReplyTarget('#chat-42')).toBeNull();
  });
});

it('preserves web migration destinations through sign-in without external redirects', () => {
  for (const path of ['/app/rooms/7', '/app/user/new?communityId=8', '/app/rooms/8/profile', '/app/projects/9/entries/10/edit', '/app/new-entry?draftId=11&activityId=12']) expect(safeRoomReturn(path)).toBe(path);
  for (const path of ['//outside.example/app/board/7', '/app/user/new?next=https://outside.example', '/app/rooms/8/profile?boardId=oops', '/app/new-entry?square_id=1&activityId=https://outside.example', '/app/new-entry?square_id=1&square_id=2']) expect(safeRoomReturn(path)).toBe('/app');
});
it('retains member introductions and Side Rooms and rejects retired creation routes', async () => {
  const { sessionReturnPath } = await import('../../../../frontend/src/lib/roomLinks');
  expect(sessionReturnPath('/app/rooms/7/members/9/introductions', { introduction: '8' })).toBe('/app/rooms/7/members/9/introductions?introduction=8');
  expect(sessionReturnPath('/app/rooms/7/chat', { panel: 'side' })).toBe('/app/rooms/7/chat?panel=side');
  expect(sessionReturnPath('/app/square/7/new-post', { origin: 'chat' })).toBe('/app');
});
