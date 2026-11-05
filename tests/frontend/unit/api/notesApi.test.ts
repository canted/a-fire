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
import { defaultTiptapDoc } from "../../../../frontend/src/lib/tiptap";

const client = {
  get: async (path: string) => {
    if (path.startsWith("/v2/notes/tree")) {
      return { room_id: 1, pages: [] };
    }
    return { page: { id: 1, title: "Title", icon: null, content: { type: "doc" } } };
  },
  patch: async () => ({ id: 2, title: "Updated", icon: null, content: { default: defaultTiptapDoc } }),
  put: async () => ({ id: 3, title: "Saved", icon: null, content: null }),
  post: async () => ({ id: 4, title: "Created", icon: null, content: { type: "doc" } }),
  delete: async () => undefined,
};

describe("notes api", () => {
  it("fetches and normalizes page", async () => {
    const page = await fetchNote(client as never, 1);
    expect(page.content.type).toBe("doc");
  });

  it("updates and saves content", async () => {
    const updated = await updateNote(client as never, 1, { title: "Updated" });
    expect(updated.title).toBe("Updated");
    expect(updated.content.type).toBe("doc");

    const saved = await saveNoteContent(client as never, 1, defaultTiptapDoc, 1);
    expect(saved.content.type).toBe("doc");
  });

  it("prepends content blocks", async () => {
    const page = await prependNoteContentBlocks(client as never, 1, [{ type: "paragraph", content: [] }]);
    expect(page.title).toBe("Created");
  });

  it("inserts content blocks after audio", async () => {
    const page = await insertNoteContentBlocksAfterAudio(client as never, 1, {
      blocks: [{ type: "paragraph", content: [] }],
      audioAssetId: 41,
      audioNodeId: "audio-node-1",
    });
    expect(page.title).toBe("Created");
  });

  it("creates and deletes pages", async () => {
    const created = await createNote(client as never, 1, "Title", null);
    expect(created.title).toBe("Created");

    await expect(deleteNote(client as never, 1)).resolves.toBeUndefined();
  });

  it("fetches page tree", async () => {
    const tree = await fetchNoteTree(client as never, 1);
    expect(tree.room_id).toBe(1);
  });
});
