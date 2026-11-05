/** Versioned complete waveform: paired amplitude and Track detail coordinates; never contains audio bytes. */
export const AUDIO_SPECTRUM_VERSION = 3 as const
export type AudioSpectrum = {
  version: typeof AUDIO_SPECTRUM_VERSION
  status: "ready" | "pending" | "unavailable"
  peaks?: number[]
  bands?: Array<[number, number, number]>
}
