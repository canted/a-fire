#!/usr/bin/env node
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const paths = process.argv.slice(2);
const adding = paths[0] === "--add";
if ((!adding && paths.length !== 3) || (adding && (paths.length < 3 || paths.length % 2 !== 1))) {
  console.error('Usage: node frontend/scripts/prepare-waveform-lab.mjs "cake.wav" "tape.m4a" "tremor.mp3"');
  console.error('Or: node frontend/scripts/prepare-waveform-lab.mjs --add destination.wav /path/to/source.wav [destination.mp3 /path/to/source.mp3 ...]');
  process.exit(1);
}
const directory = resolve(root, "tmp/waveform-lab");
const entries = adding
  ? Array.from({ length: (paths.length - 1) / 2 }, (_, i) => [paths[i * 2 + 1], paths[i * 2 + 2]])
  : ["unsweetened-cake.wav", "masking-tape.m4a", "overhead-tremor.mp3"].map((name, i) => [name, paths[i]]);
for (const [name] of entries) {
  if (!/^[a-z0-9-]+\.(wav|m4a|mp3)$/.test(name)) throw new Error(`Invalid fixture filename: ${name}`);
}
await mkdir(directory, { recursive: true });
for (const [name, source] of entries) {
  if (name.endsWith(".wav") && !source.toLowerCase().endsWith(".wav")) {
    // Browser compatibility for lossless formats such as ALAC; preserve the source.
    await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-i", resolve(source), "-c:a", "pcm_s24le", resolve(directory, name)]);
  } else {
    await copyFile(resolve(source), resolve(directory, name));
  }
}

// Eight 1.5-second cube corners: silence, bass, mids, bass+mids, treble,
// bass+treble, mids+treble, all three. Equal-energy tones make mapping inspectable.
const rate = 22050;
const samples = rate * 12;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const corner = Math.floor(i / (rate * 1.5));
  const value = [100, 1000, 6000].reduce((sum, hz, band) => sum + ((corner >> band) & 1 ? 0.25 * Math.sin(2 * Math.PI * hz * i / rate) : 0), 0);
  wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}
await writeFile(resolve(directory, "calibration.wav"), wav);
console.log("Local waveform fixtures prepared. Start Storybook with VITE_DEV_CONTEXT=waveform-lab WAVEFORM_LAB_FIXTURES=1 pnpm storybook.");
