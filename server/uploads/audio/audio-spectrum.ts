import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { audioProbeTimeoutMs, audioWaveformTimeoutMs } from "../media-processing-options"
import { AUDIO_SPECTRUM_VERSION, type AudioSpectrum } from "../../../types/audio-spectrum"
import { TRACK_DETAIL_OPTIONS, analyzeSpectrum, prepareSpectralFrames } from "../../../frontend/src/lib/spectralWaveform"

const execute = promisify(execFile)

/** ffmpeg preserves channels; averaging samples would erase phase-inverted stereo. */
export function spectrumFromInterleavedPcm(buffer: Buffer, channelCount: number): AudioSpectrum {
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) throw new Error("Invalid channel count")
  const frames = Math.floor(buffer.length / (4 * channelCount))
  if (!frames) throw new Error("Empty audio")
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const value = buffer.readFloatLE((frame * channelCount + channel) * 4)
      if (!Number.isFinite(value)) throw new Error("Invalid PCM sample")
      channels[channel][frame] = value
    }
  }
  const analysis = analyzeSpectrum(channels, 22050, 300, 3000)
  const colored = prepareSpectralFrames(analysis, TRACK_DETAIL_OPTIONS, 800)
  return { version: AUDIO_SPECTRUM_VERSION, status: "ready", peaks: colored.map(frame => frame.peak), bands: colored.map(frame => frame.bands) }
}

export function audioMetadata(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

export function cachedAudioSpectrum(metadata: string | null | undefined): AudioSpectrum | undefined {
  const value = audioMetadata(metadata).spectrum as AudioSpectrum | undefined
  if (value?.version !== AUDIO_SPECTRUM_VERSION) return undefined
  if (value.status === "unavailable") return { version: AUDIO_SPECTRUM_VERSION, status: "unavailable" }
  if (value.status !== "ready" || !Array.isArray(value.bands) || !value.bands.length || value.bands.length > 800) return undefined
  if (value.bands.some(band => !Array.isArray(band) || band.length !== 3 || band.some(n => !Number.isFinite(n) || n < 0 || n > 1))) return undefined
  if (!Array.isArray(value.peaks) || value.peaks.length !== value.bands.length || value.peaks.some(n => !Number.isFinite(n) || n < 0 || n > 1)) return undefined
  return value
}

/** Decode once for both silhouette and color, preserving all channels. */
export async function analyzeAudioFile(input: string): Promise<AudioSpectrum> {
  const { stdout: info } = await execute("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "default=noprint_wrappers=1:nokey=1", input], { timeout: audioProbeTimeoutMs(), killSignal: "SIGKILL" })
  const channels = Number(info.trim())
  const { stdout } = await execute("ffmpeg", ["-v", "error", "-i", input, "-map", "0:a:0", "-ar", "22050", "-f", "f32le", "pipe:1"], { encoding: "buffer", maxBuffer: 128 * 1024 * 1024, timeout: audioWaveformTimeoutMs(), killSignal: "SIGKILL" })
  return spectrumFromInterleavedPcm(stdout, channels)
}

/** Analysis failure must not prevent listening; never publish a partial waveform. */
export async function analyzeAudioFileForPlayback(input: string): Promise<AudioSpectrum> {
  try { return await analyzeAudioFile(input) }
  catch (error) {
    console.warn("audio_spectrum_unavailable", { message: error instanceof Error ? error.message : String(error) })
    return { version: AUDIO_SPECTRUM_VERSION, status: "unavailable" }
  }
}
