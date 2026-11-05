import { createImmediateBlobLock } from "@tests/backend/helpers/image-lock";
import sharp from "sharp"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"

function makePrisma(overrides: Partial<any>) {
  return {
    entry: { findUnique: async () => null },
    reply: { findUnique: async () => null },
    page: { findUnique: async () => null },
    roomMembership: { findFirst: async () => null },
    audioAsset: {
      create: async () => ({ id: 1, blob_id: 1, processing_status: "pending", title: "file.txt" }),
    },
    videoAsset: {
      create: async () => ({ id: 1, blob_id: 1, processing_status: "pending", title: "file.txt" }),
    },
    activeStorageBlob: {
      create: async () => ({ id: 1, key: "uploads/test", filename: "file.txt", content_type: "text/plain", byte_size: Number(4) }),
      findUnique: async () => null,
      delete: async () => null,
    },
    activeStorageAttachment: {
      create: async () => ({ id: 1 }),
      deleteMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
    },
    activeStorageVariantRecord: {
      findFirst: async () => null,
      create: async () => ({ id: 1 }),
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
    ...overrides,
  }
}

describe("UploadsService", () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
    delete process.env.UPLOADS_STORAGE_ROOT
  })

  it("stores a file and returns blob metadata for posts", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "uploads-"))
    process.env.UPLOADS_STORAGE_ROOT = tempDir
    const create = vi.fn(async (payload) => ({
      id: 9,
      key: payload.data.key,
      filename: payload.data.filename,
      content_type: payload.data.content_type,
      byte_size: payload.data.byte_size,
    }))

    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 12, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
      activeStorageBlob: { create },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    const result = await service.createUpload(
      7,
      {
        originalname: "example.txt",
        mimetype: "text/plain",
        size: 4,
        buffer: Buffer.from("test"),
      } as Express.Multer.File,
      { entry_id: 12 },
    )

    expect(result.id).toBe(9)
    expect(result.filename).toBe("example.txt")
    expect(create).toHaveBeenCalled()
  })

  it("creates an audio asset and queues audio processing for audio uploads", async () => {
    const enqueue = vi.fn()
    const createAudioAsset = vi.fn(async (payload) => ({
      id: 41,
      blob_id: payload.data.blob_id,
      processing_status: payload.data.processing_status,
      title: payload.data.title,
    }))
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 12, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
      audioAsset: { create: createAudioAsset },
      activeStorageBlob: {
        create: vi.fn(async (payload) => ({
          id: 9,
          key: payload.data.key,
          filename: payload.data.filename,
          content_type: payload.data.content_type,
          byte_size: payload.data.byte_size,
        })),
      },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    const result = await service.createUpload(
      7,
      {
        originalname: "bridge-demo.wav",
        mimetype: "audio/wav",
        size: 4,
        buffer: Buffer.from("test"),
      } as Express.Multer.File,
      { entry_id: 12 },
    )

    expect(createAudioAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blob_id: 9,
          owner_id: 7,
          source_type: "Post",
          source_id: 12,
          title: "bridge-demo.wav",
          processing_status: "pending",
        }),
      }),
    )
    expect(enqueue).toHaveBeenCalledWith("uploads.audio", { audioAssetId: 41 })
    expect(result).toEqual(
      expect.objectContaining({
        audio_asset: expect.objectContaining({
          id: 41,
          processing_status: "pending",
          title: "bridge-demo.wav",
        }),
      }),
    )
  })

  it("marks mp3 audio uploads ready immediately while still queueing metadata processing", async () => {
    const enqueue = vi.fn()
    const createAudioAsset = vi.fn(async (payload) => ({
      id: 41,
      blob_id: payload.data.blob_id,
      processing_status: payload.data.processing_status,
      title: payload.data.title,
    }))
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 12, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
      audioAsset: { create: createAudioAsset },
      activeStorageBlob: {
        create: vi.fn(async (payload) => ({
          id: 9,
          key: payload.data.key,
          filename: payload.data.filename,
          content_type: payload.data.content_type,
          byte_size: payload.data.byte_size,
        })),
      },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    const result = await service.createUpload(
      7,
      {
        originalname: "bridge-demo.mp3",
        mimetype: "audio/mpeg",
        size: 4,
        buffer: Buffer.from("test"),
      } as Express.Multer.File,
      { entry_id: 12 },
    )

    expect(createAudioAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_filename: "bridge-demo.mp3",
          original_mime_type: "audio/mpeg",
          processing_status: "ready",
        }),
      }),
    )
    expect(enqueue).toHaveBeenCalledWith("uploads.audio", { audioAssetId: 41 })
    expect(result).toEqual(
      expect.objectContaining({
        audio_asset: expect.objectContaining({
          id: 41,
          processing_status: "ready",
          title: "bridge-demo.mp3",
        }),
      }),
    )
  })

  it("marks m4a audio uploads ready immediately", async () => {
    const createAudioAsset = vi.fn(async (payload) => ({
      id: 42,
      blob_id: payload.data.blob_id,
      processing_status: payload.data.processing_status,
      title: payload.data.title,
    }))
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 12, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
      audioAsset: { create: createAudioAsset },
      activeStorageBlob: {
        create: vi.fn(async (payload) => ({
          id: 10,
          key: payload.data.key,
          filename: payload.data.filename,
          content_type: payload.data.content_type,
          byte_size: payload.data.byte_size,
        })),
      },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue: vi.fn() }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    await service.createUpload(
      7,
      {
        originalname: "bridge-demo.m4a",
        mimetype: "audio/x-m4a",
        size: 4,
        buffer: Buffer.from("test"),
      } as Express.Multer.File,
      { entry_id: 12 },
    )

    expect(createAudioAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_mime_type: "audio/x-m4a",
          processing_status: "ready",
        }),
      }),
    )
  })

  it.each([
    ["Quick recording.webm", "audio/webm;codecs=opus"],
    ["Quick recording.ogg", "audio/ogg"],
    ["Quick recording.opus", "audio/opus"],
  ])("accepts browser-recorded %s audio for processing", async (originalname, mimetype) => {
    const enqueue = vi.fn()
    const createAudioAsset = vi.fn(async (payload) => ({
      id: 43,
      blob_id: payload.data.blob_id,
      processing_status: payload.data.processing_status,
      title: payload.data.title,
    }))
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 12, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
      audioAsset: { create: createAudioAsset },
      activeStorageBlob: {
        create: vi.fn(async (payload) => ({
          id: 11,
          key: payload.data.key,
          filename: payload.data.filename,
          content_type: payload.data.content_type,
          byte_size: payload.data.byte_size,
        })),
      },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    await service.createUpload(
      7,
      {
        originalname,
        mimetype,
        size: 4,
        buffer: Buffer.from("test"),
      } as Express.Multer.File,
      { entry_id: 12 },
    )

    expect(createAudioAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_mime_type: mimetype,
          processing_status: "pending",
        }),
      }),
    )
    expect(enqueue).toHaveBeenCalledWith("uploads.audio", { audioAssetId: 43 })
  })

  it("creates a video asset and queues video processing for video uploads", async () => {
    const enqueue = vi.fn()
    const createVideoAsset = vi.fn(async (payload) => ({
      id: 44,
      blob_id: payload.data.blob_id,
      processing_status: payload.data.processing_status,
      title: payload.data.title,
      duration_ms: payload.data.duration_ms,
      width: payload.data.width,
      height: payload.data.height,
    }))
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 12, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
      videoAsset: { create: createVideoAsset },
      activeStorageBlob: {
        create: vi.fn(async (payload) => ({
          id: 9,
          key: payload.data.key,
          filename: payload.data.filename,
          content_type: payload.data.content_type,
          byte_size: payload.data.byte_size,
        })),
      },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    const result = await service.createUpload(
      7,
      {
        originalname: "launch.mov",
        mimetype: "video/quicktime",
        size: 4,
        buffer: Buffer.from("test"),
      } as Express.Multer.File,
      { entry_id: 12 },
      { metadata: JSON.stringify({ width: 1920, height: 1080 }) },
    )

    expect(createVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blob_id: 9,
          owner_id: 7,
          source_type: "Post",
          source_id: 12,
          title: "launch.mov",
          original_mime_type: "video/quicktime",
          processing_status: "pending",
          width: 1920,
          height: 1080,
        }),
      }),
    )
    expect(enqueue).toHaveBeenCalledWith("uploads.video", { videoAssetId: 44 }, { expireInMinutes: 60 })
    expect(result).toEqual(
      expect.objectContaining({
        video_asset: expect.objectContaining({
          id: 44,
          processing_status: "pending",
          title: "launch.mov",
          width: 1920,
          height: 1080,
        }),
      }),
    )
  })

  it("rejects unsupported audio formats", async () => {
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 12, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue: vi.fn() }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    await expect(
      service.createUpload(
        7,
        {
          originalname: "loop.wma",
          mimetype: "audio/x-ms-wma",
          size: 4,
          buffer: Buffer.from("test"),
        } as Express.Multer.File,
        { entry_id: 12 },
      ),
    ).rejects.toThrow("unsupported audio format")
  })

  it("requires a target id", async () => {
    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = makePrisma({})
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    await expect(
      service.createUpload(
        1,
        {
          originalname: "example.txt",
          mimetype: "text/plain",
          size: 4,
          buffer: Buffer.from("test"),
        } as Express.Multer.File,
        {},
      ),
    ).rejects.toThrow("entry_id or reply_id or page_id or chat_message_id is required")
  })

  it("extracts image metadata when missing", async () => {
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 12, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
      activeStorageBlob: {
        create: vi.fn(async (payload) => payload.data),
      },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).storage = { put: async () => {} }

    await service.createUpload(
      7,
      {
        originalname: "example.webp",
        mimetype: "image/webp",
        size: 4,
        buffer: await sharp({ create: { width: 240, height: 320, channels: 3, background: "red" } }).webp().toBuffer(),
      } as Express.Multer.File,
      { entry_id: 12 },
    )

    expect(prisma.activeStorageBlob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: JSON.stringify({ contentType: "image/webp", width: 240, height: 320, frames: 1 }),
        }),
      }),
    )
  })

  it("attaches a blob to a post", async () => {
    const prisma = makePrisma({
      activeStorageBlob: { findUnique: async () => ({ id: 10, content_type: "image/png" }) },
      entry: { findUnique: async () => ({ id: 2, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
      activeStorageAttachment: {
        findMany: async ({ where }: { where: { blob_id?: number } }) => where.blob_id ? [{ record_type: "Post", record_id: 2, name: "image" }] : [],
        deleteMany: async () => ({ count: 1 }),
        create: async () => ({ id: 22 }),
        count: async () => 0,
      },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue: async () => {} }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    const result = await service.attachUpload(7, 10, { record_type: "Post", record_id: 2, name: "image" })
    expect(result.blob_id).toBe(10)
  })

  it("purges orphaned blobs when attachments are replaced", async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }))
    const deleteBlob = vi.fn(async () => null)
    const storageDeleteMany = vi.fn(async () => {})
    const storageDelete = vi.fn(async () => {})

    const prisma = makePrisma({
      activeStorageBlob: {
        findUnique: vi.fn(async (args) => {
          if (args.where.id === 10) return { id: 10 }
          return { id: 99, key: "uploads/old-blob" }
        }),
        delete: deleteBlob,
      },
      activeStorageAttachment: {
        findMany: async ({ where }: { where: { blob_id?: number } }) => where.blob_id ? [{ record_type: "Post", record_id: 2, name: "image" }] : [{ blob_id: 99 }],
        deleteMany: async () => ({ count: 1 }),
        create: async () => ({ id: 22 }),
        count: async () => 0,
      },
      activeStorageVariantRecord: {
        findMany: async () => [{ variation_digest: "w1200" }],
        deleteMany,
      },
      entry: { findUnique: async () => ({ id: 2, user_id: 7, room_id: 2, source_entry_id: 9, status: "draft" }) },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue: async () => {} }
    ;(service as any).storage = { put: async () => {}, deleteMany: storageDeleteMany, delete: storageDelete }

    const images = new ImageVariantsService()
    const transaction = { ...prisma, $executeRaw: async () => {}, $queryRaw: async () => [] }
    Object.assign(images, {
      prisma: { $transaction: async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction) },
      storage: (service as any).storage,
    })
    ;(service as any).images = images
    await service.attachUpload(7, 10, { record_type: "Post", record_id: 2, name: "image" })

    expect(storageDeleteMany).toHaveBeenCalledWith(expect.arrayContaining(["variants/uploads/old-blob/w1200.webp", "variants/uploads/old-blob/v2/w320.webp"]))
    expect(storageDelete).toHaveBeenCalledWith("uploads/old-blob")
    expect(deleteMany).toHaveBeenCalledWith({ where: { blob_id: 99 } })
    expect(deleteBlob).toHaveBeenCalledWith({ where: { id: 99 } })
  })

  it("queues a variant request", async () => {
    const enqueue = vi.fn()
    const findFirst = vi.fn(async () => null)
    const create = vi.fn(async () => ({ id: 1 }))
    const prisma = makePrisma({
      activeStorageBlob: { findUnique: async () => ({ id: 10, content_type: "image/png" }) },
      activeStorageAttachment: {
        findMany: async () => [{ record_type: "User", record_id: 7, name: "avatar" }],
      },
      activeStorageVariantRecord: { findFirst, create },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    const result = await service.requestVariant(10, "w600", 7)
    expect(result.blobId).toBe(10)
    expect(findFirst).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith("uploads.variant", { blobId: 10, variationDigest: "w600" })
  })

  it("queues post image variants for uploads", async () => {
    const enqueue = vi.fn()
    const findFirst = vi.fn(async () => null)
    const create = vi.fn(async () => ({ id: 1 }))
    const prisma = makePrisma({
      activeStorageVariantRecord: { findFirst, create },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    await service.enqueuePostImageVariants({ id: 42, content_type: "image/png" }, { entry_id: 9 })

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith("uploads.variant", { blobId: 42, variationDigests: ["w320", "w600", "w1200"] })
    expect(findFirst).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("does not recreate a variant record when one already exists", async () => {
    const enqueue = vi.fn()
    const findFirst = vi.fn(async () => ({ id: 5 }))
    const create = vi.fn()
    const prisma = makePrisma({
      activeStorageBlob: { findUnique: async () => ({ id: 10, content_type: "image/png" }) },
      activeStorageAttachment: {
        findMany: async () => [{ record_type: "User", record_id: 7, name: "avatar" }],
      },
      activeStorageVariantRecord: { findFirst, create },
    })

    const service = new UploadsService()
    Object.assign(service, { circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) } })
    ;(service as any).prisma = prisma
    ;(service as any).images = { withBlobLock: createImmediateBlobLock(prisma) }
    ;(service as any).boss = { enqueue }
    ;(service as any).storage = { put: async () => {}, deleteMany: async () => {}, delete: async () => {} }

    await service.requestVariant(10, "w600", 7)

    expect(create).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith("uploads.variant", { blobId: 10, variationDigest: "w600" })
  })
})
