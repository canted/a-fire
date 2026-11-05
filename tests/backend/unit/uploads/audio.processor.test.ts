import { beforeEach, describe, expect, it, vi } from "vitest"
import { AudioProcessor } from "@server/uploads/audio/audio.processor"
import { withTestDependencies } from "@tests/backend/helpers/service"
import { beginMediaProcessing, publishMediaProcessing, failMediaProcessing } from "@server/uploads/media-processing"

vi.mock("@server/uploads/media-processing", () => ({ beginMediaProcessing: vi.fn(), publishMediaProcessing: vi.fn(), failMediaProcessing: vi.fn() }))

function fixture(mime = "audio/wav") {
  const prisma = { audioAsset: { findUnique: vi.fn().mockResolvedValue({ id: 41, blob_id: 9, original_filename: "source.wav", original_mime_type: mime, blob: { key: "current-playback", filename: "source.wav", content_type: mime } }) } }
  const storage = { getBuffer: vi.fn().mockResolvedValue(Buffer.from("source")), put: vi.fn() }
  const processor = withTestDependencies(new AudioProcessor(), { prisma, storage })
  return { processor, prisma, storage }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(beginMediaProcessing).mockResolvedValue({ id: "attempt", output_key: "unique-output", sourceKey: "retained-source" } as never)
  vi.mocked(publishMediaProcessing).mockResolvedValue(true)
  vi.mocked(failMediaProcessing).mockResolvedValue(true)
})

describe("AudioProcessor generation integration", () => {
  it("reads retained input and publishes only after writing immutable output", async () => {
    const { processor, prisma, storage } = fixture()
    vi.spyOn(processor, "transcodeAudioBuffer").mockResolvedValue({ buffer: Buffer.from("encoded"), durationMs: 1234, spectrum: { version: 3 as const, status: "ready" as const, peaks: [0.5], bands: [[1, 0, 0] as [number, number, number]] } })
    await processor.process({ audioAssetId: 41 })
    expect(beginMediaProcessing).toHaveBeenCalledWith(prisma, 9, "audio")
    expect(storage.getBuffer).toHaveBeenCalledWith("retained-source", expect.any(AbortSignal))
    expect(storage.put).toHaveBeenCalledWith("unique-output", Buffer.from("encoded"), "audio/mp4", expect.any(AbortSignal))
    expect(storage.put.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(publishMediaProcessing).mock.invocationCallOrder[0])
    expect(publishMediaProcessing).toHaveBeenCalledWith(prisma, "attempt", expect.objectContaining({ durationMs: 1234, byteSize: 7, metadata: JSON.stringify({ duration_ms: 1234, spectrum: { version: 3, status: "ready", peaks: [0.5], bands: [[1, 0, 0]] } }) }))
  })

  it("propagates a current transcode failure through the failure owner", async () => {
    const { processor, prisma } = fixture()
    const failure = new Error("ffmpeg failed")
    vi.spyOn(processor, "transcodeAudioBuffer").mockRejectedValue(failure)
    await expect(processor.process({ audioAssetId: 41 })).rejects.toThrow("ffmpeg failed")
    expect(failMediaProcessing).toHaveBeenCalledWith(prisma, "attempt", failure)
    expect(publishMediaProcessing).not.toHaveBeenCalled()
  })

  it("does not retry an obsolete attempt's failure", async () => {
    const { processor, storage } = fixture()
    storage.getBuffer.mockRejectedValue(new Error("late storage failure"))
    vi.mocked(failMediaProcessing).mockResolvedValue(false)
    await expect(processor.process({ audioAssetId: 41 })).resolves.toBeUndefined()
    expect(publishMediaProcessing).not.toHaveBeenCalled()
  })

  it("keeps pass-through bytes intact when optional metadata fails", async () => {
    const { processor, prisma, storage } = fixture("audio/mp4")
    vi.spyOn(processor as any, "readAudioMetadataBuffer").mockRejectedValue(new Error("ffprobe failed"))
    await processor.process({ audioAssetId: 41 })
    expect(storage.put).not.toHaveBeenCalled()
    expect(publishMediaProcessing).toHaveBeenCalledWith(prisma, "attempt", expect.objectContaining({ passThrough: true, durationMs: null, byteSize: 6 }))
    expect(failMediaProcessing).not.toHaveBeenCalled()
  })

  it("does not treat pass-through storage or publication failures as optional", async () => {
    const { processor, storage } = fixture("audio/mp4")
    storage.getBuffer.mockRejectedValueOnce(new Error("storage unavailable"))
    await expect(processor.process({ audioAssetId: 41 })).rejects.toThrow("storage unavailable")
    vi.spyOn(processor as any, "readAudioMetadataBuffer").mockResolvedValue({ durationMs: 100, spectrum: { version: 3 as const, status: "ready" as const, peaks: [0.5], bands: [[1, 0, 0] as [number, number, number]] } })
    vi.mocked(publishMediaProcessing).mockRejectedValueOnce(new Error("database unavailable"))
    await expect(processor.process({ audioAssetId: 41 })).rejects.toThrow("database unavailable")
    expect(failMediaProcessing).toHaveBeenCalledTimes(2)
  })
})
