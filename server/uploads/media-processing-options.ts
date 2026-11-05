/** Node timers cannot safely represent larger millisecond delays. */
export function positiveProcessingInteger(name: string, fallback: number) {
  const value = Math.floor(Number(process.env[name]))
  return Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647 ? value : fallback
}

export function audioTranscodeTimeoutMs() {
  return positiveProcessingInteger("AUDIO_TRANSCODE_TIMEOUT_MS", 5 * 60 * 1000)
}

export function audioProbeTimeoutMs() {
  return positiveProcessingInteger("AUDIO_PROBE_TIMEOUT_MS", 60 * 1000)
}

export function audioWaveformTimeoutMs() {
  return positiveProcessingInteger("AUDIO_WAVEFORM_TIMEOUT_MS", 2 * 60 * 1000)
}

export function audioSourceDownloadTimeoutMs() {
  return positiveProcessingInteger("AUDIO_SOURCE_DOWNLOAD_TIMEOUT_MS", 5 * 60 * 1000)
}

export function mediaOutputUploadTimeoutMs() {
  return positiveProcessingInteger("MEDIA_OUTPUT_UPLOAD_TIMEOUT_MS", 5 * 60 * 1000)
}
