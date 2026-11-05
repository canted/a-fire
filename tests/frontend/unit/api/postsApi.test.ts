import { createReply, createReflection, deleteReflection, fetchEntry, fetchEntries, fetchReplies, normalizeReflections, publishReply, updateReply } from "../../../../frontend/src/lib/api/entries";

const client = {
  get: async (path: string) => {
    if (path.includes("/replies?page=")) {
      return { data: [{ id: 1, reflections: [{ page_id: 2 }] }], pagination: { page: 1, per_page: 1, next_page: null } };
    }
    if (path.startsWith("/v1/entries/")) {
      return {
        entry: { id: 1, content: { type: "doc" }, reflections: [{ page_id: 1, count: 2 }] },
        replies: { data: [{ id: 1, reflections: [{ page_id: 2 }] }], pagination: { page: 1, per_page: 1, next_page: null } },
      };
    }
    return [{ id: "1", title: "t", boardId: "b" }];
  },
  post: async (_path: string, _payload?: unknown) => ({ id: 1, reflections: [{ page_id: 3 }] }),
  patch: async (_path: string, _payload?: unknown) => ({ id: 1, reflections: [{ page_id: 4 }] }),
  delete: async (_path: string) => ({ reflections: [{ page_id: 5 }] }),
};

describe("posts api", () => {
  it("fetches posts with or without board", async () => {
    const all = await fetchEntries(client as never);
    expect(all.length).toBe(1);

    const board = await fetchEntries(client as never, "b1");
    expect(board.length).toBe(1);
  });

  it("normalizes post show response", async () => {
    const response = await fetchEntry(client as never, "1");
    expect(response.entry.reflections?.[0].pageId).toBe(1);
    expect(response.replies.data[0].reflections?.[0].pageId).toBe(2);
  });

  it("normalizes replies on fetch", async () => {
    const response = await fetchReplies(client as never, "1", 1);
    expect(response.data[0].reflections?.[0].pageId).toBe(2);
  });

  it("handles reply mutations", async () => {
    const created = await createReply(client as never, "1", { content: { type: "doc" } });
    expect(created.reflections?.[0].pageId).toBe(3);

    const updated = await updateReply(client as never, "1", 2, { content: { type: "doc" } });
    expect(updated.reflections?.[0].pageId).toBe(4);

    const published = await publishReply(client as never, "1", 3, {});
    expect(published.reflections?.[0].pageId).toBe(3);
  });

  it("creates and deletes reflections", async () => {
    const created = await createReflection(client as never, { type: "post", id: 1 }, 9);
    expect(created[0].pageId).toBe(3);

    const deleted = await deleteReflection(client as never, { type: "reply", id: 2 }, 9);
    expect(deleted[0].pageId).toBe(5);
  });

  it("normalizes reflection payloads", () => {
    const result = normalizeReflections([{ page_id: 1, page_title: "A", count: "2", mine: "true" }, null]);
    expect(result[0].pageId).toBe(1);
    expect(result[0].count).toBe(2);
  });
});
