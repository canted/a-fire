import { expect, it, vi } from "vitest";
import { saveEntryContent } from "../../../../frontend/src/lib/api/entryDraft";

it("sends the editor-supplied revision and returns the committed revision", async () => {
  const content = { type: "doc" as const, content: [] };
  const put = vi.fn().mockResolvedValue({ id: 42, revision: 101, content });
  const client = { put, get: vi.fn(), post: vi.fn(), patch: vi.fn() };
  const result = await saveEntryContent(client, 42, content, undefined, undefined, undefined, "mixed_media", {}, 100);
  expect(put).toHaveBeenCalledWith("/v1/entries/42/content", expect.objectContaining({ content, expected_revision: 100 }));
  expect(result.revision).toBe(101);
});
