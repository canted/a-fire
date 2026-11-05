import { describe, expect, it } from "vitest";
import { analyzeSpectrum, analyzeSpectralSummary, bandsFromSummary, prepareSpectralTimeline, resampleSpectralTimeline, colorCube, prepareSpectralFrames, spectralWindow, type SpectralAnalysis } from "../../../../frontend/src/lib/spectralWaveform";

const palette = ["#1a2527", "#db4275", "#6eb951", "#dbbd42", "#2c7fd8", "#6652b1", "#3aa8be", "#fbfaf7"];
const sampleRate = 22050;
const tone = (hz: number, amplitude = 0.7) => Float32Array.from({ length: sampleRate }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / sampleRate));

describe("spectral waveform analysis", () => {
  it.each([[100, 0], [1000, 1], [6000, 2]])("places a %i Hz tone in band %i", (hz, band) => {
    const result = analyzeSpectrum([tone(hz)], sampleRate, 250, 2500);
    const power = result.frames[10].bands;
    expect(power[band]).toBeGreaterThan(0.1);
    power.forEach((value, index) => { if (index !== band) expect(value).toBeLessThan(power[band] * 0.01); });
    expect(result.duration).toBe(1);
  });

  it("preserves out-of-phase stereo and measures peaks across the whole timeline", () => {
    const left = tone(100);
    const mono = analyzeSpectrum([left], sampleRate, 250, 2500);
    const stereo = analyzeSpectrum([left, left.map(value => -value)], sampleRate, 250, 2500);
    expect(stereo.frames[10].bands[0]).toBeCloseTo(mono.frames[10].bands[0], 6);
    const impulse = new Float32Array(5000);
    impulse[4999] = 1;
    expect(analyzeSpectrum([impulse], sampleRate, 250, 2500).frames.at(-1)?.peak).toBe(1);
  });

  it("keeps silence finite and neutral in every rendering style", () => {
    const analysis = analyzeSpectrum([new Float32Array(sampleRate)], sampleRate, 250, 2500);
    for (const style of ["cube", "dominant", "attacks"] as const) {
      const frames = prepareSpectralFrames(analysis, { scale: "relative", gain: 1, smoothing: 0.5, style }, 40);
      expect(frames.every(frame => frame.peak === 0 && frame.bands.every(value => value === 0))).toBe(true);
    }
  });

  it("rejects invalid frequency boundaries", () => {
    expect(() => analyzeSpectrum([tone(100)], sampleRate, 3000, 2500)).toThrow();
  });
});

describe("palette cube", () => {
  it("reproduces all eight supplied token anchors", () => {
    palette.forEach((color, index) => {
      expect(colorCube([index & 1, (index >> 1) & 1, (index >> 2) & 1], palette)).toBe(color);
    });
  });
  it("interpolates smoothly and clamps out-of-range coordinates", () => {
    expect(colorCube([0.5, 0.5, 0], palette)).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorCube([0.5, 0.5, 0], palette)).not.toBe(palette[3]);
    expect(colorCube([5, -1, 0], palette)).toBe(palette[1]);
  });
});

describe("style comparison", () => {
  const analysis: SpectralAnalysis = { duration: 4, sampleRate, hopSize: sampleRate, fftSize: 4096, frames: [
    { peak: 0.2, bands: [0.01, 0.001, 0.0001] },
    { peak: 0.8, bands: [0.16, 0.016, 0.0016] },
    { peak: 0.8, bands: [0.16, 0.016, 0.0016] },
    { peak: 0.2, bands: [0.01, 0.001, 0.0001] },
  ] };
  const options = { scale: "relative" as const, gain: 1, smoothing: 0 };
  it("separates level from balance and preserves the shared amplitude envelope", () => {
    const cube = prepareSpectralFrames(analysis, { ...options, style: "cube" }, 4);
    const dominant = prepareSpectralFrames(analysis, { ...options, style: "dominant" }, 4);
    expect(cube[0].bands).toEqual(cube[1].bands);
    expect(dominant[1].bands[1]).toBeLessThan(cube[1].bands[1]);
    expect(dominant.map(frame => frame.peak)).toEqual(cube.map(frame => frame.peak));
  });
  it("emphasizes rising energy rather than a sustained or falling sound", () => {
    const attacks = prepareSpectralFrames(analysis, { ...options, style: "attacks" }, 4);
    expect(attacks[1].bands[0]).toBeGreaterThan(0);
    expect(attacks[2].bands).toEqual([0, 0, 0]);
    expect(attacks[3].bands).toEqual([0, 0, 0]);
  });
});


describe("spectral zoom", () => {
  it("keeps a ten-second window within the recording", () => {
    expect(spectralWindow(100, 1)).toEqual({ start: 0, end: 10 });
    expect(spectralWindow(100, 50)).toEqual({ start: 45, end: 55 });
    expect(spectralWindow(100, 99)).toEqual({ start: 90, end: 100 });
    expect(spectralWindow(4, 2)).toEqual({ start: 0, end: 4 });
  });
  it("zooms before reduction while preserving track-wide amplitude, color scale, and smoothing history", () => {
    const analysis: SpectralAnalysis = { duration: 20, sampleRate: 1024, hopSize: 1024, fftSize: 4096,
      frames: Array.from({ length: 20 }, (_, i) => ({ peak: i === 0 ? 1 : 0.2, bands: [i === 0 ? 1 : 0.01, 0.002, 0.001] })),
    };
    for (const style of ["cube", "dominant", "attacks"] as const) {
      const options = { style, gain: 1, smoothing: 0.55, scale: "strength" as const };
      const full = prepareSpectralFrames(analysis, options, 800);
      const zoom = prepareSpectralFrames(analysis, options, 800, { start: 5, end: 15 });
      expect(zoom).toEqual(full.slice(5, 15));
      expect(zoom[0].peak).toBe(0.2);
    }
  });
});


describe("compact analysis and mobile display reduction", () => {
  it("regroups cached powers at all supported cutoff pairs with equivalent peak and band energy", () => {
    const channels = [tone(450), tone(3200, 0.3)];
    const summary = analyzeSpectralSummary(channels, sampleRate);
    for (const [bass, mids] of [[80, 1000], [300, 3000], [500, 2500], [600, 6000]]) {
      const regrouped = bandsFromSummary(summary, bass, mids);
      const direct = analyzeSpectrum(channels, sampleRate, bass, mids);
      regrouped.frames.forEach((frame, i) => {
        expect(frame.peak).toBe(direct.frames[i].peak);
        frame.bands.forEach((power, band) => expect(power).toBeCloseTo(direct.frames[i].bands[band], 7));
      });
    }
    expect(summary.powers).toBeInstanceOf(Float32Array);
    expect(summary).not.toHaveProperty('channels');
  });
  it("reduces to the mobile pixel budget without losing peaks or mutating the cached timeline", () => {
    const analysis: SpectralAnalysis = { duration: 1000, sampleRate: 1024, hopSize: 1024, fftSize: 4096,
      frames: Array.from({ length: 1000 }, (_, i) => ({ peak: i === 501 ? 1 : 0.2, bands: [0.01, 0.002, 0.001] })),
    };
    const timeline = prepareSpectralTimeline(analysis, { style: 'cube', gain: 1.8, smoothing: 0, scale: 'strength' });
    const overview = resampleSpectralTimeline(timeline, 381);
    expect(overview).toHaveLength(381);
    expect(Math.max(...overview.map(frame => frame.peak))).toBe(1);
    expect(resampleSpectralTimeline(timeline, 381, { start: 495, end: 505 })).toHaveLength(10);
    expect(resampleSpectralTimeline(timeline, 381)).toEqual(overview);
  });
});


describe("experimental track detail", () => {
  const analysis: SpectralAnalysis = { duration: 20, sampleRate: 1024, hopSize: 1024, fftSize: 4096,
    frames: Array.from({ length: 20 }, (_, i) => ({ peak: 0.8, bands: [0.8 + i * 0.01, 0.9 - i * 0.01, 0.001 + i * 0.0001] })),
  };
  const options = { style: "cube" as const, gain: 1.8, smoothing: 0, scale: "strength" as const };
  it("recovers variation hidden by clipping and brings out low treble variation", () => {
    const original = prepareSpectralTimeline(analysis, options);
    const detail = prepareSpectralTimeline(analysis, { ...options, trackDetail: 1 });
    expect(original.frames[3].bands[0]).toBe(1);
    expect(original.frames[16].bands[0]).toBe(1);
    expect(detail.frames[16].bands[0] - detail.frames[3].bands[0]).toBeGreaterThan(0.5);
    expect(detail.frames[3].bands[1]).toBeGreaterThan(detail.frames[16].bands[1]);
    expect(detail.frames[16].bands[2] - detail.frames[3].bands[2]).toBeGreaterThan(0.5);
    expect(detail.frames.map(frame => frame.peak)).toEqual(original.frames.map(frame => frame.peak));
    expect(resampleSpectralTimeline(detail, 20, { start: 3, end: 8 })).toEqual(detail.frames.slice(3, 8));
  });
  it("does not invent detail in silence, absent bands or a constant spectrum", () => {
    for (const bands of [[0, 0, 0], [1, 0, 0], [1, 1, 1]] as [number, number, number][]) {
      const constant = { ...analysis, frames: analysis.frames.map(frame => ({ ...frame, bands })) };
      expect(prepareSpectralTimeline(constant, { ...options, trackDetail: 1 }).frames)
        .toEqual(prepareSpectralTimeline(constant, options).frames);
    }
  });
  it("blends the gentler treatment with the original coordinates", () => {
    const original = prepareSpectralTimeline(analysis, options);
    const full = prepareSpectralTimeline(analysis, { ...options, trackDetail: 1 });
    const mixed = prepareSpectralTimeline(analysis, { ...options, trackDetail: 0.55 });
    expect(mixed.frames[5].bands[0]).toBeCloseTo(original.frames[5].bands[0] * 0.45 + full.frames[5].bands[0] * 0.55);
  });
});
