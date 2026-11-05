import { describe, expect, it, vi } from "vitest"
import { spectrumFromInterleavedPcm, cachedAudioSpectrum } from "@server/uploads/audio/audio-spectrum"
import { AudioAssetsService } from "@server/api/v1/audio-assets/audio-assets.service"
import { analyzeSpectrum, prepareSpectralFrames, TRACK_DETAIL_OPTIONS } from "../../../../frontend/src/lib/spectralWaveform"
import { ForbiddenException } from "@nestjs/common"

function tone(stereo: boolean) {
  const channels = stereo ? 2 : 1
  const buffer = Buffer.alloc(22050 * channels * 4)
  for (let i = 0; i < 22050; i++) {
    const sample = Math.sin(i * 2 * Math.PI * 220 / 22050) * .5
    buffer.writeFloatLE(sample, i * channels * 4)
    if (stereo) buffer.writeFloatLE(-sample, (i * channels + 1) * 4)
  }
  return spectrumFromInterleavedPcm(buffer, channels)
}

describe("portable audio spectrum", () => {
  it("preserves opposite-phase stereo and produces compact finite Token Cube coordinates", () => {
    const mono = tone(false)
    expect(tone(true)).toEqual(mono)
    expect(mono.peaks).toHaveLength(mono.bands!.length)
    expect(cachedAudioSpectrum(JSON.stringify({ spectrum: { ...mono, peaks: undefined } }))).toBeUndefined()
    expect(cachedAudioSpectrum(JSON.stringify({ spectrum: { ...mono, peaks: [NaN] } }))).toBeUndefined()
    expect(mono.bands!.length).toBeLessThanOrEqual(800)
    expect(mono.bands![5][0]).toBeGreaterThan(.8)
    expect(mono.bands![5][1]).toBeLessThan(.1)
    expect(cachedAudioSpectrum(JSON.stringify({ spectrum: mono }))).toEqual(mono)
    expect(cachedAudioSpectrum('{"spectrum":{"version":2,"status":"ready","bands":[[9,0,0]]}}')).toBeUndefined()
  })

  it("uses the approved mapping and rejects old cached coordinates", () => {
    const pcm = Float32Array.from({ length: 22050 }, (_, i) =>
      Math.sin(i * 2 * Math.PI * 220 / 22050) * (0.2 + i / 22050 * 0.3)
      + Math.sin(i * 2 * Math.PI * 4000 / 22050) * (0.2 - i / 22050 * 0.1));
    const buffer = Buffer.alloc(pcm.length * 4);
    pcm.forEach((value, i) => buffer.writeFloatLE(value, i * 4));
    const result = spectrumFromInterleavedPcm(buffer, 1);
    expect(result.version).toBe(3);
    expect(result.peaks).toEqual(prepareSpectralFrames(analyzeSpectrum([pcm], 22050, 300, 3000), TRACK_DETAIL_OPTIONS, 800).map(frame => frame.peak));
    expect(result.bands).toEqual(prepareSpectralFrames(analyzeSpectrum([pcm], 22050, 300, 3000), TRACK_DETAIL_OPTIONS, 800).map(frame => frame.bands));
    expect(cachedAudioSpectrum(JSON.stringify({ spectrum: { ...result, version: 2 } }))).toBeUndefined();
    expect(cachedAudioSpectrum(JSON.stringify({ spectrum: { version: 2, status: "unavailable" } }))).toBeUndefined();
  })

  it("authorizes before returning cached metadata or enqueueing analysis", async () => {
    const service = new AudioAssetsService()
    const boss = { enqueue: vi.fn() }
    Object.assign(service, { boss })
    const authorize = vi.spyOn(service, "getAudioAssetForUser").mockRejectedValue(new ForbiddenException())
    await expect(service.getSpectrumForUser(41, 7)).rejects.toThrow(ForbiddenException)
    expect(boss.enqueue).not.toHaveBeenCalled()
    const spectrum = tone(false)
    authorize.mockResolvedValue({ processing_status: "ready", blob: { metadata: JSON.stringify({ spectrum }) } } as never)
    await expect(service.getSpectrumForUser(41, 7)).resolves.toEqual(spectrum)
    expect(boss.enqueue).not.toHaveBeenCalled()
    authorize.mockResolvedValue({ processing_status: "ready", blob: { metadata: JSON.stringify({ spectrum: { ...spectrum, version: 2 } }) } } as never)
    await expect(service.getSpectrumForUser(41, 7)).resolves.toEqual({ version: 3, status: "pending" })
    expect(boss.enqueue).toHaveBeenCalledWith("audio.spectrum", { audioAssetId: 41 }, { singletonKey: "41", singletonSeconds: 300 })
  })
})
