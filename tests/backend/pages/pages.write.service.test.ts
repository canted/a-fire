import { withTestDependencies } from "@tests/backend/helpers/service";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PagesWriteService } from "@server/api/v1/pages/pages.write.service";
import { vi } from "vitest";

const { capturePageCreatedMock } = vi.hoisted(() => ({
  capturePageCreatedMock: vi.fn(),
}));

vi.mock("@server/runtime/posthog", () => ({
  capturePageCreated: capturePageCreatedMock,
}));

const makePrisma = () => {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  roomMembership: { findFirst: vi.fn() },
  page: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  document: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  room: { findFirst: vi.fn() },
};
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  prisma.$queryRaw.mockImplementation(async (query, id) => query.join("").includes("FROM notes")
    ? [{ room_id: (await prisma.page.findUnique({ where: { id } }))?.room_id }]
    : [{ id }]);
  return prisma;
};

const makeRealtime = () => ({ emit: vi.fn(), noteRoom: vi.fn().mockReturnValue("room") });

describe("PagesWriteService", () => {
  beforeEach(() => {
    capturePageCreatedMock.mockClear();
  });

  const makeService = (
    prisma = makePrisma(),
    hocuspocus?: {
      prependPageContentBlocks?: ReturnType<typeof vi.fn>;
      insertPageContentBlocksAfterAudio?: ReturnType<typeof vi.fn>;
    },
  ) => {
    return withTestDependencies(new PagesWriteService(), {
      prisma,
      realtime: makeRealtime(),
      hocuspocus,
    });
  };

  it("requires community_id on create", async () => {
    const service = makeService();
    await expect(service.createPage(1, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it("forbids create when not a member", async () => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue(null);
    await expect(service.createPage(1, { room_id: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects invalid parent page", async () => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.page.findUnique.mockResolvedValue({ id: 2, room_id: 99 });

    await expect(service.createPage(1, { room_id: 1, parent_id: 2 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects deleted parent pages", async () => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.page.findUnique.mockResolvedValue({ id: 2, room_id: 1, deleted_at: new Date() });

    await expect(service.createPage(1, { room_id: 1, parent_id: 2 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("creates page and document", async () => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.page.create.mockResolvedValue({ id: 5, title: "T", icon: "I", room_id: 1, parent_id: null });
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, title: "T", icon: "I", room_id: 1, parent_id: null });
    service.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [] } });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    const result = await service.createPage(1, { room_id: 1, title: "T", icon: "I" });

    expect(service.prisma.document.create).toHaveBeenCalled();
    expect(capturePageCreatedMock).toHaveBeenCalledWith({
      userId: 1,
      roomId: 1,
      pageId: 5,
      source: "page_tree",
    });
    expect(result.page.id).toBe(5);
  });

  it("creates a sub-note and inserts a note-link block into the parent document when requested", async () => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.page.findUnique.mockImplementation(async ({ where }) => where.id === 2
      ? { id: 2, room_id: 1, deleted_at: null }
      : { id: 5, title: null, icon: null, room_id: 1, parent_id: 2, deleted_at: null });
    service.prisma.page.create.mockResolvedValue({ id: 5, title: null, icon: null, room_id: 1, parent_id: 2 });
    service.prisma.document.findFirst
      .mockResolvedValueOnce({
        id: 20,
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Parent" }] }] },
      })
      .mockResolvedValueOnce({ content: { type: "doc", content: [] }, version: 1 });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    const result = await service.createPage(1, { room_id: 1, parent_id: 2, insert_parent_link: true });

    expect(service.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 20 },
        data: expect.objectContaining({
          content: {
            type: "doc",
            content: [
              { type: "noteLink", attrs: { noteId: 5 } },
              { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
            ],
          },
          version: { increment: 1 },
        }),
      }),
    );
    expect(service.realtime.emit).toHaveBeenCalledWith(
      "NoteChannel",
      "room",
      expect.objectContaining({
        type: "content",
        page_id: 2,
        content: expect.objectContaining({
          content: expect.arrayContaining([expect.objectContaining({ type: "noteLink", attrs: { noteId: 5 } })]),
        }),
      }),
    );
    expect(result.page.id).toBe(5);
  });

  it("updates pages and emits", async () => {
    const service = makeService();
    service.prisma.page.findUnique
      .mockResolvedValueOnce({ id: 5, title: "T", icon: "I", room_id: 1 })
      .mockResolvedValueOnce({ id: 5, title: "New", icon: "I", room_id: 1 });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [] } });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    const result = await service.updatePage(5, 1, { title: "New" });

    expect(service.prisma.page.update).toHaveBeenCalled();
    expect(service.realtime.emit).toHaveBeenCalled();
    expect(result.page.title).toBe("New");
  });

  it("saves content by updating or creating docs", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, room_id: 1 });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.document.findFirst.mockResolvedValue({ id: 9, content: {} });
    service.prisma.page.findUnique.mockResolvedValueOnce({ id: 5, room_id: 1 });
    service.prisma.document.findFirst.mockResolvedValueOnce({ content: { type: "doc", content: [] } });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    const result = await service.saveContent(5, 1, { type: "doc" }, 0);

    expect(service.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: { increment: 1 } }),
      }),
    );
    expect(service.realtime.emit).toHaveBeenCalled();
    expect(result.page.id).toBe(5);
  });

  it("rejects browser-local media URLs before saving page content", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, room_id: 1 });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.document.findFirst.mockResolvedValue({ id: 9, content: {} });

    await expect(
      service.saveContent(5, 1, {
        type: "doc",
        content: [{ type: "image", attrs: { src: "blob:https://afire.app/local-page-image" } }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.prisma.document.update).not.toHaveBeenCalled();
    expect(service.realtime.emit).not.toHaveBeenCalled();
  });

  it("prepends blocks to page content and emits", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, title: "Target", icon: "T", room_id: 1, parent_id: null });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.document.findFirst
      .mockResolvedValueOnce({
        id: 9,
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Existing" }] }] },
      })
      .mockResolvedValueOnce({
        id: 9,
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Moved" }] },
            { type: "paragraph", content: [{ type: "text", text: "Existing" }] },
          ],
        },
      });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    const result = await service.prependContentBlocks(5, 1, {
      blocks: [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }],
      position: "top",
    });

    expect(service.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        data: expect.objectContaining({
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Moved" }] },
              { type: "paragraph", content: [{ type: "text", text: "Existing" }] },
            ],
          },
          version: { increment: 1 },
        }),
      }),
    );
    expect(service.realtime.emit).toHaveBeenCalledWith(
      "NoteChannel",
      "room",
      expect.objectContaining({
        type: "content",
        page_id: 5,
      }),
    );
    expect(result.page.id).toBe(5);
  });

  it("creates a page document when prepending blocks to a page without content", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, title: "Target", icon: "T", room_id: 1, parent_id: null });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.document.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }] },
    });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    await service.prependContentBlocks(5, 1, {
      blocks: [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }],
    });

    expect(service.prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          docable_type: "Note",
          docable_id: 5,
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }] },
        }),
      }),
    );
  });

  it("inserts blocks after a targeted page audio node", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, title: "Target", icon: "T", room_id: 1, parent_id: null });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.document.findFirst
      .mockResolvedValueOnce({
        id: 9,
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Before" }] },
            { type: "audio", attrs: { audioAssetId: 41, nodeId: "audio-node-1", status: "processing" } },
            { type: "paragraph", content: [{ type: "text", text: "After" }] },
          ],
        },
      })
      .mockResolvedValueOnce({
        id: 9,
        content: { type: "doc", content: [] },
      });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    await service.prependContentBlocks(5, 1, {
      blocks: [{ type: "paragraph", content: [{ type: "text", text: "Reply" }] }],
      position: "after_audio",
      audio_asset_id: 41,
      audio_node_id: "audio-node-1",
    });

    expect(service.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        data: expect.objectContaining({
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Before" }] },
              { type: "audio", attrs: { audioAssetId: 41, nodeId: "audio-node-1", status: "processing" } },
              { type: "paragraph", content: [{ type: "text", text: "Reply" }] },
              { type: "paragraph", content: [{ type: "text", text: "After" }] },
            ],
          },
          version: { increment: 1 },
        }),
      }),
    );
  });

  it("rejects after-audio insertion when the audio node is missing", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, title: "Target", icon: "T", room_id: 1, parent_id: null });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.document.findFirst.mockResolvedValueOnce({
      id: 9,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Existing" }] }] },
    });

    await expect(
      service.prependContentBlocks(5, 1, {
        blocks: [{ type: "paragraph", content: [{ type: "text", text: "Reply" }] }],
        position: "after_audio",
        audio_asset_id: 41,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("uses hocuspocus when prepending into an active collaborative page", async () => {
    const hocuspocus = {
      prependPageContentBlocks: vi.fn(async () => ({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }],
      })),
    };
    const service = makeService(undefined, hocuspocus);
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, title: "Target", icon: "T", room_id: 1, parent_id: null });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    service.prisma.document.findFirst.mockResolvedValue({
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }] },
    });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    await service.prependContentBlocks(5, 1, {
      blocks: [{ type: "paragraph", content: [{ type: "text", text: "Moved" }] }],
    });

    expect(hocuspocus.prependPageContentBlocks).toHaveBeenCalledWith(5, 1, [
      { type: "paragraph", content: [{ type: "text", text: "Moved" }] },
    ]);
    expect(service.prisma.document.update).not.toHaveBeenCalled();
    expect(service.prisma.document.create).not.toHaveBeenCalled();
  });

  it("rejects invalid block prepend payloads and non-members", async () => {
    const service = makeService();

    await expect(service.prependContentBlocks(5, 1, { blocks: [] })).rejects.toThrow("blocks must be a non-empty array");
    await expect(service.prependContentBlocks(5, 1, { blocks: [{ type: "doc" }] })).rejects.toThrow(
      "blocks must contain Tiptap block nodes",
    );

    service.prisma.page.findUnique.mockResolvedValue({ id: 5, room_id: 1 });
    service.prisma.roomMembership.findFirst.mockResolvedValue(null);

    await expect(
      service.prependContentBlocks(5, 1, { blocks: [{ type: "paragraph", content: [] }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("soft-deletes pages when owner", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, room_id: 1 });
    service.prisma.room.findFirst.mockResolvedValue({ id: 1 });

    await service.deletePage(5, 1);

    expect(service.prisma.page.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { deleted_at: expect.any(Date), updated_at: expect.any(Date) },
    });
    expect(service.prisma.page.delete).not.toHaveBeenCalled();
    expect(service.prisma.document.deleteMany).not.toHaveBeenCalled();
  });

  it("blocks delete when not owner", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 5, room_id: 1 });
    service.prisma.room.findFirst.mockResolvedValue(null);

    await expect(service.deletePage(5, 1)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
