// @vitest-environment node
import "reflect-metadata"
import { Controller, Inject, Module, Post, UploadedFile, UseInterceptors } from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { NestFactory } from "@nestjs/core"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { UploadsController } from "@server/api/v1/uploads/uploads.controller"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { VideoAssetsController } from "@server/api/v1/video-assets/video-assets.controller"
import { VideoAssetsService } from "@server/api/v1/video-assets/video-assets.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { NotificationActivityService } from "@server/notifications/notification-activity.service"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { StorageService } from "@server/storage/storage.service"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { IMAGE_MULTIPART_OPTIONS, IMAGE_UPLOAD_MAX_BYTES } from "@server/uploads/images/image-policy"

type BlobRow = {
  id: number
  key: string
  filename: string
  content_type: string
  byte_size: number
  metadata?: string
}
type AttachmentRow = { blob_id: number; record_type: string; record_id: number; name: string }

@Controller("test-image-upload")
class ImageUploadController {
  @Inject(UploadsService) uploads!: UploadsService
  @Post()
  @UseInterceptors(FileInterceptor("file", IMAGE_MULTIPART_OPTIONS))
  create(@UploadedFile() file: Express.Multer.File) {
    return this.uploads.createAttachmentUpload(7, file, { record_type: "User", record_id: 7, name: "avatar" })
  }
}

describe("image delivery over real HTTP", () => {
  it("enforces byte validation, responsive variants, member/visitor access, conditional requests, and revocation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "afire-image-http-"))
    const storage = new StorageService()
    Object.assign(storage, { localRoot: root, useS3: false })
    const jpeg = await sharp({ create: { width: 800, height: 400, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    let admitted = true, current = true, leaseActive = true
    const blobs = new Map<number, BlobRow>([[1, { id: 1, key: "uploads/source", filename: "image.jpg", content_type: "image/jpeg", byte_size: jpeg.length }]])
    const attachments: AttachmentRow[] = [{ blob_id: 1, record_type: "Post", record_id: 10, name: "image" }]
    const prisma = {
      $executeRaw: vi.fn(), $queryRaw: vi.fn(async () => [{ id: current ? 10 : 11 }]), $transaction: vi.fn(),
      activeStorageBlob: {
        findUnique: async ({ where }: { where: { id: number } }) => blobs.get(where.id),
        create: async ({ data }: { data: Omit<BlobRow, "id"> }) => { const row = { id: blobs.size + 1, ...data }; blobs.set(row.id, row); return row },
        update: async ({ where, data }: { where: { id: number }; data: Partial<BlobRow> }) => {
          const blob = blobs.get(where.id)
          if (!blob) throw new Error("Cannot update a missing fixture blob")
          return Object.assign(blob, data)
        },
      },
      activeStorageAttachment: {
        findMany: async ({ where }: { where: Partial<AttachmentRow> }) => attachments.filter(row => where.blob_id ? row.blob_id === where.blob_id : row.record_type === where.record_type && row.record_id === where.record_id && row.name === where.name),
        findFirst: async () => null, create: async ({ data }: { data: AttachmentRow }) => { attachments.push(data); return data }, deleteMany: async () => {},
      },
      activeStorageVariantRecord: { findFirst: async () => null, create: vi.fn() },
      room: { findUnique: async () => ({ id: 3, owner_id: 7, porosity: "closed" }) },
      roomMembership: { findFirst: async ({ where }: { where: { user_id: number } }) => where.user_id === 7 ? { id: 1 } : null },
      roomVisit: { findFirst: async () => admitted && leaseActive ? { source: "knock" } : null },
      roomKnock: { findUnique: async () => admitted ? { status: "admitted" } : null },
      roomMemberInvitation: { findUnique: async () => null },
      entry: { findFirst: async () => ({ id: current ? 10 : 11 }), findUnique: async () => ({ id: 10, user_id: 7, room_id: 3, status: "published", square_id: 4, square: { user_id: 7, current_entry_id: current ? 10 : 11 } }) },
      square: { findUnique: async () => ({ user_id: 7, room_id: 3 }) },
      chatMessage: { findUnique: async () => null, findFirst: async () => null },
      videoAsset: { findUnique: async () => ({ id: 5, owner_id: 7, source_type: "Post", source_id: 10, processing_status: "ready", blob: { key: "uploads/video", filename: "video.mp4" } }) },
    }
    prisma.$transaction.mockImplementation(async (operation: (transaction: typeof prisma) => Promise<unknown>) => operation(prisma))
    class TestModule {}
    Module({ controllers: [UploadsController, VideoAssetsController, ImageUploadController], providers: [
      UploadsService, VideoAssetsService, RoomAccessService, ImageVariantsService,
      { provide: PrismaService, useValue: prisma }, { provide: StorageService, useValue: storage },
      { provide: BossService, useValue: { enqueue: vi.fn() } },
      { provide: AuthService, useValue: { verifyAccessToken: (token: string) => ({ userId: Number(token) }) } },
      { provide: NotificationActivityService, useValue: { recordActivity: async () => {} } },
    ] })(TestModule)
    const app = await NestFactory.create(TestModule, { logger: false, abortOnError: false })
    try {
      await storage.put("uploads/source", jpeg)
      await storage.put("uploads/video.poster.jpg", jpeg)
      await app.listen(0, "127.0.0.1")
      const base = await app.getUrl()
      const get = (url: string, user = 8, etag?: string) => fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${user}`, ...(etag ? { "If-None-Match": etag } : {}) } })
      const url = "/api/v1/uploads/1/variants/w320"
      const first = await get(url)
      expect(first.status).toBe(200)
      expect(first.headers.get("cache-control")).toBe("private, no-cache, must-revalidate")
      expect(first.headers.get("content-type")).toBe("image/webp")
      expect(await sharp(Buffer.from(await first.arrayBuffer())).metadata()).toMatchObject({ width: 320, height: 640 })
      const etag = first.headers.get("etag")!
      const read = vi.spyOn(storage, "getStreamIfExists")
      const cached = await get(url, 8, etag)
      expect(cached.status).toBe(304)
      expect(await cached.text()).toBe("")
      expect(read).not.toHaveBeenCalled()
      current = false
      expect((await get(url, 8, etag)).status).toBe(404)
      expect((await get(url, 7, etag)).status).toBe(304)
      current = true
      const poster = await get("/api/v1/video-assets/5/poster")
      expect(poster.status).toBe(200)
      await poster.arrayBuffer()
      const posterTag = poster.headers.get("etag")!
      expect((await get("/api/v1/video-assets/5/poster", 8, posterTag)).status).toBe(304)
      leaseActive = false
      expect((await get(url, 8, etag)).status).toBe(404)
      expect((await get("/api/v1/video-assets/5/poster", 8, posterTag)).status).toBe(403)
      leaseActive = true
      admitted = false
      expect((await get(url, 8, etag)).status).toBe(404)
      expect((await get("/api/v1/video-assets/5/poster", 8, posterTag)).status).toBe(403)
      expect((await fetch(`${base}${url}`)).status).toBe(401)

      const upload = (buffer: Uint8Array, type: string) => {
        const form = new FormData(); form.append("file", new Blob([new Uint8Array(buffer)], { type }), "fixture.png")
        return fetch(`${base}/test-image-upload`, { method: "POST", body: form })
      }
      expect((await upload(Buffer.from("<html>active</html>"), "image/png")).status).toBe(400)
      expect((await upload(new Uint8Array(IMAGE_UPLOAD_MAX_BYTES + 1), "image/png")).status).toBe(413)
      const valid = await upload(jpeg, "image/png")
      expect(valid.status).toBe(201)
      const stored = blobs.get((await valid.json()).id)
      if (!stored?.metadata) throw new Error("Uploaded fixture blob metadata is missing")
      expect(stored.content_type).toBe("image/jpeg")
      expect(JSON.parse(stored.metadata)).toMatchObject({ width: 400, height: 800 })

      blobs.set(99, { id: 99, key: "uploads/legacy", filename: 'legacy".html', content_type: "text/html", byte_size: 4 })
      attachments.push({ blob_id: 99, record_type: "User", record_id: 7, name: "avatar" })
      await storage.put("uploads/legacy", Buffer.from("html"))
      const legacy = await get("/api/v1/uploads/99", 7)
      expect(legacy.headers.get("content-disposition")).toMatch(/^attachment;/)
      expect(legacy.headers.get("content-security-policy")).toContain("sandbox")
      await legacy.text()
      await expect(app.get(UploadsService).attachUpload(7, 99, { record_type: "User", record_id: 7, name: "avatar" })).rejects.toThrow(/image/i)
    } finally {
      await app.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
