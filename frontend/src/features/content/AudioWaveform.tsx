import { useId, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Line,
  Polygon,
} from "react-native-svg";
import {
  WAVEFORM_PALETTE,
  createColorCube,
  waveformEnvelope,
  resampleSpectralTimeline,
} from "../../lib/spectralWaveform";
import { AUDIO_SPECTRUM_VERSION, type AudioSpectrum } from "../../../../types/audio-spectrum";
import { tokens } from "../../styles/tokens";

const color = createColorCube(WAVEFORM_PALETTE);

/** Saved audio renders one complete spectral result; peaks are only for temporary recorder previews. */
export function AudioWaveform({
  peaks,
  recordingPreview = false,
  previewColor = tokens.waveformPlaceholder,
  progress,
  spectrum,
  height = 60,
}: {
  height?: number | `${number}%`;
  peaks?: number[];
  recordingPreview?: boolean;
  previewColor?: string;
  progress?: number;
  spectrum?: AudioSpectrum;
}) {
  const complete = spectrum?.version === AUDIO_SPECTRUM_VERSION && spectrum.status === "ready" && Boolean(spectrum.peaks?.length) && spectrum.peaks?.length === spectrum.bands?.length;
  const [width, setWidth] = useState(800);
  const frames = useMemo(() => {
    if (!complete || !spectrum?.peaks || !spectrum.bands) return undefined;
    const frames = spectrum.peaks.map((peak, index) => ({ peak, bands: spectrum.bands![index] }));
    // Persisted frames are already colored and normalized. Reduce their complete
    // timeline to the display width through the same reducer used by the lab.
    return resampleSpectralTimeline({
      frames, style: "cube",
      analysis: { frames, duration: frames.length, sampleRate: 1, hopSize: 1, fftSize: 4096 },
    }, width);
  }, [complete, spectrum, width]);
  const id = `spectrum-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const stops = useMemo(
    () =>
      complete
        ? frames?.map(({ bands }, index, all) => (
            <Stop
              key={index}
              offset={`${((index + 0.5) * 100) / all.length}%`}
              stopColor={color(bands)}
            />
          ))
        : undefined,
    [frames, complete],
  );
  const points = useMemo(() => {
    const values = recordingPreview ? waveformEnvelope(peaks, false) : complete ? frames?.map(frame => frame.peak) : undefined;
    const envelope = values?.length ? (values.length === 1 ? [values[0], values[0]] : values) : [0, 0];
    const x = (index: number) => (recordingPreview || !complete) ? index * 1000 / (envelope.length - 1) : (index + 0.5) * 1000 / envelope.length;
    const top = envelope.map(
      (peak, index) =>
        `${x(index)},${50 - peak * 46}`,
    );
    const bottom = envelope
      .map(
        (peak, index) =>
          `${x(index)},${50 + peak * 46}`,
      )
      .reverse();
    if (complete && !recordingPreview) {
      top.unshift(`0,${50 - envelope[0] * 46}`);
      top.push(`1000,${50 - envelope.at(-1)! * 46}`);
      bottom.unshift(`1000,${50 + envelope.at(-1)! * 46}`);
      bottom.push(`0,${50 + envelope[0] * 46}`);
    }
    return [...top, ...bottom].join(" ");
  }, [peaks, recordingPreview, frames, complete]);
  return (
    <View
      style={{ width: "100%", height }}
      onLayout={(event) => setWidth(Math.max(1, Math.ceil(event.nativeEvent.layout.width)))}
    >
    <Svg
      viewBox="0 0 1000 100"
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      {...(Platform.OS === "web"
        ? { "aria-hidden": true }
        : { accessible: false })}
    >
      <Defs>
        <LinearGradient id={id} x1="0%" x2="100%" y1="0%" y2="0%">
          {stops || [<Stop key="neutral" stopColor={tokens.surface} />]}
        </LinearGradient>
      </Defs>
      {recordingPreview && <Line x1={0} x2={1000} y1={50} y2={50} stroke={previewColor} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      <Polygon
        points={points}
        fill={recordingPreview ? previewColor : `url(#${id})`}
        stroke={recordingPreview ? previewColor : tokens.ink}
        strokeWidth={recordingPreview ? 1 : 0.264}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {progress !== undefined && Number.isFinite(progress) && <Line
        x1={Math.max(0, Math.min(1, progress)) * 1000}
        x2={Math.max(0, Math.min(1, progress)) * 1000}
        y1={0}
        y2={100}
        stroke={tokens.ink}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />}
    </Svg>
    </View>
  );
}
