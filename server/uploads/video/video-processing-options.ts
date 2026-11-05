import { positiveProcessingInteger } from "../media-processing-options"
const DEFAULT_VIDEO_PROCESSING_JOB_EXPIRE_MINUTES = 60
const DEFAULT_VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_VIDEO_PROBE_TIMEOUT_MS = 2 * 60 * 1000
const DEFAULT_VIDEO_TRANSCODE_TIMEOUT_MS = 45 * 60 * 1000

export function videoProcessingJobExpireMinutes() {
  return positiveProcessingInteger("VIDEO_PROCESSING_JOB_EXPIRE_MINUTES", DEFAULT_VIDEO_PROCESSING_JOB_EXPIRE_MINUTES)
}

export function videoSourceDownloadTimeoutMs() {
  return positiveProcessingInteger("VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS", DEFAULT_VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS)
}

export function videoProbeTimeoutMs() {
  return positiveProcessingInteger("VIDEO_PROBE_TIMEOUT_MS", DEFAULT_VIDEO_PROBE_TIMEOUT_MS)
}

export function videoTranscodeTimeoutMs() {
  return positiveProcessingInteger("VIDEO_TRANSCODE_TIMEOUT_MS", DEFAULT_VIDEO_TRANSCODE_TIMEOUT_MS)
}
