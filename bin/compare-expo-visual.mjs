import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
// No automatic baseline updates or content masks. Calibrate the limit with two unchanged reference captures.
const [reference, actual, output, limit] = process.argv.slice(2);
if (!reference || !actual || !output || limit === undefined || !Number.isFinite(Number(limit)) || Number(limit) < 0 || Number(limit) > 1) {
  throw new Error('Usage: node bin/compare-expo-visual.mjs reference.png actual.png output-directory calibrated-max-different-ratio');
}
const images = await Promise.all([reference, actual].map(file => sharp(file).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
const [before, after] = images;
if (before.info.width !== after.info.width || before.info.height !== after.info.height) throw new Error('Capture dimensions differ; recapture at the same viewport.');
const { width, height } = before.info;
const diff = Buffer.alloc(width * height * 3);
let different = 0;
for (let pixel = 0; pixel < width * height; pixel++) {
  const offset = pixel * 3;
  const changed = [0, 1, 2].some(channel => Math.abs(before.data[offset + channel] - after.data[offset + channel]) > 10);
  if (changed) different++;
  diff[offset] = changed ? 220 : 255;
  diff[offset + 1] = changed ? 30 : 255;
  diff[offset + 2] = changed ? 80 : 255;
}
const ratio = different / (width * height);
const report = { reference: path.resolve(reference), actual: path.resolve(actual), width, height, differentPixels: different, differentRatio: ratio, calibratedLimit: Number(limit), pass: ratio <= Number(limit) };
await mkdir(output, { recursive: true });
await sharp(diff, { raw: { width, height, channels: 3 } }).png().toFile(path.join(output, 'difference.png'));
await sharp({ create: { width: width * 2, height, channels: 3, background: '#fff' } }).composite([{ input: reference, left: 0, top: 0 }, { input: actual, left: width, top: 0 }]).png().toFile(path.join(output, 'comparison.png'));
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!report.pass) process.exitCode = 1;
