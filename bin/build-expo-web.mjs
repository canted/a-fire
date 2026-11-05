import { compressWebAsset } from "./compress-web-asset.mjs";
import { expoWebHtml } from "./expo-web-html.mjs";
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Local release configuration stays separate from development's root .env.
// Exported values (including Docker build arguments) retain precedence.
dotenv.config({ path: path.join(root, '.env.production'), quiet: true });
const output = path.resolve(root, process.argv[2] || 'public/frontend');
process.env.EXPO_PUBLIC_POSTHOG_KEY ||= process.env.VITE_POSTHOG_KEY || '';
process.env.EXPO_PUBLIC_POSTHOG_HOST ||= process.env.VITE_POSTHOG_HOST || '';
const endpoint = process.env.EXPO_PUBLIC_API_URL;
if (!endpoint || !/^https:\/\//.test(endpoint)) throw new Error('EXPO_PUBLIC_API_URL must name the HTTPS production API before building Expo web.');
const parsedEndpoint = new URL(endpoint);
if (parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash) throw new Error('EXPO_PUBLIC_API_URL must not contain credentials, query parameters or a fragment.');
await mkdir(path.dirname(output), { recursive: true });
const staging = await mkdtemp(path.join(path.dirname(output), '.expo-web-'));
try {
  const exported = spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'export', '--platform', 'web', '--clear', '--output-dir', staging], { cwd: path.join(root, 'frontend'), env: process.env, stdio: 'inherit' });
  if (exported.error) throw exported.error;
  if (exported.status !== 0) throw new Error(`Expo web export failed (${exported.status}).`);
  const html = expoWebHtml(await readFile(path.join(staging, 'index.html'), 'utf8'), await readFile(path.join(root, 'frontend/web-metadata.html'), 'utf8'));
  await writeFile(path.join(staging, 'index.html'), html);
  const assets = (await readdir(staging, { recursive: true })).filter(file => /\.(?:js|css)$/.test(file)).sort();
  if (!assets.length || !html.includes('<script')) throw new Error('Expo export did not produce a runnable web entry.');
  const hash = createHash('sha256').update(html);
  for (const asset of assets) {
    const source = await readFile(path.join(staging, asset));
    hash.update(asset).update(source);
    for (const variant of await compressWebAsset(asset, source)) await writeFile(path.join(staging, `${asset}.${variant.extension}`), variant.data);
  }
  const buildId = hash.digest('hex').slice(0, 16);
  await writeFile(path.join(staging, 'client-build.json'), JSON.stringify({ buildId, assets }));
  await writeFile(path.join(staging, 'index.html'), html.replace('</head>', `<meta name="afire-build-id" content="${buildId}">\n</head>`));
  // Keep the exact existing build until the new artifact has passed the checks.
  const previous = `${staging}-previous`;
  let moved = false;
  try { await rename(output, previous); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(staging, output); } catch (error) { if (moved) await rename(previous, output); throw error; }
  if (moved) await rm(previous, { recursive: true, force: true });
  console.log(`Expo web release artifact: ${output}`);
} finally { await rm(staging, { recursive: true, force: true }); }
