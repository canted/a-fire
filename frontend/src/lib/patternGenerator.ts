import Color from "color";
import MersenneTwister from "mersenne-twister";

export const DEFAULT_SHAPE_COUNT = 9;
export const DEFAULT_WOBBLE = 10;

// Derived from token palette in src/styles/tokens.css
export const DEFAULT_BASE_COLORS = [
  // "#f1e8e1",
  // "#1f1a1a",
  // "#ef5757",
  // "#24b659",
  "#24b6b6",
  // "#b624b6",
  // "#b6b624",
  // "#9f3500",
  // "#2fa0df",
  // "#f7f3ec",
  // "#efe8dd",
  // "#d8cdbd",
  // "#e46b34",
  // "#c24f1e",
  // "#2fa0df",
  // "#c0392b",
  // "#1c1813",
  // "#433a30",
  // "#FFB547",
  // "#FF990B",
];

export interface PatternOptions {
  shapeCount?: number;
  wobble?: number;
  baseColors?: string[];
  width?: number;
  height?: number;
}

export default function Pattern(address: string, options: PatternOptions = {}): string {
  const {
    shapeCount = DEFAULT_SHAPE_COUNT,
    wobble = DEFAULT_WOBBLE,
    baseColors = DEFAULT_BASE_COLORS,
    width = 20,
    height = 360,
  } = options;

  if (baseColors.length === 0) throw new Error("Insufficient base colors");

  const hashInput = address || "default-seed";
  const hash = Array.from(hashInput).reduce((acc, char) => {
    return (acc * 31 + char.charCodeAt(0)) >>> 0;
  }, 0);
  const seed = hash || 1;
  const generator = new MersenneTwister(seed);

  const hueShift = generator.random() * 360;
  const colorIndex = Math.floor(generator.random() * baseColors.length);
  const rotated = Color(baseColors[colorIndex]).rotate(hueShift).hsl().object();
  const randomizedBase = {
    h: rotated.h ?? 0,
    s: clamp((rotated.s ?? 0) + (generator.random() - 0.5) * 100, 0, 100),
    l: clamp((rotated.l ?? 0) + (generator.random() - 0.5) * 100, 0, 100),
  };
  const baseColor = Color.hsl(randomizedBase.h, randomizedBase.s, randomizedBase.l).hex();
  const baseHsl = randomizedBase;
  const hueVariance = wobble / 80; // reduced hue drift for subtler shifts
  const saturationVariance = wobble / 60; // increased jitter for richer variation
  const lightnessVariance = wobble / 50; // stronger lightness drift to spread contrast

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function wrapHue(value: number): number {
    const result = value % 360;
    return result < 0 ? result + 360 : result;
  }

  function nextColor(): string {
    const hueJitter = (generator.random() - 0.5) * 2 * hueVariance * 180; // cap at +/- hueVariance * 180 degrees
    const saturationJitter = (generator.random() - 0.5) * 2 * saturationVariance * 100;
    const lightnessJitter = (generator.random() - 0.5) * 2 * lightnessVariance * 100;
    const h = wrapHue((baseHsl.h ?? 0) + hueJitter);
    const s = clamp((baseHsl.s ?? 0) + saturationJitter, 0, 100);
    const l = clamp((baseHsl.l ?? 0) + lightnessJitter, 0, 100);
    return Color.hsl(h, s, l).hex();
  }

  function nextTransform(index: number): string {
    const firstRotation = generator.random();
    const boost = generator.random();
    const secondRotation = generator.random();
    const angle = 2 * Math.PI * firstRotation;
    const velocity = (100 * (index + boost)) / shapeCount;
    const x = Math.cos(angle) * velocity;
    const y = Math.sin(angle) * velocity;
    const r = firstRotation * 360 + secondRotation * 180;
    return `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${r.toFixed(1)} 50 50)`;
  }

  const shapes = [];
  shapes.push(`<rect x="0" y="0" width="100%" height="100%" fill="${baseColor}" />`);
  for (let i = 0; i < shapeCount; i++) {
    shapes.push(
      `<rect x="0" y="0" width="100%" height="100%" transform="${nextTransform(i)}" fill="${nextColor()}" />`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" x="0" y="0" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" width="${width}" height="${height}">${shapes.join(
    "",
  )}</svg>`;
}
