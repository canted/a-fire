import { describe, expect, it, vi } from "vitest";
import { projectTimelineGroups, projectTimelineEntries, projectTimelineKey, projectCopyKey, projectCopies } from "../../frontend/src/lib/projectTimeline";
import { fetchProjectEntryPage, type ProjectEntry, type ProjectEntryPage } from "../../frontend/src/lib/api/projectEntries";

const entry = (id: number, intent: string): ProjectEntry => ({ id, intent, kind: "material", author: { id: 1, username: "Owner" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", content: { type: "doc", content: [] }, format: "mixed_media", can_edit: true, can_share: true, submissions: [] });
describe("Project timeline paging contract", () => {
  it("scopes copy pages to the selected source and suppresses retained copies on access errors", () => {
    const page = { submissions: [{ id: 9, room_id: 4, room_name: "Room", reply_count: 1 }], nextCursor: "next" };
    expect(projectCopyKey("7", "42", true, 1, page)).toEqual(["project", "7", "copies", "42", "next"]);
    expect(projectCopyKey("7", undefined, true, 0, null)).toBeNull();
    expect(projectCopyKey("7", "42", false, 0, null)).toBeNull();
    expect(projectCopies([page,page], true)).toHaveLength(1);
    expect(projectCopies([page], false)).toEqual([]);
  });
  it("scopes pages to Project and direct Entry and stops at the final page", () => {
    expect(projectTimelineKey("7", false, undefined, 0, null)).toBeNull();
    expect(projectTimelineKey("7", true, undefined, 0, null)).toEqual(["project", "7", "timeline", null, null]);
    expect(projectTimelineKey("7", true, "42", 1, { entries: [], nextCursor: "next" })).toEqual(["project", "7", "timeline", "42", "next"]);
    expect(projectTimelineKey("7", true, "42", 1, { entries: [], nextCursor: null })).toBeNull();
  });
  it("deduplicates page overlaps in stable order and hides retained data on loss of access", () => {
    const pages: ProjectEntryPage[] = [{ entries: [entry(1,"first"),entry(2,"old")], nextCursor: "next" }, { entries: [entry(2,"updated"),entry(3,"last")], nextCursor: null }];
    expect(projectTimelineEntries(pages,true).map(value => [value.id,value.intent])).toEqual([[1,"first"],[2,"updated"],[3,"last"]]);
    expect(projectTimelineEntries(pages,false)).toEqual([]);
  });
  it("passes cursor and direct Entry scope through the canonical API client", async () => {
    const get = vi.fn().mockResolvedValue({ entries: [], nextCursor: null });
    await fetchProjectEntryPage({ get }, 7, "cursor", "42");
    expect(get).toHaveBeenCalledWith("/v1/projects/7/entries?cursor=cursor&entry_id=42");
  });
});

it("places saved replies under their exact loaded share without losing unmatched feedback", () => {
  const source = { ...entry(1, "Source"), submissions: [{ id: 10, room_id: 7, room_name: "Studio", reply_count: 2 }] };
  const saved = { ...entry(2, "Saved"), kind: "feedback" as const, source_entry_id: 1, source_shared_entry_id: 10 };
  const otherShare = { ...saved, id: 3, source_shared_entry_id: 11 };
  const orphan = { ...saved, id: 4, source_entry_id: 99 };
  const groups = projectTimelineGroups([source, saved, otherShare, orphan]);
  expect(groups.map(group => group.entry.id)).toEqual([1, 3, 4]);
  expect(groups[0].savedReplies).toEqual([saved]);
  expect(projectTimelineGroups([saved])[0]).toEqual({ entry: saved, savedReplies: [] });
});
