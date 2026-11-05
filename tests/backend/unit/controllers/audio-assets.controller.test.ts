import { describe, expect, it, vi } from "vitest"
import { AudioAssetsController } from "@server/api/v1/audio-assets/audio-assets.controller"

function makeController() {
  const controller = new AudioAssetsController()
  const audioAssetsService = {
    getAudioAssetForUser: vi.fn(),
    getSourceContext: vi.fn(),
  }
  ;(controller as any).audioAssetsService = audioAssetsService
  return { controller, audioAssetsService }
}

describe("AudioAssetsController", () => {
  it("includes original filename and content type in audio asset responses", async () => {
    const { controller, audioAssetsService } = makeController()
    audioAssetsService.getAudioAssetForUser.mockResolvedValue({
      id: 41,
      title: "Bridge idea",
      processing_status: "ready",
      duration_ms: 1234,
      created_at: new Date("2026-06-17T12:04:00.000Z"),
      waveform_peaks: [0.1, 0.3],
      error_message: null,
      blob: { filename: "bridge.mp3", content_type: "audio/mpeg" },
    })
    audioAssetsService.getSourceContext.mockResolvedValue({
      source_type: "Reply",
      source_id: 9,
      parent_entry_id: 12,
    })

    await expect(
      controller.show("41", {
        user: { id: 7 },
        protocol: "https",
        get: (header: string) => (header === "host" ? "afire.test" : undefined),
      } as never),
    ).resolves.toEqual({
      id: 41,
      title: "Bridge idea",
      processing_status: "ready",
      duration_ms: 1234,
      created_at: "2026-06-17T12:04:00.000Z",
      error_message: null,
      reply_available: true,
      filename: "bridge.mp3",      content_type: "audio/mpeg",
      source_type: "Reply",
      source_id: 9,
      parent_entry_id: 12,
      playback_url: "/api/v1/audio-assets/41/download",
      download_url: "/api/v1/audio-assets/41/download",
    })
  })
})
