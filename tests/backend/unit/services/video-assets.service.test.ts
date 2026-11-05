import { withTestDependencies } from "@tests/backend/helpers/service";
import { ForbiddenException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { VideoAssetsService } from "@server/api/v1/video-assets/video-assets.service"

function makePrisma(overrides: Partial<any> = {}) {
  return {
    videoAsset: {
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
    exists: vi.fn(),
    getStream: vi.fn(),
    getStreamIfExists: vi.fn(),
    getSize: vi.fn(),
    ...overrides,
  }
}

describe("VideoAssetsService", () => {
  it("rejects reply video assets when their parent post has been removed", async () => {
    const prisma = makePrisma()
    prisma.videoAsset.findUnique.mockResolvedValue({ id: 41, owner_id: 2, source_type: "Reply", source_id: 11 })
    prisma.reply.findUnique.mockResolvedValue({ id: 11, status: "published", entry_id: null })
    const service = withTestDependencies(new VideoAssetsService(), { prisma })

    await expect(service.getVideoAssetForUser(41, 7)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.entry.findUnique).not.toHaveBeenCalled()
  })

  it("returns page video assets for community members", async () => {
    const prisma = makePrisma()
    const storage = makeStorage()
    prisma.videoAsset.findUnique.mockResolvedValue({
      id: 41,
      owner_id: 2,
      source_type: "Page",
      source_id: 3,
      title: "Launch clip",
      processing_status: "ready",
      duration_ms: 1234,
      width: 1280,
      height: 720,
      error_message: null,
      blob: { id: 9, key: "uploads/video-41", filename: "launch.mp4", content_type: "video/mp4", byte_size: 99 },
    })
    prisma.page.findUnique.mockResolvedValue({ id: 3, room_id: 8 })
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 })

    const service = new VideoAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), isCurrentPublishedPost: vi.fn() }

    const result = await service.getVideoAssetForUser(41, 7)

    expect(result).toEqual(
      expect.objectContaining({
        id: 41,
        title: "Launch clip",
        processing_status: "ready",
        blob: expect.objectContaining({
          key: "uploads/video-41",
        }),
      }),
    )
  })

  it("rejects users who cannot access the source post", async () => {
    const prisma = makePrisma()
    const storage = makeStorage()
    prisma.videoAsset.findUnique.mockResolvedValue({
      id: 41,
      owner_id: 2,
      source_type: "Post",
      source_id: 12,
      title: "Launch clip",
      processing_status: "ready",
      blob: { id: 9, key: "uploads/video-41", filename: "launch.mp4", content_type: "video/mp4", byte_size: 99 },
    })
    prisma.entry.findUnique.mockResolvedValue({
      id: 12,
      user_id: 2,
      status: "published",
      room_id: 8,
      square: null,
    })
    prisma.roomMembership.findFirst.mockResolvedValue(null)

    const service = new VideoAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), isCurrentPublishedPost: vi.fn() }

    await expect(service.getVideoAssetForUser(41, 7)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("streams ready video assets with byte ranges", async () => {
    const stream = { pipe: vi.fn() }
    const prisma = makePrisma()
    const storage = makeStorage({
      exists: vi.fn(async () => true),
      getStream: vi.fn(async () => ({ stream })),
      getSize: vi.fn(async () => 1000),
    })
    prisma.videoAsset.findUnique.mockResolvedValue({
      id: 41,
      owner_id: 2,
      source_type: "Page",
      source_id: 3,
      title: "Launch clip",
      processing_status: "ready",
      blob: { id: 9, key: "uploads/video-41", filename: "launch.mp4", content_type: "video/mp4", byte_size: 99 },
    })
    prisma.page.findUnique.mockResolvedValue({ id: 3, room_id: 8 })
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 })

    const service = new VideoAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), isCurrentPublishedPost: vi.fn() }

    const result = await service.streamVideoAssetForUser(41, 7, "bytes=100-199")

    expect(storage.getStream).toHaveBeenCalledWith("uploads/video-41", { start: 100, end: 199, total: 1000 })
    expect(result).toEqual({
      stream,
      filename: "launch.mp4",
      contentType: "video/mp4",
      byteSize: 1000,
      range: { start: 100, end: 199, total: 1000 },
    })
  })

  it("returns poster URLs only when a ready poster exists", async () => {
    const prisma = makePrisma()
    const storage = makeStorage({
      exists: vi.fn(async () => true),
    })
    const service = new VideoAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), isCurrentPublishedPost: vi.fn() }

    await expect(
      service.getPosterUrlForAsset({
        id: 41,
        processing_status: "ready",
        blob: { key: "uploads/video-41" },
      }),
    ).resolves.toBe("/api/v1/video-assets/41/poster")
    expect(storage.exists).toHaveBeenCalledWith("uploads/video-41.poster.jpg")

    await expect(
      service.getPosterUrlForAsset({
        id: 41,
        processing_status: "processing",
        blob: { key: "uploads/video-41" },
      }),
    ).resolves.toBeNull()
  })

  it("streams ready poster thumbnails", async () => {
    const stream = { pipe: vi.fn() }
    const prisma = makePrisma()
    const storage = makeStorage({
      exists: vi.fn(async () => true),
      getStream: vi.fn(async () => ({ stream })),
      getSize: vi.fn(async () => 321),
      getStreamIfExists: vi.fn(async () => ({ stream, byteSize: 321 })),
    })
    prisma.videoAsset.findUnique.mockResolvedValue({
      id: 41,
      owner_id: 2,
      source_type: "Page",
      source_id: 3,
      title: "Launch clip",
      processing_status: "ready",
      blob: { id: 9, key: "uploads/video-41", filename: "launch.mp4", content_type: "video/mp4", byte_size: 99 },
    })
    prisma.page.findUnique.mockResolvedValue({ id: 3, room_id: 8 })
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 })

    const service = new VideoAssetsService()
    ;(service as any).prisma = prisma
    ;(service as any).storage = storage
    ;(service as any).circleAccess = { resolve: vi.fn().mockResolvedValue(null), isCurrentPublishedPost: vi.fn() }

    const result = await service.streamVideoPosterForUser(41, 7)

    expect(storage.exists).not.toHaveBeenCalled()
    expect(storage.getStreamIfExists).toHaveBeenCalledWith("uploads/video-41.poster.jpg")
    expect(result).toEqual({
      stream,
      filename: "launch.jpg",
      contentType: "image/jpeg",
      byteSize: 321,
      etag: expect.any(String),
    })
  })
})
