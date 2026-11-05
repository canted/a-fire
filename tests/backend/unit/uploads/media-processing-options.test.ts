import { afterEach, it, expect, vi } from "vitest"
import { audioProbeTimeoutMs, audioTranscodeTimeoutMs, audioWaveformTimeoutMs, audioSourceDownloadTimeoutMs, mediaOutputUploadTimeoutMs } from "@server/uploads/media-processing-options"
import { videoProbeTimeoutMs } from "@server/uploads/video/video-processing-options"

afterEach(() => vi.unstubAllEnvs())
it("uses finite audio defaults and independent operation overrides", () => {
  vi.stubEnv("AUDIO_TRANSCODE_TIMEOUT_MS", "")
  vi.stubEnv("AUDIO_PROBE_TIMEOUT_MS", "")
  vi.stubEnv("AUDIO_WAVEFORM_TIMEOUT_MS", "")
  vi.stubEnv("AUDIO_SOURCE_DOWNLOAD_TIMEOUT_MS", "")
  expect(audioSourceDownloadTimeoutMs()).toBe(300000)
  vi.stubEnv("MEDIA_OUTPUT_UPLOAD_TIMEOUT_MS", "")
  expect(mediaOutputUploadTimeoutMs()).toBe(300000)
  expect([audioTranscodeTimeoutMs(), audioProbeTimeoutMs(), audioWaveformTimeoutMs()]).toEqual([300000, 60000, 120000])
  vi.stubEnv("AUDIO_PROBE_TIMEOUT_MS", "500")
  expect(audioProbeTimeoutMs()).toBe(500)
  expect(audioTranscodeTimeoutMs()).toBe(300000)
})
it.each(["0", "-1", "Infinity", "not-a-number", "2147483648"])("rejects unsafe timer configuration %s", value => {
  vi.stubEnv("AUDIO_PROBE_TIMEOUT_MS", value)
  vi.stubEnv("VIDEO_PROBE_TIMEOUT_MS", value)
  vi.stubEnv("MEDIA_OUTPUT_UPLOAD_TIMEOUT_MS", value)
  expect(mediaOutputUploadTimeoutMs()).toBe(300000)
  expect(audioProbeTimeoutMs()).toBe(60000)
  expect(videoProbeTimeoutMs()).toBe(120000)
})
