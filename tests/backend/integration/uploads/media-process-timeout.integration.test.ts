import "reflect-metadata"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it, expect, vi } from "vitest"
import { analyzeAudioFile } from "@server/uploads/audio/audio-spectrum"
import { AudioProcessor } from "@server/uploads/audio/audio.processor"
import { VideoProcessor } from "@server/uploads/video/video.processor"

it.each(["transcode", "probe", "waveform", "poster"])("kills a hung %s subprocess even when it ignores SIGTERM", async operation => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-process-timeout-"))
  const pidFile = path.join(root, "child.pid")
  // Avoid requiring a second Node runtime to finish startup inside the kill budget.
  // The shell installs the ignored signal before publishing its PID and spawns no children.
  const quotedPidFile = "'" + pidFile.replaceAll("'", "'\\''") + "'"
  const script = `#!/bin/sh\ntrap '' TERM\nprintf '%s' "$$" > ${quotedPidFile}\nwhile :; do :; done\n`
  const previousPath = process.env.PATH
  try {
    for (const command of ["ffmpeg", "ffprobe"]) await writeFile(path.join(root, command), script, { mode: 0o755 })
    vi.stubEnv("PATH", `${root}${path.delimiter}${previousPath}`)
    for (const name of ["AUDIO_TRANSCODE_TIMEOUT_MS", "AUDIO_PROBE_TIMEOUT_MS", "AUDIO_WAVEFORM_TIMEOUT_MS", "VIDEO_PROBE_TIMEOUT_MS"]) vi.stubEnv(name, "500")
    if (operation === "waveform") await writeFile(path.join(root, "ffprobe"), "#!/bin/sh\nprintf '1\\n'\n", { mode: 0o755 })
    const audio = new AudioProcessor()
    if (operation === "poster") {
      const video = new VideoProcessor()
      await expect((video as any).readVideoPoster("fixture", path.join(root, "poster.jpg"))).resolves.toBeNull()
    } else {
      const work = operation === "transcode" ? audio.transcodeAudioBuffer(Buffer.from("fixture"), "fixture.wav")
        : operation === "probe" ? (audio as any).readDurationMs("fixture") : analyzeAudioFile("fixture")
      await expect(work).rejects.toMatchObject({ killed: true, signal: "SIGKILL" })
    }
    const pid = Number(await readFile(pidFile, "utf8"))
    expect(Number.isSafeInteger(pid)).toBe(true)
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }))
  } finally {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})
