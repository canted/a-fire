import { expect, it, vi } from 'vitest';
import { fetchMemberProfile } from "../../../../frontend/src/lib/api/members";
import { introductionContext } from '../../../../frontend/src/lib/introductionPresentation';
import { safeRoomReturn } from '../../../../frontend/src/lib/roomLinks';
import type { IntroductionSummary } from '../../../../frontend/src/lib/api/introductions';
it('retains viewer-specific introduction wording', () => {
  const item = { createdBy: { id: '1', displayUsername: 'Alice' }, participants: [{ id: '2', displayUsername: 'Bea' }, { id: '3', displayUsername: 'Cal' }] } as IntroductionSummary;
  expect(introductionContext(item, 1)).toBe('You introduced Bea to Cal');
  expect(introductionContext(item, 2)).toBe('Alice introduced you to Cal');
  expect(introductionContext(item, 4)).toBe('Alice introduced Bea to Cal');
});
it('rejects retired Square and introduction return destinations', () => {
  for (const path of ['/app/square/42', '/app/square/42/introductions', '/app/square/42/introductions?introduction=7']) expect(safeRoomReturn(path)).toBe('/app');
  for (const path of ['/app/square/0', '/app/square/42/introductions?redirect=https://example.com', '/app/square/42/introductions?introduction=7&introduction=8']) expect(safeRoomReturn(path)).toBe('/app');
});

it('rejects retired typed composer links', () => {
  for (const path of ['/app/square/42/new-post', '/app/square/42/new-post/audio?origin=chat', '/app/square/42/new-post/text?activityId=7']) expect(safeRoomReturn(path)).toBe('/app');
  for (const path of ['/app/square/42/new-post/audio?origin=admin', '/app/square/42/new-post?activityId=7&activityId=8', '/app/square/42/new-post?next=https://example.com']) expect(safeRoomReturn(path)).toBe('/app');
});

it('loads Room/member profiles without allocating or resolving a Square', async () => {
  const get = vi.fn().mockResolvedValue({ entries: [] });
  await fetchMemberProfile({ get }, { roomId: '9', memberUserId: '42' }, 2);
  expect(get).toHaveBeenLastCalledWith('/v1/rooms/9/members/42/entries?page=2');
  await fetchMemberProfile({ get }, { roomId: '9', memberUserId: '42' }, 'after:17');
  expect(get).toHaveBeenLastCalledWith('/v1/rooms/9/members/42/entries?cursor=after%3A17');
});
it('preserves exact Room/member destinations across sign-in', () => {
  for (const path of ['/app/rooms/9/members/42', '/app/rooms/9/members/42/introductions', '/app/rooms/9/members/42/introductions?introduction=7']) expect(safeRoomReturn(path)).toBe(path);
  for (const path of ['/app/rooms/0/members/42', '/app/rooms/9/members/0', '/app/rooms/9/members/42?redirect=https://example.com', '/app/rooms/9/members/42/introductions?introduction=7&introduction=8']) expect(safeRoomReturn(path)).toBe('/app');
});
