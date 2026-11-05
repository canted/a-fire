import { ForbiddenException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { AudioAssetsService } from "@server/api/v1/audio-assets/audio-assets.service"

function makePrisma(overrides: Partial<any> = {}) {
  return {
    audioAsset: {
      findUnique: vi.fn(),
    },
    page: {
      findUnique: vi.fn(),
    },
    entry: {
      findUnique: vi.fn(),
    },
    reply: {
      findUnique: vi.fn(),
    },
    roomMembership: {
      findFirst: vi.fn(),
    },
    ...overrides,
  }
}

function makeStorage(overrides: Partial<any> = {}) {
  return {
    getSignedUrl: vi.fn(),
    exists: vi.fn(),
    getStream: vi.fn(),
    getSize: vi.fn(),
    ...overrides,
  }
}

describe("AudioAssetsService", () => {
  it("denies deleted Entry sources before audio metadata, bytes or spectrum access", async () => {
    const prisma = makePrisma(); const storage = makeStorage();
    prisma.audioAsset.findUnique.mockResolvedValue({ id: 41, owner_id: 2, source_type: "Post", source_id: 12, processing_status: "ready", blob: { key: "audio/41" } });
    prisma.entry.findUnique.mockResolvedValue({ id: 12, status: "deleted", room_id: 8 });
    const resolve = vi.fn().mockResolvedValue({ kind: "member" });
    const service = new AudioAssetsService(); Object.assign(service, { prisma, storage, circleAccess: { resolve } });
    await expect(service.getAudioAssetForUser(41, 2)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.streamAudioAssetForUser(41, 2)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getSpectrumForUser(41, 2)).rejects.toBeInstanceOf(NotFoundException);
    expect(resolve).not.toHaveBeenCalled();
    expect(storage.exists).not.toHaveBeenCalled(); expect(storage.getStream).not.toHaveBeenCalled();
  });

  it.each(["Post", "Note", "Unknown"])("does not let an uploader bypass %s authorization", async sourceType => {
    const prisma = makePrisma()
    const storage = makeStorage()
    prisma.audioAsset.findUnique.mockResolvedValue({ id: 41, owner_id: 2, source_type: sourceType, source_id: 12, processing_status: "ready", blob: { key: "audio/41" } })
    prisma.entry.findUnique.mockResolvedValue({ id: 12, status: "published", room_id: 8 })
    prisma.page.findUnique.mockResolvedValue({ id: 12, room_id: 8 })
    prisma.roomMembership.findFirst.mockResolvedValue(null)
    const service = new AudioAssetsService()
    Object.assign(service, { prisma, storage, circleAccess: { resolve: vi.fn().mockResolvedValue(null) } })
    await expect(service.getAudioAssetForUser(41, 2)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.streamAudioAssetForUser(41, 2)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.getSpectrumForUser(41, 2)).rejects.toBeInstanceOf(ForbiddenException)
    expect(storage.exists).not.toHaveBeenCalled()
    expect(storage.getStream).not.toHaveBeenCalled()
  })

  it("returns page audio assets for community members", async () => {
    const prisma = makePrisma()
    const storage = makeStorage()
    prisma.audioAsset.findUnique.mockResolvedValue({
      id: 41,
      owner_id: 2,
      source_type: "Page",
      source_id: 3,
      title: "Bridge idea",
      processing_status: "ready",
      duration_ms: 1234,
      waveform_peaks: [0.1, 0.3],
      error_message: null,
      blob: { id: 9, key: "uploads/audio-41", filename: "bridge.m4a", content_type: "audio/mp4", byte_size: 99 },
    })
    prisma.page.findUnique.mockResolvedValue({ id: 3, room_id: 8 })
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 })

    const service = new AudioAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), canReadPublishedPostWithRoomHistory: vi.fn() }

    const result = await service.getAudioAssetForUser(41, 7)

    expect(result).toEqual(
      expect.objectContaining({
        id: 41,
        title: "Bridge idea",
        processing_status: "ready",
        blob: expect.objectContaining({
          key: "uploads/audio-41",
        }),
      }),
    )
  })

  it("rejects users who cannot access the source post", async () => {
    const prisma = makePrisma()
    const storage = makeStorage()
    prisma.audioAsset.findUnique.mockResolvedValue({
      id: 41,
      owner_id: 2,
      source_type: "Post",
      source_id: 12,
      title: "Bridge idea",
      processing_status: "ready",
      blob: { id: 9, key: "uploads/audio-41", filename: "bridge.m4a", content_type: "audio/mp4", byte_size: 99 },
    })
    prisma.entry.findUnique.mockResolvedValue({
      id: 12,
      user_id: 2,
      status: "published",
      room_id: 8,
      square: null,
    })
    prisma.roomMembership.findFirst.mockResolvedValue(null)

    const service = new AudioAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), canReadPublishedPostWithRoomHistory: vi.fn() }

    await expect(service.getAudioAssetForUser(41, 7)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it.each([
    [{ status: "published", room_id: 8 }, true],
    [{ status: "draft", room_id: 8 }, false],
    [{ status: "published", project_id: 3, creation_origin: "project_material" }, false],
    [null, false],
  ])("exposes feedback availability from the canonical post policy (%j)", async (post, available) => {
    const prisma = makePrisma()
    prisma.entry.findUnique.mockResolvedValue(post)
    const service = new AudioAssetsService()
    ;(service as any).prisma = prisma
    await expect(service.getSourceContext({ source_type: "Post", source_id: 12 })).resolves.toMatchObject({ reply_available: available, source_type: "Post", source_id: 12 })
  })

  it("resolves reply audio source context to its parent post", async () => {
    const prisma = makePrisma()
    prisma.reply.findUnique.mockResolvedValue({ entry_id: 12 })

    const service = new AudioAssetsService()
    ;(service as any).prisma = prisma

    await expect(service.getSourceContext({ source_type: "Reply", source_id: 9 })).resolves.toEqual({
      source_type: "Reply",
      source_id: 9,
      parent_entry_id: 12,
      parent_chat_message_id: null,
      room_id: null,
    })
  })

  it("streams canonical audio for authorized viewers", async () => {
    const stream = { pipe: vi.fn() }
    const prisma = makePrisma()
    const storage = makeStorage({
      exists: vi.fn(async () => true),
      getStream: vi.fn(async () => ({ stream })),
      getSize: vi.fn(async () => 123),
    })
    prisma.audioAsset.findUnique.mockResolvedValue({
      id: 41,
      owner_id: 2,
      source_type: "Page",
      source_id: 3,
      title: "Bridge idea",
      processing_status: "ready",
      blob: { id: 9, key: "uploads/audio-41", filename: "bridge.m4a", content_type: "audio/mp4", byte_size: 99 },
    })
    prisma.page.findUnique.mockResolvedValue({ id: 3, room_id: 8 })
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 })

    const service = new AudioAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), canReadPublishedPostWithRoomHistory: vi.fn() }

    const result = await service.streamAudioAssetForUser(41, 7)

    expect(result).toEqual({
      stream,
      filename: "bridge.m4a",
      contentType: "audio/mp4",
      byteSize: 123,
    })
  })

  it("streams ready mp3 assets with their original filename and content type", async () => {
    const stream = { pipe: vi.fn() }
    const prisma = makePrisma()
    const storage = makeStorage({
      getSignedUrl: vi.fn(async () => null),
      exists: vi.fn(async () => true),
      getStream: vi.fn(async () => ({ stream })),
      getSize: vi.fn(async () => 123),
    })
    prisma.audioAsset.findUnique.mockResolvedValue({
      id: 41,
      owner_id: 2,
      source_type: "Page",
      source_id: 3,
      title: "Bridge idea",
      processing_status: "ready",
      blob: { id: 9, key: "uploads/audio-41", filename: "bridge.mp3", content_type: "audio/mpeg", byte_size: 99 },
    })
    prisma.page.findUnique.mockResolvedValue({ id: 3, room_id: 8 })
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 })

    const service = new AudioAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), canReadPublishedPostWithRoomHistory: vi.fn() }

    await expect(service.streamAudioAssetForUser(41, 7)).resolves.toEqual({
      stream,
      filename: "bridge.mp3",
      contentType: "audio/mpeg",
      byteSize: 123,
    })
  })
  it("does not let a published Chat audio uploader bypass revoked Room access", async () => {
    const prisma = makePrisma({ chatMessage: { findUnique: vi.fn().mockResolvedValue({ id: 9, status: "published", author_id: 2, room_id: 8 }) } })
    const storage = makeStorage()
    prisma.audioAsset.findUnique.mockResolvedValue({ id: 41, owner_id: 2, source_type: "ChatMessage", source_id: 9, processing_status: "ready", blob: { key: "audio/41" } })
    const service = new AudioAssetsService()
    Object.assign(service, { prisma, storage, circleAccess: { resolve: vi.fn().mockResolvedValue(null), canReadPublishedChatMessage: vi.fn().mockResolvedValue(false) } })
    await expect(service.streamAudioAssetForUser(41, 2)).rejects.toThrow(ForbiddenException)
    expect(storage.exists).not.toHaveBeenCalled()
    await expect(service.getSpectrumForUser(41, 2)).rejects.toThrow(ForbiddenException)
  })

  it("preserves the uploader's access to unpublished Chat draft audio", async () => {
    const prisma = makePrisma({ chatMessage: { findUnique: vi.fn().mockResolvedValue({ id: 9, status: "draft", author_id: 2, room_id: 8 }) } })
    const asset = { id: 41, owner_id: 2, source_type: "ChatMessage", source_id: 9, blob: { key: "audio/41" } }
    prisma.audioAsset.findUnique.mockResolvedValue(asset)
    const service = new AudioAssetsService()
    Object.assign(service, { prisma, circleAccess: { resolve: vi.fn().mockResolvedValue({ kind: "member" }) } })
    await expect(service.getAudioAssetForUser(41, 2)).resolves.toEqual(asset)
  })

})
