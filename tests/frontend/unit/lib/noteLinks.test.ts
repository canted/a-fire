import { describe, expect, it } from 'vitest';
import { safeRoomReturn } from '../../../../frontend/src/lib/roomLinks';
describe('Note audio destination authentication returns', () => {
  it.each(['/app/note/12?audio=4&t=2.3', '/app/note/12/audio-reply?audio=4&audioNode=source-1&t=0', '/app/note/12#audio-reply-123'])('retains %s', path => expect(safeRoomReturn(path)).toBe(path));
  it.each(['/app/note/12/audio-reply', '/app/note/12?audio=4&audio=5', '/app/note/12?audio=4&t=-1', '/app/note/12?audio=4&next=https://evil.test', '/app/note/12?audioNode=source-1', '/app/note/12/audio-reply/other?audio=4', '/app/note/12#bad%20id'])('rejects %s', path => expect(safeRoomReturn(path)).toBe('/app'));
});
