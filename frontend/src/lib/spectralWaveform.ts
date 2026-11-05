export type Bands = [number, number, number];
/** Amplitude-only envelope for temporary recording previews. Saved audio uses spectral frames. */
export function waveformEnvelope(peaks?: number[] | null, normalize = true) {
  if (!peaks || !peaks.length) return undefined;
  const values = peaks.map(value => Number.isFinite(value) ? Math.abs(value) : 0);
  const maximum = values.reduce((a, b) => Math.max(a, b), 1e-8);
  return values.map(value => normalize ? value / maximum : Math.min(1, value));
}
export type SpectralFrame = { peak: number; bands: Bands };
export type SpectralAnalysis = {
  duration: number;
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  frames: SpectralFrame[];
};
export type SpectralStyle = "cube" | "dominant" | "attacks";
export type SpectralOptions = {
  scale: "strength" | "relative";
  gain: number;
  smoothing: number;
  style: SpectralStyle;
  /** Blend toward each band’s full-recording variation. */
  trackDetail?: number;
};
/** Approved Track detail mapping, shared by browser rendering and persisted spectra. */
export const TRACK_DETAIL_OPTIONS: Readonly<SpectralOptions> = {
  style: "cube", scale: "strength", gain: 1.8, smoothing: 0, trackDetail: 0.55,
};

/** Approved Tokyo Night Storm anchors: quiet, bass, mids, bass+mids,
 * treble, bass+treble, mids+treble, all three.
 * Source: github.com/folke/tokyonight.nvim/blob/main/lua/tokyonight/colors/storm.lua */
export const WAVEFORM_PALETTE = [
  "#24283b", "#f7768e", "#9ece6a", "#ff9e64",
  "#7aa2f7", "#9d7cd8", "#1abc9c", "#c0caf5",
] as const;

// Exact cumulative powers at every boundary exposed by the prototype sliders.
export const SPECTRAL_BOUNDARIES = [
  ...Array.from({ length: 53 }, (_, i) => 80 + i * 10),
  ...Array.from({ length: 51 }, (_, i) => 1000 + i * 100),
];
export type SpectralSummary = Omit<SpectralAnalysis, "frames"> & {
  boundaries: number[];
  powers: Float32Array;
  peaks: Float32Array;
};

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Full-file, centered Hann-window STFT. Average channel powers, never channel
 * samples: an out-of-phase stereo recording must not disappear in the analysis. */
export function analyzeSpectralSummary(channels: Float32Array[], sampleRate: number, boundaries = SPECTRAL_BOUNDARIES): SpectralSummary {
  if (!channels.length || !channels[0].length || !Number.isFinite(sampleRate) || sampleRate <= 0 ||
    boundaries.some((value, i) => !Number.isFinite(value) || value <= 20 || value >= sampleRate / 2 || (i > 0 && value <= boundaries[i - 1])) ||
    channels.some(channel => channel.length !== channels[0].length)) {
    throw new Error("Audio must contain samples and ordered frequency boundaries below the Nyquist frequency.");
  }
  const fftSize = 4096;
  const hopSize = 1024;
  const length = channels[0].length;
  const window = Float64Array.from({ length: fftSize }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));
  const windowPower = window.reduce((sum, value) => sum + value * value, 0);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const reversed = Uint16Array.from({ length: fftSize }, (_, i) => {
    let value = i;
    let result = 0;
    for (let bit = 0; bit < 12; bit++) { result = (result << 1) | (value & 1); value >>= 1; }
    return result;
  });
  const cos = Float64Array.from({ length: fftSize / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / fftSize));
  const sin = Float64Array.from({ length: fftSize / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / fftSize));
  const frameCount = Math.ceil(length / hopSize);
  const stride = boundaries.length + 1;
  const powers = new Float32Array(frameCount * stride);
  const peaks = new Float32Array(frameCount);
  const cumulative = new Float64Array(stride);
  for (let start = 0; start < length; start += hopSize) {
    const frameIndex = start / hopSize;
    cumulative.fill(0);
    let peak = 0;
    const center = start + Math.floor(Math.min(hopSize, length - start) / 2);
    for (const channel of channels) {
      for (let i = start; i < Math.min(length, start + hopSize); i++) peak = Math.max(peak, Math.abs(channel[i]));
      imaginary.fill(0);
      for (let i = 0; i < fftSize; i++) {
        const source = center + i - fftSize / 2;
        real[reversed[i]] = (source >= 0 && source < length ? channel[source] : 0) * window[i];
      }
      for (let size = 2; size <= fftSize; size *= 2) {
        const half = size / 2;
        const stride = fftSize / size;
        for (let offset = 0; offset < fftSize; offset += size) {
          for (let j = 0; j < half; j++) {
            const a = offset + j;
            const b = a + half;
            const twiddle = j * stride;
            const r = real[b] * cos[twiddle] - imaginary[b] * sin[twiddle];
            const im = real[b] * sin[twiddle] + imaginary[b] * cos[twiddle];
            real[b] = real[a] - r;
            imaginary[b] = imaginary[a] - im;
            real[a] += r;
            imaginary[a] += im;
          }
        }
      }
      let total = 0;
      let boundary = 0;
      for (let bin = 1; bin <= fftSize / 2; bin++) {
        const frequency = bin * sampleRate / fftSize;
        while (boundary < boundaries.length && frequency >= boundaries[boundary]) {
          cumulative[boundary++] += total;
        }
        if (frequency < 20) continue;
        const mirrorFactor = bin === fftSize / 2 ? 1 : 2;
        total += mirrorFactor * (real[bin] ** 2 + imaginary[bin] ** 2) / (fftSize * windowPower * channels.length);
      }
      while (boundary < stride) cumulative[boundary++] += total;
    }
    peaks[frameIndex] = peak;
    powers.set(cumulative, frameIndex * stride);
  }
  return { powers, peaks, boundaries, duration: length / sampleRate, sampleRate, fftSize, hopSize };
}

/** Regroup cached energies without decoding or running another FFT. */
export function bandsFromSummary(summary: SpectralSummary, bassEnd: number, midsEnd: number): SpectralAnalysis {
  const bass = summary.boundaries.indexOf(bassEnd);
  const mids = summary.boundaries.indexOf(midsEnd);
  if (bass < 0 || mids <= bass) throw new Error("Frequency boundaries must be ordered and present in the summary.");
  const stride = summary.boundaries.length + 1;
  const frames = Array.from(summary.peaks, (peak, i) => {
    const offset = i * stride;
    const low = summary.powers[offset + bass];
    const middle = summary.powers[offset + mids];
    const total = summary.powers[offset + stride - 1];
    return { peak, bands: [low, Math.max(0, middle - low), Math.max(0, total - middle)] as Bands };
  });
  return { duration: summary.duration, sampleRate: summary.sampleRate, fftSize: summary.fftSize, hopSize: summary.hopSize, frames };
}

export function analyzeSpectrum(channels: Float32Array[], sampleRate: number, bassEnd: number, midsEnd: number): SpectralAnalysis {
  return bandsFromSummary(analyzeSpectralSummary(channels, sampleRate, [bassEnd, midsEnd]), bassEnd, midsEnd);
}

function percentile95(values: number[]) {
  values.sort((a, b) => a - b);
  return Math.max(1e-8, values[Math.floor((values.length - 1) * 0.95)] ?? 0);
}

/** Color transforms happen before display reduction so attacks survive a long
 * recording being squeezed into a small waveform. All styles share peak heights. */
export type SpectralTimeline = { analysis: SpectralAnalysis; frames: SpectralFrame[]; style: SpectralStyle };
export function prepareSpectralTimeline(analysis: SpectralAnalysis, options: SpectralOptions): SpectralTimeline {
  const rms = analysis.frames.map(frame => frame.bands.map(value => Math.sqrt(Math.max(0, value))) as Bands);
  const reference = percentile95(rms.map(bands => Math.max(...bands)));
  const attacks = options.style === "attacks" ? rms.map((bands, i) => bands.map((value, band) => Math.max(0, value - (rms[i - 1]?.[band] ?? value))) as Bands) : [];
  const attackReference = percentile95(attacks.map(bands => Math.max(...bands)).filter(value => value > reference * 0.001));
  // Fit once over audible full-track frames, never the zoom window. Keep
  // unclipped log values: clipping is precisely the detail this view recovers.
  const logBand = (value: number) => Math.log1p(9 * value / reference * options.gain) / Math.log(10);
  const detailRanges = options.trackDetail ? [0, 1, 2].map(band => {
    const values = rms.filter(frame => Math.max(...frame) >= Math.max(1e-6, reference * 0.001))
      .map(frame => logBand(frame[band])).sort((a, b) => a - b);
    const low = values[Math.floor((values.length - 1) * 0.1)] ?? 0;
    const high = values[Math.floor((values.length - 1) * 0.9)] ?? 0;
    return { low, high };
  }) : [];
  let previous: Bands = [0, 0, 0];
  const smoothing = Math.min(0.95, clamp(options.smoothing));
  const colored = rms.map((bands, i) => {
    const silent = Math.max(...bands) < Math.max(1e-6, reference * 0.001);
    const source = options.style === "attacks" ? attacks[i] : bands;
    const divisor = options.style === "attacks" ? attackReference : options.scale === "relative" ? Math.max(1e-8, ...bands) : reference;
    let coordinates = source.map(value => silent ? 0 : clamp(Math.log1p(9 * value / divisor * options.gain) / Math.log(10))) as Bands;
    if (options.trackDetail && options.style === "cube") {
      const mix = clamp(options.trackDetail);
      coordinates = coordinates.map((value, band) => {
        const { low, high } = detailRanges[band];
        // Avoid inventing contrast in an absent or effectively constant band.
        if (high - low < 0.01 || source[band] < Math.max(1e-6, reference * 0.001)) return value;
        const detail = clamp(0.15 + 0.8 * (logBand(source[band]) - low) / (high - low));
        return value * (1 - mix) + detail * mix;
      }) as Bands;
    }
    if (options.style === "dominant") coordinates = coordinates.map(value => value ** 3) as Bands;
    coordinates = coordinates.map((value, band) => silent ? 0 : previous[band] * smoothing + value * (1 - smoothing)) as Bands;
    previous = coordinates;
    return { peak: analysis.frames[i].peak, bands: coordinates };
  });
  const maximumPeak = colored.reduce((peak, frame) => Math.max(peak, frame.peak), 1e-8);
  for (const frame of colored) frame.peak /= maximumPeak;
  return { analysis, frames: colored, style: options.style };
}

export function resampleSpectralTimeline(timeline: SpectralTimeline, count = 382, window = { start: 0, end: timeline.analysis.duration }): SpectralFrame[] {
  const { analysis, frames: colored, style } = timeline;
  if (!colored.length) return [];
  const first = Math.max(0, Math.min(colored.length - 1, Math.floor(window.start * analysis.sampleRate / analysis.hopSize)));
  const last = Math.max(first + 1, Math.min(colored.length, Math.ceil(window.end * analysis.sampleRate / analysis.hopSize)));
  const visibleCount = last - first;
  const buckets = Math.max(1, Math.min(visibleCount, Math.floor(count)));
  return Array.from({ length: buckets }, (_, index) => {
    const start = first + Math.floor(index * visibleCount / buckets);
    const end = first + Math.floor((index + 1) * visibleCount / buckets);
    const bands: Bands = [0, 0, 0];
    let peak = 0;
    for (let i = start; i < end; i++) {
      peak = Math.max(peak, colored[i].peak);
      for (let band = 0; band < 3; band++) {
        if (style === "attacks") bands[band] = Math.max(bands[band], colored[i].bands[band]);
        else bands[band] += colored[i].bands[band] / (end - start);
      }
    }
    return { peak, bands };
  });
}

export function prepareSpectralFrames(analysis: SpectralAnalysis, options: SpectralOptions, count = 800, window = { start: 0, end: analysis.duration }): SpectralFrame[] {
  return resampleSpectralTimeline(prepareSpectralTimeline(analysis, options), count, window);
}

/** Clamp a fixed-width inspection window without changing full-track scaling. */
export function spectralWindow(duration: number, center: number, width = 10) {
  const span = Math.min(Math.max(0, duration), width);
  const start = Math.max(0, Math.min(duration - span, center - span / 2));
  return { start, end: start + span };
}

type Lab = [number, number, number];
function toLab(hex: string): Lab {
  const rgb = hex.match(/^#([\da-f]{6})$/i);
  if (!rgb) throw new Error(`Expected a six-digit token color, received ${hex}`);
  const [r, g, b] = [0, 2, 4].map(offset => {
    const value = parseInt(rgb[1].slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromLab([L, a, b]: Lab) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return `#${[4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(value => {
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055;
    return Math.round(clamp(encoded) * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}

export function createColorCube(palette: readonly string[]) {
  if (palette.length !== 8) throw new Error("The spectral cube needs eight color anchors.");
  const corners = palette.map(toLab);
  return (input: Bands) => {
    const coordinates = input.map(clamp);
    const result: Lab = [0, 0, 0];
    corners.forEach((corner, index) => {
      const weight = coordinates.reduce((product, value, axis) => product * ((index >> axis) & 1 ? value : 1 - value), 1);
      corner.forEach((value, axis) => { result[axis] += value * weight; });
    });
    return fromLab(result);
  };
}

export function colorCube(coordinates: Bands, palette: string[]) {
  return createColorCube(palette)(coordinates);
}
