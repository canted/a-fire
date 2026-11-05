export const SUPPORTED_AUDIO_CONTENT_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/aiff",
  "audio/x-aiff",
  "audio/webm",
  "audio/ogg",
  "audio/opus",
])

const PASS_THROUGH_AUDIO_CONTENT_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a"])

export function normalizeAudioContentType(contentType?: string | null) {
  return (contentType ?? "").split(";", 1)[0].trim().toLowerCase()
}

export function isSupportedAudioContentType(contentType?: string | null) {
  return SUPPORTED_AUDIO_CONTENT_TYPES.has(normalizeAudioContentType(contentType))
}

export function isPassThroughAudioContentType(contentType?: string | null) {
  return PASS_THROUGH_AUDIO_CONTENT_TYPES.has(normalizeAudioContentType(contentType))
}
