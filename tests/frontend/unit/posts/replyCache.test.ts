import { normalizeFeedbackRequest } from "../../../../frontend/src/lib/feedback";
import { describe, expect, it } from "vitest";
import type { Reply } from "../../../../frontend/src/lib/api/entries";
import { mergeRepliesForCache, mergeReplyIntoPostResponse } from "../../../../frontend/src/lib/replyCache";

function reply(id: number, publishedAt: string, text = `reply-${id}`): Reply {
  return {
    id,
    published_at: publishedAt,
    created_at: publishedAt,
    user: { id, username: `user-${id}` },
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

describe("reply cache helpers", () => {
  it("adds missing remote and own replies in publication order", () => {
    const remoteReply = reply(2, "2026-01-01T00:02:00Z", "remote");
    const ownReply = reply(3, "2026-01-01T00:03:00Z", "own");

    const withRemote = mergeRepliesForCache([reply(1, "2026-01-01T00:01:00Z")], remoteReply);
    const withOwnReply = mergeRepliesForCache(withRemote.replies, ownReply);

    expect(withOwnReply.replies.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(withRemote.addedReplyIds).toEqual(["2"]);
    expect(withOwnReply.addedReplyIds).toEqual(["3"]);
  });

  it("replaces duplicate reply payloads without adding another row", () => {
    const existing = reply(2, "2026-01-01T00:02:00Z", "old");
    const incoming = reply(2, "2026-01-01T00:02:00Z", "new");

    const merged = mergeRepliesForCache([existing], incoming);

    expect(merged.addedReplyIds).toEqual([]);
    expect(merged.replies).toHaveLength(1);
    expect(merged.replies[0].content?.content?.[0]?.content?.[0]?.text).toBe("new");
  });

  it("sorts by published time, then numeric id", () => {
    const merged = mergeRepliesForCache(
      [reply(5, "2026-01-01T00:02:00Z"), reply(3, "2026-01-01T00:01:00Z")],
      [reply(4, "2026-01-01T00:02:00Z"), reply(2, "2026-01-01T00:00:00Z")],
    );

    expect(merged.replies.map((item) => item.id)).toEqual([2, 3, 4, 5]);
  });

  it("merges replies into a post response without dropping pagination", () => {
    const current: import("../../../../frontend/src/lib/api/entries").EntryShowResponse = {
      entry: { id: 10, status: "published", user: { id: 1, username: "ada" }, content: { type: "doc" }, format: "mixed_media", feedback_request: normalizeFeedbackRequest(), created_at: "2026-01-01T00:00:00Z" },
      replies: {
        data: [reply(1, "2026-01-01T00:01:00Z")],
        pagination: { page: 1, per_page: 20, next_page: null },
      },
    };

    const merged = mergeReplyIntoPostResponse(current, reply(2, "2026-01-01T00:02:00Z"));

    expect(merged.response?.replies.data.map((item) => item.id)).toEqual([1, 2]);
    expect(merged.response?.replies.pagination).toEqual(current.replies.pagination);
  });
});
