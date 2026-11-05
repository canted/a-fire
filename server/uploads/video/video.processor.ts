import { mediaOutputUploadTimeoutMs } from "../media-processing-options"
import { beginMediaProcessing, publishMediaProcessing, failMediaProcessing } from "../media-processing"
import { Inject, Injectable } from "@nestjs/common"
import { createWriteStream, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"
import { PrismaService } from "../../prisma/prisma.service"
import { StorageService } from "../../storage/storage.service"
import { CANONICAL_VIDEO_CONTENT_TYPE } from "./video-formats"
import { videoProbeTimeoutMs, videoSourceDownloadTimeoutMs, videoTranscodeTimeoutMs } from "./video-processing-options"
import { VIDEO_POSTER_CONTENT_TYPE, videoPosterStorageKey } from "./video-poster"

type VideoProcessorPayload = {
  videoAssetId: number
}

type VideoTranscodeResult = {
  buffer: Buffer
  posterBuffer: Buffer | null
  durationMs: number | null
  width: number | null
  height: number | null
}

type VideoFileProcessResult = {
  byteSize: number
  posterBuffer: Buffer | null
  durationMs: number | null
  width: number | null
  height: number | null
}

type VideoMetadata = {
  durationMs: number | null
  width: number | null
  height: number | null
}

type VideoInspection = VideoMetadata & {
  audioCodecs: string[]
  pixelFormat: string | null
  videoCodec: string | null
}

type VideoProcessingPlan = "remux" | "transcode"

type VideoStreamProcessingPlan = {
  audioAction: "copy" | "transcode"
  mode: VideoProcessingPlan
  reasons: string[]
  videoAction: "copy" | "transcode"
}

const execFileAsync = promisify(execFile)
const VIDEO_PROCESS_OUTPUT_MAX_BUFFER = 10 * 1024 * 1024
const REMUXABLE_VIDEO_CODECS = new Set(["h264"])
const REMUXABLE_AUDIO_CODECS = new Set(["aac"])
const WEB_COMPATIBLE_PIXEL_FORMATS = new Set(["yuv420p"])
const MAX_REMUX_DIMENSION = 1920

@Injectable()
export class VideoProcessor {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(StorageService)
  private readonly storage!: StorageService

  async process(payload: VideoProcessorPayload): Promise<void> {
    const asset = await this.prisma.videoAsset.findUnique({ where: { id: payload.videoAssetId }, include: { blob: true } })
    if (!asset?.blob) return
    const attempt = await beginMediaProcessing(this.prisma, asset.blob_id, "video")
    let tempDir: string | undefined
    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-upload-"))
      const inputPath = path.join(tempDir, `input${path.extname(asset.original_filename || asset.blob.filename || "video.bin") || ".bin"}`)
      const outputPath = path.join(tempDir, "output.mp4")
      const posterPath = path.join(tempDir, "poster.jpg")
      await this.writeStorageObjectToFile(attempt.sourceKey, inputPath, asset.id)
      const result = await this.processVideoFile(inputPath, outputPath, posterPath)
      await this.storage.putFile(attempt.output_key, outputPath, CANONICAL_VIDEO_CONTENT_TYPE, AbortSignal.timeout(mediaOutputUploadTimeoutMs()))
      if (result.posterBuffer) await this.storage.put(videoPosterStorageKey(attempt.output_key), result.posterBuffer, VIDEO_POSTER_CONTENT_TYPE, AbortSignal.timeout(mediaOutputUploadTimeoutMs()))
      const published = await publishMediaProcessing(this.prisma, attempt.id, {
        filename: toCanonicalVideoFilename(asset.original_filename || asset.blob.filename), contentType: CANONICAL_VIDEO_CONTENT_TYPE,
        byteSize: result.byteSize, metadata: JSON.stringify({ duration_ms: result.durationMs, width: result.width, height: result.height }),
        durationMs: result.durationMs, width: result.width, height: result.height,
      })
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ event: published ? "video_upload_complete" : "video_upload_superseded", video_asset_id: asset.id, attempt_id: attempt.id }))
    } catch (error) {
      const current = await failMediaProcessing(this.prisma, attempt.id, error)
      if (current) throw error
    } finally {
      if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  async transcodeVideoBuffer(sourceBuffer: Buffer, originalFilename: string): Promise<VideoTranscodeResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-upload-"))
    const inputPath = path.join(tempDir, `input${path.extname(originalFilename || "video.bin") || ".bin"}`)
    const outputPath = path.join(tempDir, "output.mp4")
    const posterPath = path.join(tempDir, "poster.jpg")

    try {
      await fs.writeFile(inputPath, sourceBuffer)
      const result = await this.processVideoFile(inputPath, outputPath, posterPath)
      const outputBuffer = await fs.readFile(outputPath)
      return {
        buffer: outputBuffer,
        posterBuffer: result.posterBuffer,
        durationMs: result.durationMs,
        width: result.width,
        height: result.height,
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  private async writeStorageObjectToFile(key: string, outputPath: string, videoAssetId: number): Promise<void> {
    const startedAt = Date.now()
    const timeoutMs = videoSourceDownloadTimeoutMs()
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "video_source_download_start",
        video_asset_id: videoAssetId,
        key,
      }),
    )

    const signal = AbortSignal.timeout(timeoutMs)
    const { stream } = await this.storage.getStream(key, undefined, signal)
    const writeStream = createWriteStream(outputPath)
    await pipeline(stream, writeStream, { signal })

    const stats = await fs.stat(outputPath)
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "video_source_download_complete",
        video_asset_id: videoAssetId,
        key,
        byte_size: stats.size,
        duration_ms: Date.now() - startedAt,
      }),
    )
  }

  private async processVideoFile(inputPath: string, outputPath: string, posterPath: string): Promise<VideoFileProcessResult> {
    const inspection = await this.inspectVideoFile(inputPath)
    const plan = chooseVideoProcessingPlan(inspection)

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "video_processing_plan",
        audio_action: plan.audioAction,
        audio_codecs: inspection.audioCodecs,
        height: inspection.height,
        mode: plan.mode,
        pixel_format: inspection.pixelFormat,
        reasons: plan.reasons,
        video_action: plan.videoAction,
        video_codec: inspection.videoCodec,
        width: inspection.width,
      }),
    )

    if (plan.mode === "remux") {
      await this.remuxVideoFile(inputPath, outputPath)
    } else {
      await this.transcodeVideoFile(inputPath, outputPath, plan)
    }

    const outputStats = await fs.stat(outputPath)
    const metadata = await this.readVideoMetadata(outputPath)
    const posterBuffer = await this.readVideoPoster(outputPath, posterPath)
    return { byteSize: outputStats.size, posterBuffer, ...metadata }
  }

  private async inspectVideoFile(filePath: string): Promise<VideoInspection> {
    const stdout = await this.runFfprobe([
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,pix_fmt,width,height,duration",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ])

    return parseVideoInspection(stdout)
  }

  private async remuxVideoFile(inputPath: string, outputPath: string): Promise<void> {
    await this.runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ])
  }

  private async transcodeVideoFile(inputPath: string, outputPath: string, plan: VideoStreamProcessingPlan): Promise<void> {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
    ]

    if (plan.videoAction === "copy") {
      args.push("-c:v", "copy")
    } else {
      args.push(
        "-vf",
        "scale=w=min(1920\\,iw):h=min(1080\\,ih):force_original_aspect_ratio=decrease",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
      )
    }

    if (plan.audioAction === "copy") {
      args.push("-c:a", "copy")
    } else {
      args.push("-c:a", "aac", "-b:a", "128k")
    }

    args.push(
      "-movflags",
      "+faststart",
      outputPath,
    )

    await this.runFfmpeg(args)
  }

  private async runFfprobe(args: string[]): Promise<string> {
    const timeoutMs = videoProbeTimeoutMs()
    const { stdout } = await execFileAsync("ffprobe", args, {
      killSignal: "SIGKILL",
      maxBuffer: VIDEO_PROCESS_OUTPUT_MAX_BUFFER,
      timeout: timeoutMs,
    }).catch((error) => {
      if (isExecTimeout(error)) {
        throw new Error(`ffprobe timed out after ${Math.round(timeoutMs / 1000)} seconds`)
      }
      throw error
    })
    return String(stdout)
  }

  private async runFfmpeg(args: string[]): Promise<void> {
    const timeoutMs = videoTranscodeTimeoutMs()
    await execFileAsync("ffmpeg", args, {
      killSignal: "SIGKILL",
      maxBuffer: VIDEO_PROCESS_OUTPUT_MAX_BUFFER,
      timeout: timeoutMs,
    }).catch((error) => {
      if (isExecTimeout(error)) {
        throw new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 60000)} minutes`)
      }
      throw error
    })
  }

  private async readVideoPoster(filePath: string, posterPath: string): Promise<Buffer | null> {
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        filePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=w=min(960\\,iw):h=-2",
        "-q:v",
        "3",
        posterPath,
      ], { timeout: videoProbeTimeoutMs(), killSignal: "SIGKILL", maxBuffer: VIDEO_PROCESS_OUTPUT_MAX_BUFFER })
      return await fs.readFile(posterPath)
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "video_poster_generation_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      return null
    }
  }

  private async readVideoMetadata(filePath: string): Promise<VideoMetadata> {
    const stdout = await this.runFfprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ])

    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: unknown; height?: unknown; duration?: unknown }>
      format?: { duration?: unknown }
    }
    const stream = parsed.streams?.[0]
    const duration = Number(stream?.duration ?? parsed.format?.duration)
    const width = Number(stream?.width)
    const height = Number(stream?.height)

    return {
      durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
      width: Number.isInteger(width) && width > 0 ? width : null,
      height: Number.isInteger(height) && height > 0 ? height : null,
    }
  }
}

function chooseVideoProcessingPlan(inspection: VideoInspection): VideoStreamProcessingPlan {
  const reasons: string[] = []
  if (!inspection.videoCodec || !REMUXABLE_VIDEO_CODECS.has(inspection.videoCodec)) {
    reasons.push("video_codec")
  }
  if (inspection.pixelFormat && !WEB_COMPATIBLE_PIXEL_FORMATS.has(inspection.pixelFormat)) {
    reasons.push("pixel_format")
  }
  if (requiresDownscale(inspection)) {
    reasons.push("dimensions")
  }
  if (inspection.audioCodecs.some((codec) => !REMUXABLE_AUDIO_CODECS.has(codec))) {
    reasons.push("audio_codec")
  }

  const videoAction = reasons.some((reason) => reason === "video_codec" || reason === "pixel_format" || reason === "dimensions")
    ? "transcode"
    : "copy"
  const audioAction = reasons.includes("audio_codec") ? "transcode" : "copy"
  const mode = reasons.length === 0 ? "remux" : "transcode"

  return { audioAction, mode, reasons, videoAction }
}

function parseVideoInspection(stdout: string): VideoInspection {
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: unknown
      codec_name?: unknown
      duration?: unknown
      height?: unknown
      pix_fmt?: unknown
      width?: unknown
    }>
    format?: { duration?: unknown }
  }
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video")
  const audioStreams = parsed.streams?.filter((stream) => stream.codec_type === "audio") ?? []
  const duration = Number(videoStream?.duration ?? parsed.format?.duration)
  const width = Number(videoStream?.width)
  const height = Number(videoStream?.height)

  return {
    audioCodecs: audioStreams.map((stream) => String(stream.codec_name ?? "")).filter(Boolean),
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
    height: Number.isInteger(height) && height > 0 ? height : null,
    pixelFormat: typeof videoStream?.pix_fmt === "string" ? videoStream.pix_fmt : null,
    videoCodec: typeof videoStream?.codec_name === "string" ? videoStream.codec_name : null,
    width: Number.isInteger(width) && width > 0 ? width : null,
  }
}

function requiresDownscale(inspection: VideoInspection) {
  if (!inspection.width || !inspection.height) return true
  return Math.max(inspection.width, inspection.height) > MAX_REMUX_DIMENSION
}

function toCanonicalVideoFilename(filename: string) {
  const base = filename.replace(/\.[^/.]+$/, "")
  return `${base}.mp4`
}

function isExecTimeout(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "killed" in error &&
    "signal" in error &&
    (error as { killed?: unknown; signal?: unknown }).killed === true
  )
}

export { chooseVideoProcessingPlan, parseVideoInspection, toCanonicalVideoFilename }
