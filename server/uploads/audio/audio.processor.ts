import { analyzeAudioFileForPlayback } from "./audio-spectrum"
import type { AudioSpectrum } from "../../../types/audio-spectrum"
import { audioTranscodeTimeoutMs, audioProbeTimeoutMs, audioSourceDownloadTimeoutMs, mediaOutputUploadTimeoutMs } from "../media-processing-options"
import { beginMediaProcessing, publishMediaProcessing, failMediaProcessing } from "../media-processing"
import { Inject, Injectable } from "@nestjs/common"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { PrismaService } from "../../prisma/prisma.service"
import { StorageService } from "../../storage/storage.service"
import { isPassThroughAudioContentType } from "./audio-formats"

type AudioProcessorPayload = {
  audioAssetId: number
}

type AudioTranscodeResult = {
  buffer: Buffer
  durationMs: number
  spectrum: AudioSpectrum
}

const execFileAsync = promisify(execFile)
const CANONICAL_AUDIO_CONTENT_TYPE = "audio/mp4"

@Injectable()
export class AudioProcessor {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(StorageService)
  private readonly storage!: StorageService

  async process(payload: AudioProcessorPayload): Promise<void> {
    const asset = await this.prisma.audioAsset.findUnique({ where: { id: payload.audioAssetId }, include: { blob: true } })
    if (!asset?.blob) return
    const attempt = await beginMediaProcessing(this.prisma, asset.blob_id, "audio")
    try {
      const sourceBuffer = await this.storage.getBuffer(attempt.sourceKey, AbortSignal.timeout(audioSourceDownloadTimeoutMs()))
      // Once a source key is retained, the current blob MIME may describe a transformed output.
      const sourceType = asset.original_mime_type ?? (asset.blob.media_source_key ? null : asset.blob.content_type)
      let published: boolean
      if (isPassThroughAudioContentType(sourceType)) {
        let metadata: { durationMs: number; spectrum: AudioSpectrum } | undefined
        try {
          metadata = await this.readAudioMetadataBuffer(sourceBuffer, asset.original_filename || asset.blob.filename)
        } catch (error) {
          console.error(JSON.stringify({ event: "audio_upload_passthrough_metadata_failed", audio_asset_id: asset.id, message: error instanceof Error ? error.message : String(error) }))
        }
        published = await publishMediaProcessing(this.prisma, attempt.id, {
          filename: asset.original_filename || asset.blob.filename, contentType: sourceType,
          byteSize: sourceBuffer.length, metadata: metadata ? JSON.stringify({ duration_ms: metadata.durationMs, spectrum: metadata.spectrum }) : null,
          durationMs: metadata?.durationMs ?? null, passThrough: true,
        })
      } else {
        const result = await this.transcodeAudioBuffer(sourceBuffer, asset.original_filename || asset.blob.filename)
        await this.storage.put(attempt.output_key, result.buffer, CANONICAL_AUDIO_CONTENT_TYPE, AbortSignal.timeout(mediaOutputUploadTimeoutMs()))
        published = await publishMediaProcessing(this.prisma, attempt.id, {
          filename: toCanonicalFilename(asset.original_filename || asset.blob.filename), contentType: CANONICAL_AUDIO_CONTENT_TYPE,
          byteSize: result.buffer.length, metadata: JSON.stringify({ duration_ms: result.durationMs, spectrum: result.spectrum }),
          durationMs: result.durationMs,
        })
      }
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ event: published ? "audio_upload_complete" : "audio_upload_superseded", audio_asset_id: asset.id, attempt_id: attempt.id }))
    } catch (error) {
      const current = await failMediaProcessing(this.prisma, attempt.id, error)
      if (current) throw error
      // An obsolete attempt cannot turn newer success into a retry storm.
    }
  }

  async transcodeAudioBuffer(sourceBuffer: Buffer, originalFilename: string): Promise<AudioTranscodeResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-upload-"))
    const inputPath = path.join(tempDir, `input${path.extname(originalFilename || "audio.bin") || ".bin"}`)
    const outputPath = path.join(tempDir, "output.m4a")

    try {
      await fs.writeFile(inputPath, sourceBuffer)
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        outputPath,
      ], { timeout: audioTranscodeTimeoutMs(), killSignal: "SIGKILL" })

      const outputBuffer = await fs.readFile(outputPath)
      const durationMs = await this.readDurationMs(outputPath)
      const spectrum = await analyzeAudioFileForPlayback(outputPath)
      return { buffer: outputBuffer, durationMs, spectrum }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  private async readAudioMetadataBuffer(sourceBuffer: Buffer, originalFilename: string) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-upload-"))
    const inputPath = path.join(tempDir, `input${path.extname(originalFilename || "audio.bin") || ".bin"}`)

    try {
      await fs.writeFile(inputPath, sourceBuffer)
      const durationMs = await this.readDurationMs(inputPath)
      const spectrum = await analyzeAudioFileForPlayback(inputPath)
      return { durationMs, spectrum }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  private async readDurationMs(filePath: string): Promise<number> {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { timeout: audioProbeTimeoutMs(), killSignal: "SIGKILL" })
    const seconds = Number(String(stdout).trim())
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error("Could not determine audio duration")
    }
    return Math.round(seconds * 1000)
  }

}

function toCanonicalFilename(filename: string) {
  const base = filename.replace(/\.[^/.]+$/, "")
  return `${base}.m4a`
}

export { toCanonicalFilename }
