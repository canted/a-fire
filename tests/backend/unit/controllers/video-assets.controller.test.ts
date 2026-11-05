import { describe, expect, it, vi } from "vitest"
import { VideoAssetsController } from "@server/api/v1/video-assets/video-assets.controller"

function makeController() {
  const controller = new VideoAssetsController()
  const videoAssetsService = {
    getVideoAssetForUser: vi.fn(),
    getSourceContext: vi.fn(),
    getPosterUrlForAsset: vi.fn(),
    streamVideoAssetForUser: vi.fn(),
    streamVideoPosterForUser: vi.fn(),
  }
  ;(controller as any).videoAssetsService = videoAssetsService
  return { controller, videoAssetsService }
}

describe("VideoAssetsController", () => {
  it("includes playback metadata in video asset responses", async () => {
    const { controller, videoAssetsService } = makeController()
    videoAssetsService.getVideoAssetForUser.mockResolvedValue({
      id: 41,
      title: "Launch clip",
      processing_status: "ready",
      duration_ms: 1234,
      width: 1280,
      height: 720,
      error_message: null,
      blob: { filename: "launch.mp4", content_type: "video/mp4" },
    })
    videoAssetsService.getSourceContext.mockResolvedValue({
      source_type: "Reply",
      source_id: 9,
      parent_entry_id: 12,
    })
    videoAssetsService.getPosterUrlForAsset.mockResolvedValue("/api/v1/video-assets/41/poster")

    await expect(
      controller.show("41", {
        user: { id: 7 },
      } as never),
    ).resolves.toEqual({
      id: 41,
      title: "Launch clip",
      processing_status: "ready",
      duration_ms: 1234,
      width: 1280,
      height: 720,
      error_message: null,
      filename: "launch.mp4",
      content_type: "video/mp4",
      source_type: "Reply",
      source_id: 9,
      parent_entry_id: 12,
      poster_url: "/api/v1/video-assets/41/poster",
      playback_url: "/api/v1/video-assets/41/download",
      download_url: "/api/v1/video-assets/41/download",
    })
  })

  it("responds with partial content for range playback", async () => {
    const { controller, videoAssetsService } = makeController()
    const stream = { pipe: vi.fn() }
    const response = {
      setHeader: vi.fn(),
      status: vi.fn(),
    }
    videoAssetsService.streamVideoAssetForUser.mockResolvedValue({
      stream,
      filename: "launch.mp4",
      contentType: "video/mp4",
      byteSize: 1000,
      range: { start: 100, end: 199, total: 1000 },
    })

    await controller.download("41", { user: { id: 7 } } as never, response as never, undefined, "bytes=100-199")

    expect(videoAssetsService.streamVideoAssetForUser).toHaveBeenCalledWith(41, 7, "bytes=100-199")
    expect(response.status).toHaveBeenCalledWith(206)
    expect(response.setHeader).toHaveBeenCalledWith("Content-Range", "bytes 100-199/1000")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Length", 100)
    expect(stream.pipe).toHaveBeenCalledWith(response)
  })

  it("streams poster thumbnails", async () => {
    const { controller, videoAssetsService } = makeController()
    const stream = { pipe: vi.fn() }
    const response = {
      setHeader: vi.fn(),
      status: vi.fn(),
    }
    videoAssetsService.streamVideoPosterForUser.mockResolvedValue({
      stream,
      filename: "launch.jpg",
      contentType: "image/jpeg",
      byteSize: 321,
    })

    await controller.poster("41", { user: { id: 7 } } as never, response as never)

    expect(videoAssetsService.streamVideoPosterForUser).toHaveBeenCalledWith(41, 7, undefined)
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/jpeg")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Disposition", 'inline; filename="launch.jpg"')
    expect(response.setHeader).toHaveBeenCalledWith("Content-Length", 321)
    expect(stream.pipe).toHaveBeenCalledWith(response)
  })
})
