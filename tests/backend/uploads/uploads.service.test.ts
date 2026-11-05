import { createImmediateBlobLock } from "@tests/backend/helpers/image-lock";
import { withTestDependencies } from "@tests/backend/helpers/service";
import sharp from "sharp";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { vi } from "vitest";
import { UploadsService } from "@server/api/v1/uploads/uploads.service";

type PrismaMock = ReturnType<typeof mockPrisma>;

const mockPrisma = () => ({
  entry: { findUnique: vi.fn() },
  reply: { findUnique: vi.fn() },
  page: { findUnique: vi.fn() },
  roomMembership: { findFirst: vi.fn() },
  activeStorageBlob: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  activeStorageVariantRecord: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  activeStorageAttachment: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  videoAsset: { create: vi.fn() },
  room: { findUnique: vi.fn() },
  communityMemberships: {},
  board: { findUnique: vi.fn() },
  roomStructureArchive: { findUnique: vi.fn().mockResolvedValue(null) },
  square: { findUnique: vi.fn() },
});

const mockBoss = () => ({ enqueue: vi.fn() });
const mockStorage = () => ({
  put: vi.fn(),
  getBuffer: vi.fn(),
  getSignedUrl: vi.fn(),
  exists: vi.fn(),
  getStream: vi.fn(),
  getStreamIfExists: vi.fn(),
  getSize: vi.fn(),
  deleteMany: vi.fn(),
  delete: vi.fn(),
});

describe("UploadsService", () => {
  const makeService = (prisma: PrismaMock) => {
    return withTestDependencies(new UploadsService(), {
      prisma,
      boss: mockBoss(),
      storage: mockStorage(),
      images: { ensure: vi.fn(), purgeOrphan: vi.fn(), withBlobLock: createImmediateBlobLock(prisma) },
      circleAccess: { resolve: vi.fn(async (community_id, user_id) => await prisma.roomMembership.findFirst({ where: { room_id: community_id, user_id, disabled: false }, select: { id: true } }) ? { kind: "member", canWriteWall: true } : null), isCurrentPublishedPost: vi.fn() },
    });
  };

  const makeFile = (overrides: Partial<Express.Multer.File> = {}) =>
    ({
      originalname: "file.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("hi"),
      size: 2,
      ...overrides,
    }) as Express.Multer.File;

  const grantBlobAccess = (prisma: PrismaMock, userId = 1) => {
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_type: "User", record_id: userId, name: "avatar" }]);
  };

  it("revokes Note media on deletion before conditional responses or uploads", async () => {
    const prisma = mockPrisma(), service = makeService(prisma);
    prisma.page.findUnique.mockResolvedValue({ id: 12, room_id: 9, deleted_at: null });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 77, key: "note/image", filename: "note.png", content_type: "image/png", byte_size: 12 });
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_type: "Note", record_id: 12 }]);
    service.storage.exists.mockResolvedValue(true);
    service.storage.getStream.mockResolvedValue({ stream: {} });
    const result = await service.streamUpload(77, 1);
    if ("notModified" in result) throw new Error("Expected bytes");
    prisma.page.findUnique.mockResolvedValue({ id: 12, room_id: 9, deleted_at: new Date() });
    service.storage.exists.mockClear(); service.storage.getStream.mockClear();
    await expect(service.streamUpload(77, 1, undefined, result.etag)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createUpload(1, makeFile(), { note_id: 12 })).rejects.toBeInstanceOf(NotFoundException);
    expect(service.storage.exists).not.toHaveBeenCalled();
    expect(service.storage.getStream).not.toHaveBeenCalled();
    expect(service.storage.put).not.toHaveBeenCalled();
  });

  it.each([null, { kind: "visitor" }])("requires current Room membership for Note media (%s)", async access => {
    const prisma = mockPrisma(), service = makeService(prisma);
    prisma.page.findUnique.mockResolvedValue({ id: 12, room_id: 9, deleted_at: null });
    service.circleAccess.resolve.mockResolvedValue(access as never);
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 77, key: "note/image", content_type: "image/png", byte_size: 12 });
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_type: "Note", record_id: 12 }]);
    await expect(service.streamUpload(77, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createUpload(1, makeFile(), { note_id: 12 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.storage.exists).not.toHaveBeenCalled();
    expect(service.storage.put).not.toHaveBeenCalled();
  });

  it.each(["Post", "Reply"])("denies %s image bytes without current Room access", async recordType => {
    const prisma = mockPrisma(); const service = makeService(prisma);
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 1, key: "private/image", byte_size: 3, content_type: "image/png" });
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_type: recordType, record_id: 12 }]);
    const post = { id: 12, user_id: 1, status: "published", room_id: 8, source_entry_id: 9 };
    prisma.entry.findUnique.mockResolvedValue(post);
    prisma.reply.findUnique.mockResolvedValue({ id: 12, user_id: 1, status: "published", entry: post, chat_message: null });
    prisma.roomMembership.findFirst.mockResolvedValue(null);
    await expect(service.streamUpload(1, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(service.circleAccess.resolve).toHaveBeenCalledWith(8, 1);
    expect(service.storage.exists).not.toHaveBeenCalled(); expect(service.storage.getStream).not.toHaveBeenCalled();
  });

  it("rejects chat uploads before writing bytes, even with a second target", async () => {
    const service = makeService(mockPrisma());
    for (const target of [{ chat_message_id: 9 }, { chat_message_id: 9, entry_id: 1 }]) {
      await expect(service.createUpload(1, makeFile(), target)).rejects.toThrow("Chat supports text and links");
    }
    expect(service.storage.put).not.toHaveBeenCalled();
    expect(service.prisma.activeStorageBlob.create).not.toHaveBeenCalled();
  });

  it("keeps a private blob unreadable after an outsider tries to attach it to their avatar", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 77, key: "private" });
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ blob_id: 77, record_type: "Post", record_id: 8, name: "image" }]);
    prisma.entry.findUnique.mockResolvedValue({ id: 8, user_id: 11, status: "draft" });
    const service = makeService(prisma);
    await expect(service.streamUpload(77, 42)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.attachUpload(42, 77, { record_type: "User", record_id: 42, name: "avatar" })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.activeStorageAttachment.create).not.toHaveBeenCalled();
    expect(prisma.activeStorageAttachment.deleteMany).not.toHaveBeenCalled();
    await expect(service.streamUpload(77, 42)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("requires a file", async () => {
    const service = makeService(mockPrisma());
    await expect(service.createUpload(1, null as never, { entry_id: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates uploads for post targets", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 1, user_id: 1, room_id: 2, source_entry_id: 9, status: "draft" });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.activeStorageBlob.create.mockResolvedValue({
      id: 9,
      key: "uploads/abc",
      filename: "file.txt",
      content_type: "text/plain",
      byte_size: 2,
    });

    const service = makeService(prisma);
    const file = makeFile();
    const result = await service.createUpload(1, file, { entry_id: 1 }, { metadata: "{}" });

    expect(service.storage.put).toHaveBeenCalled();
    expect(result).toEqual({
      id: 9,
      key: "uploads/abc",
      filename: "file.txt",
      content_type: "text/plain",
      byte_size: 2,
    });
  });

  it("verifies access for page targets", async () => {
    const prisma = mockPrisma();
    prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: 9 });
    prisma.roomMembership.findFirst.mockResolvedValue(null);

    const service = makeService(prisma);
    const file = { originalname: "file.txt", mimetype: "text/plain", buffer: Buffer.from("hi"), size: 2 } as any;

    await expect(
      service.createUpload(1, file, { page_id: 1 }, { metadata: "{}" })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows page uploads when community membership exists", async () => {
    const prisma = mockPrisma();
    prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: 9 });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 5 });
    prisma.activeStorageBlob.create.mockResolvedValue({
      id: 9,
      key: "uploads/abc",
      filename: "file.txt",
      content_type: "text/plain",
      byte_size: 2,
    });

    const service = makeService(prisma);
    const file = makeFile();
    const result = await service.createUpload(1, file, { page_id: 1 }, { metadata: "{}" });
    expect(result.id).toBe(9);
  });

  it("allows legacy note_id uploads for page targets", async () => {
    const prisma = mockPrisma();
    prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: 9 });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 5 });
    prisma.activeStorageBlob.create.mockResolvedValue({
      id: 9,
      key: "uploads/abc",
      filename: "file.txt",
      content_type: "text/plain",
      byte_size: 2,
    });

    const service = makeService(prisma);
    const result = await service.createUpload(1, makeFile(), { note_id: 1 }, { metadata: "{}" });
    expect(result.id).toBe(9);
    expect(prisma.page.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("creates and enqueues video assets for supported video uploads", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 1, user_id: 1, room_id: 2, source_entry_id: 9, status: "draft" });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.activeStorageBlob.create.mockResolvedValue({
      id: 9,
      key: "uploads/abc",
      filename: "clip.mov",
      content_type: "video/quicktime",
      byte_size: 2,
    });
    prisma.videoAsset.create.mockResolvedValue({
      id: 44,
      title: "clip.mov",
      processing_status: "pending",
      duration_ms: null,
      width: null,
      height: null,
    });

    const service = makeService(prisma);
    const result = await service.createUpload(
      1,
      makeFile({ originalname: "clip.mov", mimetype: "video/quicktime" }),
      { entry_id: 1 },
      { metadata: "{}" },
    );

    expect(prisma.videoAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blob_id: 9,
          owner_id: 1,
          source_type: "Post",
          source_id: 1,
          original_mime_type: "video/quicktime",
          processing_status: "pending",
        }),
      }),
    );
    expect(service.boss.enqueue).toHaveBeenCalledWith("uploads.video", { videoAssetId: 44 }, { expireInMinutes: 60 });
    expect(result).toEqual(
      expect.objectContaining({
        video_asset: expect.objectContaining({
          id: 44,
          processing_status: "pending",
        }),
      }),
    );
  });

  it("rejects unsupported video formats", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 1, user_id: 1, room_id: 2, source_entry_id: 9, status: "draft" });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    const service = makeService(prisma);

    await expect(
      service.createUpload(1, makeFile({ mimetype: "video/x-msvideo" }), { entry_id: 1 }, { metadata: "{}" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enqueues image variants for posts", async () => {
    const prisma = mockPrisma();
    const service = makeService(prisma);

    await service.enqueuePostImageVariants({ id: 3, content_type: "image/png" }, { entry_id: 10 });

    expect(prisma.activeStorageVariantRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.activeStorageVariantRecord.create).not.toHaveBeenCalled();
    expect(service.boss.enqueue).toHaveBeenCalledTimes(1);
    expect(service.boss.enqueue).toHaveBeenCalledWith("uploads.variant", { blobId: 3, variationDigests: ["w320", "w600", "w1200"] });
  });

  it("skips variant enqueue for non-image", async () => {
    const prisma = mockPrisma();
    const service = makeService(prisma);

    await service.enqueuePostImageVariants({ id: 3, content_type: "text/plain" }, { entry_id: 10 });

    expect(prisma.activeStorageVariantRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.activeStorageVariantRecord.create).not.toHaveBeenCalled();
    expect(service.boss.enqueue).not.toHaveBeenCalled();
  });

  it("does not fail the upload when variant enqueueing fails", async () => {
    const prisma = mockPrisma();
    const service = makeService(prisma);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    service.boss.enqueue.mockRejectedValueOnce(new Error("queue down"));

    await expect(
      service.enqueuePostImageVariants({ id: 3, content_type: "image/png" }, { entry_id: 10 }),
    ).resolves.toBeUndefined();

    expect(prisma.activeStorageVariantRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.activeStorageVariantRecord.create).not.toHaveBeenCalled();
    expect(service.boss.enqueue).toHaveBeenCalledTimes(1);
    expect(service.boss.enqueue).toHaveBeenCalledWith("uploads.variant", { blobId: 3, variationDigests: ["w320", "w600", "w1200"] });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("reuses an existing variant record before queueing", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 1, key: "uploads/1", content_type: "image/png" });
    prisma.activeStorageVariantRecord.findFirst.mockResolvedValue({ id: 99 });
    grantBlobAccess(prisma);

    const service = makeService(prisma);
    const result = await service.requestVariant(1, "w600", 1);

    expect(prisma.activeStorageVariantRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.activeStorageVariantRecord.create).not.toHaveBeenCalled();
    expect(service.boss.enqueue).toHaveBeenCalledWith("uploads.variant", { blobId: 1, variationDigest: "w600" });
    expect(result).toEqual({ blobId: 1, variationDigest: "w600" });
  });

  it("attaches uploads and purges old blobs", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 5 });
    prisma.activeStorageAttachment.findMany
      .mockResolvedValueOnce([{ record_type: "User", record_id: 1, name: "avatar" }])
      .mockResolvedValueOnce([{ blob_id: 5 }, { blob_id: 7 }]);

    const service = makeService(prisma);
    const purgeSpy = vi.spyOn(service as any, "purgeOrphanedBlob").mockResolvedValue(undefined);

    service.storage.getBuffer.mockResolvedValue(await sharp({ create: { width: 8, height: 6, channels: 3, background: "red" } }).png().toBuffer());
    await service.attachUpload(1, 5, { record_type: "User", record_id: 1, name: "avatar" });

    expect(prisma.activeStorageAttachment.create).toHaveBeenCalled();
    expect(purgeSpy).toHaveBeenCalledWith(7);
  });

  it("throws when attaching missing blob", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue(null);
    const service = makeService(prisma);
    await expect(service.attachUpload(1, 5, { record_type: "User", record_id: 1, name: "avatar" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("attaches newly created blobs through the trusted internal path", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.create.mockResolvedValue({
      id: 11,
      key: "uploads/abc",
      filename: "file.txt",
      content_type: "text/plain",
      byte_size: 2,
    });
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 11 });

    const service = makeService(prisma);
    prisma.activeStorageAttachment.findMany.mockResolvedValue([]);

    const result = await service.createAttachmentUpload(1, makeFile({ buffer: await sharp({ create: { width: 8, height: 6, channels: 3, background: "red" } }).png().toBuffer() }), { record_type: "User", record_id: 1, name: "avatar" });

    expect(prisma.activeStorageAttachment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ blob_id: 11, record_type: "User", record_id: 1 }) });
    expect(result.id).toBe(11);
  });

  it("removes attachments and purges orphans", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ blob_id: 7 }, { blob_id: 8 }]);
    const service = makeService(prisma);
    const purgeSpy = vi.spyOn(service as any, "purgeOrphanedBlob").mockResolvedValue(undefined);

    await service.removeAttachment(1, { record_type: "User", record_id: 1, name: "avatar" });

    expect(prisma.activeStorageAttachment.deleteMany).toHaveBeenCalled();
    expect(purgeSpy).toHaveBeenCalledTimes(2);
  });

  it("requests variants with digest", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 1, key: "uploads/1", content_type: "image/png" });
    grantBlobAccess(prisma);

    const service = makeService(prisma);
    const result = await service.requestVariant(1, "w600", 1);

    expect(prisma.activeStorageVariantRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.activeStorageVariantRecord.create).not.toHaveBeenCalled();
    expect(service.boss.enqueue).toHaveBeenCalledWith("uploads.variant", { blobId: 1, variationDigest: "w600" });
    expect(result).toEqual({ blobId: 1, variationDigest: "w600" });
  });

  it("errors when variant digest missing", async () => {
    const service = makeService(mockPrisma());
    await expect(service.requestVariant(1, "", 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects unknown image variants", async () => {
    const service = makeService(mockPrisma());
    await expect(service.requestVariant(1, "unknown", 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("streams variant directly when stored", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({
      id: 1,
      key: "uploads/1",
      filename: "file.png",
      content_type: "image/png",
      byte_size: 12,
    });
    grantBlobAccess(prisma);

    const service = makeService(prisma);
    service.storage.exists.mockResolvedValue(true);
    service.storage.getStream.mockResolvedValue({ stream: {} });
    service.storage.getSize.mockResolvedValue(9);
    service.storage.getStreamIfExists.mockResolvedValue({ stream: {}, byteSize: 9 });

    const result = await service.streamVariant(1, "w600", 1);
    if ("notModified" in result) throw new Error("Expected upload bytes, received a conditional response");
    expect(result.filename).toBe("file.webp");
    expect(result.contentType).toBe("image/webp");
    expect(result.byteSize).toBe(9);
  });

  it("creates and streams the requested variant when background processing has not finished", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({
      id: 1,
      key: "uploads/1",
      filename: "file.png",
      content_type: "image/png",
      byte_size: 12,
    });
    grantBlobAccess(prisma);

    const service = makeService(prisma);
    service.storage.exists.mockResolvedValue(false);
    service.storage.getBuffer.mockResolvedValue(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAABgAAAAAqtMUzAAAAGElEQVQIHWNkYGD4D8Q4ARNOGajEYFAAAMaoAQsy1h4bAAAAAElFTkSuQmCC",
        "base64",
      ),
    );
    service.storage.getStream.mockResolvedValue({ stream: {} });
    service.storage.getSize.mockResolvedValue(9);
    service.storage.getStreamIfExists.mockResolvedValue({ stream: {}, byteSize: 9 });

    service.storage.getStreamIfExists.mockResolvedValueOnce(null);
    const result = await service.streamVariant(1, "w600", 1);
    expect(service.images.ensure).toHaveBeenCalledWith(1, ["w600"]);
    expect(result).toEqual({
      stream: {},
      filename: "file.webp",
      contentType: "image/webp",
      byteSize: 9,
      etag: expect.any(String),
    });
  });

  it("streams upload through the app when access is allowed", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({
      id: 1,
      key: "uploads/1",
      filename: "file.png",
      content_type: "image/png",
      byte_size: 12,
    });
    grantBlobAccess(prisma);

    const service = makeService(prisma);
    service.storage.exists.mockResolvedValue(true);
    service.storage.getStream.mockResolvedValue({ stream: {} });

    const result = await service.streamUpload(1, 1);

    if ("notModified" in result) throw new Error("Expected upload bytes, received a conditional response");
    expect(result.filename).toBe("file.png");
    expect(result.contentType).toBe("image/png");
  });

  it("denies orphaned blobs after ownership backfill is expected", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({
      id: 1,
      key: "uploads/1",
      filename: "file.png",
      content_type: "image/png",
      byte_size: 12,
    });
    prisma.activeStorageAttachment.findMany.mockResolvedValue([]);

    const service = makeService(prisma);

    await expect(service.streamUpload(1, 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("builds metadata from width/height input", async () => {
    const service = makeService(mockPrisma());
    const metadata = await (service as any).buildMetadata({ width: "10", height: "20" });
    expect(metadata).toBe(JSON.stringify({ width: 10, height: 20 }));
  });

  it("defaults metadata to empty object", async () => {
    const service = makeService(mockPrisma());
    const metadata = await (service as any).buildMetadata({});
    expect(metadata).toBe("{}");
  });

  it("rejects unsupported attachment types", async () => {
    const service = makeService(mockPrisma());
    await expect(
      (service as any).verifyAttachmentAccess(1, { record_type: "Unknown", record_id: 1, name: "avatar" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects invalid attachment names for posts", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 1, user_id: 1, room_id: 2, source_entry_id: 9, status: "draft" });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    const service = makeService(prisma);
    await expect(
      (service as any).verifyAttachmentAccess(1, { record_type: "Post", record_id: 1, name: "avatar" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects retired Board icon attachments even for Room owners", async () => {
    const prisma = mockPrisma();
    prisma.board.findUnique.mockResolvedValue({ id: 4, owner_id: 22, room_id: 3 });
    prisma.room.findUnique.mockResolvedValue({ id: 3, owner_id: 7 });
    const service = makeService(prisma);

    await expect(
      (service as any).verifyAttachmentAccess(7, { record_type: "Board", record_id: 4, name: "icon" }),
    ).rejects.toThrow("unsupported record_type");
  });

  it("rejects retired Square attachment writes", async () => {
    const service = makeService(mockPrisma());
    await expect((service as any).verifyAttachmentAccess(1, { record_type: "Square", record_id: 4, name: "border" })).rejects.toThrow("unsupported record_type");
  });

  it.each(["Board", "Square"])("denies legacy %s images without current Room access, including user 1", async record_type => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue({ id: 77, key: "retained", content_type: "image/png", byte_size: 12 });
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_type, record_id: 4, name: record_type === "Board" ? "icon" : "border" }]);
    prisma.board.findUnique.mockResolvedValue({ id: 4, owner_id: 1, room_id: 3 });
    prisma.square.findUnique.mockResolvedValue({ id: 4, user_id: 1, room_id: 3 });
    prisma.roomMembership.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);
    await expect(service.streamUpload(77, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(service.storage.exists).not.toHaveBeenCalled();
    expect(service.storage.getStream).not.toHaveBeenCalled();
  });

  it("throws when reply target missing", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue(null);
    const service = makeService(prisma);
    await expect((service as any).verifyAccess(1, { reply_id: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws when upload target is empty", async () => {
    const service = makeService(mockPrisma());
    await expect((service as any).verifyAccess(1, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws when blob missing", async () => {
    const prisma = mockPrisma();
    prisma.activeStorageBlob.findUnique.mockResolvedValue(null);

    const service = makeService(prisma);
    await expect(service.streamUpload(1, 1)).rejects.toBeInstanceOf(NotFoundException);
  });
});
