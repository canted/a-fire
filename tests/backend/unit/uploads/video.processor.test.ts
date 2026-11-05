import { beginMediaProcessing, publishMediaProcessing, failMediaProcessing } from "@server/uploads/media-processing"
import { withTestDependencies } from "@tests/backend/helpers/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { promises as fs } from "node:fs"
import {
  VideoProcessor,
  chooseVideoProcessingPlan,
  parseVideoInspection,
  toCanonicalVideoFilename,
} from "@server/uploads/video/video.processor"
import {
  videoProbeTimeoutMs,
  videoProcessingJobExpireMinutes,
  videoSourceDownloadTimeoutMs,
  videoTranscodeTimeoutMs,
} from "@server/uploads/video/video-processing-options"

vi.mock("@server/uploads/media-processing", () => ({ beginMediaProcessing: vi.fn(), publishMediaProcessing: vi.fn(), failMediaProcessing: vi.fn() }))
beforeEach(() => {
  vi.mocked(beginMediaProcessing).mockReset().mockResolvedValue({ id: "attempt", sourceKey: "retained-source", output_key: "unique-output" } as never)
  vi.mocked(publishMediaProcessing).mockReset().mockResolvedValue(true)
  vi.mocked(failMediaProcessing).mockReset().mockResolvedValue(true)
})

function makePrisma(overrides: Partial<any> = {}) {
  return {
    videoAsset: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    activeStorageBlob: {
      update: vi.fn(),
    },
    ...overrides,
  }
}

function makeStorage(overrides: Partial<any> = {}) {
  return {
    getBuffer: vi.fn(),
    getStream: vi.fn(),
    put: vi.fn(),
    putFile: vi.fn(),
    ...overrides,
  }
}

describe("VideoProcessor", () => {
  afterEach(() => {
    delete process.env.VIDEO_PROCESSING_JOB_EXPIRE_MINUTES
    delete process.env.VIDEO_PROBE_TIMEOUT_MS
    delete process.env.VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS
    delete process.env.VIDEO_TRANSCODE_TIMEOUT_MS
  })

  it("writes video and poster before atomic generation publication", async () => {
    const prisma = makePrisma()
    const storage = makeStorage()
    prisma.videoAsset.findUnique.mockResolvedValue({
      id: 44,
      blob_id: 9,
      original_filename: "launch.mov",
      blob: { id: 9, key: "uploads/video-44", filename: "launch.mov" },
    })

    const processor = new VideoProcessor()
    ;(processor as any).prisma = prisma
    ;(processor as any).storage = storage
    vi.spyOn(processor as any, "writeStorageObjectToFile").mockResolvedValue(undefined)
    vi.spyOn(processor as any, "processVideoFile").mockResolvedValue({
      byteSize: Buffer.byteLength("encoded-video"),
      posterBuffer: Buffer.from("poster-image"),
      durationMs: 1234,
      width: 1280,
      height: 720,
    })

    await processor.process({ videoAssetId: 44 })

    expect(beginMediaProcessing).toHaveBeenCalledWith(prisma, 9, "video")
    expect(storage.putFile).toHaveBeenCalledWith("unique-output", expect.any(String), "video/mp4", expect.any(AbortSignal))
    expect(storage.put).toHaveBeenCalledWith("unique-output.poster.jpg", Buffer.from("poster-image"), "image/jpeg", expect.any(AbortSignal))
    expect(storage.put.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(publishMediaProcessing).mock.invocationCallOrder[0])
    expect(publishMediaProcessing).toHaveBeenCalledWith(prisma, "attempt", expect.objectContaining({ durationMs: 1234, width: 1280, height: 720 }))
    expect(prisma.activeStorageBlob.update).not.toHaveBeenCalled()
  })

  it("records current failure through the generation owner and propagates it", async () => {
    const prisma = makePrisma()
    prisma.videoAsset.findUnique.mockResolvedValue({ id: 44, blob_id: 9, original_filename: "source.mov", blob: { key: "source", filename: "source.mov" } })
    const processor = withTestDependencies(new VideoProcessor(), { prisma, storage: makeStorage() })
    vi.spyOn(processor as any, "writeStorageObjectToFile").mockRejectedValue(new Error("storage unavailable"))
    await expect(processor.process({ videoAssetId: 44 })).rejects.toThrow("storage unavailable")
    expect(failMediaProcessing).toHaveBeenCalledWith(prisma, "attempt", expect.any(Error))
    expect(publishMediaProcessing).not.toHaveBeenCalled()
  })

  it("remuxes web-compatible MOV sources without full transcoding", async () => {
    const processor = new VideoProcessor()
    vi.spyOn(processor as any, "inspectVideoFile").mockResolvedValue({
      audioCodecs: ["aac"],
      durationMs: 1234,
      height: 720,
      pixelFormat: "yuv420p",
      videoCodec: "h264",
      width: 1280,
    })
    const remux = vi.fn(async (_inputPath: string, outputPath: string) => {
      await fs.writeFile(outputPath, Buffer.from("remuxed-video"))
    })
    withTestDependencies(processor, { remuxVideoFile: remux })
    const transcode = vi.spyOn(processor as any, "transcodeVideoFile").mockResolvedValue(undefined)
    vi.spyOn(processor as any, "readVideoMetadata").mockResolvedValue({
      durationMs: 1234,
      width: 1280,
      height: 720,
    })
    vi.spyOn(processor as any, "readVideoPoster").mockResolvedValue(Buffer.from("poster"))

    const result = await processor.transcodeVideoBuffer(Buffer.from("raw-video"), "clip.mov")

    expect(remux).toHaveBeenCalled()
    expect(transcode).not.toHaveBeenCalled()
    expect(result).toEqual({
      buffer: Buffer.from("remuxed-video"),
      posterBuffer: Buffer.from("poster"),
      durationMs: 1234,
      width: 1280,
      height: 720,
    })
  })

  it("full transcodes Android-hostile sources", async () => {
    const processor = new VideoProcessor()
    vi.spyOn(processor as any, "inspectVideoFile").mockResolvedValue({
      audioCodecs: ["aac"],
      durationMs: 1234,
      height: 1080,
      pixelFormat: "yuv420p",
      videoCodec: "hevc",
      width: 1920,
    })
    const remux = vi.spyOn(processor as any, "remuxVideoFile").mockResolvedValue(undefined)
    const transcode = vi.fn(async (_inputPath: string, outputPath: string) => {
      await fs.writeFile(outputPath, Buffer.from("encoded-video"))
    })
    withTestDependencies(processor, { transcodeVideoFile: transcode })
    vi.spyOn(processor as any, "readVideoMetadata").mockResolvedValue({
      durationMs: 1234,
      width: 1920,
      height: 1080,
    })
    vi.spyOn(processor as any, "readVideoPoster").mockResolvedValue(Buffer.from("poster"))

    const result = await processor.transcodeVideoBuffer(Buffer.from("raw-video"), "clip.mov")

    expect(remux).not.toHaveBeenCalled()
    expect(transcode).toHaveBeenCalled()
    expect(result.buffer).toEqual(Buffer.from("encoded-video"))
  })

  it("normalizes canonical filenames to mp4", () => {
    expect(toCanonicalVideoFilename("launch.mov")).toBe("launch.mp4")
    expect(toCanonicalVideoFilename("launch")).toBe("launch.mp4")
  })

  it("chooses remux only for compact H.264/AAC browser-compatible video", () => {
    expect(
      chooseVideoProcessingPlan({
        audioCodecs: ["aac"],
        durationMs: 1234,
        height: 720,
        pixelFormat: "yuv420p",
        videoCodec: "h264",
        width: 1280,
      }),
    ).toEqual({
      audioAction: "copy",
      mode: "remux",
      reasons: [],
      videoAction: "copy",
    })
    expect(
      chooseVideoProcessingPlan({
        audioCodecs: ["aac"],
        durationMs: 1234,
        height: 1080,
        pixelFormat: "yuv420p",
        videoCodec: "hevc",
        width: 1920,
      }),
    ).toEqual({
      audioAction: "copy",
      mode: "transcode",
      reasons: ["video_codec"],
      videoAction: "transcode",
    })
    expect(
      chooseVideoProcessingPlan({
        audioCodecs: ["pcm_s16le"],
        durationMs: 1234,
        height: 720,
        pixelFormat: "yuv420p",
        videoCodec: "h264",
        width: 1280,
      }),
    ).toEqual({
      audioAction: "transcode",
      mode: "transcode",
      reasons: ["audio_codec"],
      videoAction: "copy",
    })
    expect(
      chooseVideoProcessingPlan({
        audioCodecs: ["aac"],
        durationMs: 1234,
        height: 2160,
        pixelFormat: "yuv420p",
        videoCodec: "h264",
        width: 3840,
      }),
    ).toEqual({
      audioAction: "copy",
      mode: "transcode",
      reasons: ["dimensions"],
      videoAction: "transcode",
    })
  })

  it("parses ffprobe inspection output", () => {
    const inspection = parseVideoInspection(
      JSON.stringify({
        streams: [
          { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920 },
          { codec_type: "audio", codec_name: "aac" },
        ],
        format: { duration: "4.25" },
      }),
    )

    expect(inspection).toEqual({
      audioCodecs: ["aac"],
      durationMs: 4250,
      height: 1920,
      pixelFormat: "yuv420p",
      videoCodec: "h264",
      width: 1080,
    })
  })

  it("uses bounded video processing defaults with env overrides", () => {
    expect(videoProcessingJobExpireMinutes()).toBe(60)
    expect(videoSourceDownloadTimeoutMs()).toBe(5 * 60 * 1000)
    expect(videoProbeTimeoutMs()).toBe(2 * 60 * 1000)
    expect(videoTranscodeTimeoutMs()).toBe(45 * 60 * 1000)

    process.env.VIDEO_PROCESSING_JOB_EXPIRE_MINUTES = "90"
    process.env.VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS = "120000"
    process.env.VIDEO_PROBE_TIMEOUT_MS = "30000"
    process.env.VIDEO_TRANSCODE_TIMEOUT_MS = "120000"

    expect(videoProcessingJobExpireMinutes()).toBe(90)
    expect(videoSourceDownloadTimeoutMs()).toBe(120000)
    expect(videoProbeTimeoutMs()).toBe(30000)
    expect(videoTranscodeTimeoutMs()).toBe(120000)
  })
})
