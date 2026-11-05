import type { useAudioPlayback as useProductionAudioPlayback } from "../src/hooks/useAudioPlayback";
const unavailable = () => { throw new Error("Playback is not enabled in this isolated workspace preview."); };
/** Idle session only; real media acceptance remains in the application. */
export function useAudioPlayback(): ReturnType<typeof useProductionAudioPlayback> {
  return { track: null, playing: false, loading: false, position: 0, duration: 0,
    play: unavailable, pause: unavailable, toggle: unavailable, close: unavailable, seek: unavailable };
}
