import { historicalReplyCount, type RoomMessage } from '../../../../frontend/src/lib/api/room';
import { describe, expect, it, vi } from 'vitest';
import { eligibleSaveProjects, keepChatMessage, projectFields, createProjectRecord, type ProjectSummary } from '../../../../frontend/src/lib/api/projects';
import { fetchChatReplies, fetchThreadMessage, replyAsRoomMessage } from '../../../../frontend/src/lib/api/chatThread';
import { safeRoomReturn } from '../../../../frontend/src/lib/roomLinks';
import { rubberBandSwipeOffset, COMMIT_OFFSET } from '../../../../frontend/src/lib/chatSwipe';

describe('portable Chat actions', () => {
  it('offers only owned Chat-save destinations', () => {
    const projects = ['owner', 'accepted', 'pending', 'declined', null].map((viewer_participation, id) => ({ id, viewer_participation })) as ProjectSummary[];
    expect(eligibleSaveProjects(projects).map(project => project.id)).toEqual([0]);
  });
  it('preserves the canonical keep payload and response', async () => {
    const post = vi.fn().mockResolvedValue({ id: 9 });
    await expect(keepChatMessage({ post }, 7, 12)).resolves.toEqual({ id: 9 });
    expect(post).toHaveBeenCalledWith('/v1/projects/7/keep', { chat_message_id: 12 });
  });
  it('uses separate source and historical reply reads', async () => {
    const get = vi.fn().mockResolvedValue({});
    await fetchThreadMessage({ get }, '7', '12');
    await fetchChatReplies({ get }, '7', '12');
    expect(get.mock.calls.map(call => call[0])).toEqual(['/v2/rooms/7/chat/messages/12', '/v2/rooms/7/chat/messages/12/replies']);
  });
  it('retains safe historical and save URLs through authentication', () => {
    for (const suffix of ['', '/save']) expect(safeRoomReturn(`/app/rooms/7/chat/messages/12${suffix}`)).toBe(`/app/rooms/7/chat/messages/12${suffix}`);
    for (const path of ['https://example.com', '//example.com', '/app/rooms/7/chat/messages/0', '/app/rooms/7/chat/messages/12/unknown']) expect(safeRoomReturn(path)).toBe('/app');
  });
  it('retains only supported entry and nested project return paths', () => {
    const next = '/app/projects/new?next=' + encodeURIComponent('/app/rooms/7/chat/messages/12/save');
    expect(safeRoomReturn(next)).toBe(next);
    expect(safeRoomReturn('/app/entries/123')).toBe('/app/entries/123');
    expect(safeRoomReturn('/app/projects/new?next=https%3A%2F%2Fevil.test')).toBe('/app');
    expect(safeRoomReturn('/app/projects/new?next=%')).toBe('/app');
  });
  it('creates projects with the shared multipart contract and no implicit sharing', async () => {
    const form = projectFields({ name: 'Private project', iconSymbol: 'projectAtom', iconColor: 'blue' });
    expect(Array.from(form.entries())).toEqual([['project[name]', 'Private project'], ['project[icon_symbol]', 'projectAtom'], ['project[icon_color]', 'blue']]);
    const post = vi.fn().mockResolvedValue({ id: 9 });
    await expect(createProjectRecord({ post }, form)).resolves.toEqual({ id: 9 });
    expect(post).toHaveBeenCalledWith('/v1/projects', form);
  });
  it('shares reply attribution without losing displayed identity', () => {
    const message = replyAsRoomMessage({ id: '12', user: { id: 7, username: 'account name' }, display_username: 'Room identity', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reply' }] }] } });
    expect(message.id).toBe(12);
    expect(message.author?.display_username).toBe('Room identity');
    expect(message.body).toBe('Reply');
  });
  it('keeps swipe resistance and commit separate from a short reveal', () => {
    expect(rubberBandSwipeOffset(-30)).toBe(0);
    expect(rubberBandSwipeOffset(75)).toBeLessThan(COMMIT_OFFSET);
    expect(rubberBandSwipeOffset(200)).toBeGreaterThan(COMMIT_OFFSET);
    expect(rubberBandSwipeOffset(1000)).toBeLessThan(126);
  });
});

it('preserves exact Wall and notification destinations without accepting arbitrary redirects', () => {
  expect(safeRoomReturn('/app/rooms/7/chat?wall=82')).toBe('/app/rooms/7/chat?wall=82');
  expect(safeRoomReturn('/app/notification-preferences')).toBe('/app/notification-preferences');
  for (const path of ['/app/rooms/7/chat?wall=0', '/app/rooms/7/chat?wall=82&next=https://evil.test', '/app/rooms/7/chat?wall=../82']) expect(safeRoomReturn(path)).toBe('/app');
});

it('does not label entry responses as historical Chat replies', () => {
  const message = { reply_count: 10, entry: { id: 5 }, content: { type: 'doc', content: [{ type: 'file' }] } } as RoomMessage;
  expect(historicalReplyCount(message)).toBe(0);
  expect(historicalReplyCount({ ...message, entry: undefined })).toBe(10);
  expect(historicalReplyCount({ ...message, content: null })).toBe(10);
});
