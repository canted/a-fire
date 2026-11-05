import { expect, it } from 'vitest';
import { expoRouteAlias } from '../../../../frontend/src/lib/expoRouteAlias';
import { safeRoomReturn } from '../../../../frontend/src/lib/roomLinks';
it.each([
  ['/app/communities/7/pages/new', '/app/rooms/7/notes/new'],
  ['/app/communities/7/pages', '/app/rooms/7/notes'],
  ['/app/page/8/audio-reply?audio=9&t=4', '/app/note/8/audio-reply?audio=9&t=4'],
  ['/app/circles/7/chat-prototype#chat-4', '/app/rooms/7/chat#chat-4'],
  ['/app/communities', '/app/rooms/all'],
  ['/app/circles/new', '/app/rooms/new'],
  ['/app/circles/7/activities', '/app/rooms/7/rounds'],
  ['/app/circles/7/side-circles', '/app/rooms/7/adjacent-rooms'],
  ['/app/circles/7/first-post-prompt', '/app/rooms/7/first-entry-prompt'],
  ['/app/post/8#reply-4', '/app/entries/8#reply-4'],
  ['/app/post/8/new-reply?audio=9&t=4', '/app/entries/8/new-reply?audio=9&t=4'],
])('preserves historical destination %s', (before, after) => {
  expect(expoRouteAlias(before)).toBe(after);
  expect(safeRoomReturn(before)).toBe(after);
});
it.each(['https://outside.example/app/communities', '//outside.example/app/communities', '/app/communities/../admin', '/app/board/2/rounds/invalid', '/app/projects/7'])('does not invent a mapping for %s', path => expect(expoRouteAlias(path)).toBeUndefined());
it('accepts the migrated Side Rooms destinations without broadening panel parameters', () => {
  expect(safeRoomReturn('/app/circles/7/side-circles')).toBe('/app/rooms/7/adjacent-rooms');
  expect(safeRoomReturn('/app/circles/7/chat?panel=side')).toBe('/app/rooms/7/chat?panel=side');
  expect(safeRoomReturn('/app/circles/7/chat?panel=admin')).toBe('/app');
});

it.each(['/app/board/2/rounds/3/edit', '/app/board/2/activities/3', '/app/square/4'])('rejects retired Room structure links: %s', path => {
  expect(expoRouteAlias(path)).toBeUndefined();
  expect(safeRoomReturn(path)).toBe('/app');
});
