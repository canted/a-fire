import { describe, expect, it, vi } from "vitest"
import { UploadsController } from "@server/api/v1/uploads/uploads.controller"
import { MEDIA_AUTH_COOKIE_NAME } from "@server/api/v1/auth/media-auth-cookie"

function makeController() {
  const controller = new UploadsController()
  const uploadsService = {
    createUpload: vi.fn(),
    enqueuePostImageVariants: vi.fn(),
    streamUpload: vi.fn(),
    streamVariant: vi.fn(),
  }
  ;(controller as any).uploadsService = uploadsService
  return { controller, uploadsService }
}

describe("UploadsController", () => {
  it("returns same-origin upload URLs and refreshes the media auth cookie", async () => {
    const { controller, uploadsService } = makeController()
    uploadsService.createUpload.mockResolvedValue({
      id: 140,
      filename: "image.png",
      content_type: "image/png",
      byte_size: 123,
    })
    const response = { cookie: vi.fn() }

    await expect(
      controller.create(
        {
          user: { id: 7 },
          headers: { authorization: "Bearer access-token" },
        } as never,
        response as never,
        {
          originalname: "image.png",
          mimetype: "image/png",
          size: 123,
          buffer: Buffer.from("image"),
        } as Express.Multer.File,
        { entry_id: "107" },
      ),
    ).resolves.toEqual({
      success: 1,
      file: {
        url: "/api/v1/uploads/140",
        signed_id: "140",
        filename: "image.png",
        content_type: "image/png",
        byte_size: 123,
      },
    })

    expect(response.cookie).toHaveBeenCalledWith(
      MEDIA_AUTH_COOKIE_NAME,
      "access-token",
      expect.objectContaining({
        httpOnly: true,
        path: "/api/v1",
      }),
    )
    expect(uploadsService.enqueuePostImageVariants).toHaveBeenCalledWith(
      { id: 140, content_type: "image/png" },
      { entry_id: 107, reply_id: undefined, page_id: undefined },
    )
  })

  it("returns video asset metadata for video uploads", async () => {
    const { controller, uploadsService } = makeController()
    uploadsService.createUpload.mockResolvedValue({
      id: 141,
      filename: "clip.mov",
      content_type: "video/quicktime",
      byte_size: 123,
      video_asset: {
        id: 44,
        title: "clip.mov",
        processing_status: "pending",
        duration_ms: null,
        width: null,
        height: null,
      },
    })
    const response = { cookie: vi.fn() }

    await expect(
      controller.create(
        {
          user: { id: 7 },
          headers: { authorization: "Bearer access-token" },
        } as never,
        response as never,
        {
          originalname: "clip.mov",
          mimetype: "video/quicktime",
          size: 123,
          buffer: Buffer.from("video"),
        } as Express.Multer.File,
        { entry_id: "107" },
      ),
    ).resolves.toEqual({
      success: 1,
      video_asset: {
        id: 44,
        title: "clip.mov",
        processing_status: "pending",
        duration_ms: null,
        width: null,
        height: null,
        filename: "clip.mov",
        content_type: "video/quicktime",
        metadata_url: "/api/v1/video-assets/44",
        playback_url: "/api/v1/video-assets/44/download",
        download_url: "/api/v1/video-assets/44/download",
      },
    })
  })

  it("requires private cache revalidation when streaming uploads", async () => {
    const { controller, uploadsService } = makeController()
    const stream = { pipe: vi.fn() }
    const response = {
      setHeader: vi.fn(),
      status: vi.fn(),
    }
    uploadsService.streamUpload.mockResolvedValue({
      stream,
      filename: "image.png",
      contentType: "image/png",
      byteSize: 123,
    })

    await controller.show("140", { user: { id: 7 } } as never, response as never)

    expect(uploadsService.streamUpload).toHaveBeenCalledWith(140, 7, undefined, undefined)
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-cache, must-revalidate")
    expect(stream.pipe).toHaveBeenCalledWith(response)
  })

  it("requires private cache revalidation when streaming upload variants", async () => {
    const { controller, uploadsService } = makeController()
    const stream = { pipe: vi.fn() }
    const response = {
      setHeader: vi.fn(),
    }
    uploadsService.streamVariant.mockResolvedValue({
      stream,
      filename: "image.webp",
      contentType: "image/webp",
      byteSize: 456,
    })

    await controller.showVariant("140", "w1200", { user: { id: 7 } } as never, response as never)

    expect(uploadsService.streamVariant).toHaveBeenCalledWith(140, "w1200", 7, undefined)
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-cache, must-revalidate")
    expect(stream.pipe).toHaveBeenCalledWith(response)
  })
})
