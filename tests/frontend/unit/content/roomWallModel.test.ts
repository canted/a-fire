import { expect, it } from "vitest";
import { roomWallMembers, roundResultMembers } from "../../../../frontend/src/features/rooms/wall/wallModel";
import type { RoomHome } from "../../../../frontend/src/lib/api/roomHome";
import type { WallDetail } from "../../../../frontend/src/lib/api/walls";
const content = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "Shared content" }] }] };
const result: WallDetail = {
  id: "1", roundId: "2", roomId: "3", title: "Round result", description: null, publishedAt: "2026-11-02", templateKey: "feedback",
  entries: [{ id: "a", entryId: "40", authorName: "Alice", authorAvatarUrl: null, available: true, content, format: "mixed_media", formatData: null, responseCount: 2, responseParticipants: [] },
    { id: "b", entryId: null, authorName: "Bob", authorAvatarUrl: null, available: false, content: null, format: "mixed_media", formatData: null, responseCount: 0, responseParticipants: [] }],
};
it("preserves every result position, including unavailable contributions, without live selection", () => {
  const members = roundResultMembers(result);
  expect(members.map(member => member.id)).toEqual(["a", "b"]);
  expect(members[1]).toEqual({ id: "b", name: "Bob", avatarUrl: null, available: false });
  expect(members[0].available && members[0].slots.map(slot => slot.entry.id)).toEqual(["40"]);
  const many = { ...result, entries: Array.from({ length: 7 }, (_, i) => ({ ...result.entries[0], id: String(i), entryId: String(i + 40) })) };
  expect(roundResultMembers(many)).toHaveLength(7);
});
it("never renders cached content for an unavailable result item", () => {
  const members = roundResultMembers({ ...result, entries: [{ ...result.entries[0], available: false }] });
  expect(members[0]).not.toHaveProperty("slots");
});
it("retains selected result content, shared context and response counts", () => {
  const shared = [{ source_reply_id: 5, source_shared_entry_id: 40, source_room_id: 3, source_author_id: 2, author_name: "Bob", content, format: "mixed_media" as const, format_data: null }];
  const members = roundResultMembers({ ...result, entries: [{ ...result.entries[0], room_statement: "My intent", shared_feedback: shared }] });
  const entry = members[0].available && members[0].slots[0].entry;
  expect(entry).toMatchObject({ id: "40", replyCount: 2, entry: { content, room_statement: "My intent", shared_feedback: shared } });
});
it("keeps empty live members and the existing limited context-slot policy", () => {
  const members: RoomHome["members"] = [{ membershipId: "10", userId: "1", username: "Alice", recentEntries: [
    { id: "40", createdAt: "2026-11-02", content, room_statement: "Current intent", replyCount: 1 },
    { id: "39", createdAt: "2026-11-01", content },
    { id: "38", createdAt: "2026-10-31", content },
  ] }, { membershipId: "11", userId: "2", username: "Bob", latestEntry: null }];
  const wall = roomWallMembers(members);
  expect(wall.map(member => member.id)).toEqual(["10", "11"]);
  expect(wall[0].available && wall[0].slots.map(slot => [slot.kind, slot.entry.id])).toEqual([["entry", "39"], ["statement", "40"], ["entry", "40"]]);
  expect(wall[1]).toMatchObject({ available: true, slots: [] });
});
it("renders a starred reply even when shared feedback snapshots are empty", () => {
  const wall = roomWallMembers([{ membershipId: "10", userId: "1", username: "Alice", recentEntries: [{
    id: "40", createdAt: "2026-11-02", content, shared_feedback: [],
    savedResponses: [{ id: "50", entryId: "40", author: "Bob", text: "Keep the pause", savedAt: "2026-11-03", sourceTitle: "Saved reply" }],
  }] }]);
  expect(wall[0].available && wall[0].slots.map(slot => slot.kind)).toEqual(["entry", "feedback"]);
});
