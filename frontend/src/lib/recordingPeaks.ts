import type * as React from "react";

const WINDOW_SAMPLES = 160;
const emptyWindow = () => Array<number>(WINDOW_SAMPLES).fill(0);

/** Live amplitude from the recorder's existing stream: an eight-second rolling window
 * by default, or the full recording contour when retainHistory is requested.
 * No speaker connection, spectral analysis, or second microphone request. */
export function createUseRecordingPeaks({ useEffect, useState }: Pick<typeof React, "useState"> & { useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void }) {
return function useRecordingPeaks(stream: MediaStream | null, active: boolean, retainHistory = false) {
  const [peaks, setPeaks] = useState(emptyWindow);
  useEffect(() => {
    if (!active || !stream) return;
    setPeaks(retainHistory ? [] : emptyWindow());
    const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let interval: number | undefined;
    const release = () => {
      if (interval !== undefined) window.clearInterval(interval);
      source?.disconnect();
      analyser?.disconnect();
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
    };
    try {
      context = new Context();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      if (context.state === "suspended") void context.resume().catch(() => undefined);
      interval = window.setInterval(() => {
        analyser!.getFloatTimeDomainData(samples);
        let peak = 0;
        for (const value of samples) peak = Math.max(peak, Math.abs(value));
        setPeaks(previous => [...(retainHistory ? previous : previous.slice(1)), Math.min(1, peak)]);
      }, 50);
    } catch {
      // Metering is optional: recording still works without Web Audio support.
      release();
    }
    return release;
  }, [stream, active, retainHistory]);
  return peaks;
}

}
