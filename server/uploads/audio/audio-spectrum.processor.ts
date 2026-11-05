import { Inject, Injectable } from "@nestjs/common"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { PrismaService } from "../../prisma/prisma.service"
import { StorageService } from "../../storage/storage.service"
import { audioMetadata, cachedAudioSpectrum, analyzeAudioFile } from "./audio-spectrum"
import { AUDIO_SPECTRUM_VERSION, type AudioSpectrum } from "../../../types/audio-spectrum"


/** Complete waveform backfill runs in the existing worker, never in a request. */
@Injectable()
export class AudioSpectrumProcessor {
  @Inject(PrismaService) private readonly prisma!: PrismaService
  @Inject(StorageService) private readonly storage!: StorageService

  async process({ audioAssetId }: { audioAssetId: number }) {
    const asset = await this.prisma.audioAsset.findUnique({ where: { id: audioAssetId }, include: { blob: true } })
    if (!asset?.blob || asset.processing_status !== "ready" || cachedAudioSpectrum(asset.blob.metadata)) return
    // Storage failures remain retryable; they must not permanently cache a
    // decoding failure for otherwise valid media.
    const source = Number(asset.blob.byte_size) <= 128 * 1024 * 1024 ? await this.storage.getBuffer(asset.blob.key) : undefined
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "audio-spectrum-"))
    let spectrum: AudioSpectrum
    try {
      const input = path.join(directory, "input")
      if (!source) throw new Error("Audio exceeds the bounded spectral-analysis size")
      await fs.writeFile(input, source)
      spectrum = await this.analyzeFile(input)
    } catch (error) {
      console.warn("audio_spectrum_unavailable", { audioAssetId, message: error instanceof Error ? error.message : String(error) })
      spectrum = { version: AUDIO_SPECTRUM_VERSION, status: "unavailable" }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
    // Compare-and-set: a concurrent replacement or metadata repair must win.
    await this.prisma.activeStorageBlob.updateMany({
      where: { id: asset.blob_id, key: asset.blob.key, metadata: asset.blob.metadata, byte_size: asset.blob.byte_size },
      data: { metadata: JSON.stringify({ ...audioMetadata(asset.blob.metadata), spectrum }) },
    })
  }
  private async analyzeFile(input: string): Promise<AudioSpectrum> {
    return analyzeAudioFile(input)
  }

}
