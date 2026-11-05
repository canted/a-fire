import { ApiClient } from "../../../../frontend/site/lib/api/client";
import { vi } from "vitest";
import { defaultTiptapDoc } from "../../../../frontend/src/lib/tiptap";
import {
  createNote,
  deleteNote,
  fetchNote,
  fetchNoteTree,
  insertNoteContentBlocksAfterAudio,
  prependNoteContentBlocks,
  saveNoteContent,
  updateNote,
} from "../../../../frontend/src/lib/api/notes";

const client = Object.assign(new ApiClient(), {
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
});

describe("notes api", () => {
  beforeEach(() => {
    client.get.mockReset();
    client.patch.mockReset();
    client.put.mockReset();
    client.post.mockReset();
    client.delete.mockReset();
  });

  it("fetches and normalizes a note payload", async () => {
    client.get.mockResolvedValueOnce({
      note: { id: 1, title: "Page", icon: null, parent_id: null, content: { default: defaultTiptapDoc } },
    });

    const page = await fetchNote(client, 1);

    expect(client.get).toHaveBeenCalledWith("/v2/notes/1");
    expect(page.content).toEqual(defaultTiptapDoc);
  });

  it("normalizes raw note content", async () => {
    client.get.mockResolvedValueOnce({
      id: 2,
      title: null,
      icon: "📄",
      parent_id: null,
      content: { type: "doc", content: [] },
    });

    const page = await fetchNote(client, 2);
    expect(page.content.type).toBe("doc");
  });

  it("updates and saves content", async () => {
    client.patch.mockResolvedValueOnce({ note: { id: 3, title: "Next", icon: null, parent_id: null, content: null } });
    client.put.mockResolvedValueOnce({ id: 3, title: "Next", icon: null, parent_id: null, content: { type: "doc", content: [] } });

    const updated = await updateNote(client, 3, { title: "Next" });
    const saved = await saveNoteContent(client, 3, { type: "doc", content: [] }, 7);

    expect(client.patch).toHaveBeenCalledWith("/v2/notes/3", { note: { title: "Next" } });
    expect(client.put).toHaveBeenCalledWith("/v2/notes/3/content", { content: { type: "doc", content: [] }, expected_version: 7 });
    expect(updated.content).toEqual(defaultTiptapDoc);
    expect(saved.content.type).toBe("doc");
  });

  it("prepends content blocks", async () => {
    const blocks = [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }];
    client.post.mockResolvedValueOnce({
      note: { id: 3, title: "Target", icon: null, parent_id: null, content: { type: "doc", content: blocks } },
    });

    const page = await prependNoteContentBlocks(client, 3, blocks);

    expect(client.post).toHaveBeenCalledWith("/v2/notes/3/content/blocks", { blocks, position: "top" });
    expect(page.content.content).toEqual(blocks);
  });

  it("inserts content blocks after an audio node", async () => {
    const blocks = [{ type: "paragraph", content: [{ type: "text", text: "Reply" }] }];
    client.post.mockResolvedValueOnce({
      note: { id: 3, title: "Target", icon: null, parent_id: null, content: { type: "doc", content: blocks } },
    });

    const page = await insertNoteContentBlocksAfterAudio(client, 3, {
      blocks,
      audioAssetId: 41,
      audioNodeId: "audio-node-1",
    });

    expect(client.post).toHaveBeenCalledWith("/v2/notes/3/content/blocks", {
      blocks,
      position: "after_audio",
      audio_asset_id: 41,
      audio_node_id: "audio-node-1",
    });
    expect(page.content.content).toEqual(blocks);
  });

  it("creates, deletes, and fetches tree", async () => {
    client.post.mockResolvedValueOnce({
      note: { id: 4, title: "New", icon: null, parent_id: null, content: defaultTiptapDoc },
    });
    client.delete.mockResolvedValueOnce(undefined);
    client.get.mockResolvedValueOnce({ room_id: 9, notes: [] });

    const created = await createNote(client, 9, "New", null);
    await deleteNote(client, 4);
    const tree = await fetchNoteTree(client, 9);

    expect(client.post).toHaveBeenCalledWith("/v2/notes", { room_id: 9, title: "New", parent_id: null });
    expect(client.delete).toHaveBeenCalledWith("/v2/notes/4");
    expect(client.get).toHaveBeenCalledWith("/v2/notes/tree?room_id=9");
    expect(created.id).toBe(4);
    expect(tree.room_id).toBe(9);
  });

  it("can request parent note-link insertion when creating a sub-note", async () => {
    client.post.mockResolvedValueOnce({
      note: { id: 5, title: null, icon: null, parent_id: 4, content: defaultTiptapDoc },
    });

    await createNote(client, 9, undefined, 4, { insertParentLink: true });

    expect(client.post).toHaveBeenCalledWith("/v2/notes", {
      room_id: 9,
      title: undefined,
      parent_id: 4,
      insert_parent_link: true,
    });
  });
});
